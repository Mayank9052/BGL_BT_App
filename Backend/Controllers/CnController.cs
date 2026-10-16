// Backend/Controllers/CnController.cs
//
// CN (Credit Note) workflow — only for activities of APPROVED proposals.
//
//   NotStarted / RsmRejected ──Checker: send-to-rsm──► SentForRsmApproval
//   SentForRsmApproval ──RSM: rsm-decision──► RsmApproved | RsmRejected
//   RsmApproved ──Dealer/Team/Checker: final-invoice (file + amount)──► RsmApproved (+ invoice)
//   RsmApproved (+ invoice) ──Checker: send-to-accounts──► SentToAccounts
//   SentToAccounts ──Checker: mark-processed (CN number)──► CnProcessed
//
// Endpoints
//   GET  /api/cn/proposals/{proposalId}               CN state of every activity (+ allowed actions for caller)
//   POST /api/cn/activities/{id}/send-to-rsm          Checker
//   POST /api/cn/activities/{id}/rsm-decision         RSM (Checker may record on RSM's behalf, note mandatory)
//   POST /api/cn/activities/{id}/final-invoice        Dealer / RSM / TSM / Commando / Checker
//   POST /api/cn/activities/{id}/send-to-accounts     Checker (attachments: BGauss invoice, vendor invoices, photos)
//   POST /api/cn/activities/{id}/mark-processed       Checker
//   GET  /api/cn/report?month=&year=&status=&dealer=  Approved vs Actual, activity-wise (scoped to caller)

using System.Security.Claims;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Helpers;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

public record CnRsmDecisionDto(bool Approved, string? Note);
public record CnFinalInvoiceDto(string FileUrl, string? FileName, string? FileType, decimal Amount);
public record CnMarkProcessedDto(string CnNumber);

[ApiController]
[Route("api/cn")]
[Authorize(AuthenticationSchemes = "AzureAD,DealerJwt")]
public class CnController : ControllerBase
{
    private readonly AppDbContext          _db;
    private readonly CnEmailService        _mail;
    private readonly CnAttachmentLoader    _files;
    private readonly ILogger<CnController> _log;

    public CnController(AppDbContext db, CnEmailService mail, CnAttachmentLoader files, ILogger<CnController> log)
    {
        _db = db; _mail = mail; _files = files; _log = log;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CALLER + RELATIONSHIPS
    // ═══════════════════════════════════════════════════════════════════════════
    private sealed record Caller(string Email, string Name, string Role, User? User, bool IsChecker, bool IsViewer);

    private async Task<Caller?> GetCallerAsync()
    {
        User? u = null;
        if (int.TryParse(User.FindFirstValue("sub"), out var id))
            u = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);

        var email = (u?.Email
                     ?? User.FindFirstValue("preferred_username")
                     ?? User.FindFirstValue("email")
                     ?? User.FindFirstValue(ClaimTypes.Email)
                     ?? User.FindFirstValue(ClaimTypes.Upn)
                     ?? "").Trim();
        if (email.Length == 0) return null;

        u ??= await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Email.ToLower() == email.ToLower());

        var role = u?.Role ?? User.FindFirstValue("role") ?? User.FindFirstValue(ClaimTypes.Role) ?? "";
        var name = u?.DisplayName ?? User.FindFirstValue("name") ?? email;

        var isChecker = _mail.CheckerEmails.Contains(email, StringComparer.OrdinalIgnoreCase)
                        || role.Equals("Admin", StringComparison.OrdinalIgnoreCase);
        var isViewer  = isChecker
                        || _mail.ViewerEmails.Contains(email, StringComparer.OrdinalIgnoreCase)
                        || role.Equals("Manager", StringComparison.OrdinalIgnoreCase);

        return new Caller(email, name, role, u, isChecker, isViewer);
    }

    private static bool EmailIn(string email, params string?[] lists) =>
        CnEmailService.Split(lists).Contains(email, StringComparer.OrdinalIgnoreCase);

    private static bool NameIs(string? a, string? b)
    {
        var na = DealerNameMatcher.Normalize(a);
        return na.Length > 0 && na == DealerNameMatcher.Normalize(b);
    }

    private static bool IsRsmFor(Caller c, Proposal p, DealerTeamMapping? m) =>
        m != null
            ? EmailIn(c.Email, m.RsmEmail) || NameIs(c.Name, m.Rsm)
            : NameIs(c.Name, p.RsmName);

    private static bool IsTeamFor(Caller c, Proposal p, DealerTeamMapping? m) =>
        IsRsmFor(c, p, m)
        || (m != null && (EmailIn(c.Email, m.TsmEmail, m.CommandoEmail) || NameIs(c.Name, m.Tsm) || NameIs(c.Name, m.Commando)))
        || NameIs(c.Name, p.RsmName) || NameIs(c.Name, p.TsmName) || NameIs(c.Name, p.CommandoName)
        || string.Equals(p.SubmittedBy, c.Email, StringComparison.OrdinalIgnoreCase);

    private static bool IsDealerFor(Caller c, Proposal p, DealerTeamMapping? m) =>
        c.Role.Equals("Dealer", StringComparison.OrdinalIgnoreCase) && c.User != null
        && (DealerNameMatcher.SameDealer(c.User.DealerName, p.DealerName)
            || (m != null && DealerNameMatcher.SameDealer(c.User.DealerName, m.DealerName)));

    private static bool CanView(Caller c, Proposal p, DealerTeamMapping? m) =>
        c.IsViewer || IsTeamFor(c, p, m) || IsDealerFor(c, p, m);

    private async Task<(Proposal? P, ProposalActivity? A)> LoadAsync(Guid activityId)
    {
        var a = await _db.Set<ProposalActivity>()
            .Include(x => x.Proposal)
            .Include(x => x.MediaFiles)
            .FirstOrDefaultAsync(x => x.Id == activityId);
        return (a?.Proposal, a);
    }

    private Task<DealerTeamMapping?> MappingFor(Proposal p) => DealerNameMatcher.FindMappingAsync(_db, p.DealerName);

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW MODEL
    // ═══════════════════════════════════════════════════════════════════════════
    private object ToView(Caller c, Proposal p, ProposalActivity a, DealerTeamMapping? m)
    {
        var r          = CnReportBuilder.Build(p, a);
        var s          = a.CnStatus;
        var approved   = p.Status == "Approved";
        var isRsm      = IsRsmFor(c, p, m);
        var canUpload  = IsDealerFor(c, p, m) || IsTeamFor(c, p, m) || c.IsChecker;

        var blockers = new List<string>();
        if (!approved)                  blockers.Add("Proposal is not Approved.");
        if (r.PhotoCount == 0)          blockers.Add("Upload at least one activity photo.");
        if (r.VendorInvoiceCount == 0)  blockers.Add("Upload the vendor invoice (PDF / image) in Invoices.");
        if (CnEmailService.Split(m?.RsmEmail).Count == 0) blockers.Add("No RSM email in Dealer Mapping for this dealer.");

        return new
        {
            activityId = a.Id,
            proposalId = p.Id,
            report     = r,
            cnStatus   = s.ToString(),
            approvedBgaussAmount = CnReportBuilder.ApprovedBgaussAmount(a),
            rsmEmails      = CnEmailService.Split(m?.RsmEmail),
            accountsEmails = c.IsChecker ? _mail.AccountsEmails : new List<string>(),

            cnRequestedAt          = a.CnRequestedAt,
            cnRequestedByEmail     = a.CnRequestedByEmail,
            cnRsmDecidedAt         = a.CnRsmDecidedAt,
            cnRsmDecidedByEmail    = a.CnRsmDecidedByEmail,
            cnRsmDecisionNote      = a.CnRsmDecisionNote,
            cnFinalInvoiceUrl      = a.CnFinalInvoiceUrl,
            cnFinalInvoiceFileName = a.CnFinalInvoiceFileName,
            cnFinalInvoiceAt       = a.CnFinalInvoiceAt,
            cnInvoiceAmount        = a.CnInvoiceAmount,
            cnSentToAccountsAt     = a.CnSentToAccountsAt,
            cnSentToAccountsByEmail= a.CnSentToAccountsByEmail,
            cnProcessedAt          = a.CnProcessedAt,
            cnNumber               = a.CnNumber,

            isChecker = c.IsChecker,
            canSendToRsm = c.IsChecker && (s == CnStatus.NotStarted || s == CnStatus.RsmRejected) && blockers.Count == 0,
            sendToRsmBlockers = (s == CnStatus.NotStarted || s == CnStatus.RsmRejected) ? blockers : new List<string>(),
            canRsmDecide       = approved && s == CnStatus.SentForRsmApproval && (isRsm || c.IsChecker),
            rsmDecideOnBehalf  = !isRsm && c.IsChecker,
            canUploadFinalInvoice = approved && s == CnStatus.RsmApproved && canUpload,
            canSendToAccounts  = c.IsChecker && approved && s == CnStatus.RsmApproved
                                 && !string.IsNullOrWhiteSpace(a.CnFinalInvoiceUrl) && (a.CnInvoiceAmount ?? 0) > 0,
            canMarkProcessed   = c.IsChecker && s == CnStatus.SentToAccounts,
        };
    }

    private IActionResult Result(Caller c, Proposal p, ProposalActivity a, DealerTeamMapping? m, CnMailResult? mail, params string[] extraNotes)
    {
        var notes = new List<string>(extraNotes.Where(x => !string.IsNullOrWhiteSpace(x)));
        if (mail != null) notes.AddRange(mail.Notes);
        if (mail is { Sent: false }) notes.Insert(0, "Mail NOT sent — " + mail.Error);
        return Ok(new
        {
            cn          = ToView(c, p, a, m),
            mailSent    = mail?.Sent ?? false,
            mailMessage = notes.Count > 0 ? string.Join(" · ", notes) : null,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET — CN state for every activity of a proposal
    // ═══════════════════════════════════════════════════════════════════════════
    [HttpGet("proposals/{proposalId:guid}")]
    public async Task<IActionResult> GetForProposal(Guid proposalId)
    {
        var c = await GetCallerAsync();
        if (c is null) return Unauthorized();

        var p = await _db.Proposals
            .Include(x => x.Activities).ThenInclude(a => a.MediaFiles)
            .AsSplitQuery().AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == proposalId);
        if (p is null) return NotFound(new { message = "Proposal not found." });

        var m = await MappingFor(p);
        if (!CanView(c, p, m)) return Forbid();

        return Ok(p.Activities.Select(a => ToView(c, p, a, m)));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1 — Checker → RSM
    // ═══════════════════════════════════════════════════════════════════════════
    [HttpPost("activities/{id:guid}/send-to-rsm")]
    public async Task<IActionResult> SendToRsm(Guid id)
    {
        var c = await GetCallerAsync();
        if (c is null) return Unauthorized();
        if (!c.IsChecker) return StatusCode(403, new { message = "Only the Checker can send a CN for RSM approval." });

        var (p, a) = await LoadAsync(id);
        if (p is null || a is null) return NotFound(new { message = "Activity not found." });
        if (p.Status != "Approved")
            return BadRequest(new { message = "CN can be raised only for activities of an Approved proposal." });
        if (a.CnStatus is not (CnStatus.NotStarted or CnStatus.RsmRejected))
            return Conflict(new { message = $"CN is already at '{a.CnStatus}'." });

        var r = CnReportBuilder.Build(p, a);
        if (r.PhotoCount == 0 || r.VendorInvoiceCount == 0)
            return BadRequest(new { message = "Upload at least one activity photo and the vendor invoice before sending for RSM approval." });

        var m = await MappingFor(p);
        var rsm = CnEmailService.Split(m?.RsmEmail);
        if (rsm.Count == 0)
            return BadRequest(new { message = $"No RSM email in Dealer Mapping for '{p.DealerName}'. Update Admin → Dealer Mapping first." });

        var mail = await _mail.SendRsmApprovalRequestAsync(p, a, r, rsm, c.Name);
        if (!mail.Sent)
            return StatusCode(502, new { message = $"Mail not sent — {mail.Error}. CN status NOT changed; you can retry." });

        a.CnStatus            = CnStatus.SentForRsmApproval;
        a.CnRequestedAt       = DateTimeOffset.UtcNow;
        a.CnRequestedByEmail  = c.Email;
        a.CnRsmDecidedAt      = null;
        a.CnRsmDecidedByEmail = null;
        a.CnRsmDecisionNote   = null;
        await _db.SaveChangesAsync();

        _log.LogInformation("CN {Act}: sent for RSM approval by {By} to {Rsm}", a.Id, c.Email, string.Join(",", rsm));
        return Result(c, p, a, m, mail);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2 — RSM decision
    // ═══════════════════════════════════════════════════════════════════════════
    [HttpPost("activities/{id:guid}/rsm-decision")]
    public async Task<IActionResult> RsmDecision(Guid id, [FromBody] CnRsmDecisionDto dto)
    {
        var c = await GetCallerAsync();
        if (c is null) return Unauthorized();

        var (p, a) = await LoadAsync(id);
        if (p is null || a is null) return NotFound(new { message = "Activity not found." });
        if (a.CnStatus != CnStatus.SentForRsmApproval)
            return Conflict(new { message = $"CN is at '{a.CnStatus}', not awaiting RSM approval." });

        var m = await MappingFor(p);
        var isRsm = IsRsmFor(c, p, m);
        if (!isRsm && !c.IsChecker)
            return StatusCode(403, new { message = "Only the dealer's RSM (as per Dealer Mapping) can approve or reject this CN." });

        var note = (dto.Note ?? "").Trim();
        if (!dto.Approved && note.Length == 0)
            return BadRequest(new { message = "Rejection reason is required." });
        if (!isRsm && note.Length == 0)
            return BadRequest(new { message = "Recording on the RSM's behalf: add a note, e.g. 'Approved by RSM on email dated DD.MM.YYYY'." });

        a.CnStatus            = dto.Approved ? CnStatus.RsmApproved : CnStatus.RsmRejected;
        a.CnRsmDecidedAt      = DateTimeOffset.UtcNow;
        a.CnRsmDecidedByEmail = c.Email;
        a.CnRsmDecisionNote   = (isRsm ? "" : "[Recorded by Checker on RSM's behalf] ") + note;
        await _db.SaveChangesAsync();

        CnMailResult mail;
        if (dto.Approved)
        {
            var r = CnReportBuilder.Build(p, a);
            var dealer = CnEmailService.Split(p.DealerEmail, m?.DealerEmail);
            var cc     = CnEmailService.Split(m?.RsmEmail, m?.TsmEmail, m?.CommandoEmail);
            mail = dealer.Count == 0
                ? new CnMailResult(false, "No dealer email on the proposal or in Dealer Mapping — inform the dealer to upload the BGauss invoice.", new())
                : await _mail.SendRsmApprovedAsync(p, a, r, dealer, cc, c.Name);
        }
        else
        {
            var cc = CnEmailService.Split(p.DealerEmail, m?.DealerEmail, m?.RsmEmail);
            mail = await _mail.SendRsmRejectedAsync(p, a, a.CnRsmDecisionNote!, c.Name, cc);
        }

        _log.LogInformation("CN {Act}: RSM decision {Dec} by {By}", a.Id, a.CnStatus, c.Email);
        return Result(c, p, a, m, mail);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3 — BGauss-name invoice (file + amount)
    // ═══════════════════════════════════════════════════════════════════════════
    [HttpPost("activities/{id:guid}/final-invoice")]
    public async Task<IActionResult> FinalInvoice(Guid id, [FromBody] CnFinalInvoiceDto dto)
    {
        var c = await GetCallerAsync();
        if (c is null) return Unauthorized();

        var (p, a) = await LoadAsync(id);
        if (p is null || a is null) return NotFound(new { message = "Activity not found." });
        if (a.CnStatus != CnStatus.RsmApproved)
            return Conflict(new { message = "The BGauss invoice can be uploaded only after RSM approval and before it is sent to Accounts." });

        var m = await MappingFor(p);
        if (!(IsDealerFor(c, p, m) || IsTeamFor(c, p, m) || c.IsChecker)) return Forbid();

        if (string.IsNullOrWhiteSpace(dto.FileUrl))
            return BadRequest(new { message = "Invoice file is required." });
        if (dto.Amount <= 0)
            return BadRequest(new { message = "Invoice amount must be greater than zero." });

        var maxAmount = CnReportBuilder.ApprovedBgaussAmount(a);
        if (dto.Amount > maxAmount)
            return BadRequest(new
            {
                message = $"Invoice amount Rs.{dto.Amount:N0} exceeds the approved BGauss amount Rs.{maxAmount:N0}. " +
                          "Correct the invoice, or raise a budget addition first.",
            });

        var replaced = !string.IsNullOrWhiteSpace(a.CnFinalInvoiceUrl);
        a.CnFinalInvoiceUrl      = dto.FileUrl.Trim();
        a.CnFinalInvoiceFileName = string.IsNullOrWhiteSpace(dto.FileName) ? "BGauss_Invoice" : dto.FileName.Trim();
        a.CnInvoiceAmount        = Math.Round(dto.Amount, 2);
        a.CnFinalInvoiceAt       = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();

        var r = CnReportBuilder.Build(p, a);
        var mail = await _mail.SendFinalInvoiceReceivedAsync(p, a, r, $"{c.Name} ({c.Email})", CnEmailService.Split(m?.RsmEmail));

        _log.LogInformation("CN {Act}: BGauss invoice {Mode} by {By}, amount {Amt}", a.Id, replaced ? "replaced" : "uploaded", c.Email, a.CnInvoiceAmount);
        return Result(c, p, a, m, mail, replaced ? "Previous invoice replaced." : "");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4 — Checker → Accounts (with all supporting documents)
    // ═══════════════════════════════════════════════════════════════════════════
    [HttpPost("activities/{id:guid}/send-to-accounts")]
    public async Task<IActionResult> SendToAccounts(Guid id)
    {
        var c = await GetCallerAsync();
        if (c is null) return Unauthorized();
        if (!c.IsChecker) return StatusCode(403, new { message = "Only the Checker can send a CN to Accounts." });

        var (p, a) = await LoadAsync(id);
        if (p is null || a is null) return NotFound(new { message = "Activity not found." });
        if (a.CnStatus != CnStatus.RsmApproved)
            return Conflict(new { message = $"CN is at '{a.CnStatus}'. It must be RSM-approved first." });
        if (string.IsNullOrWhiteSpace(a.CnFinalInvoiceUrl) || (a.CnInvoiceAmount ?? 0) <= 0)
            return BadRequest(new { message = "The dealer's invoice in BGauss's name (file + amount) is not uploaded yet." });
        if (_mail.AccountsEmails.Count == 0)
            return BadRequest(new { message = "Accounts team email not configured (Cn:AccountsTeamEmails)." });

        var m = await MappingFor(p);
        var r = CnReportBuilder.Build(p, a);
        var (files, links, notes) = await _files.CollectAsync(a);

        var mail = await _mail.SendToAccountsAsync(p, a, r, files, links, _mail.AccountsCc, $"{c.Name} ({c.Email})");
        if (!mail.Sent)
            return StatusCode(502, new { message = $"Mail not sent — {mail.Error}. CN status NOT changed; you can retry." });

        a.CnStatus                = CnStatus.SentToAccounts;
        a.CnSentToAccountsAt      = DateTimeOffset.UtcNow;
        a.CnSentToAccountsByEmail = c.Email;
        await _db.SaveChangesAsync();

        _log.LogInformation("CN {Act}: sent to Accounts by {By} with {N} attachment(s), {L} link(s)", a.Id, c.Email, files.Count, links.Count);
        return Result(c, p, a, m, mail, $"{files.Count} file(s) attached" + (links.Count > 0 ? $", {links.Count} as link(s)" : ""), string.Join(" ", notes));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5 — CN processed (Checker records CN number from Accounts)
    // ═══════════════════════════════════════════════════════════════════════════
    [HttpPost("activities/{id:guid}/mark-processed")]
    public async Task<IActionResult> MarkProcessed(Guid id, [FromBody] CnMarkProcessedDto dto)
    {
        var c = await GetCallerAsync();
        if (c is null) return Unauthorized();
        if (!c.IsChecker) return StatusCode(403, new { message = "Only the Checker can mark a CN as processed." });

        var cnNo = (dto.CnNumber ?? "").Trim();
        if (cnNo.Length == 0 || cnNo.Length > 50)
            return BadRequest(new { message = "CN number is required (max 50 characters)." });

        var (p, a) = await LoadAsync(id);
        if (p is null || a is null) return NotFound(new { message = "Activity not found." });
        if (a.CnStatus != CnStatus.SentToAccounts)
            return Conflict(new { message = $"CN is at '{a.CnStatus}'. It must be sent to Accounts first." });

        a.CnStatus           = CnStatus.CnProcessed;
        a.CnNumber           = cnNo;
        a.CnProcessedAt      = DateTimeOffset.UtcNow;
        a.CnProcessedByEmail = c.Email;
        await _db.SaveChangesAsync();

        var m = await MappingFor(p);
        var r = CnReportBuilder.Build(p, a);
        var to = CnEmailService.Split(p.DealerEmail, m?.DealerEmail);
        var cc = CnEmailService.Split(m?.RsmEmail, m?.TsmEmail, m?.CommandoEmail);
        var mail = to.Count == 0
            ? new CnMailResult(false, "No dealer email — CN recorded, dealer not informed by mail.", new())
            : await _mail.SendCnProcessedAsync(p, a, r, to, cc);

        _log.LogInformation("CN {Act}: processed, CN No {No}, by {By}", a.Id, cnNo, c.Email);
        return Result(c, p, a, m, mail);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REPORT — activity-wise Approved vs Actual (approved proposals only)
    // ═══════════════════════════════════════════════════════════════════════════
    [HttpGet("report")]
    public async Task<IActionResult> Report(
        [FromQuery] string? month, [FromQuery] string? year, [FromQuery] string? status, [FromQuery] string? dealer)
    {
        var c = await GetCallerAsync();
        if (c is null) return Unauthorized();

        var query = _db.Proposals.AsNoTracking().Where(p => p.Status == "Approved");
        if (!string.IsNullOrWhiteSpace(month)) query = query.Where(p => p.Month == month);

        var proposals = await query
            .Include(p => p.Activities).ThenInclude(a => a.MediaFiles)
            .AsSplitQuery()
            .ToListAsync();

        var maps = await _db.Set<DealerTeamMapping>().AsNoTracking().ToListAsync();
        var mapByKey = maps
            .GroupBy(x => DealerNameMatcher.Normalize(x.DealerName))
            .Where(g => g.Key.Length > 0 && g.Count() == 1)
            .ToDictionary(g => g.Key, g => g.First());

        var dealerKey = DealerNameMatcher.Normalize(dealer);
        var rows = new List<CnReportRow>();

        foreach (var p in proposals)
        {
            if (!string.IsNullOrWhiteSpace(year) && $"{p.Year}" != year) continue;
            var key = DealerNameMatcher.Normalize(p.DealerName);
            if (dealerKey.Length > 0 && key != dealerKey) continue;

            mapByKey.TryGetValue(key, out var m);
            if (!CanView(c, p, m)) continue;

            foreach (var a in p.Activities)
            {
                if (!string.IsNullOrWhiteSpace(status) &&
                    !string.Equals(a.CnStatus.ToString(), status, StringComparison.OrdinalIgnoreCase)) continue;
                rows.Add(CnReportBuilder.Build(p, a));
            }
        }

        return Ok(rows
            .OrderBy(r => r.Year).ThenBy(r => r.Month).ThenBy(r => r.DealerName).ThenBy(r => r.ActivityName));
    }
}

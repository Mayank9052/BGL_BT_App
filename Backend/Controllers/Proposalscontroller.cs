using System.Security.Claims;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/proposals")]
[Authorize]
public class ProposalsController : ControllerBase
{
    private readonly AppDbContext  _db;
    private readonly BaplDbContext _bapl;
    private readonly IEmailService _emailService;
    private readonly ILogger<ProposalsController> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly DailyDigestService _digestService; // ← immediate-send
    private readonly IConfiguration _config;             // ← NEW (1G): Email:SuppressIndividualForwardMails
    private readonly DealerTypeService _dealerType;      // ← 26.10: RRERP Old/New rule (shared)

    private string GraphToken() =>
        Request.Headers["X-Graph-Token"].FirstOrDefault() ?? "";

    public ProposalsController(
        AppDbContext  db,
        BaplDbContext bapl,
        IEmailService emailService,
        ILogger<ProposalsController> logger,
        IServiceScopeFactory scopeFactory,
        DailyDigestService digestService,
        IConfiguration config,              // ← NEW (1G)
        DealerTypeService dealerType)       // ← 26.10
    {
        _db             = db;
        _bapl           = bapl;
        _emailService   = emailService;
        _logger         = logger;
        _scopeFactory   = scopeFactory;
        _digestService  = digestService;
        _config         = config;
        _dealerType     = dealerType;
    }

    // ── POST /api/proposals ───────────────────────────────────────────────────
    [HttpPost]
    public async Task<ActionResult<ProposalResponseDto>> Create(CreateProposalDto dto)
    {
        if (dto.Activities is null || dto.Activities.Count == 0)
            return BadRequest("At least one activity is required.");

        var duplicateTypes = dto.Activities
            .Where(a => !string.IsNullOrWhiteSpace(a.ActivityType))
            .GroupBy(a => a.ActivityType.Trim().ToLower())
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();

        if (duplicateTypes.Count > 0)
            return BadRequest(new
            {
                message = $"Duplicate activity type(s) not allowed in the same proposal: " +
                           $"{string.Join(", ", duplicateTypes)}"
            });

        var (datesOk, dateError) = ValidateActivityDates(dto.Activities, dto.Month, dto.Year);
        if (!datesOk) return BadRequest(new { message = dateError });

        var submittedBy = CurrentUserEmail();
        var submitter = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Email == submittedBy);

        var activities = dto.Activities.Select(a => new ProposalActivity
        {
            ActivityType     = a.ActivityType,
            Category         = a.Category,
            Subcategory      = a.Subcategory,
            Qty              = a.Qty > 0 ? a.Qty : 1,
            SalesPercent     = a.SalesPercent,
            LeadTarget       = a.LeadTarget,
            RetailTarget     = a.RetailTarget,
            StartDate        = ParseDate(a.StartDate),
            EndDate          = ParseDate(a.EndDate),
            Budget           = a.Budget,
            AdditionalBudget = a.AdditionalBudget,
            BGaussShare      = a.BGaussShare > 0 ? a.BGaussShare : 100m,
            VendorId         = a.VendorId,
            Remarks          = a.Remarks,
            MediaFiles       = (a.MediaFiles ?? new List<MediaFileDto>())
                .Where(m => !string.IsNullOrWhiteSpace(m.FileUrl))
                .Select(m => new ActivityMedia
                {
                    FileUrl  = m.FileUrl,
                    FileName = m.FileName,
                    FileType = m.FileType,
                }).ToList(),
        }).ToList();

        var totalBudget       = activities.Sum(a => a.Budget + a.AdditionalBudget);
        var totalLeadTarget   = activities.Sum(a => a.LeadTarget);
        var totalRetailTarget = activities.Sum(a => a.RetailTarget);
        var cac = totalRetailTarget > 0 ? Math.Round(totalBudget / totalRetailTarget, 2) : 0m;
        var cpl = totalLeadTarget   > 0 ? Math.Round(totalBudget / totalLeadTarget,   2) : 0m;

        var (allowedCac, cacWarning) = await GetCacLimitAsync(dto.DealerName, cac);

        var proposal = new Proposal
        {
            State                  = dto.State,
            Location               = dto.Location,
            Type                   = dto.Type,
            DealerName             = dto.DealerName,
            VendorId               = dto.VendorId,
            VendorName             = dto.VendorName,
            RsmName                = dto.RsmName,
            TsmName                = dto.TsmName,
            CommandoName           = dto.CommandoName,
            Month                  = dto.Month,
            Year                   = dto.Year,
            Eligibility            = dto.Eligibility,
            Remarks                = dto.Remarks,
            TotalBudget            = totalBudget,
            TotalLeadTarget        = totalLeadTarget,
            TotalRetailTarget      = totalRetailTarget,
            Cac                    = cac,
            Cpl                    = cpl,
            AllowedCac             = allowedCac,
            CacWarning             = cacWarning,
            SubmittedBy            = submittedBy,
            SubmittedByDisplayName = submitter?.DisplayName ?? dto.RsmName,
            Activities             = activities,
            TokenNumber            = GenerateTokenNumber(),
            Status                 = "Pending",
        };

        _db.Proposals.Add(proposal);
        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        var (sent, error) = await _emailService.SendSubmissionMailAsync(proposal, GraphToken());
        if (!sent)
            _logger.LogWarning("Submission mail failed for proposal {Id}: {Error}", proposal.Id, error);

        return CreatedAtAction(nameof(GetById), new { id = proposal.Id }, ToResponse(proposal));
    }

    [HttpPost("{id:guid}/notify-team")]
    public async Task<ActionResult<ProposalResponseDto>> NotifyTeam(
        Guid id, [FromBody] NotifyTeamDto dto)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();
        if (proposal.Status != "Approved")
            return Conflict(new { message = "Only approved proposals can have their team notified." });

        var (sent, error) = await _emailService.SendTeamNotificationMailAsync(
            proposal, dto.RsmEmail, dto.TsmEmail, dto.CommandoEmail, GraphToken());

        if (!sent)
            return BadRequest(new { error = error ?? "Failed to send team notification." });

        proposal.TeamNotified   = true;
        proposal.TeamNotifiedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(ToResponse(proposal));
    }

    // ── GET /api/proposals/{id}/ai-review ─────────────────────────────────────
    [HttpGet("{id:guid}/ai-review")]
    public async Task<ActionResult<ProposalAiReviewDto>> GetAiReview(Guid id)
    {
        var review = await _db.ProposalAiReviews
            .Include(r => r.Flags)
            .Where(r => r.ProposalId == id)
            .OrderByDescending(r => r.RunAt)
            .AsNoTracking()
            .FirstOrDefaultAsync();

        if (review is null)
            return NotFound(new { message = "No AI review yet for this proposal." });

        return Ok(ToAiReviewResponse(review));
    }

    // ── POST /api/proposals/{id}/ai-review/rerun ──────────────────────────────
    [HttpPost("{id:guid}/ai-review/rerun")]
    public async Task<ActionResult<ProposalAiReviewDto>> RerunAiReview(
        Guid id, [FromServices] IProposalAiReviewService reviewSvc)
    {
        var exists = await _db.Proposals.AnyAsync(p => p.Id == id);
        if (!exists) return NotFound();

        var review = await reviewSvc.ReviewAsync(id);
        return Ok(ToAiReviewResponse(review));
    }

    private static ProposalAiReviewDto ToAiReviewResponse(Models.ProposalAiReview r) => new(
        r.Id, r.ProposalId, r.Status, r.OverallVerdict, r.Summary, r.ModelUsed,
        r.ToolCallCount, r.RunAt, r.ErrorMessage,
        r.Flags.Select(f => new ProposalAiFlagDto(f.Id, f.Severity, f.Title, f.Detail, f.RelatedActivityType)).ToList()
    );

    // ── GET /api/proposals ────────────────────────────────────────────────────
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetAll()
    {
        var proposals = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(proposals.Select(ToResponse));
    }

    // ── GET /api/proposals/mine ───────────────────────────────────────────────
    [HttpGet("mine")]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetMine()
    {
        var email = CurrentUserEmail();

        var proposals = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .Where(p => p.SubmittedBy == email)
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(proposals.Select(ToResponse));
    }

    // ── GET /api/proposals/by-dealer?name={dealerName} ────────────────────────
    [HttpGet("by-dealer")]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetByDealer(
        [FromQuery] string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { message = "Dealer name is required." });

        var proposals = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .Where(p => p.DealerName == name)
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(proposals.Select(ToResponse));
    }

    // ── GET /api/proposals/activity-types-used ────────────────────────────────
    [HttpGet("activity-types-used")]
    public async Task<ActionResult<IEnumerable<string>>> GetActivityTypesUsed(
        [FromQuery] string dealerName, [FromQuery] string month)
    {
        if (string.IsNullOrWhiteSpace(dealerName) || string.IsNullOrWhiteSpace(month))
            return BadRequest(new { message = "dealerName and month are required." });

        var types = await _db.Proposals
            .Where(p => p.DealerName == dealerName
                     && p.Month == month
                     && p.Status != "Rejected")
            .SelectMany(p => p.Activities)
            .Select(a => a.ActivityType)
            .Distinct()
            .ToListAsync();

        return Ok(types);
    }

    // ── GET /api/proposals/{id} ───────────────────────────────────────────────
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProposalResponseDto>> GetById(Guid id)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id);

        return proposal is null ? NotFound() : Ok(ToResponse(proposal));
    }

    // ── PUT /api/proposals/{id} ───────────────────────────────────────────────
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ProposalResponseDto>> Update(Guid id, UpdateProposalDto dto)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();

        // ── Budget Addition bypass: allow editing an Approved proposal
        // ONLY when the edit is triggered by the budget-addition flow
        // (i.e. dto.CheckerRemarks starts with "[Budget Addition Request from Dealer]")
        // For all other cases, block editing approved/rejected proposals.
        bool isBudgetAdditionEdit =
            !string.IsNullOrWhiteSpace(dto.CheckerRemarks) &&
            dto.CheckerRemarks.StartsWith("[Budget Addition Request from Dealer]",
                StringComparison.OrdinalIgnoreCase);

        if ((proposal.Status is "Approved" or "Rejected") && !isBudgetAdditionEdit)
            return Conflict(new { message = $"This proposal was already {proposal.Status} and cannot be modified." });

        if (dto.Activities is null || dto.Activities.Count == 0)
            return BadRequest(new { message = "At least one activity is required." });

        var duplicateTypes = dto.Activities
            .Where(a => !string.IsNullOrWhiteSpace(a.ActivityType))
            .GroupBy(a => a.ActivityType.Trim().ToLower())
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();

        if (duplicateTypes.Count > 0)
            return BadRequest(new
            {
                message = $"Duplicate activity type(s) not allowed: " +
                           $"{string.Join(", ", duplicateTypes)}"
            });

        // Skip backdate validation for budget addition edits on Approved proposals
        if (!isBudgetAdditionEdit)
        {
            var (datesOk, dateError) = ValidateActivityDates(dto.Activities, dto.Month, dto.Year);
            if (!datesOk) return BadRequest(new { message = dateError });
        }

        var wasNeedsRevision = proposal.Status == "NeedsRevision";

        proposal.DealerName     = dto.DealerName;
        proposal.VendorId       = dto.VendorId;
        proposal.VendorName     = dto.VendorName;
        proposal.Location       = dto.Location;
        proposal.State          = dto.State;
        proposal.Type           = dto.Type;
        proposal.RsmName        = dto.RsmName;
        proposal.TsmName        = dto.TsmName;
        proposal.CommandoName   = dto.CommandoName;
        proposal.Month          = dto.Month;
        proposal.Year           = dto.Year;
        proposal.Eligibility    = dto.Eligibility;
        proposal.Remarks        = dto.Remarks;
        proposal.CheckerRemarks = dto.CheckerRemarks;  // ← FIX: was missing

        await _db.ProposalActivities
            .Where(a => a.ProposalId == id)
            .ExecuteDeleteAsync();

        var newActivities = dto.Activities.Select(a => new ProposalActivity
        {
            Id               = Guid.NewGuid(),
            ProposalId       = id,
            ActivityType     = a.ActivityType,
            Category         = a.Category,
            Subcategory      = a.Subcategory,
            Qty              = a.Qty > 0 ? a.Qty : 1,
            SalesPercent     = a.SalesPercent,
            LeadTarget       = a.LeadTarget,
            RetailTarget     = a.RetailTarget,
            StartDate        = ParseDate(a.StartDate),
            EndDate          = ParseDate(a.EndDate),
            Budget           = a.Budget,
            AdditionalBudget = a.AdditionalBudget,
            BGaussShare      = a.BGaussShare > 0 ? a.BGaussShare : 100m,
            VendorId         = a.VendorId,
            Remarks          = a.Remarks,
            MediaFiles       = (a.MediaFiles ?? new List<MediaFileDto>())
                .Where(m => !string.IsNullOrWhiteSpace(m.FileUrl))
                .Select(m => new ActivityMedia
                {
                    FileUrl  = m.FileUrl,
                    FileName = m.FileName,
                    FileType = m.FileType,
                }).ToList(),
        }).ToList();

        await _db.ProposalActivities.AddRangeAsync(newActivities);

        proposal.TotalBudget       = newActivities.Sum(a => a.Budget + a.AdditionalBudget);
        proposal.TotalLeadTarget   = newActivities.Sum(a => a.LeadTarget);
        proposal.TotalRetailTarget = newActivities.Sum(a => a.RetailTarget);
        proposal.Cac = proposal.TotalRetailTarget > 0
            ? Math.Round(proposal.TotalBudget / proposal.TotalRetailTarget, 2) : 0m;
        proposal.Cpl = proposal.TotalLeadTarget > 0
            ? Math.Round(proposal.TotalBudget / proposal.TotalLeadTarget, 2) : 0m;

        var (allowedCac, cacWarning) = await GetCacLimitAsync(proposal.DealerName, proposal.Cac);
        proposal.AllowedCac = allowedCac;
        proposal.CacWarning = cacWarning;

        // For budget addition: keep status as Pending so Vijay can re-approve
        // For NeedsRevision: reset to Pending so RSM's resubmit goes back for review
        if (wasNeedsRevision)
        {
            proposal.Status       = "Pending";
            proposal.ApproverNote = null;
        }
        else if (isBudgetAdditionEdit)
        {
            // Reset to Pending so Vijay sees it in queue
            proposal.Status = "Pending";
        }

        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        var updated = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .AsNoTracking()
            .FirstAsync(p => p.Id == id);

        if (wasNeedsRevision)
        {
            var (sent, error) = await _emailService.SendResubmissionMailAsync(updated, GraphToken());
            if (!sent)
                _logger.LogWarning("Resubmission mail failed for {Id}: {Error}", updated.Id, error);
        }
        // Budget addition email is sent from ForwardToApprover, not here

        return Ok(ToResponse(updated));
    }

    // ── DELETE /api/proposals/{id} ────────────────────────────────────────────
    // [BTL-2026-10-26] Admin role only (Users.Role = "Admin"; Manager is NOT allowed).
    // Hard delete in one transaction: AI reviews + flags, approval decisions,
    // activity media, activities, proposal. Logged with who/what for audit.
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var email  = CurrentUserEmail();
        var caller = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == email);
        if (caller is null || !string.Equals(caller.Role, "Admin", StringComparison.OrdinalIgnoreCase))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Only Admin can delete proposals." });

        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (proposal is null) return NotFound(new { message = "Proposal not found." });

        var token = proposal.TokenNumber ?? proposal.Id.ToString();
        try
        {
            // EnableRetryOnFailure is on → user transactions must run inside the execution strategy.
            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                await using var tx = await _db.Database.BeginTransactionAsync();

                var reviews = await _db.ProposalAiReviews
                    .Include(r => r.Flags)
                    .Where(r => r.ProposalId == id)
                    .ToListAsync();
                _db.RemoveRange(reviews.SelectMany(r => r.Flags).Cast<object>());
                _db.RemoveRange(reviews);

                var decisions = await _db.ApprovalDecisions.Where(d => d.ProposalId == id).ToListAsync();
                _db.ApprovalDecisions.RemoveRange(decisions);

                _db.ActivityMediaFiles.RemoveRange(proposal.Activities.SelectMany(a => a.MediaFiles));
                _db.ProposalActivities.RemoveRange(proposal.Activities);
                _db.Proposals.Remove(proposal);

                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            });
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Delete blocked for proposal {Token} by {User}", token, email);
            return Conflict(new { message = "Proposal could not be deleted — other records still refer to it (e.g. Credit Note data). Nothing was deleted." });
        }

        _logger.LogWarning("Proposal {Token} ({Dealer}, {Month} {Year}, status {Status}) DELETED by {User}",
            token, proposal.DealerName, proposal.Month, proposal.Year, proposal.Status, email);
        return Ok(new { deleted = true, token });
    }

    // ── POST /api/proposals/{id}/dealer-sendback ──────────────────────────────
    [HttpPost("{id:guid}/dealer-sendback")]
    [Authorize(AuthenticationSchemes = "DealerJwt")]
    public async Task<ActionResult<ProposalResponseDto>> DealerSendBack(
        Guid id, [FromBody] DealerSendBackDto dto)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();
        if (proposal.Status != "Approved")
            return Conflict(new { message = "Only approved proposals can have add-on requests." });
        if (string.IsNullOrWhiteSpace(dto.DealerEmail))
            return BadRequest(new { message = "Dealer email is required." });
        if (string.IsNullOrWhiteSpace(dto.RequestNote))
            return BadRequest(new { message = "Request note is required." });

        proposal.DealerSendBackNote = dto.RequestNote.Trim();
        proposal.DealerSentBack     = true;
        proposal.DealerSentBackAt   = DateTimeOffset.UtcNow;

        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        var graphToken = Request.Headers["X-Graph-Token"].FirstOrDefault() ?? "";
        var (sent, error) = await _emailService.SendDealerSendBackMailAsync(
            proposal, dto.DealerEmail, dto.RequestNote, graphToken);

        if (!sent)
            _logger.LogWarning("Dealer send-back mail failed for {Id}: {Error}", proposal.Id, error);

        return Ok(ToResponse(proposal));
    }

    // ── PATCH /api/proposals/{id}/decide ─────────────────────────────────────
    [HttpPatch("{id:guid}/decide")]
    public async Task<ActionResult<ProposalResponseDto>> Decide(Guid id, DecideProposalDto dto)
    {
        if (dto.Status != "Approved" && dto.Status != "Rejected")
            return BadRequest("Status must be 'Approved' or 'Rejected'.");

        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();
        if (proposal.Status is "Approved" or "Rejected")
            return Conflict(new { message = $"This proposal was already {proposal.Status}." });

        var approvedBy = dto.ApprovedBy ?? CurrentUserEmail();

        proposal.Status       = dto.Status;
        proposal.ApproverNote = dto.ApproverNote;
        proposal.ApprovedBy   = approvedBy;
        proposal.DecidedAt    = DateTimeOffset.UtcNow;

        var decision = new ApprovalDecision
        {
            ProposalId   = proposal.Id,
            Status       = dto.Status,
            ApproverNote = dto.ApproverNote,
            ApprovedBy   = approvedBy,
        };
        _db.ApprovalDecisions.Add(decision);
        await _db.SaveChangesAsync();

        // Approved → cc RSM/TSM/Commando from Dealer Mapping. Rejected → Checker + submitter only.
        List<string>? teamCc = null;
        if (dto.Status == "Approved")
        {
            var mapping = await DealerNameMatcher.FindMappingAsync(_db, proposal.DealerName);
            teamCc = DealerNameMatcher.TeamEmails(mapping);
            if (mapping is null)
                _logger.LogWarning("No Dealer Mapping for '{Dealer}' — approval mail sent without team cc.", proposal.DealerName);
        }

        var (sent, error) = await _emailService.SendDecisionMailAsync(proposal, decision, GraphToken(), teamCc);
        decision.MailSent   = sent;
        decision.MailSentAt = sent ? DateTimeOffset.UtcNow : null;
        decision.MailError  = error;
        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        if (!sent)
            _logger.LogWarning("Decision mail failed for proposal {Id}: {Error}", proposal.Id, error);

        return Ok(ToResponse(proposal));
    }

    // ── PATCH /api/proposals/{id}/sendback ───────────────────────────────────
    [HttpPatch("{id:guid}/sendback")]
    public async Task<ActionResult<ProposalResponseDto>> SendBack(Guid id, [FromBody] SendBackDto dto)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();
        if (proposal.Status is "Approved" or "Rejected")
            return Conflict(new { message = "Cannot send back a finalised proposal." });

        proposal.Status       = "NeedsRevision";
        proposal.ApproverNote = dto.Note?.Trim();
        proposal.ApprovedBy   = dto.SentBackBy ?? CurrentUserEmail();

        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        var (sent, error) = await _emailService.SendRevisionRequestMailAsync(proposal, dto.Note, GraphToken());
        if (!sent)
            _logger.LogWarning("Send-back mail failed for {Id}: {Error}", proposal.Id, error);

        return Ok(ToResponse(proposal));
    }

    // ── PATCH /api/proposals/{id}/actuals ─────────────────────────────────────
    // Staff (Azure) OR Dealer login. A dealer can only update proposals of its own dealership.
    [HttpPatch("{id:guid}/actuals")]
    [Authorize(AuthenticationSchemes = "AzureAD,DealerJwt")]
    public async Task<ActionResult<ProposalResponseDto>> UpdateActuals(
        Guid id, [FromBody] List<UpdateActivityActualsDto> actuals)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();
        if (proposal.Status != "Approved")
            return BadRequest(new { message = "Actuals can only be added after approval." });

        // Dealer caller → must own this proposal
        var sub = User.FindFirstValue("sub");
        if (int.TryParse(sub, out var userId))
        {
            var caller = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
            if (caller is not null && string.Equals(caller.Role, "Dealer", StringComparison.OrdinalIgnoreCase))
            {
                var mapping = await DealerNameMatcher.FindMappingAsync(_db, caller.DealerName);
                var own = DealerNameMatcher.SameDealer(caller.DealerName, proposal.DealerName)
                       || (mapping is not null && DealerNameMatcher.SameDealer(mapping.DealerName, proposal.DealerName));
                if (!own) return Forbid();
            }
        }

        // Actual dates: proposal month + next month only
        var mIdx = Array.IndexOf(MonthNames, proposal.Month);
        if (mIdx >= 0 && int.TryParse(proposal.Year, out var pYear))
        {
            var minD = new DateOnly(pYear, mIdx + 1, 1);
            var maxD = minD.AddMonths(2).AddDays(-1);
            foreach (var dto in actuals)
            {
                var s = ParseDate(dto.ActualStartDate);
                var e = ParseDate(dto.ActualEndDate);
                foreach (var v in new[] { s, e })
                    if (v.HasValue && (v.Value < minD || v.Value > maxD))
                        return BadRequest(new { message =
                            $"Actual dates must be between {minD:dd.MM.yyyy} and {maxD:dd.MM.yyyy} for a {proposal.Month} {proposal.Year} proposal." });
                if (s.HasValue && e.HasValue && e.Value < s.Value)
                    return BadRequest(new { message = "Actual end date cannot be before actual start date." });
            }
        }

        foreach (var dto in actuals)
        {
            var activity = proposal.Activities.FirstOrDefault(a => a.Id == dto.ActivityId);
            if (activity is null) continue;

            activity.ActualStartDate = ParseDate(dto.ActualStartDate);
            activity.ActualEndDate   = ParseDate(dto.ActualEndDate);
            if (dto.MediaFileUrl  != null) activity.MediaFileUrl  = dto.MediaFileUrl;
            if (dto.MediaFileName != null) activity.MediaFileName = dto.MediaFileName;
            if (dto.MediaFileType != null) activity.MediaFileType = dto.MediaFileType;
            if (dto.DailyData     != null) activity.DailyData     = dto.DailyData;
        }

        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        return Ok(ToResponse(proposal));
    }

    // ── POST /api/proposals/{id}/activities/{activityId}/media ───────────────
    [HttpPost("{id:guid}/activities/{activityId:guid}/media")]
    [Authorize(AuthenticationSchemes = "AzureAD,DealerJwt")]  // both admin and dealer can add proof
    public async Task<ActionResult<ActivityMediaDto>> AddActivityMedia(
        Guid id, Guid activityId, [FromBody] AddActivityMediaDto dto)
    {
        var activity = await _db.ProposalActivities
            .FirstOrDefaultAsync(a => a.Id == activityId && a.ProposalId == id);

        if (activity is null) return NotFound(new { message = "Activity not found." });

        var media = new ActivityMedia
        {
            ActivityId             = activityId,
            FileUrl                = dto.FileUrl,
            FileName               = dto.FileName,
            FileType               = dto.FileType,
            CapturedAt             = dto.CapturedAt ?? DateTimeOffset.UtcNow,
            Latitude               = dto.Latitude,
            Longitude              = dto.Longitude,
            LocationAccuracyMeters = dto.LocationAccuracyMeters,
        };

        _db.ActivityMediaFiles.Add(media);
        await _db.SaveChangesAsync();

        return Ok(new ActivityMediaDto(
            media.Id, media.FileUrl, media.FileName, media.FileType,
            media.CapturedAt, media.Latitude, media.Longitude, media.LocationAccuracyMeters));
    }

    // ── DELETE /api/proposals/{id}/activities/{activityId}/media/{mediaId} ───
    [HttpDelete("{id:guid}/activities/{activityId:guid}/media/{mediaId:guid}")]
    public async Task<IActionResult> RemoveActivityMedia(Guid id, Guid activityId, Guid mediaId)
    {
        var media = await _db.ActivityMediaFiles
            .FirstOrDefaultAsync(m => m.Id == mediaId && m.ActivityId == activityId);

        if (media is null) return NotFound();

        _db.ActivityMediaFiles.Remove(media);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Removed." });
    }

    // ── GET /api/proposals/my-dealer-proposals ────────────────────────────────
    // Returns EVERY proposal for this dealer, whoever submitted it (RSM Azure login,
    // RSM/TSM local login, or the dealer). Match = normalised name of the dealer
    // login + its Dealer Mapping row. No partial/Contains matching (prevents
    // showing another dealer's proposals).
    [HttpGet("my-dealer-proposals")]
    [Authorize(AuthenticationSchemes = "DealerJwt")]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetMyDealerProposals()
    {
        var sub = User.FindFirstValue("sub");
        if (string.IsNullOrWhiteSpace(sub) || !int.TryParse(sub, out var userId))
            return Unauthorized();

        var dealerUser = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (dealerUser is null) return Unauthorized();
        if (string.IsNullOrWhiteSpace(dealerUser.DealerName))
            return Ok(Array.Empty<ProposalResponseDto>());

        var mapping = await DealerNameMatcher.FindMappingAsync(_db, dealerUser.DealerName);

        var keys = new[] { dealerUser.DealerName, mapping?.DealerName }
            .Select(DealerNameMatcher.Normalize)
            .Where(k => k.Length > 0)
            .ToHashSet();

        var allNames = await _db.Proposals.AsNoTracking()
            .Select(p => p.DealerName).Distinct().ToListAsync();
        var matchedNames = allNames
            .Where(n => keys.Contains(DealerNameMatcher.Normalize(n)))
            .ToList();

        if (matchedNames.Count == 0) return Ok(Array.Empty<ProposalResponseDto>());

        var proposals = await _db.Proposals
            .Include(p => p.Activities).ThenInclude(a => a.MediaFiles)
            .Where(p => matchedNames.Contains(p.DealerName))
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(proposals.Select(ToResponse));
    }

    // ── POST /api/proposals/{id}/forward ─────────────────────────────────────
    [HttpPost("{id:guid}/forward")]
    public async Task<ActionResult<ProposalResponseDto>> ForwardToApprover(Guid id)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();
        if (proposal.Status != "Pending")
            return Conflict(new { message = "Only pending proposals can be forwarded." });

        proposal.CheckedByEmail = CurrentUserEmail();
        proposal.CheckedAt      = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        // ── BUDGET ADDITION re-approval: if dealer sent a budget request,
        // send the dedicated budget addition email (amber) instead of the
        // regular checker-forward email (navy), so Vijay knows it's a
        // budget re-approval, not a fresh proposal. (Unchanged — still sent individually.)
        if (proposal.DealerSentBack && _emailService is GraphEmailService graphSvc)
        {
            try
            {
                var dto     = ToResponse(proposal);
                var amounts = proposal.Activities.ToDictionary(
                    a => a.Id.ToString(),
                    a => a.AdditionalBudget);

                await graphSvc.SendBudgetAdditionEmailAsync(
                    dto,
                    proposal.CheckedByEmail ?? "Manager",
                    amounts,
                    proposal.CheckerRemarks);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Budget addition email failed for {Id}", proposal.Id);
            }
        }
        else
        {
            // ── 1G (Shivam, 26.10.2026): individual "Forward to Final Approver" mails
            // are switched OFF. The Checker reviews all proposals, then sends ONE
            // summary via POST /api/proposals/forward-summary.
            // Set "Email:SuppressIndividualForwardMails": false in appsettings.json
            // to restore the old one-mail-per-proposal behaviour.
            var suppressIndividual = _config.GetValue("Email:SuppressIndividualForwardMails", true);

            if (suppressIndividual)
            {
                _logger.LogInformation(
                    "Proposal {Token} forwarded by {Checker} — individual mail suppressed; will be included in the forward summary.",
                    proposal.TokenNumber, proposal.CheckedByEmail);
            }
            else
            {
                // Regular forward — try the delegated (X-Graph-Token) path first,
                // since it sends from the Checker's own browser session exactly
                // as before. Fall back to the app-only immediate-send path (still
                // using the Checker's own email as sender) if no delegated token
                // was attached to this request.
                var graphToken = GraphToken();
                bool sent; string? error;

                if (!string.IsNullOrWhiteSpace(graphToken))
                {
                    (sent, error) = await _emailService.SendCheckerForwardMailAsync(proposal, graphToken);
                    if (!sent)
                        _logger.LogWarning("Delegated checker-forward mail failed for {Id}: {Error} — trying immediate app-only send.", proposal.Id, error);
                }
                else
                {
                    sent = false;
                }

                if (!sent)
                {
                    var (immSent, immError) = await _digestService.SendForwardDigestNowAsync(
                        new List<Guid> { proposal.Id }, CurrentUserEmail());
                    if (!immSent)
                        _logger.LogWarning("Immediate app-only forward mail also failed for {Id}: {Error}", proposal.Id, immError);
                }
            }
        }

        return Ok(ToResponse(proposal));
    }

    // ── POST /api/proposals/forward-summary ──────────────────────────────────
    // 1G: Checker clicks "Send summary to Final Approver" once all proposals are
    // reviewed and confirmed. Sends ONE mail covering every proposal that has been
    // forwarded and is still Pending with the Final Approver, ordered State → Dealer.
    // Optional ?since=yyyy-MM-dd → only proposals forwarded on/after that date (IST).
    [HttpPost("forward-summary")]
    public async Task<IActionResult> SendForwardSummary([FromQuery] string? since)
    {
        var q = _db.Proposals.AsNoTracking()
            .Where(p => p.Status == "Pending" && p.CheckedByEmail != null);

        if (DateOnly.TryParse(since, out var sinceDate))
        {
            var sinceIst = new DateTimeOffset(sinceDate.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(5.5));
            q = q.Where(p => p.CheckedAt >= sinceIst);
        }

        var ids = await q
            .OrderBy(p => p.State).ThenBy(p => p.DealerName)
            .Select(p => p.Id)
            .ToListAsync();

        if (ids.Count == 0)
            return BadRequest(new { message = "No forwarded proposals are pending with the Final Approver." });

        var (sent, error) = await _digestService.SendForwardDigestNowAsync(ids, CurrentUserEmail());
        if (!sent)
            return BadRequest(new { message = $"Summary mail not sent — {error ?? "unknown error"}." });

        _logger.LogInformation("Forward summary sent by {Checker}: {Count} proposals.", CurrentUserEmail(), ids.Count);
        return Ok(new { sent = true, proposals = ids.Count });
    }

        // ── GET /api/proposals/my-team-proposals ──────────────────────────────────
    [HttpGet("my-team-proposals")]
    [Authorize(AuthenticationSchemes = "DealerJwt")]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetMyTeamProposals()
    {
        var sub = User.FindFirstValue("sub");
        if (string.IsNullOrWhiteSpace(sub) || !int.TryParse(sub, out var userId))
            return Unauthorized();

        var staff = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (staff is null) return Unauthorized();
        if (string.Equals(staff.Role, "Dealer", StringComparison.OrdinalIgnoreCase)) return Forbid();

        var role    = (staff.Role ?? "").Trim();
        var email   = (staff.Email ?? "").Trim();
        var nameKey = DealerNameMatcher.Normalize(staff.DisplayName);

        bool IsMe(string? name, string? emails) =>
            (email.Length > 0 && !string.IsNullOrWhiteSpace(emails) &&
             emails.Split(',', ';').Any(x => string.Equals(x.Trim(), email, StringComparison.OrdinalIgnoreCase)))
            || (nameKey.Length > 0 && DealerNameMatcher.Normalize(name) == nameKey);

        // (a) dealers mapped to me in Dealer Mapping
        var maps = await _db.Set<DealerTeamMapping>().AsNoTracking().ToListAsync();
        IEnumerable<DealerTeamMapping> myMaps =
            role.Equals("RSM", StringComparison.OrdinalIgnoreCase)      ? maps.Where(m => IsMe(m.Rsm, m.RsmEmail)) :
            role.Equals("TSM", StringComparison.OrdinalIgnoreCase)      ? maps.Where(m => IsMe(m.Tsm, m.TsmEmail)) :
            role.Equals("Commando", StringComparison.OrdinalIgnoreCase) ? maps.Where(m => IsMe(m.Commando, m.CommandoEmail)) :
            Enumerable.Empty<DealerTeamMapping>();
        var dealerKeys = myMaps.Select(m => DealerNameMatcher.Normalize(m.DealerName))
                               .Where(k => k.Length > 0).ToHashSet();

        // Light projection only — no activities/media yet
        var heads = await _db.Proposals.AsNoTracking()
            .Select(p => new { p.Id, p.DealerName, p.RsmName, p.TsmName, p.CommandoName, p.SubmittedBy })
            .ToListAsync();

        var ids = heads.Where(h =>
                dealerKeys.Contains(DealerNameMatcher.Normalize(h.DealerName))                                  // (a)
             || (nameKey.Length > 0 && (                                                                         // (b)
                    (role.Equals("RSM", StringComparison.OrdinalIgnoreCase)      && DealerNameMatcher.Normalize(h.RsmName)      == nameKey) ||
                    (role.Equals("TSM", StringComparison.OrdinalIgnoreCase)      && DealerNameMatcher.Normalize(h.TsmName)      == nameKey) ||
                    (role.Equals("Commando", StringComparison.OrdinalIgnoreCase) && DealerNameMatcher.Normalize(h.CommandoName) == nameKey)))
             || (email.Length > 0 && string.Equals(h.SubmittedBy, email, StringComparison.OrdinalIgnoreCase))) // (c)
            .Select(h => h.Id)
            .ToList();

        if (ids.Count == 0) return Ok(Array.Empty<ProposalResponseDto>());

        var proposals = await _db.Proposals
            .Where(p => ids.Contains(p.Id))
            .Include(p => p.Activities).ThenInclude(a => a.MediaFiles)
            .AsSplitQuery()
            .AsNoTracking()
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();

        _logger.LogInformation("my-team-proposals: {Email} ({Role}) → {Maps} mapped dealers, {Count} proposals",
            email, role, dealerKeys.Count, proposals.Count);

        return Ok(proposals.Select(ToResponse));
    }

    // ── POST /api/proposals/{id}/notify-dealer ────────────────────────────────
    // ONE-TIME: once DealerNotified = true, further calls are rejected (409).
    // Flag is set ONLY after the mail is actually sent.
    [HttpPost("{id:guid}/notify-dealer")]
    public async Task<ActionResult<ProposalResponseDto>> NotifyDealer(
        Guid id, [FromBody] NotifyDealerDto dto)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();
        if (proposal.Status != "Approved")
            return Conflict(new { message = "Only approved proposals can be sent to the dealer." });
        if (proposal.DealerNotified)
            return Conflict(new { message = $"Dealer already notified{(string.IsNullOrWhiteSpace(proposal.DealerEmail) ? "" : $" ({proposal.DealerEmail})")}." });
        if (string.IsNullOrWhiteSpace(dto.DealerEmail))
            return BadRequest(new { message = "Dealer email is required." });

        var dealerEmail = dto.DealerEmail.Trim();

        var (sent, error) = await _emailService.SendDealerNotificationMailAsync(
            proposal, dealerEmail, dto.RsmEmail, dto.TsmEmail, dto.CommandoEmail, GraphToken());

        if (!sent)
        {
            _logger.LogWarning("Dealer notification failed for {Id}: {Error}", proposal.Id, error);
            return BadRequest(new { message = $"Mail not sent — {error ?? "unknown error"}. Proposal NOT marked as notified; you can retry." });
        }

        proposal.DealerEmail    = dealerEmail;
        proposal.DealerNotified = true;
        await _db.SaveChangesAsync();

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var reviewSvc = scope.ServiceProvider.GetRequiredService<IProposalAiReviewService>();
            try { await reviewSvc.ReviewAsync(proposal.Id); }
            catch (Exception ex)
            {
                var log = scope.ServiceProvider.GetRequiredService<ILogger<ProposalsController>>();
                log.LogWarning(ex, "AI review failed for {Id}", proposal.Id);
            }
        });

        return Ok(ToResponse(proposal));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private string CurrentUserEmail() =>
        User.FindFirstValue("preferred_username")
        ?? User.FindFirstValue("email")                 // ← local-login JWT (RSM/TSM/Commando/Dealer)
        ?? User.FindFirstValue(ClaimTypes.Email)
        ?? User.FindFirstValue(ClaimTypes.Upn)
        ?? User.Identity?.Name
        ?? "unknown";

    private static string GenerateTokenNumber() =>
        $"BG-{DateTime.UtcNow:yyyyMM}-{Random.Shared.Next(1000, 9999)}";

    private static DateOnly? ParseDate(string? value) =>
        DateOnly.TryParse(value, out var date) ? date : null;

    private static readonly string[] MonthNames = {
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
    };

    private static (bool Ok, string? Error) ValidateActivityDates(
        List<ActivityDto> activities, string? month, string? year)
    {
        // ── FIX: validate against the proposal's selected Month/Year, not "today".
        // A whole-month activity plan (e.g. imported from Excel) can legitimately
        // start earlier in the month than the day it's submitted — the old
        // "start >= today" rule blocked exactly that case. Mirrors the same fix
        // applied on the frontend (RSMForm.tsx's activityDateRange).
        DateOnly? firstOfMonth = null;
        DateOnly? lastOfMonth  = null;
        var monthIdx = Array.IndexOf(MonthNames, month);
        if (monthIdx >= 0 && int.TryParse(year, out var yearNum))
        {
            firstOfMonth = new DateOnly(yearNum, monthIdx + 1, 1);
            lastOfMonth  = firstOfMonth.Value.AddMonths(1).AddDays(-1);
        }

        for (int i = 0; i < activities.Count; i++)
        {
            var a    = activities[i];
            var name = string.IsNullOrWhiteSpace(a.ActivityType) ? $"Activity #{i + 1}" : a.ActivityType;
            var start = ParseDate(a.StartDate);
            var end   = ParseDate(a.EndDate);

            if (start.HasValue && end.HasValue && end.Value < start.Value)
                return (false, $"'{name}': end date cannot be before start date.");

            if (firstOfMonth.HasValue && lastOfMonth.HasValue)
            {
                if (start.HasValue && (start.Value < firstOfMonth.Value || start.Value > lastOfMonth.Value))
                    return (false, $"'{name}': start date ({start.Value:dd-MMM-yyyy}) must fall within {month} {year}.");
                if (end.HasValue && (end.Value < firstOfMonth.Value || end.Value > lastOfMonth.Value))
                    return (false, $"'{name}': end date ({end.Value:dd-MMM-yyyy}) must fall within {month} {year}.");
            }
        }

        return (true, null);
    }

    // Allowed CAC per vehicle: New ₹6,000 / Old ₹4,000.
    // Old / New = RRERP rule in DealerTypeService (onboarding OR first sale within the last
    // N months, default 3). Dealer Mapping type is used only when the dealer has no code.
    private async Task<(int AllowedCac, string? Warning)>
    GetCacLimitAsync(string dealerName, decimal actualCac)
    {
        try
        {
            var mapping = await DealerNameMatcher.FindMappingAsync(_db, dealerName);
            var dealer  = await _bapl.DealerMasters
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.CustomerName == dealerName && d.Active == "Y");
            var code = dealer?.CustomerCode ?? mapping?.DealerCode;

            bool   isNew;
            string source;
            var    t = mapping?.DealerTypeOverride == true ? null : await _dealerType.ClassifyOneAsync(code);
            if (mapping?.DealerTypeOverride == true)           // Admin override after cross-check wins
            { isNew = string.Equals(mapping.DealerType, "New", StringComparison.OrdinalIgnoreCase); source = "Dealer Mapping override"; }
            else if (t is not null) { isNew = t.IsNew; source = "RRERP"; }
            else if (string.Equals(mapping?.DealerType, "New", StringComparison.OrdinalIgnoreCase)) { isNew = true; source = "Dealer Mapping"; }
            else if (mapping is not null || dealer is not null) { isNew = false; source = mapping?.DealerType is null ? "default" : "Dealer Mapping"; }
            else return (4000, null);

            var months = _dealerType.WindowMonths;
            double avg = 0;
            if (!string.IsNullOrWhiteSpace(code))
            {
                var rows = await _bapl.Database
                    .SqlQueryRaw<MonthlyCount>(@"
                        SELECT
                            YEAR(TRY_CONVERT(DATE, salebill_date, 105))  AS [Year],
                            MONTH(TRY_CONVERT(DATE, salebill_date, 105)) AS [Month],
                            COUNT(*) AS RetailCount
                        FROM DMS_SaleBill
                        WHERE dealer_code = {0}
                        AND IsDelete    = 0
                        AND TRY_CONVERT(DATE, salebill_date, 105) IS NOT NULL
                        AND TRY_CONVERT(DATE, salebill_date, 105) >= {1}
                        GROUP BY
                            YEAR(TRY_CONVERT(DATE, salebill_date, 105)),
                            MONTH(TRY_CONVERT(DATE, salebill_date, 105))",
                        code, _dealerType.Cutoff)
                    .ToListAsync();
                avg = (double)rows.Sum(r => r.RetailCount) / months;
            }

            int allowedCac = isNew ? 6000 : 4000;
            string? warning = actualCac > allowedCac
                ? $"CAC/CPL ₹{actualCac:N0} exceeds allowed ₹{allowedCac}/vehicle " +
                  $"({(isNew ? "New" : "Old")} dealer per {source}, avg {avg:N1} retails/month over {months} months). " +
                  "Deviation approval required."
                : null;

            return (allowedCac, warning);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "CAC check failed for '{Name}' — using default 4000", dealerName);
            return (4000, null);
        }
    }

    // ── ToResponse — FIX CS7036: added CheckerRemarks before Activities ───────
    private static ProposalResponseDto ToResponse(Proposal p) => new(
        p.Id, p.State, p.Location, p.Type, p.DealerName,
        p.VendorId, p.VendorName, p.RsmName, p.TsmName, p.CommandoName,
        p.Month, p.Year, p.Eligibility, p.Remarks,
        p.TotalBudget, p.TotalLeadTarget, p.TotalRetailTarget,
        p.Cac, p.Cpl,
        p.SubmittedBy, p.CreatedAt, p.SubmittedByDisplayName,
        p.Status, p.ApproverNote, p.ApprovedBy, p.DecidedAt,
        p.TokenNumber, p.AllowedCac, p.CacWarning,
        p.CheckedByEmail, p.CheckedAt, p.DealerNotified, p.DealerEmail,
        p.DealerSendBackNote, p.DealerSentBack, p.DealerSentBackAt,
        p.CheckerRemarks,
        p.TeamNotified, p.TeamNotifiedAt,
        p.Activities.Select(a => new ActivityResponseDto(
            a.Id, a.ActivityType, a.Category,
            a.Subcategory, a.Qty, a.SalesPercent,
            a.LeadTarget, a.RetailTarget,
            a.StartDate, a.EndDate,
            a.Budget, a.AdditionalBudget, a.BGaussShare,
            a.VendorId, a.Remarks,
            a.ActualStartDate, a.ActualEndDate,
            a.MediaFileUrl, a.MediaFileName, a.MediaFileType,
            a.MediaFiles.Select(m => new ActivityMediaDto(
                m.Id, m.FileUrl, m.FileName, m.FileType,
                m.CapturedAt, m.Latitude, m.Longitude, m.LocationAccuracyMeters)).ToList(),
            a.DailyData
        )).ToList()
    );
}

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

    private string GraphToken() =>
        Request.Headers["X-Graph-Token"].FirstOrDefault() ?? "";

    public ProposalsController(
        AppDbContext  db,
        BaplDbContext bapl,
        IEmailService emailService,
        ILogger<ProposalsController> logger,
        IServiceScopeFactory scopeFactory)
    {
        _db           = db;
        _bapl         = bapl;
        _emailService = emailService;
        _logger       = logger;
        _scopeFactory = scopeFactory;
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

        var (datesOk, dateError) = ValidateActivityDates(dto.Activities);
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
            var (datesOk, dateError) = ValidateActivityDates(dto.Activities);
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

        var (sent, error) = await _emailService.SendDecisionMailAsync(proposal, decision, GraphToken());
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
    [HttpPatch("{id:guid}/actuals")]
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
    [HttpGet("my-dealer-proposals")]
    [Authorize(AuthenticationSchemes = "DealerJwt")]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetMyDealerProposals()
    {
        var sub = User.FindFirstValue("sub");
        if (string.IsNullOrWhiteSpace(sub) || !int.TryParse(sub, out var userId))
            return Unauthorized();

        var dealerUser = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (dealerUser is null) return Unauthorized();

        List<Proposal> proposals;

        if (!string.IsNullOrWhiteSpace(dealerUser.DealerName))
        {
            proposals = await _db.Proposals
                .Include(p => p.Activities).ThenInclude(a => a.MediaFiles)
                .Where(p => p.DealerName == dealerUser.DealerName)
                .OrderByDescending(p => p.CreatedAt)
                .AsNoTracking()
                .ToListAsync();

            if (proposals.Count > 0) return Ok(proposals.Select(ToResponse));
        }

        if (!string.IsNullOrWhiteSpace(dealerUser.DealerName))
        {
            var lower = dealerUser.DealerName.Trim().ToLower();
            proposals = await _db.Proposals
                .Include(p => p.Activities).ThenInclude(a => a.MediaFiles)
                .Where(p => p.DealerName.ToLower() == lower)
                .OrderByDescending(p => p.CreatedAt)
                .AsNoTracking()
                .ToListAsync();

            if (proposals.Count > 0) return Ok(proposals.Select(ToResponse));

            var partial = lower;
            proposals = await _db.Proposals
                .Include(p => p.Activities).ThenInclude(a => a.MediaFiles)
                .Where(p => p.DealerName.ToLower().Contains(partial)
                        || partial.Contains(p.DealerName.ToLower()))
                .OrderByDescending(p => p.CreatedAt)
                .AsNoTracking()
                .ToListAsync();

            if (proposals.Count > 0) return Ok(proposals.Select(ToResponse));
        }

        return Ok(Array.Empty<ProposalResponseDto>());
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
        // budget re-approval, not a fresh proposal.
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
            // Regular forward — existing flow unchanged
            var (sent, error) = await _emailService.SendCheckerForwardMailAsync(proposal, GraphToken());
            if (!sent)
                _logger.LogWarning("Checker-forward mail failed for {Id}: {Error}", proposal.Id, error);
        }

        return Ok(ToResponse(proposal));
    }

    // ── POST /api/proposals/{id}/notify-dealer ────────────────────────────────
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
        if (string.IsNullOrWhiteSpace(dto.DealerEmail))
            return BadRequest(new { message = "Dealer email is required." });

        proposal.DealerEmail    = dto.DealerEmail;
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

        var (sent, error) = await _emailService.SendDealerNotificationMailAsync(
            proposal, dto.DealerEmail, GraphToken());

        if (!sent)
            _logger.LogWarning("Dealer notification failed for {Id}: {Error}", proposal.Id, error);

        return Ok(ToResponse(proposal));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────
    private string CurrentUserEmail() =>
        User.FindFirstValue("preferred_username")
        ?? User.FindFirstValue(ClaimTypes.Upn)
        ?? User.FindFirstValue(ClaimTypes.Email)
        ?? User.Identity?.Name
        ?? "unknown";

    private static string GenerateTokenNumber() =>
        $"BG-{DateTime.UtcNow:yyyyMM}-{Random.Shared.Next(1000, 9999)}";

    private static DateOnly? ParseDate(string? value) =>
        DateOnly.TryParse(value, out var date) ? date : null;

    private static (bool Ok, string? Error) ValidateActivityDates(
        List<ActivityDto> activities)
    {
        var todayIst = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(5).AddMinutes(30));

        for (int i = 0; i < activities.Count; i++)
        {
            var a    = activities[i];
            var name = string.IsNullOrWhiteSpace(a.ActivityType) ? $"Activity #{i + 1}" : a.ActivityType;
            var start = ParseDate(a.StartDate);
            var end   = ParseDate(a.EndDate);

            if (start.HasValue && end.HasValue && end.Value < start.Value)
                return (false, $"'{name}': end date cannot be before start date.");

            if (start.HasValue && start.Value < todayIst)
                return (false,
                    $"'{name}': start date ({start.Value:dd-MMM-yyyy}) is in the past. " +
                    $"Activities must start from today ({todayIst:dd-MMM-yyyy}) or later.");
        }

        return (true, null);
    }

    private async Task<(int AllowedCac, string? Warning)>
    GetCacLimitAsync(string dealerName, decimal actualCac)
    {
        try
        {
            var cutoff = DateTime.UtcNow.AddMonths(-4).Date;

            var dealer = await _bapl.DealerMasters
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.CustomerName == dealerName && d.Active == "Y");

            if (dealer == null) return (4000, null);

            bool isNew = dealer.OnboardedDate.HasValue &&
                        dealer.OnboardedDate.Value.Date >= cutoff;

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
                    dealer.CustomerCode, cutoff)
                .ToListAsync();

            double avg        = (double)rows.Sum(r => r.RetailCount) / 4.0;
            int    allowedCac = isNew ? 6000 : 4000;

            string? warning = actualCac > allowedCac
                ? $"CAC/CPL ₹{actualCac:N0} exceeds allowed ₹{allowedCac}/vehicle " +
                  $"({(isNew ? "New" : "Old")} dealer, avg {avg:N1} retails/month). " +
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
        p.CheckerRemarks,                              // ← FIX: was missing → CS7036
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

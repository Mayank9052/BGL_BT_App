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
    private readonly AppDbContext _db;
    private readonly IEmailService _emailService;
    private readonly ILogger<ProposalsController> _logger;
    private string GraphToken() =>
    Request.Headers["X-Graph-Token"].FirstOrDefault() ?? "";

    public ProposalsController(AppDbContext db, IEmailService emailService, ILogger<ProposalsController> logger)
    {
        _db           = db;
        _emailService = emailService;
        _logger       = logger;
    }

    // ── POST /api/proposals ───────────────────────────────────────────────────
    [HttpPost]
    public async Task<ActionResult<ProposalResponseDto>> Create(CreateProposalDto dto)
    {
        if (dto.Activities is null || dto.Activities.Count == 0)
            return BadRequest("At least one activity is required.");

        var submittedBy = CurrentUserEmail();

        var submitter = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Email == submittedBy);

        var activities = dto.Activities.Select(a => new ProposalActivity
        {
            ActivityType = a.ActivityType,
            Target       = a.Target,
            StartDate    = ParseDate(a.StartDate),
            EndDate      = ParseDate(a.EndDate),
            Budget       = a.Budget,
            Incentive    = a.Incentive,
            Remarks      = a.Remarks,
        }).ToList();

        var totalBudget = activities.Sum(a => a.Budget + a.Incentive);
        var totalTarget = activities.Sum(a => a.Target);
        var cac         = totalTarget > 0 ? Math.Round(totalBudget / totalTarget, 2) : 0m;

        var proposal = new Proposal
        {
            State                  = dto.State,
            Location               = dto.Location,
            Type                   = dto.Type,
            DealerName             = dto.DealerName,
            RsmName                = dto.RsmName,
            CommandoName           = dto.CommandoName,
            Month                  = dto.Month,
            Eligibility            = dto.Eligibility,
            Remarks                = dto.Remarks,
            TotalBudget            = totalBudget,
            TotalTarget            = totalTarget,
            Cac                    = cac,
            SubmittedBy            = submittedBy,
            SubmittedByDisplayName = submitter?.DisplayName ?? dto.RsmName,
            Activities             = activities,
            TokenNumber            = GenerateTokenNumber(),
            Status                 = "Pending",
        };

        _db.Proposals.Add(proposal);
        await _db.SaveChangesAsync();

        var (sent, error) = await _emailService.SendSubmissionMailAsync(proposal, GraphToken());
        if (!sent)
            _logger.LogWarning("Submission mail failed for proposal {Id}: {Error}", proposal.Id, error);

        return CreatedAtAction(nameof(GetById), new { id = proposal.Id }, ToResponse(proposal));
    }

    // ── GET /api/proposals — admin sees all ───────────────────────────────────
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetAll()
    {
        var proposals = await _db.Proposals
            .Include(p => p.Activities)
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(proposals.Select(ToResponse));
    }

    // ── GET /api/proposals/mine — RSM sees only their own ─────────────────────
    [HttpGet("mine")]
    public async Task<ActionResult<IEnumerable<ProposalResponseDto>>> GetMine()
    {
        var email = CurrentUserEmail();

        var proposals = await _db.Proposals
            .Include(p => p.Activities)
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
            .Where(p => p.DealerName == name)
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(proposals.Select(ToResponse));
    }

    // ── GET /api/proposals/{id} ───────────────────────────────────────────────
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProposalResponseDto>> GetById(Guid id)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id);

        return proposal is null ? NotFound() : Ok(ToResponse(proposal));
    }

    // ── PUT /api/proposals/{id} — RSM resubmits / admin edits ────────────────
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ProposalResponseDto>> Update(Guid id, UpdateProposalDto dto)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();

        if (proposal.Status is "Approved" or "Rejected")
            return Conflict(new { message = $"This proposal was already {proposal.Status} and cannot be modified." });

        var wasNeedsRevision = proposal.Status == "NeedsRevision";

        proposal.DealerName   = dto.DealerName;
        proposal.Location     = dto.Location;
        proposal.State        = dto.State;
        proposal.Type         = dto.Type;
        proposal.RsmName      = dto.RsmName;
        proposal.CommandoName = dto.CommandoName;
        proposal.Month        = dto.Month;
        proposal.Eligibility  = dto.Eligibility;
        proposal.Remarks      = dto.Remarks;

        // Delete existing activities and replace
        await _db.ProposalActivities
            .Where(a => a.ProposalId == id)
            .ExecuteDeleteAsync();

        var newActivities = dto.Activities.Select(a => new ProposalActivity
        {
            Id           = Guid.NewGuid(),
            ProposalId   = id,
            ActivityType = a.ActivityType,
            Target       = a.Target,
            StartDate    = ParseDate(a.StartDate),
            EndDate      = ParseDate(a.EndDate),
            Budget       = a.Budget,
            Incentive    = a.Incentive,
            Remarks      = a.Remarks,
        }).ToList();

        await _db.ProposalActivities.AddRangeAsync(newActivities);

        proposal.TotalBudget = newActivities.Sum(a => a.Budget + a.Incentive);
        proposal.TotalTarget = newActivities.Sum(a => a.Target);
        proposal.Cac         = proposal.TotalTarget > 0
            ? Math.Round(proposal.TotalBudget / proposal.TotalTarget, 2) : 0m;

        if (wasNeedsRevision)
        {
            proposal.Status       = "Pending";
            proposal.ApproverNote = null;
        }

        await _db.SaveChangesAsync();

        var updated = await _db.Proposals
            .Include(p => p.Activities)
            .AsNoTracking()
            .FirstAsync(p => p.Id == id);

        if (wasNeedsRevision)
        {
            var (sent, error) = await _emailService.SendResubmissionMailAsync(updated, GraphToken());
            if (!sent)
                _logger.LogWarning("Resubmission mail failed for {Id}: {Error}", updated.Id, error);
        }

        return Ok(ToResponse(updated));
    }

    // ── PATCH /api/proposals/{id}/decide ─────────────────────────────────────
    [HttpPatch("{id:guid}/decide")]
    public async Task<ActionResult<ProposalResponseDto>> Decide(Guid id, DecideProposalDto dto)
    {
        if (dto.Status != "Approved" && dto.Status != "Rejected")
            return BadRequest("Status must be 'Approved' or 'Rejected'.");

        var proposal = await _db.Proposals
            .Include(p => p.Activities)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();

        if (proposal.Status is "Approved" or "Rejected")
            return Conflict(new { message = $"This proposal was already {proposal.Status} and can no longer be modified." });

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
        decision.MailSent  = sent;
        decision.MailSentAt = sent ? DateTimeOffset.UtcNow : null;
        decision.MailError  = error;
        await _db.SaveChangesAsync();

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
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();

        if (proposal.Status is "Approved" or "Rejected")
            return Conflict(new { message = "Cannot send back a finalised proposal." });

        proposal.Status       = "NeedsRevision";
        proposal.ApproverNote = dto.Note?.Trim();
        proposal.ApprovedBy   = dto.SentBackBy ?? CurrentUserEmail();

        await _db.SaveChangesAsync();

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
        }

        await _db.SaveChangesAsync();
        return Ok(ToResponse(proposal));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
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

    private static ProposalResponseDto ToResponse(Proposal p) => new(
        p.Id, p.State, p.Location, p.Type, p.DealerName, p.RsmName, p.CommandoName,
        p.Month, p.Eligibility, p.Remarks, p.TotalBudget, p.TotalTarget, p.Cac,
        p.SubmittedBy, p.CreatedAt, p.SubmittedByDisplayName, p.Status,
        p.ApproverNote, p.ApprovedBy, p.DecidedAt, p.TokenNumber,
        p.Activities.Select(a => new ActivityResponseDto(
            a.Id, a.ActivityType, a.Target, a.StartDate, a.EndDate,
            a.Budget, a.Incentive, a.Remarks,
            a.ActualStartDate, a.ActualEndDate,
            a.MediaFileUrl, a.MediaFileName, a.MediaFileType
        )).ToList()
    );
}
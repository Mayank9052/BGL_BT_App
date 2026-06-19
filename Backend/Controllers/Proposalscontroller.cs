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

    public ProposalsController(AppDbContext db, IEmailService emailService, ILogger<ProposalsController> logger)
    {
        _db = db;
        _emailService = emailService;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<ProposalResponseDto>> Create(CreateProposalDto dto)
    {
        if (dto.Activities is null || dto.Activities.Count == 0)
            return BadRequest("At least one activity is required.");

        var submittedBy = CurrentUserEmail();

        var activities = dto.Activities.Select(a => new ProposalActivity
        {
            ActivityType = a.ActivityType,
            Target = a.Target,
            StartDate = ParseDate(a.StartDate),
            EndDate = ParseDate(a.EndDate),
            Budget = a.Budget,
            Incentive = a.Incentive,
            Remarks = a.Remarks,
        }).ToList();

        var totalBudget = activities.Sum(a => a.Budget + a.Incentive);
        var totalTarget = activities.Sum(a => a.Target);
        var cac = totalTarget > 0 ? Math.Round(totalBudget / totalTarget, 2) : 0m;

        var proposal = new Proposal
        {
            State = dto.State,
            Location = dto.Location,
            Type = dto.Type,
            DealerName = dto.DealerName,
            RsmName = dto.RsmName,
            CommandoName = dto.CommandoName,
            Month = dto.Month,
            Eligibility = dto.Eligibility,
            Remarks = dto.Remarks,
            TotalBudget = totalBudget,
            TotalTarget = totalTarget,
            Cac = cac,
            SubmittedBy = submittedBy,
            Activities = activities,
            TokenNumber = GenerateTokenNumber(),
            Status = "Pending",
        };

        _db.Proposals.Add(proposal);
        await _db.SaveChangesAsync();

        // Notify the fixed approver mailbox. A mail failure must never
        // block the proposal from being saved — log and move on.
        var (sent, error) = await _emailService.SendSubmissionMailAsync(proposal);
        if (!sent)
            _logger.LogWarning("Submission mail failed for proposal {Id}: {Error}", proposal.Id, error);

        return CreatedAtAction(nameof(GetById), new { id = proposal.Id }, ToResponse(proposal));
    }

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

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProposalResponseDto>> GetById(Guid id)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id);

        return proposal is null ? NotFound() : Ok(ToResponse(proposal));
    }

    // PATCH /api/proposals/{id}/decide — matches decideProposal() in proposalService.ts
    [HttpPatch("{id:guid}/decide")]
    public async Task<ActionResult<ProposalResponseDto>> Decide(Guid id, DecideProposalDto dto)
    {
        if (dto.Status != "Approved" && dto.Status != "Rejected")
            return BadRequest("Status must be 'Approved' or 'Rejected'.");

        var proposal = await _db.Proposals
            .Include(p => p.Activities)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (proposal is null) return NotFound();

        // Once a final decision is recorded, lock the record — no further
        // modification or re-decision is allowed (per the approval policy).
        if (proposal.Status is "Approved" or "Rejected")
            return Conflict(new { message = $"This proposal was already {proposal.Status} and can no longer be modified." });

        var approvedBy = dto.ApprovedBy ?? CurrentUserEmail();

        proposal.Status = dto.Status;
        proposal.ApproverNote = dto.ApproverNote;
        proposal.ApprovedBy = approvedBy;
        proposal.DecidedAt = DateTimeOffset.UtcNow;

        var decision = new ApprovalDecision
        {
            ProposalId = proposal.Id,
            Status = dto.Status,
            ApproverNote = dto.ApproverNote,
            ApprovedBy = approvedBy,
        };
        _db.ApprovalDecisions.Add(decision);

        await _db.SaveChangesAsync();

        var (sent, error) = await _emailService.SendDecisionMailAsync(proposal, decision);
        decision.MailSent = sent;
        decision.MailSentAt = sent ? DateTimeOffset.UtcNow : null;
        decision.MailError = error;
        await _db.SaveChangesAsync();

        if (!sent)
            _logger.LogWarning("Decision mail failed for proposal {Id}: {Error}", proposal.Id, error);

        return Ok(ToResponse(proposal));
    }

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
        p.SubmittedBy, p.CreatedAt, p.Status, p.ApproverNote, p.ApprovedBy, p.DecidedAt,
        p.TokenNumber,
        p.Activities.Select(a => new ActivityResponseDto(
            a.Id, a.ActivityType, a.Target, a.StartDate, a.EndDate, a.Budget, a.Incentive, a.Remarks
        )).ToList()
    );
}
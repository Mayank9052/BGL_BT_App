using System.Security.Claims;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/proposals")]
//[Authorize]
public class ProposalsController : ControllerBase
{
    private readonly AppDbContext _db;

    public ProposalsController(AppDbContext db) => _db = db;

    [HttpPost]
    public async Task<ActionResult<ProposalResponseDto>> Create(CreateProposalDto dto)
    {
        if (dto.Activities is null || dto.Activities.Count == 0)
            return BadRequest("At least one activity is required.");

        var submittedBy =
            User.FindFirstValue("preferred_username")
            ?? User.FindFirstValue(ClaimTypes.Upn)
            ?? User.FindFirstValue(ClaimTypes.Email)
            ?? User.Identity?.Name
            ?? "unknown";

        var activities = dto.Activities.Select(a => new ProposalActivity
        {
            ActivityType = a.ActivityType,
            Target = a.Target,
            StartDate = ParseDate(a.StartDate),
            EndDate = ParseDate(a.EndDate),
            Budget = a.Budget,
            Incentive = a.Incentive,
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
        };

        _db.Proposals.Add(proposal);
        await _db.SaveChangesAsync();

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

    private static DateOnly? ParseDate(string? value) =>
        DateOnly.TryParse(value, out var date) ? date : null;

    private static ProposalResponseDto ToResponse(Proposal proposal) => new(
        proposal.Id,
        proposal.State,
        proposal.Location,
        proposal.Type,
        proposal.DealerName,
        proposal.RsmName,
        proposal.CommandoName,
        proposal.Month,
        proposal.Eligibility,
        proposal.Remarks,
        proposal.TotalBudget,
        proposal.TotalTarget,
        proposal.Cac,
        proposal.SubmittedBy,
        proposal.CreatedAt,
        proposal.Activities.Select(a => new ActivityResponseDto(
            a.Id,
            a.ActivityType,
            a.Target,
            a.StartDate,
            a.EndDate,
            a.Budget,
            a.Incentive)).ToList());
}
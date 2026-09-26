// Backend/Controllers/DealerTeamMappingController.cs
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BGL_BT_App.Backend.Controllers;

public record DealerTeamMappingDto(
    int Id, string DealerName, string? DealerCode, string? City, string? State,
    string Rsm, string? RsmEmail, string? Tsm, string? TsmEmail,
    string? Commando, string? CommandoEmail, string? DealerEmail,
    bool IsEligible, string? DealerType, DateTime UpdatedAt, string? UpdatedByEmail);

public record UpsertDealerTeamMappingDto(
    string DealerName, string? DealerCode, string? City, string? State,
    string Rsm, string? RsmEmail, string? Tsm, string? TsmEmail,
    string? Commando, string? CommandoEmail, string? DealerEmail,
    bool IsEligible, string? DealerType);

[ApiController]
[Route("api/dealer-team-mapping")]
[Authorize(AuthenticationSchemes = "AzureAD,DealerJwt")]
public class DealerTeamMappingController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILogger<DealerTeamMappingController> _logger;

    public DealerTeamMappingController(AppDbContext db, ILogger<DealerTeamMappingController> logger)
    {
        _db = db; _logger = logger;
    }

    // ── GET /api/dealer-team-mapping — Admin only, list all ────────────────
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? search = null)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        var query = _db.Set<DealerTeamMapping>().AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var q = search.Trim().ToLower();
            query = query.Where(d =>
                d.DealerName.ToLower().Contains(q) ||
                (d.DealerCode != null && d.DealerCode.ToLower().Contains(q)) ||
                (d.Rsm != null && d.Rsm.ToLower().Contains(q)) ||
                (d.Tsm != null && d.Tsm.ToLower().Contains(q)) ||
                (d.City != null && d.City.ToLower().Contains(q)) ||
                (d.State != null && d.State.ToLower().Contains(q)));
        }

        var rows = await query.OrderBy(d => d.DealerName).ToListAsync();
        return Ok(rows.Select(ToDto));
    }

    // ── POST /api/dealer-team-mapping — Admin only, create one ─────────────
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] UpsertDealerTeamMappingDto dto)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        if (string.IsNullOrWhiteSpace(dto.DealerName))
            return BadRequest(new { message = "Dealer name is required." });
        if (string.IsNullOrWhiteSpace(dto.Rsm))
            return BadRequest(new { message = "RSM name is required." });

        var exists = await _db.Set<DealerTeamMapping>()
            .AnyAsync(d => d.DealerName.ToLower() == dto.DealerName.Trim().ToLower());
        if (exists)
            return Conflict(new { message = $"'{dto.DealerName}' already exists in the mapping." });

        var row = new DealerTeamMapping
        {
            DealerName = dto.DealerName.Trim(), DealerCode = dto.DealerCode, City = dto.City, State = dto.State,
            Rsm = dto.Rsm.Trim(), RsmEmail = dto.RsmEmail, Tsm = dto.Tsm, TsmEmail = dto.TsmEmail,
            Commando = dto.Commando, CommandoEmail = dto.CommandoEmail, DealerEmail = dto.DealerEmail,
            IsEligible = dto.IsEligible, DealerType = dto.DealerType,
            UpdatedByEmail = guard.CallerEmail,
        };
        _db.Add(row);
        await _db.SaveChangesAsync();

        return Ok(ToDto(row));
    }

    // ── PUT /api/dealer-team-mapping/{id} — Admin only, update one ─────────
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpsertDealerTeamMappingDto dto)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        var row = await _db.Set<DealerTeamMapping>().FirstOrDefaultAsync(d => d.Id == id);
        if (row is null) return NotFound(new { message = "Mapping not found." });

        row.DealerName     = dto.DealerName.Trim();
        row.DealerCode      = dto.DealerCode;
        row.City            = dto.City;
        row.State           = dto.State;
        row.Rsm             = dto.Rsm.Trim();
        row.RsmEmail        = dto.RsmEmail;
        row.Tsm             = dto.Tsm;
        row.TsmEmail        = dto.TsmEmail;
        row.Commando        = dto.Commando;
        row.CommandoEmail   = dto.CommandoEmail;
        row.DealerEmail     = dto.DealerEmail;
        row.IsEligible      = dto.IsEligible;
        row.DealerType      = dto.DealerType;
        row.UpdatedAt       = DateTime.UtcNow;
        row.UpdatedByEmail  = guard.CallerEmail;

        await _db.SaveChangesAsync();
        return Ok(ToDto(row));
    }

    // ── DELETE /api/dealer-team-mapping/{id} — Admin only ───────────────────
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        var row = await _db.Set<DealerTeamMapping>().FirstOrDefaultAsync(d => d.Id == id);
        if (row is null) return NotFound(new { message = "Mapping not found." });

        _db.Remove(row);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Deleted." });
    }

    private static DealerTeamMappingDto ToDto(DealerTeamMapping d) => new(
        d.Id, d.DealerName, d.DealerCode, d.City, d.State,
        d.Rsm, d.RsmEmail, d.Tsm, d.TsmEmail, d.Commando, d.CommandoEmail, d.DealerEmail,
        d.IsEligible, d.DealerType, d.UpdatedAt, d.UpdatedByEmail);

    private async Task<(IActionResult? Error, string? CallerEmail)> EnsureCallerIsAdmin()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
               ?? User.FindFirstValue("oid");
        if (string.IsNullOrEmpty(oid))
            return (Unauthorized(new { message = "Missing identity claim." }), null);

        var caller = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.AzureObjectId == oid);
        if (caller is null)
            return (Unauthorized(new { message = "Caller not found in Users table." }), null);
        if (!string.Equals(caller.Role, "Admin", StringComparison.OrdinalIgnoreCase))
            return (Forbid(), null);

        return (null, caller.Email);
    }
}
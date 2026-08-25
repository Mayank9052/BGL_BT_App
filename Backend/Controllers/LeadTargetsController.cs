// Backend/Controllers/LeadTargetsController.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/lead-targets")]
[Authorize]
public class LeadTargetsController : ControllerBase
{
    private readonly AppDbContext _db;
    public LeadTargetsController(AppDbContext db) { _db = db; }

    // GET /api/lead-targets?month=8&year=2026
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? month, [FromQuery] int? year)
    {
        var q = _db.LeadTargets.AsNoTracking().AsQueryable();
        if (month.HasValue) q = q.Where(t => t.Month == month.Value);
        if (year.HasValue)  q = q.Where(t => t.Year == year.Value);
        return Ok(await q.OrderBy(t => t.State).ThenBy(t => t.Channel).ToListAsync());
    }

    // Upsert one (State, Channel, Month, Year) target
    [HttpPut]
    public async Task<IActionResult> Upsert([FromBody] LeadTargetDto dto)
    {
        var existing = await _db.LeadTargets.FirstOrDefaultAsync(t =>
            t.State == dto.State && t.Channel == dto.Channel && t.Month == dto.Month && t.Year == dto.Year);

        if (existing != null)
        {
            existing.TargetValue = dto.TargetValue;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _db.LeadTargets.Add(new LeadTarget
            {
                State = dto.State, Channel = dto.Channel, Month = dto.Month,
                Year = dto.Year, TargetValue = dto.TargetValue,
            });
        }
        await _db.SaveChangesAsync();
        return Ok(new { saved = true });
    }

    // Bulk upsert — e.g. re-importing the whole "Leads target Dump" sheet at once
    [HttpPut("bulk")]
    public async Task<IActionResult> BulkUpsert([FromBody] List<LeadTargetDto> targets)
    {
        foreach (var dto in targets)
        {
            var existing = await _db.LeadTargets.FirstOrDefaultAsync(t =>
                t.State == dto.State && t.Channel == dto.Channel && t.Month == dto.Month && t.Year == dto.Year);
            if (existing != null)
            {
                existing.TargetValue = dto.TargetValue;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                _db.LeadTargets.Add(new LeadTarget
                {
                    State = dto.State, Channel = dto.Channel, Month = dto.Month,
                    Year = dto.Year, TargetValue = dto.TargetValue,
                });
            }
        }
        await _db.SaveChangesAsync();
        return Ok(new { count = targets.Count });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var entity = await _db.LeadTargets.FindAsync(id);
        if (entity == null) return NotFound();
        _db.LeadTargets.Remove(entity);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
// Backend/Controllers/LeadChannelMappingsController.cs
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

/// <summary>
/// Lets an admin fix the Source/SubSource → Channel bucketing (e.g. if
/// "Incoming Calls" should be its own channel instead of BTL) WITHOUT a
/// code deployment. See 01_schema.sql for the seeded starting mapping.
/// </summary>
[ApiController]
[Route("api/lead-channel-mappings")]
[Authorize]
public class LeadChannelMappingsController : ControllerBase
{
    private readonly AppDbContext _db;
    public LeadChannelMappingsController(AppDbContext db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.LeadChannelMappings.AsNoTracking().OrderBy(m => m.Source).ToListAsync());

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] LeadChannelMappingDto dto)
    {
        var exists = await _db.LeadChannelMappings.AnyAsync(m =>
            m.Source == dto.Source && (m.SubSource ?? "") == (dto.SubSource ?? ""));
        if (exists) return Conflict(new { error = "Mapping for this Source/SubSource already exists — use PUT to update it." });

        var entity = new LeadChannelMapping { Source = dto.Source, SubSource = dto.SubSource, Channel = dto.Channel };
        _db.LeadChannelMappings.Add(entity);
        await _db.SaveChangesAsync();
        return Ok(entity);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] LeadChannelMappingDto dto)
    {
        var entity = await _db.LeadChannelMappings.FindAsync(id);
        if (entity == null) return NotFound();
        entity.Source = dto.Source;
        entity.SubSource = dto.SubSource;
        entity.Channel = dto.Channel;
        await _db.SaveChangesAsync();
        return Ok(entity);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var entity = await _db.LeadChannelMappings.FindAsync(id);
        if (entity == null) return NotFound();
        _db.LeadChannelMappings.Remove(entity);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // Bulk replace — convenient for re-uploading the whole mapping at once
    [HttpPut("bulk")]
    public async Task<IActionResult> BulkReplace([FromBody] List<LeadChannelMappingDto> mappings)
    {
        _db.LeadChannelMappings.RemoveRange(_db.LeadChannelMappings);
        foreach (var m in mappings)
            _db.LeadChannelMappings.Add(new LeadChannelMapping { Source = m.Source, SubSource = m.SubSource, Channel = m.Channel });
        await _db.SaveChangesAsync();
        return Ok(new { count = mappings.Count });
    }
}
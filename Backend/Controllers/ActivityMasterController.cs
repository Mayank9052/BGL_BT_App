using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using BGL_BT_App.Backend.DTOs;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/activity-types")]
[Authorize]
public class ActivityMasterController : ControllerBase
{
    private readonly AppDbContext _db;

    public ActivityMasterController(AppDbContext db) => _db = db;

    // GET /api/activity-types — all active types (used by RSM form dropdown)
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var list = await _db.ActivityMasters
            .Where(a => a.IsActive)
            .OrderBy(a => a.ActivityName)
            .Select(a => new { a.Id, a.ActivityName, a.IsActive })
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/activity-types/all — admin view (includes inactive)
    [HttpGet("all")]
    public async Task<IActionResult> GetAllAdmin()
    {
        var list = await _db.ActivityMasters
            .OrderBy(a => a.ActivityName)
            .Select(a => new { a.Id, a.ActivityName, a.IsActive, a.CreatedAt })
            .ToListAsync();
        return Ok(list);
    }

    // POST /api/activity-types — admin only
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ActivityMasterDto dto)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        if (string.IsNullOrWhiteSpace(dto.ActivityName))
            return BadRequest(new { message = "Activity name is required." });

        var exists = await _db.ActivityMasters
            .AnyAsync(a => a.ActivityName.ToLower() == dto.ActivityName.Trim().ToLower());
        if (exists)
            return Conflict(new { message = "Activity type already exists." });

        var activity = new ActivityMaster
        {
            ActivityName = dto.ActivityName.Trim(),
            IsActive     = true,
        };
        _db.ActivityMasters.Add(activity);
        await _db.SaveChangesAsync();
        return Ok(new { activity.Id, activity.ActivityName, activity.IsActive });
    }

    // PATCH /api/activity-types/{id} — admin only
    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] ActivityMasterDto dto)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        var activity = await _db.ActivityMasters.FindAsync(id);
        if (activity is null) return NotFound();

        if (!string.IsNullOrWhiteSpace(dto.ActivityName))
            activity.ActivityName = dto.ActivityName.Trim();

        if (dto.IsActive.HasValue)
            activity.IsActive = dto.IsActive.Value;

        await _db.SaveChangesAsync();
        return Ok(new { activity.Id, activity.ActivityName, activity.IsActive });
    }

    // DELETE /api/activity-types/{id} — admin only (soft delete via IsActive)
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        var activity = await _db.ActivityMasters.FindAsync(id);
        if (activity is null) return NotFound();

        activity.IsActive = false;
        await _db.SaveChangesAsync();
        return Ok(new { message = "Deactivated." });
    }

    private async Task<IActionResult?> EnsureAdmin()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
               ?? User.FindFirstValue("oid");
        if (string.IsNullOrEmpty(oid)) return Unauthorized();

        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.AzureObjectId == oid);
        if (user is null) return Unauthorized();
        if (!string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase))
            return Forbid();

        return null;
    }
}


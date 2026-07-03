// Backend/Controllers/ActivityMasterController.cs
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

    // GET /api/activity-types — active only (RSM form dropdown)
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var list = await _db.ActivityMasters
            .Where(a => a.IsActive)
            .OrderBy(a => a.ActivityName)
            .Select(a => new ActivityTypeDto(a.Id, a.ActivityName, a.ActivityType, a.IsActive))
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/activity-types/all — admin (includes inactive)
    [HttpGet("all")]
    public async Task<IActionResult> GetAllAdmin()
    {
        var list = await _db.ActivityMasters
            .OrderBy(a => a.ActivityName)
            .Select(a => new ActivityTypeDto(a.Id, a.ActivityName, a.ActivityType, a.IsActive))
            .ToListAsync();
        return Ok(list);
    }

    // POST /api/activity-types — admin only
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateActivityTypeRequest dto)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        if (string.IsNullOrWhiteSpace(dto.ActivityName))
            return BadRequest(new { message = "Activity name is required." });

        var actType = (dto.ActivityType ?? "BTL").Trim().ToUpper();
        if (actType != "ATL" && actType != "BTL")
            return BadRequest(new { message = "ActivityType must be 'ATL' or 'BTL'." });

        var exists = await _db.ActivityMasters
            .AnyAsync(a => a.ActivityName.ToLower() == dto.ActivityName.Trim().ToLower());
        if (exists)
            return Conflict(new { message = $"'{dto.ActivityName}' already exists." });

        var activity = new ActivityMaster
        {
            ActivityName = dto.ActivityName.Trim(),
            ActivityType = actType,
            IsActive     = true,
        };
        _db.ActivityMasters.Add(activity);
        await _db.SaveChangesAsync();
        return Ok(new ActivityTypeDto(activity.Id, activity.ActivityName, activity.ActivityType, activity.IsActive));
    }

    // PATCH /api/activity-types/{id}/toggle — admin only
    [HttpPatch("{id:int}/toggle")]
    public async Task<IActionResult> Toggle(int id, [FromBody] ToggleRequest dto)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        var activity = await _db.ActivityMasters.FindAsync(id);
        if (activity is null) return NotFound();

        activity.IsActive = dto.IsActive;
        await _db.SaveChangesAsync();
        return Ok(new ActivityTypeDto(activity.Id, activity.ActivityName, activity.ActivityType, activity.IsActive));
    }

    private async Task<IActionResult?> EnsureAdmin()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
               ?? User.FindFirstValue("oid");
        if (string.IsNullOrEmpty(oid)) return Unauthorized();
        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.AzureObjectId == oid);
        if (user is null) return Unauthorized();
        if (!string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase)) return Forbid();
        return null;
    }
}
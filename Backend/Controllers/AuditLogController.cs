// Backend/Controllers/AuditLogController.cs
using BGL_BT_App.Backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/audit-logs")]
public class AuditLogController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILogger<AuditLogController> _logger;

    public AuditLogController(AppDbContext db, ILogger<AuditLogController> logger)
    {
        _db = db; _logger = logger;
    }

    // ── GET /api/audit-logs — Admin only, supports basic filters + paging ─────
    // Accepts either Azure AD (staff/Admin) OR DealerJwt (in case an Admin-role
    // local account should ever view this too) — the role check below is what
    // actually gates access, not the scheme.
    [HttpGet]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> GetLogs(
        [FromQuery] string? action = null,
        [FromQuery] string? actorEmail = null,
        [FromQuery] string? role = null,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50)
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            pageSize = Math.Clamp(pageSize, 1, 200);
            page = Math.Max(page, 1);

            var query = _db.AuditLogs.AsNoTracking().AsQueryable();

            if (!string.IsNullOrWhiteSpace(action))
                query = query.Where(l => l.Action == action);
            if (!string.IsNullOrWhiteSpace(actorEmail))
                query = query.Where(l => l.ActorEmail.ToLower().Contains(actorEmail.ToLower()));
            if (!string.IsNullOrWhiteSpace(role))
                query = query.Where(l => l.ActorRole == role);
            if (from.HasValue)
                query = query.Where(l => l.CreatedAt >= from.Value);
            if (to.HasValue)
                query = query.Where(l => l.CreatedAt <= to.Value);

            var total = await query.CountAsync();
            var logs = await query
                .OrderByDescending(l => l.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(l => new
                {
                    l.Id, l.ActorEmail, l.ActorName, l.ActorRole, l.AuthType,
                    l.Action, l.TargetEmail, l.Details, l.Success, l.CreatedAt,
                })
                .ToListAsync();

            return Ok(new { total, page, pageSize, logs });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch audit logs");
            return StatusCode(500, new { message = ex.Message });
        }
    }

    // ── GET /api/audit-logs/actions — distinct action list, for the filter dropdown ──
    [HttpGet("actions")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> GetDistinctActions()
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        var actions = await _db.AuditLogs.AsNoTracking()
            .Select(l => l.Action).Distinct().OrderBy(a => a).ToListAsync();
        return Ok(actions);
    }

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
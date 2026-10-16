// Backend/Services/AuditLogService.cs
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

public class AuditLogService
{
    private readonly AppDbContext _db;
    private readonly ILogger<AuditLogService> _logger;

    public AuditLogService(AppDbContext db, ILogger<AuditLogService> logger)
    {
        _db = db; _logger = logger;
    }

    /// <summary>
    /// Records one audit event. Never pass password values or tokens in
    /// `details` — this method logs that an action happened, not secret content.
    /// Failures to write the log itself are swallowed (logged to the app log)
    /// so a logging bug never blocks the actual login/action it's recording.
    /// </summary>
    public async Task LogAsync(
        string actorEmail, string actorName, string actorRole, string authType,
        string action, string? targetEmail = null, string? details = null,
        string? ipAddress = null, bool success = true)
    {
        try
        {
            _db.AuditLogs.Add(new AuditLog
            {
                ActorEmail  = actorEmail ?? "",
                ActorName   = actorName ?? "",
                ActorRole   = actorRole ?? "",
                AuthType    = authType ?? "",
                Action      = action,
                TargetEmail = targetEmail,
                Details     = details,
                IpAddress   = ipAddress,
                Success     = success,
                CreatedAt   = DateTime.UtcNow,
            });
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to write audit log for action {Action} by {Actor}", action, actorEmail);
        }
    }
}
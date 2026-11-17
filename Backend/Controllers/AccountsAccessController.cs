using System.Security.Claims;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

public record PermDto(string PageKey, bool View, bool Download, bool Full);
public record SaveAccessDto(List<PermDto> Permissions);

[ApiController]
[Route("api/accounts-access")]
[Authorize(AuthenticationSchemes = "AzureAD,DealerJwt")]
public class AccountsAccessController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AccountsAccessService _access;
    private readonly CnEmailService _mail;
    private readonly ILogger<AccountsAccessController> _log;

    public AccountsAccessController(AppDbContext db, AccountsAccessService access, CnEmailService mail,
                                    ILogger<AccountsAccessController> log)
    { _db = db; _access = access; _mail = mail; _log = log; }

    private string Email() => (User.FindFirstValue("preferred_username") ?? User.FindFirstValue("email")
        ?? User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue(ClaimTypes.Upn) ?? "").Trim().ToLowerInvariant();
    private string ActorName(string email) => User.FindFirstValue("name") ?? email;

    /// Every management endpoint calls this first. Non-admins get 403 and the attempt is audited.
    private async Task<IActionResult?> RequireAdminAsync(string what)
    {
        var e = Email();
        if (e.Length == 0) return Unauthorized();
        if (await _access.IsAdminAsync(e)) return null;   // [BTL-2026-11-17] config admins + portal Admin role

        _db.AccountsAccessAudits.Add(new AccountsAccessAudit
        {
            ActorEmail = e, ActorName = ActorName(e), TargetEmail = "—", PageKey = "access-management",
            PageName = "Access Management", PermissionType = "—", Action = "Denied", Result = "Denied", Note = what,
        });
        await _db.SaveChangesAsync();
        _log.LogWarning("Access-management call denied for {User}: {What}", e, what);
        return StatusCode(403, new { message = "Only Admins and Accounts access admins (Ankit Heda, Gaurav Zore) can manage access rights." });
    }

    private async Task<bool> InAccountsTeamAsync(string email)
    {
        if (_mail.AccountsEmails.Contains(email, StringComparer.OrdinalIgnoreCase)) return true;
        var u = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Email.ToLower() == email);
        return u != null && string.Equals(u.Role, "Accounts", StringComparison.OrdinalIgnoreCase);
    }

    // ── GET /api/accounts-access/me — effective permissions of the caller (drives the UI) ──
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var e = Email();
        if (e.Length == 0) return Unauthorized();
        var (perms, legacy) = await _access.EffectiveAsync(e, await InAccountsTeamAsync(e));
        return Ok(new { email = e, isAdmin = await _access.IsAdminAsync(e), legacy, pages = AccountsAccessService.Pages, permissions = perms });
    }

    // ── GET /api/accounts-access/users — all Accounts team users + their permissions (admin) ──
    [HttpGet("users")]
    public async Task<IActionResult> Users()
    {
        var deny = await RequireAdminAsync("list users"); if (deny != null) return deny;

        var rows = await _db.AccountsPagePermissions.AsNoTracking().ToListAsync();
        var roleUsers = await _db.Users.AsNoTracking()
            .Where(u => u.Role == "Accounts").Select(u => new { u.Email, u.DisplayName }).ToListAsync();

        var emails = rows.Select(r => r.UserEmail)
            .Concat(_mail.AccountsEmails.Select(x => x.ToLowerInvariant()))
            .Concat(roleUsers.Select(u => u.Email.ToLowerInvariant()))
            .Concat(_access.Admins)
            .Distinct().OrderBy(x => x).ToList();

        var names = await _db.Users.AsNoTracking().Where(u => emails.Contains(u.Email.ToLower()))
            .Select(u => new { Email = u.Email.ToLower(), u.DisplayName, u.Role }).ToListAsync();

        var list = new List<object>();
        foreach (var em in emails)
        {
            var (perms, legacy) = await _access.EffectiveAsync(em, true);
            var mine = rows.Where(r => r.UserEmail == em).ToList();
            var last = mine.OrderByDescending(r => r.UpdatedAt).FirstOrDefault();
            var n = names.FirstOrDefault(x => x.Email == em);
            list.Add(new
            {
                email = em, displayName = n?.DisplayName, role = n?.Role,
                isAdmin = await _access.IsAdminAsync(em), configured = mine.Count > 0, legacy,
                permissions = perms, updatedAt = last?.UpdatedAt, updatedBy = last?.UpdatedBy,
            });
        }
        return Ok(new { pages = AccountsAccessService.Pages, users = list });
    }

    // ── PUT /api/accounts-access/users/{email} — upsert permissions + audit every change (admin) ──
    [HttpPut("users/{email}")]
    public async Task<IActionResult> Save(string email, [FromBody] SaveAccessDto dto)
    {
        var deny = await RequireAdminAsync($"change access of {email}"); if (deny != null) return deny;

        var actor = Email();
        var target = (email ?? "").Trim().ToLowerInvariant();
        if (!CnEmailService.IsEmail(target)) return BadRequest(new { message = "Enter a valid email address." });
        if (await _access.IsAdminAsync(target))
            return BadRequest(new { message = "Access admins always have full access and cannot be edited." });
        if (dto?.Permissions is null) return BadRequest(new { message = "Permissions are required." });
        if (dto.Permissions.Any(p => AccountsAccessService.Find(p.PageKey) is null))
            return BadRequest(new { message = "Unknown page key." });

        var existing = await _db.AccountsPagePermissions.Where(x => x.UserEmail == target).ToListAsync();
        var firstTime = existing.Count == 0;
        var inTeam = await InAccountsTeamAsync(target);
        var now = DateTimeOffset.UtcNow;
        var by = ActorName(actor);
        var audits = new List<AccountsAccessAudit>();

        foreach (var page in AccountsAccessService.Pages)
        {
            var req = dto.Permissions.FirstOrDefault(p => p.PageKey == page.Key);
            var next = req is null
                ? AccountsAccessService.None(page)
                : AccountsAccessService.Normalize(page, req.View, req.Download, req.Full);

            var row = existing.FirstOrDefault(x => x.PageKey == page.Key);
            // "before" = saved row, or (first time) the legacy full access an unconfigured team user has today
            var before = row != null ? AccountsAccessService.Normalize(page, row.CanView, row.CanDownload, row.CanFull)
                       : inTeam      ? AccountsAccessService.All(page)
                                     : AccountsAccessService.None(page);

            void Diff(string type, bool was, bool now_, bool applicable)
            {
                if (!applicable || was == now_) return;
                audits.Add(new AccountsAccessAudit
                {
                    At = now, ActorEmail = actor, ActorName = by, TargetEmail = target,
                    PageKey = page.Key, PageName = page.Name, PermissionType = type,
                    Action = now_ ? "Granted" : "Revoked", Result = "Success",
                });
            }
            Diff("View",     before.View,     next.View,     true);
            Diff("Download", before.Download, next.Download, page.HasDownload);
            Diff("Full",     before.Full,     next.Full,     page.HasFull);

            if (row is null)
                _db.AccountsPagePermissions.Add(new AccountsPagePermission
                {
                    UserEmail = target, PageKey = page.Key, CanView = next.View, CanDownload = next.Download,
                    CanFull = next.Full, UpdatedAt = now, UpdatedBy = actor,
                });
            else if (row.CanView != next.View || row.CanDownload != next.Download || row.CanFull != next.Full)
            { row.CanView = next.View; row.CanDownload = next.Download; row.CanFull = next.Full; row.UpdatedAt = now; row.UpdatedBy = actor; }
        }

        if (firstTime)
            audits.Insert(0, new AccountsAccessAudit
            {
                At = now, ActorEmail = actor, ActorName = by, TargetEmail = target, PageKey = "—", PageName = "All pages",
                PermissionType = "—", Action = "UserAdded", Result = "Success",
                Note = inTeam ? "Explicit permissions set (previously unrestricted legacy access)" : "User added to Accounts access list",
            });

        _db.AccountsAccessAudits.AddRange(audits);
        await _db.SaveChangesAsync();
        _log.LogInformation("Accounts access for {Target} updated by {Actor}: {N} change(s)", target, actor, audits.Count);

        var (perms, legacy) = await _access.EffectiveAsync(target, inTeam);
        return Ok(new { email = target, configured = true, legacy, permissions = perms, changes = audits.Count });
    }

    // ── GET /api/accounts-access/audit?page=&pageSize=&user=&actor=&action= (admin) ──
    [HttpGet("audit")]
    public async Task<IActionResult> Audit([FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] string? user = null, [FromQuery] string? actor = null, [FromQuery] string? action = null)
    {
        var deny = await RequireAdminAsync("read audit log"); if (deny != null) return deny;

        page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 5, 200);
        var q = _db.AccountsAccessAudits.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(user))   { var u = user.Trim().ToLower();  q = q.Where(x => x.TargetEmail.ToLower().Contains(u)); }
        if (!string.IsNullOrWhiteSpace(actor))  { var a = actor.Trim().ToLower(); q = q.Where(x => x.ActorEmail.ToLower().Contains(a) || x.ActorName.ToLower().Contains(a)); }
        if (!string.IsNullOrWhiteSpace(action)) q = q.Where(x => x.Action == action);

        var total = await q.CountAsync();
        var rows = await q.OrderByDescending(x => x.At).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new { total, page, pageSize, rows });
    }
}
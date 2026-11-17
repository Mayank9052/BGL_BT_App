using BGL_BT_App.Backend.Data;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

public record AccessPage(string Key, string Name, string Description, bool HasDownload, bool HasFull);
public record PagePerm(string PageKey, bool View, bool Download, bool Full);

public class AccountsAccessService
{
    // The grantable Accounts pages. "access-management" is NOT here — it is admin-only, never grantable.
    public static readonly AccessPage[] Pages =
    {
        new("cn-dashboard",   "Credit Notes Dashboard", "CN list, KPIs and filters. Download = Excel / PDF / CSV export.",                       true,  false),
        new("cn-process",     "Process CN",             "Open the CN panel. Full = CN Pending / Reject / Revise / Mark processed / Cleared.",    false, true),
        new("cn-attachments", "Attachments & Photos",   "Invoices and activity photos. Download = download / open original files.",              true,  false),
        new("cn-emails",      "Email History",          "Every CN mail: recipients, subject, content, time.",                                    false, false),
    };

    private readonly AppDbContext _db;
    private readonly IConfiguration _cfg;
    public AccountsAccessService(AppDbContext db, IConfiguration cfg) { _db = db; _cfg = cfg; }

    public static AccessPage? Find(string? key) => Pages.FirstOrDefault(p => p.Key == key);

    public List<string> Admins =>
        (_cfg["Cn:AccessAdmins"] ?? "ankit.heda@bgauss.com,gaurav.zore@bgauss.com")
            .Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => x.ToLowerInvariant()).Distinct().ToList();

    /// Access admin by config list only (Ankit Heda / Gaurav Zore). Use IsAdminAsync for the full rule.
    public bool IsAdmin(string? email) =>
        !string.IsNullOrWhiteSpace(email) && Admins.Contains(email.Trim().ToLowerInvariant());

    // [BTL-2026-11-17] Portal Admins (Users.Role = "Admin") have ALL Accounts access, incl. Access Management.
    public async Task<bool> IsAdminAsync(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return false;
        var e = email.Trim().ToLowerInvariant();
        if (Admins.Contains(e)) return true;
        return await _db.Users.AsNoTracking()
            .AnyAsync(u => u.Email.ToLower() == e && u.IsActive && u.Role == "Admin");
    }

    public static PagePerm Normalize(AccessPage p, bool view, bool download, bool full)
    {
        if (!p.HasDownload) download = false;
        if (!p.HasFull)     full = false;
        if (full)           { view = true; download = p.HasDownload; }   // Full ⇒ everything the page supports
        if (download)       view = true;                                 // Download ⇒ View
        return new PagePerm(p.Key, view, download, full);
    }

    public static PagePerm All(AccessPage p)  => Normalize(p, true, p.HasDownload, p.HasFull);
    public static PagePerm None(AccessPage p) => new(p.Key, false, false, false);

    public Task<bool> HasAnyRowsAsync(string email) =>
        _db.AccountsPagePermissions.AsNoTracking().AnyAsync(x => x.UserEmail == email.Trim().ToLower());

    /// <param name="inAccountsTeam">caller is an Accounts user by role / Cn:AccountsTeamEmails. With no saved rows
    /// such a user keeps legacy full access, so deploying this feature changes nothing until an admin configures them.</param>
    public async Task<(List<PagePerm> Perms, bool Legacy)> EffectiveAsync(string email, bool inAccountsTeam)
    {
        email = email.Trim().ToLowerInvariant();
        if (await IsAdminAsync(email)) return (Pages.Select(All).ToList(), false);

        var rows = await _db.AccountsPagePermissions.AsNoTracking().Where(x => x.UserEmail == email).ToListAsync();
        if (rows.Count == 0)
            return (Pages.Select(p => inAccountsTeam ? All(p) : None(p)).ToList(), inAccountsTeam);

        var perms = Pages.Select(p =>
        {
            var r = rows.FirstOrDefault(x => x.PageKey == p.Key);
            return r is null ? None(p) : Normalize(p, r.CanView, r.CanDownload, r.CanFull);
        }).ToList();
        return (perms, false);
    }

    /// <summary>Server-side check used by the CN endpoints. level = view | download | full.</summary>
    public async Task<bool> HasAsync(string email, string pageKey, string level)
    {
        var (perms, _) = await EffectiveAsync(email, inAccountsTeam: true);
        var p = perms.FirstOrDefault(x => x.PageKey == pageKey);
        return p != null && level switch { "view" => p.View, "download" => p.Download, "full" => p.Full, _ => false };
    }
}
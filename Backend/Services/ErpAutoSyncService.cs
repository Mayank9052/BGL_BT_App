// Backend/Services/ErpAutoSyncService.cs
//
// Runs on a timer (default: every 1 hour, configurable via
// appsettings "ErpSync:IntervalHours") and automatically does what the
// Admin previously had to trigger by hand via "Preview Import" → "Import":
//
//   1. Fetch active dealers from BaplFinal C_CustomerMaster
//   2. Fetch active staff (RSM/TSM/ZSM/Commando/Manager) from H_EmployeeMaster
//   3. CREATE a portal login for any ERP record that doesn't have one yet
//      (identical logic/default passwords to the manual bulk-import endpoints)
//   4. For records that ALREADY have a login: refresh only DisplayName /
//      DealerName / PhoneNumber from ERP. Role, IsActive, Email, and
//      PasswordHash on an EXISTING user are NEVER touched by this job — so
//      if an Admin manually changes someone's Role (e.g. "Manager" → RSM) or
//      deactivates/reactivates an account, that decision survives every
//      future hourly sync permanently. Only brand-new ERP entries get a
//      Role assigned (from DesignationId), since they have no prior manual
//      decision to protect.
//
// Registration (Program.cs):
//   builder.Services.AddHostedService<ErpAutoSyncService>();
//
// Configuration (appsettings.json) — optional, defaults shown:
//   "ErpSync": { "Enabled": true, "IntervalHours": 1 }

using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Helpers;
using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

// ── Shared, process-wide status so the frontend can show "Last synced: …"
// without needing a database table just for this. Resets on app restart,
// which is fine — it's informational only. ──────────────────────────────────
public static class ErpSyncState
{
    public static DateTime? LastRunUtc        { get; set; }
    public static DateTime? LastSuccessUtc     { get; set; }
    public static string?   LastError          { get; set; }
    public static int       LastDealersCreated { get; set; }
    public static int       LastDealersUpdated { get; set; }
    public static int       LastStaffCreated   { get; set; }
    public static int       LastStaffUpdated   { get; set; }
}

internal class ErpSyncDealerRow
{
    public string CustomerCode  { get; set; } = "";
    public string CustomerName  { get; set; } = "";
    public string Mobile        { get; set; } = "";
    public string ContactPerson { get; set; } = "";
    public string ContactEmail  { get; set; } = "";
}

internal class ErpSyncEmployeeRow
{
    public string EmployeeCode  { get; set; } = "";
    public string EmployeeName  { get; set; } = "";
    public int    DesignationId { get; set; }
    public string EmailId       { get; set; } = "";
    public string MobileNo      { get; set; } = "";
}

public class ErpAutoSyncService : BackgroundService
{
    private readonly IServiceScopeFactory     _scopeFactory;
    private readonly IConfiguration           _cfg;
    private readonly ILogger<ErpAutoSyncService> _log;

    public ErpAutoSyncService(
        IServiceScopeFactory scopeFactory, IConfiguration cfg, ILogger<ErpAutoSyncService> log)
    {
        _scopeFactory = scopeFactory;
        _cfg          = cfg;
        _log          = log;
    }

    private bool Enabled => !_cfg.GetValue<bool?>("ErpSync:Enabled").HasValue
                           || _cfg.GetValue<bool>("ErpSync:Enabled");

    private TimeSpan Interval =>
        TimeSpan.FromHours(_cfg.GetValue<double?>("ErpSync:IntervalHours") ?? 1.0);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!Enabled)
        {
            _log.LogInformation("ErpAutoSyncService disabled via ErpSync:Enabled=false.");
            return;
        }

        _log.LogInformation("ErpAutoSyncService started — syncing every {Interval}.", Interval);

        // Run once shortly after startup, then on the configured interval.
        using var timer = new PeriodicTimer(Interval);
        do
        {
            await RunOnce(ct);
        }
        while (!ct.IsCancellationRequested && await timer.WaitForNextTickAsync(ct));
    }

    private async Task RunOnce(CancellationToken ct)
    {
        ErpSyncState.LastRunUtc = DateTime.UtcNow;
        ErpSyncState.LastError  = null;

        using var scope = _scopeFactory.CreateScope();
        var db   = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var bapl = scope.ServiceProvider.GetRequiredService<BaplDbContext>();

        try
        {
            var (dealersCreated, dealersUpdated) = await SyncDealersAsync(db, bapl, ct);
            var (staffCreated, staffUpdated)     = await SyncStaffAsync(db, bapl, ct);

            ErpSyncState.LastDealersCreated = dealersCreated;
            ErpSyncState.LastDealersUpdated = dealersUpdated;
            ErpSyncState.LastStaffCreated   = staffCreated;
            ErpSyncState.LastStaffUpdated   = staffUpdated;
            ErpSyncState.LastSuccessUtc     = DateTime.UtcNow;

            _log.LogInformation(
                "ErpAutoSyncService run complete — dealers: {DC} created / {DU} updated · staff: {SC} created / {SU} updated.",
                dealersCreated, dealersUpdated, staffCreated, staffUpdated);
        }
        catch (Exception ex)
        {
            ErpSyncState.LastError = ex.Message;
            _log.LogError(ex, "ErpAutoSyncService run failed.");
        }
    }

    // ── Dealers ──────────────────────────────────────────────────────────────
    private async Task<(int Created, int Updated)> SyncDealersAsync(
        AppDbContext db, BaplDbContext bapl, CancellationToken ct)
    {
        var baplRows = await bapl.Database
            .SqlQueryRaw<ErpSyncDealerRow>(@"
                SELECT
                    c.CustomerCode,
                    c.CustomerName,
                    ISNULL(c.Mobile, '')        AS Mobile,
                    ISNULL(c.ContactPerson, '')  AS ContactPerson,
                    ISNULL(c.Email, '')          AS ContactEmail
                FROM [dbo].[C_CustomerMaster] c
                WHERE c.Active = 'Y'")
            .ToListAsync(ct);

        var existing = await db.Users
            .Where(u => u.Role == "Dealer" && u.DealerCode != null)
            .ToDictionaryAsync(u => u.DealerCode!, ct);

        const string defaultPassword = "Dealer@123";
        var passwordHash = PasswordHasher.Hash(defaultPassword);

        int created = 0, updated = 0;

        foreach (var row in baplRows)
        {
            if (existing.TryGetValue(row.CustomerCode, out var user))
            {
                // ── Existing account: refresh display fields only. Role,
                // IsActive, Email, PasswordHash are left exactly as the
                // Admin last set them. ──────────────────────────────────────
                bool changed = false;
                if (user.DealerName != row.CustomerName) { user.DealerName = row.CustomerName; changed = true; }
                if (user.DisplayName != row.CustomerName) { user.DisplayName = row.CustomerName; changed = true; }
                var mobile = string.IsNullOrWhiteSpace(row.Mobile) ? null : row.Mobile.Trim();
                if (user.PhoneNumber != mobile) { user.PhoneNumber = mobile; changed = true; }
                if (changed) { user.UpdatedAt = DateTime.UtcNow; updated++; }
                continue;
            }

            // ── New dealer — create exactly like the manual bulk-import does. ──
            var email = !string.IsNullOrWhiteSpace(row.ContactEmail) && row.ContactEmail.Contains('@')
                ? row.ContactEmail.Trim().ToLower()
                : !string.IsNullOrWhiteSpace(row.Mobile)
                    ? $"{row.Mobile.Trim()}@dealer.bgauss.local"
                    : $"{row.CustomerCode.Trim().ToLower()}@dealer.bgauss.local";

            if (await db.Users.AnyAsync(u => u.Email.ToLower() == email.ToLower(), ct))
                email = $"{row.CustomerCode.Trim().ToLower()}@dealer.bgauss.local";

            var nameParts = (row.ContactPerson?.Trim().Length > 0 ? row.ContactPerson : row.CustomerName)
                .Trim().Split(' ');

            db.Users.Add(new User
            {
                Email          = email,
                DisplayName    = row.CustomerName,
                FirstName      = nameParts[0],
                LastName       = nameParts.Length > 1 ? string.Join(' ', nameParts.Skip(1)) : "",
                Role           = "Dealer",
                AuthType       = "Local",
                PasswordHash   = passwordHash,
                DealerCode     = row.CustomerCode,
                DealerName     = row.CustomerName,
                PhoneNumber    = string.IsNullOrWhiteSpace(row.Mobile) ? null : row.Mobile.Trim(),
                IsActive       = true,
                CreatedByEmail = "erp-auto-sync",
            });
            created++;
        }

        await db.SaveChangesAsync(ct);
        return (created, updated);
    }

    // ── Staff (RSM / TSM / ZSM / Commando / Manager) ────────────────────────
    private async Task<(int Created, int Updated)> SyncStaffAsync(
        AppDbContext db, BaplDbContext bapl, CancellationToken ct)
    {
        var rows = await bapl.Database
            .SqlQueryRaw<ErpSyncEmployeeRow>(@"
                SELECT
                    EmployeeCode,
                    EmployeeName,
                    DesignationId,
                    ISNULL(EmailId, '')  AS EmailId,
                    ISNULL(MobileNo, '') AS MobileNo
                FROM [dbo].[H_EmployeeMaster]
                WHERE Status = 'Y'
                  AND DesignationId IN (8, 24, 25, 26, 36)")
            .ToListAsync(ct);

        var existing = await db.Users
            .Where(u => u.EmployeeCode != null)
            .ToDictionaryAsync(u => u.EmployeeCode!, ct);

        const string defaultPassword = "Auto@123";
        var passwordHash = PasswordHasher.Hash(defaultPassword);

        int created = 0, updated = 0;

        foreach (var row in rows)
        {
            if (existing.TryGetValue(row.EmployeeCode, out var user))
            {
                // ── Existing account: refresh display fields only. Role (even
                // if the Admin changed it from the ERP-implied value, e.g.
                // "Manager" DesignationId → kept as RSM), IsActive, Email,
                // and PasswordHash are left untouched. ─────────────────────
                bool changed = false;
                if (user.DisplayName != row.EmployeeName.Trim()) { user.DisplayName = row.EmployeeName.Trim(); changed = true; }
                var mobile = string.IsNullOrWhiteSpace(row.MobileNo) ? null : row.MobileNo.Trim();
                if (user.PhoneNumber != mobile) { user.PhoneNumber = mobile; changed = true; }
                if (changed) { user.UpdatedAt = DateTime.UtcNow; updated++; }
                continue;
            }

            // DesignationId 8 ("Manager") → RSM fallback, same as the manual
            // bulk-import endpoints (see EmployeeAuthController patch).
            var role = EmployeeRoleMap.ToRole(row.DesignationId) ?? (row.DesignationId == 8 ? "RSM" : null);
            if (role is null) continue; // not an eligible designation

            var email = !string.IsNullOrWhiteSpace(row.EmailId) && row.EmailId.Contains('@')
                ? row.EmailId.Trim().ToLower()
                : $"{row.EmployeeCode.Trim().ToLower()}@staff.bgauss.local";

            if (await db.Users.AnyAsync(u => u.Email.ToLower() == email.ToLower(), ct))
                email = $"{row.EmployeeCode.Trim().ToLower()}@staff.bgauss.local";

            var nameParts = row.EmployeeName.Trim().Split(' ');

            db.Users.Add(new User
            {
                Email          = email,
                DisplayName    = row.EmployeeName.Trim(),
                FirstName      = nameParts[0],
                LastName       = nameParts.Length > 1 ? string.Join(' ', nameParts.Skip(1)) : "",
                Role           = role,
                AuthType       = "Local",
                PasswordHash   = passwordHash,
                EmployeeCode   = row.EmployeeCode,
                PhoneNumber    = string.IsNullOrWhiteSpace(row.MobileNo) ? null : row.MobileNo.Trim(),
                IsActive       = true,
                CreatedByEmail = "erp-auto-sync",
            });
            created++;
        }

        await db.SaveChangesAsync(ct);
        return (created, updated);
    }
}
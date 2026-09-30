// Backend/Controllers/DealerTeamMappingController.cs
using System.Security.Claims;
using System.Text.RegularExpressions;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using BGL_BT_App.Backend.Services;

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

// Read-only shape for non-admin screens (RSM Form, Approver Dashboard).
public record DealerTeamLookupDto(
    string DealerName, string? DealerCode, string? City, string? State,
    string Rsm, string? RsmEmail, string? Tsm, string? TsmEmail,
    string? Commando, string? CommandoEmail, string? DealerEmail,
    bool IsEligible, string? DealerType);

// Bulk rows: every field optional — blank / NULL = keep existing DB value.
public record BulkUpsertDataDto(
    string DealerName, string? DealerCode, string? City, string? State,
    string? Rsm, string? RsmEmail, string? Tsm, string? TsmEmail,
    string? Commando, string? CommandoEmail, string? DealerEmail,
    bool? IsEligible, string? DealerType);

public record BulkImportRowDto(int SourceRow, BulkUpsertDataDto Data);
public record BulkImportRequestDto(List<BulkImportRowDto> Rows);
public record BulkImportErrorDto(int SourceRow, string DealerName, string Message);
public record BulkImportResultDto(int Created, int Updated, int Unchanged, List<BulkImportErrorDto> Errors);

[ApiController]
[Route("api/dealer-team-mapping")]
[Authorize(AuthenticationSchemes = "AzureAD,DealerJwt")]
public class DealerTeamMappingController : ControllerBase
{
    private const int MaxBulkRows = 5000;
    private static readonly Regex EmailRx =
        new(@"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$", RegexOptions.Compiled);

    private readonly AppDbContext _db;
    private readonly ILogger<DealerTeamMappingController> _logger;

    public DealerTeamMappingController(AppDbContext db, ILogger<DealerTeamMappingController> logger)
    {
        _db = db; _logger = logger;
    }

    // ── GET /api/dealer-team-mapping — Admin only, full list ───────────────
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

    // ── GET /api/dealer-team-mapping/lookup — any signed-in user ───────────
    // Used by RSM Form (dealer list + auto-fill) and Approver Dashboard (cc on
    // Notify Dealer). A Dealer login only receives its OWN row.
    [HttpGet("lookup")]
    public async Task<IActionResult> Lookup()
    {
        var query = _db.Set<DealerTeamMapping>().AsNoTracking().AsQueryable();

        if (IsDealerCaller())
        {
            // ASSUMPTION: DealerJwt carries "dealerCode" / "dealerName" claims.
            var code = (User.FindFirstValue("dealerCode") ?? "").Trim();
            var name = (User.FindFirstValue("dealerName") ?? "").Trim().ToLower();
            if (code.Length == 0 && name.Length == 0)
                return Ok(Array.Empty<DealerTeamLookupDto>());

            query = query.Where(d =>
                (code.Length > 0 && d.DealerCode == code) ||
                (name.Length > 0 && d.DealerName.ToLower() == name));
        }

        var rows = await query.OrderBy(d => d.DealerName).ToListAsync();
        return Ok(rows.Select(ToLookupDto));
    }

    // ── GET /api/dealer-team-mapping/my-team — Dealer login: own RSM/TSM/Commando ──
    [HttpGet("my-team")]
    public async Task<IActionResult> MyTeam()
    {
        var sub = User.FindFirstValue("sub");
        if (string.IsNullOrWhiteSpace(sub) || !int.TryParse(sub, out var userId))
            return Unauthorized(new { message = "Dealer login required." });

        var u = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId);
        if (u is null) return Unauthorized(new { message = "User not found." });

        var m = await DealerNameMatcher.FindMappingAsync(_db, u.DealerName);
        if (m is null) return NotFound(new { message = "No Dealer Mapping found for your dealership." });

        return Ok(ToLookupDto(m));
    }

        // ── GET /api/dealer-team-mapping/my-dealers — RSM/TSM/Commando login ──────
    // All dealers mapped to this person (match by email first, else by name).
    [HttpGet("my-dealers")]
    public async Task<IActionResult> MyDealers()
    {
        var sub = User.FindFirstValue("sub");
        if (string.IsNullOrWhiteSpace(sub) || !int.TryParse(sub, out var userId))
            return Unauthorized(new { message = "Staff login required." });

        var u = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId);
        if (u is null) return Unauthorized(new { message = "User not found." });

        var email   = (u.Email ?? "").Trim();
        var nameKey = DealerNameMatcher.Normalize(u.DisplayName);

        bool IsMe(string? name, string? emails) =>
            (email.Length > 0 && !string.IsNullOrWhiteSpace(emails) &&
             emails.Split(',', ';').Any(x => string.Equals(x.Trim(), email, StringComparison.OrdinalIgnoreCase)))
            || (nameKey.Length > 0 && DealerNameMatcher.Normalize(name) == nameKey);

        var rows = await _db.Set<DealerTeamMapping>().AsNoTracking()
            .OrderBy(d => d.DealerName).ToListAsync();

        var mine = (u.Role ?? "") switch
        {
            var r when r.Equals("RSM", StringComparison.OrdinalIgnoreCase)      => rows.Where(m => IsMe(m.Rsm, m.RsmEmail)),
            var r when r.Equals("TSM", StringComparison.OrdinalIgnoreCase)      => rows.Where(m => IsMe(m.Tsm, m.TsmEmail)),
            var r when r.Equals("Commando", StringComparison.OrdinalIgnoreCase) => rows.Where(m => IsMe(m.Commando, m.CommandoEmail)),
            _ => Enumerable.Empty<DealerTeamMapping>(),
        };

        return Ok(mine.Select(ToLookupDto));
    }

    // ── POST /api/dealer-team-mapping — Admin only ─────────────────────────
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] UpsertDealerTeamMappingDto dto)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        var err = Validate(dto);
        if (err is not null) return BadRequest(new { message = err });

        var name = dto.DealerName.Trim();
        var exists = await _db.Set<DealerTeamMapping>()
            .AnyAsync(d => d.DealerName.ToLower() == name.ToLower());
        if (exists)
            return Conflict(new { message = $"'{name}' already exists in the mapping." });

        var row = new DealerTeamMapping();
        Apply(row, dto, guard.CallerEmail);
        _db.Add(row);
        await _db.SaveChangesAsync();
        return Ok(ToDto(row));
    }

    // ── PUT /api/dealer-team-mapping/{id} — Admin only ─────────────────────
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpsertDealerTeamMappingDto dto)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        var err = Validate(dto);
        if (err is not null) return BadRequest(new { message = err });

        var row = await _db.Set<DealerTeamMapping>().FirstOrDefaultAsync(d => d.Id == id);
        if (row is null) return NotFound(new { message = "Mapping not found." });

        var name = dto.DealerName.Trim();
        var clash = await _db.Set<DealerTeamMapping>()
            .AnyAsync(d => d.Id != id && d.DealerName.ToLower() == name.ToLower());
        if (clash)
            return Conflict(new { message = $"Another mapping already uses the name '{name}'." });

        Apply(row, dto, guard.CallerEmail);
        await _db.SaveChangesAsync();
        return Ok(ToDto(row));
    }

    // ── DELETE /api/dealer-team-mapping/{id} — Admin only ──────────────────
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

        // ── POST /api/dealer-team-mapping/bulk — Admin only, Excel import ──────
    // Match: Dealer Code first, else Dealer Name (case-insensitive).
    // Blank / "NULL" cell = KEEP existing value. Not matched → created.
    // Rows missing from the file are NOT deleted. Invalid rows skipped + reported.
    [HttpPost("bulk")]
    public async Task<IActionResult> BulkUpsert([FromBody] BulkImportRequestDto req)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        if (req?.Rows is null || req.Rows.Count == 0)
            return BadRequest(new { message = "No rows to import." });
        if (req.Rows.Count > MaxBulkRows)
            return BadRequest(new { message = $"Maximum {MaxBulkRows} rows per import." });

        var set = _db.Set<DealerTeamMapping>();
        var existing = await set.ToListAsync();

        var byCode = new Dictionary<string, DealerTeamMapping>(StringComparer.OrdinalIgnoreCase);
        var byName = new Dictionary<string, DealerTeamMapping>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in existing)
        {
            var c = N(e.DealerCode);
            if (c is not null) byCode.TryAdd(c, e);
            byName.TryAdd(e.DealerName.Trim(), e);
        }

        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var errors = new List<BulkImportErrorDto>();
        int created = 0, updated = 0, unchanged = 0;

        foreach (var item in req.Rows)
        {
            var d = item.Data;
            if (d is null) { errors.Add(new(item.SourceRow, "", "Empty row.")); continue; }

            var name = N(d.DealerName) ?? "";
            if (name.Length == 0) { errors.Add(new(item.SourceRow, "", "Dealer name is required.")); continue; }

            var code = N(d.DealerCode);
            if (!seenNames.Add(name)) { errors.Add(new(item.SourceRow, name, "Dealer name repeated in file.")); continue; }
            if (code is not null && !seenCodes.Add(code)) { errors.Add(new(item.SourceRow, name, $"Dealer code '{code}' repeated in file.")); continue; }

            DealerTeamMapping? target = null;
            var matchedByCode = code is not null && byCode.TryGetValue(code, out target);
            if (!matchedByCode) byName.TryGetValue(name, out target);

            if (!matchedByCode && target is not null && code is not null &&
                N(target.DealerCode) is { } dbCode &&
                !string.Equals(dbCode, code, StringComparison.OrdinalIgnoreCase))
            {
                errors.Add(new(item.SourceRow, name,
                    $"Name matches an existing dealer with code '{dbCode}', but file has code '{code}'."));
                continue;
            }
            if (byName.TryGetValue(name, out var nameOwner) && target is not null &&
                !ReferenceEquals(nameOwner, target))
            {
                errors.Add(new(item.SourceRow, name,
                    $"Dealer name already used by another mapping (code {nameOwner.DealerCode ?? "—"})."));
                continue;
            }

            // Blank cells fall back to the existing DB value
            var merged = Merge(target, d);
            var err = Validate(merged);
            if (err is not null) { errors.Add(new(item.SourceRow, name, err)); continue; }

            if (target is null)
            {
                target = new DealerTeamMapping();
                Apply(target, merged, guard.CallerEmail);
                set.Add(target);
                byName[target.DealerName] = target;
                if (N(target.DealerCode) is { } nc) byCode[nc] = target;
                created++;
            }
            else if (IsSame(target, merged))
            {
                unchanged++;
            }
            else
            {
                var oldName = target.DealerName;
                var oldCode = N(target.DealerCode);
                Apply(target, merged, guard.CallerEmail);
                if (!string.Equals(oldName, target.DealerName, StringComparison.OrdinalIgnoreCase))
                { byName.Remove(oldName); byName[target.DealerName] = target; }
                var newCode = N(target.DealerCode);
                if (!string.Equals(oldCode, newCode, StringComparison.OrdinalIgnoreCase))
                { if (oldCode is not null) byCode.Remove(oldCode); if (newCode is not null) byCode[newCode] = target; }
                updated++;
            }
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation(
            "Dealer mapping bulk import by {Email}: created {C}, updated {U}, unchanged {N}, errors {E}",
            guard.CallerEmail, created, updated, unchanged, errors.Count);

        return Ok(new BulkImportResultDto(created, updated, unchanged, errors));
    }

    // File value wins when present; otherwise keep the DB value.
    // New dealer with blank Eligibility → Eligible (ASSUMPTION — confirm); blank Type → null.
    private static UpsertDealerTeamMappingDto Merge(DealerTeamMapping? e, BulkUpsertDataDto d) => new(
        DealerName:    d.DealerName.Trim(),
        DealerCode:    N(d.DealerCode)    ?? e?.DealerCode,
        City:          N(d.City)          ?? e?.City,
        State:         N(d.State)         ?? e?.State,
        Rsm:           N(d.Rsm)           ?? e?.Rsm ?? "",
        RsmEmail:      N(d.RsmEmail)      ?? e?.RsmEmail,
        Tsm:           N(d.Tsm)           ?? e?.Tsm,
        TsmEmail:      N(d.TsmEmail)      ?? e?.TsmEmail,
        Commando:      N(d.Commando)      ?? e?.Commando,
        CommandoEmail: N(d.CommandoEmail) ?? e?.CommandoEmail,
        DealerEmail:   N(d.DealerEmail)   ?? e?.DealerEmail,
        IsEligible:    d.IsEligible       ?? e?.IsEligible ?? true,
        DealerType:    N(d.DealerType)    ?? e?.DealerType);

    // ── Helpers ────────────────────────────────────────────────────────────
       private static string? N(string? s) =>
        string.IsNullOrWhiteSpace(s) || s.Trim().Equals("NULL", StringComparison.OrdinalIgnoreCase)
            ? null : s.Trim();

    // Emails: trimmed, lower-case; multiple dealer emails joined by ","
    private static string? NE(string? s)
    {
        if (N(s) is null) return null;
        var parts = s!.Split(',', ';').Select(p => p.Trim().ToLowerInvariant()).Where(p => p.Length > 0);
        var joined = string.Join(",", parts);
        return joined.Length == 0 ? null : joined;
    }

    private static string? NormalizeType(string? s) =>
        N(s)?.ToLowerInvariant() switch { "old" => "Old", "new" => "New", _ => null };

    private static string? FirstBadEmail(string? v)
    {
        if (N(v) is null) return null;
        foreach (var part in v!.Split(',', ';'))
        {
            var p = part.Trim();
            if (p.Length > 0 && !EmailRx.IsMatch(p)) return p;
        }
        return null;
    }

    private static string? Validate(UpsertDealerTeamMappingDto dto)
    {
        if (N(dto.DealerName) is null) return "Dealer name is required.";
        if (N(dto.Rsm) is null) return "RSM name is required.";
        if (N(dto.DealerType) is not null && NormalizeType(dto.DealerType) is null)
            return "Dealer type must be Old or New.";

        foreach (var (label, value) in new[] {
            ("RSM email", dto.RsmEmail), ("TSM email", dto.TsmEmail),
            ("Commando email", dto.CommandoEmail), ("Dealer email", dto.DealerEmail) })
        {
            var bad = FirstBadEmail(value);
            if (bad is not null) return $"{label} '{bad}' is not a valid email.";
        }
        if (N(dto.TsmEmail) is not null && N(dto.Tsm) is null) return "TSM email given but TSM name is blank.";
        if (N(dto.CommandoEmail) is not null && N(dto.Commando) is null) return "Commando email given but Commando name is blank.";
        return null;
    }

    private static void Apply(DealerTeamMapping row, UpsertDealerTeamMappingDto dto, string? by)
    {
        row.DealerName     = dto.DealerName.Trim();
        row.DealerCode     = N(dto.DealerCode);
        row.City           = N(dto.City);
        row.State          = N(dto.State);
        row.Rsm            = dto.Rsm.Trim();
        row.RsmEmail       = NE(dto.RsmEmail);
        row.Tsm            = N(dto.Tsm);
        row.TsmEmail       = NE(dto.TsmEmail);
        row.Commando       = N(dto.Commando);
        row.CommandoEmail  = NE(dto.CommandoEmail);
        row.DealerEmail    = NE(dto.DealerEmail);
        row.IsEligible     = dto.IsEligible;
        row.DealerType     = NormalizeType(dto.DealerType);
        row.UpdatedAt      = DateTime.UtcNow;
        row.UpdatedByEmail = by;
    }

    private static bool IsSame(DealerTeamMapping r, UpsertDealerTeamMappingDto d) =>
        r.DealerName == d.DealerName.Trim() &&
        N(r.DealerCode) == N(d.DealerCode) &&
        N(r.City) == N(d.City) && N(r.State) == N(d.State) &&
        r.Rsm == d.Rsm.Trim() && NE(r.RsmEmail) == NE(d.RsmEmail) &&
        N(r.Tsm) == N(d.Tsm) && NE(r.TsmEmail) == NE(d.TsmEmail) &&
        N(r.Commando) == N(d.Commando) && NE(r.CommandoEmail) == NE(d.CommandoEmail) &&
        NE(r.DealerEmail) == NE(d.DealerEmail) &&
        r.IsEligible == d.IsEligible &&
        NormalizeType(r.DealerType) == NormalizeType(d.DealerType);

    private static DealerTeamMappingDto ToDto(DealerTeamMapping d) => new(
        d.Id, d.DealerName, d.DealerCode, d.City, d.State,
        d.Rsm, d.RsmEmail, d.Tsm, d.TsmEmail, d.Commando, d.CommandoEmail, d.DealerEmail,
        d.IsEligible, d.DealerType, d.UpdatedAt, d.UpdatedByEmail);

    private static DealerTeamLookupDto ToLookupDto(DealerTeamMapping d) => new(
        d.DealerName, d.DealerCode, d.City, d.State,
        d.Rsm, d.RsmEmail, d.Tsm, d.TsmEmail, d.Commando, d.CommandoEmail, d.DealerEmail,
        d.IsEligible, d.DealerType);

    private bool IsDealerCaller() =>
        User.FindAll(ClaimTypes.Role).Select(c => c.Value)
            .Concat(User.FindAll("role").Select(c => c.Value))
            .Any(r => string.Equals(r, "Dealer", StringComparison.OrdinalIgnoreCase));

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
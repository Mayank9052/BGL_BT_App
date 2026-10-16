using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Helpers;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BGL_BT_App.Backend.Controllers;

// ── Helper for H_EmployeeMaster raw rows ──────────────────────────────────────
internal class EmployeeRaw
{
    public string EmployeeCode { get; set; } = "";
    public string EmployeeName { get; set; } = "";
    public int    DesignationId { get; set; }
    public string EmailId      { get; set; } = "";
    public string MobileNo     { get; set; } = "";
    public string Status       { get; set; } = "";
    public string? BaseLocation { get; set; }
}

[ApiController]
[Route("api/employee-auth")]
public class EmployeeAuthController : ControllerBase
{
    private readonly AppDbContext  _db;
    private readonly BaplDbContext _bapl;
    private readonly JwtTokenService _jwt;
    private readonly ILogger<EmployeeAuthController> _logger;
    private readonly AuditLogService _audit;

    public EmployeeAuthController(
        AppDbContext db, BaplDbContext bapl,
        JwtTokenService jwt, ILogger<EmployeeAuthController> logger, AuditLogService audit)
    {
        _db = db; _bapl = bapl; _jwt = jwt; _logger = logger; _audit = audit;
    }

    // ── POST /api/employee-auth/login — public ────────────────────────────────
    // Uses the SAME DealerJwt scheme as dealer login, so no new auth
    // middleware or frontend changes are needed — just a different
    // Role claim ("RSM"/"TSM"/"ZSM"/"Commando") on the resulting token.
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] DealerLoginDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Password))
                return BadRequest(new { message = "Email and password are required." });

            var user = await _db.Users.FirstOrDefaultAsync(u =>
                u.Email.ToLower() == dto.Email.Trim().ToLower()
                && u.AuthType == "Local"
                && (u.Role == "RSM" || u.Role == "TSM" || u.Role == "ZSM" || u.Role == "Commando"));

            if (user is null || user.PasswordHash is null)
                return Unauthorized(new { message = "Invalid email or password." });
            if (!user.IsActive)
                return Unauthorized(new { message = "This account has been deactivated. Contact admin." });
            if (!PasswordHasher.Verify(dto.Password, user.PasswordHash))
                return Unauthorized(new { message = "Invalid email or password." });

            user.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            var token = _jwt.GenerateToken(user); // must embed user.Role as a claim — see note below

            return Ok(new DealerLoginResponseDto(
                token, user.Id, user.Email, user.DisplayName, user.Role,
                user.EmployeeCode, user.DisplayName
            ));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Employee login failed for {Email}", dto.Email);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── GET /api/employee-auth/bulk-preview — Admin only ──────────────────────
    [HttpGet("bulk-preview")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> BulkPreview()
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var rows = await FetchEligibleEmployees();
            var existingCodes = await GetExistingEmployeeCodes();

            var toCreate = rows
                .Where(r => !existingCodes.Contains(r.EmployeeCode))
                .Select(r => new
                {
                    r.EmployeeCode,
                    r.EmployeeName,
                    role = EmployeeRoleMap.ToRole(r.DesignationId) ?? (r.DesignationId == 8 ? "RSM" : null),
                    r.EmailId,
                    hasRealEmail = !string.IsNullOrWhiteSpace(r.EmailId) && r.EmailId.Contains('@'),
                })
                .ToList();

            return Ok(new
            {
                totalEligible    = rows.Count,
                alreadyImported  = existingCodes.Count,
                toCreate         = toCreate.Count,
                employees        = toCreate,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bulk staff preview failed");
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── POST /api/employee-auth/bulk-import — Admin only ──────────────────────
    // Default password: same convention as dealer bulk import (Dealer@123
    // reused here as Auto@123 to avoid confusing the two groups).
    [HttpPost("bulk-import")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> BulkImport()
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var rows          = await FetchEligibleEmployees();
            var existingCodes = await GetExistingEmployeeCodes();

            const string defaultPassword = "Auto@123";
            var passwordHash = PasswordHasher.Hash(defaultPassword);

            int created = 0, skipped = 0, failed = 0;
            var errors = new List<string>();
            var createdList = new List<object>();

            foreach (var row in rows)
            {
                if (existingCodes.Contains(row.EmployeeCode)) { skipped++; continue; }

                var role = EmployeeRoleMap.ToRole(row.DesignationId) ?? (row.DesignationId == 8 ? "RSM" : null);
                if (role is null) { skipped++; continue; } // not an RSM/TSM/ZSM/Commando/Manager designation

                try
                {
                    var email = !string.IsNullOrWhiteSpace(row.EmailId) && row.EmailId.Contains('@')
                        ? row.EmailId.Trim().ToLower()
                        : $"{row.EmployeeCode.Trim().ToLower()}@staff.bgauss.local";

                    var emailTaken = await _db.Users.AnyAsync(u => u.Email.ToLower() == email);
                    if (emailTaken)
                        email = $"{row.EmployeeCode.Trim().ToLower()}@staff.bgauss.local";

                    var nameParts = row.EmployeeName.Trim().Split(' ');
                    var user = new User
                    {
                        Email          = email,
                        DisplayName    = row.EmployeeName.Trim(),
                        FirstName      = nameParts[0],
                        LastName       = nameParts.Length > 1 ? string.Join(' ', nameParts.Skip(1)) : "",
                        Role           = role,
                        AuthType       = "Local",
                        PasswordHash   = passwordHash,
                        EmployeeCode   = row.EmployeeCode,
                        PhoneNumber    = row.MobileNo,
                        IsActive       = true,
                        CreatedByEmail = guard.CallerEmail,
                    };

                    _db.Users.Add(user);
                    created++;
                    createdList.Add(new { row.EmployeeCode, row.EmployeeName, role, email });

                    if (created % 50 == 0) await _db.SaveChangesAsync();
                }
                catch (Exception ex)
                {
                    failed++;
                    errors.Add($"{row.EmployeeCode} ({row.EmployeeName}): {ex.Message}");
                }
            }

            if (created % 50 != 0) await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Bulk staff import by {Admin}: created={C}, skipped={S}, failed={F}",
                guard.CallerEmail, created, skipped, failed);

            return Ok(new
            {
                message = $"Import complete: {created} created, {skipped} already existed/ineligible, {failed} failed.",
                created, skipped, failed, defaultPassword, errors, employees = createdList,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bulk staff import failed");
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── GET /api/employee-auth/list — Admin only ──────────────────────────────
    [HttpGet("list")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> ListStaffUsers()
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var staff = await _db.Users
                .Where(u => u.Role == "RSM" || u.Role == "TSM" || u.Role == "ZSM" || u.Role == "Commando")
                .OrderBy(u => u.Role).ThenBy(u => u.DisplayName)
                .Select(u => new
                {
                    u.Id, u.Email, u.DisplayName, u.EmployeeCode, u.Role,
                    u.PhoneNumber, u.IsActive, u.LastLoginAt, u.CreatedByEmail, u.CreatedAt,
                })
                .ToListAsync();

            return Ok(staff);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list staff users");
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── PATCH /api/employee-auth/{id}/toggle — Admin only ─────────────────────
    [HttpPatch("{id:int}/toggle")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> ToggleStaffActive(int id)
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var staff = await _db.Users.FirstOrDefaultAsync(u =>
                u.Id == id && (u.Role == "RSM" || u.Role == "TSM" || u.Role == "ZSM" || u.Role == "Commando"));
            if (staff is null) return NotFound(new { message = "Staff account not found." });

            staff.IsActive = !staff.IsActive;
            await _db.SaveChangesAsync();
            return Ok(new { staff.Id, staff.IsActive });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to toggle staff {Id}", id);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── POST /api/employee-auth/{id}/admin-reset-password — Admin only ────────
    [HttpPost("{id:int}/admin-reset-password")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> AdminResetStaffPassword(int id, [FromBody] AdminResetPasswordDto dto)
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 8)
                return BadRequest(new { message = "Password must be at least 8 characters." });

            var staff = await _db.Users.FirstOrDefaultAsync(u =>
                u.Id == id && (u.Role == "RSM" || u.Role == "TSM" || u.Role == "ZSM" || u.Role == "Commando"));
            if (staff is null) return NotFound(new { message = "Staff account not found." });

            staff.PasswordHash = PasswordHasher.Hash(dto.NewPassword);
            staff.UpdatedAt    = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Admin {Admin} reset password for staff {Email}", guard.CallerEmail, staff.Email);
            
            await _audit.LogAsync(guard.CallerEmail!, "Admin", "Admin", "AzureAD", "PasswordAdminReset",
                targetEmail: staff.Email, details: $"Admin reset password for {staff.DisplayName}");

            return Ok(new { message = $"Password reset successfully for {staff.DisplayName}." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Admin password reset failed for staff {Id}", id);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── PRIVATE HELPERS ────────────────────────────────────────────────────
    private async Task<List<EmployeeRaw>> FetchEligibleEmployees() =>
        await _bapl.Database
            .SqlQueryRaw<EmployeeRaw>(@"
                SELECT
                    EmployeeCode,
                    EmployeeName,
                    DesignationId,
                    ISNULL(EmailId, '')   AS EmailId,
                    ISNULL(MobileNo, '')  AS MobileNo,
                    Status,
                    BaseLocation
                FROM [dbo].[H_EmployeeMaster]
                WHERE Status = 'Y'
                  AND DesignationId IN (8, 24, 25, 26, 36)")
            .ToListAsync();

    private async Task<HashSet<string>> GetExistingEmployeeCodes() =>
        (await _db.Users
            .Where(u => u.EmployeeCode != null)
            .Select(u => u.EmployeeCode!)
            .ToListAsync())
            .ToHashSet();

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
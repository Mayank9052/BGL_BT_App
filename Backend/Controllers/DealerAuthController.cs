using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Security.Cryptography;

namespace BGL_BT_App.Backend.Controllers;

// ── Helper for BaplFinal raw dealer rows ──────────────────────────────────────
internal class BaplDealerRaw
{
    public string CustomerCode  { get; set; } = "";
    public string CustomerName  { get; set; } = "";
    public string City          { get; set; } = "";
    public string State         { get; set; } = "";
    public string Mobile        { get; set; } = "";
    public string ContactPerson { get; set; } = "";
    public string ContactEmail  { get; set; } = "";
}

[ApiController]
[Route("api/dealer-auth")]
public class DealerAuthController : ControllerBase
{
    private readonly AppDbContext  _db;
    private readonly BaplDbContext _bapl;
    private readonly JwtTokenService _jwt;
    private readonly IEmailService _emailService;
    private readonly ILogger<DealerAuthController> _logger;

    public DealerAuthController(
        AppDbContext db, BaplDbContext bapl,
        JwtTokenService jwt,
        IEmailService emailService,
        ILogger<DealerAuthController> logger)
    {
        _db = db; _bapl = bapl; _jwt = jwt;
        _emailService = emailService; _logger = logger;
    }

    // ── POST /api/dealer-auth/login — public ──────────────────────────────────
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] DealerLoginDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Password))
                return BadRequest(new { message = "Email and password are required." });

            var user = await _db.Users
                .FirstOrDefaultAsync(u => u.Email.ToLower() == dto.Email.Trim().ToLower()
                                       && u.AuthType == "Local"
                                       && u.Role == "Dealer");

            if (user is null || user.PasswordHash is null)
                return Unauthorized(new { message = "Invalid email or password." });

            if (!user.IsActive)
                return Unauthorized(new { message = "This account has been deactivated. Contact admin." });

            if (!PasswordHasher.Verify(dto.Password, user.PasswordHash))
                return Unauthorized(new { message = "Invalid email or password." });

            user.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            var token = _jwt.GenerateToken(user);

            return Ok(new DealerLoginResponseDto(
                token, user.Id, user.Email, user.DisplayName, user.Role,
                user.DealerCode, user.DealerName
            ));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Dealer login failed for {Email}", dto.Email);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── POST /api/dealer-auth/create — Admin only ─────────────────────────────
    [HttpPost("create")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> CreateDealerUser([FromBody] CreateDealerUserDto dto)
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Password))
                return BadRequest(new { message = "Email and password are required." });

            if (dto.Password.Length < 8)
                return BadRequest(new { message = "Password must be at least 8 characters." });

            var exists = await _db.Users.AnyAsync(u => u.Email.ToLower() == dto.Email.Trim().ToLower());
            if (exists)
                return Conflict(new { message = "A user with this email already exists." });

            var dealerUser = new User
            {
                Email          = dto.Email.Trim(),
                DisplayName    = dto.DisplayName.Trim(),
                Role           = "Dealer",
                AuthType       = "Local",
                PasswordHash   = PasswordHasher.Hash(dto.Password),
                DealerCode     = dto.DealerCode,
                DealerName     = dto.DealerName,
                PhoneNumber    = dto.PhoneNumber,
                IsActive       = true,
                CreatedByEmail = guard.CallerEmail,
            };

            _db.Users.Add(dealerUser);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                dealerUser.Id, dealerUser.Email, dealerUser.DisplayName,
                dealerUser.DealerCode, dealerUser.DealerName, dealerUser.Role,
                dealerUser.PhoneNumber, dealerUser.IsActive,
                dealerUser.LastLoginAt, dealerUser.CreatedByEmail, dealerUser.CreatedAt,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create dealer user {Email}", dto.Email);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── GET /api/dealer-auth/list — Admin only ─────────────────────────────────
    [HttpGet("list")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> ListDealerUsers()
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var dealers = await _db.Users
                .Where(u => u.Role == "Dealer")
                .OrderBy(u => u.DealerName)
                .Select(u => new
                {
                    u.Id, u.Email, u.DisplayName, u.DealerCode, u.DealerName,
                    u.PhoneNumber, u.IsActive, u.LastLoginAt, u.CreatedByEmail, u.CreatedAt,
                })
                .ToListAsync();

            return Ok(dealers);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list dealer users");
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── PATCH /api/dealer-auth/{id}/toggle — Admin only ──────────────────────
    [HttpPatch("{id:int}/toggle")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> ToggleDealerActive(int id)
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var dealer = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == "Dealer");
            if (dealer is null) return NotFound(new { message = "Dealer account not found." });

            dealer.IsActive = !dealer.IsActive;
            await _db.SaveChangesAsync();
            return Ok(new { dealer.Id, dealer.IsActive });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to toggle dealer {Id}", id);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── POST /api/dealer-auth/{id}/admin-reset-password — Admin only ──────────
    [HttpPost("{id:int}/admin-reset-password")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> AdminResetDealerPassword(int id, [FromBody] AdminResetPasswordDto dto)
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 8)
                return BadRequest(new { message = "Password must be at least 8 characters." });

            var dealer = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.Role == "Dealer");
            if (dealer is null) return NotFound(new { message = "Dealer account not found." });

            dealer.PasswordHash     = PasswordHasher.Hash(dto.NewPassword);
            dealer.ResetToken       = null;
            dealer.ResetTokenExpiry = null;
            dealer.UpdatedAt        = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Admin {Admin} reset password for dealer {Email}", guard.CallerEmail, dealer.Email);

            return Ok(new { message = $"Password reset successfully for {dealer.DisplayName}." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Admin password reset failed for dealer {Id}", id);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BULK IMPORT FROM BAPLFINAL C_CustomerMaster
    // ══════════════════════════════════════════════════════════════════════════

    // ── POST /api/dealer-auth/bulk-preview — Admin only ───────────────────────
    // Shows what would be imported (dry run — no writes)
    [HttpPost("bulk-preview")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> BulkPreviewDealers()
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var baplRows = await FetchBaplDealers();
            var existingCodes = await GetExistingDealerCodes();

            var toCreate = baplRows
                .Where(r => !existingCodes.Contains(r.CustomerCode))
                .Select(r => new
                {
                    r.CustomerCode,
                    r.CustomerName,
                    r.City,
                    r.State,
                    r.Mobile,
                    r.ContactPerson,
                    proposedEmail = BuildDealerEmail(r),
                    hasRealEmail  = !string.IsNullOrWhiteSpace(r.ContactEmail)
                                    && r.ContactEmail.Contains('@'),
                })
                .ToList();

            return Ok(new
            {
                totalInBapl      = baplRows.Count,
                alreadyImported  = existingCodes.Count,
                toCreate         = toCreate.Count,
                dealers          = toCreate,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bulk preview failed");
            return StatusCode(500, new { message = ex.Message });
        }
    }

    // ── POST /api/dealer-auth/bulk-import — Admin only ────────────────────────
    // Creates User accounts for every active dealer in C_CustomerMaster
    // that doesn't already have a login. Default password: Dealer@123
    [HttpPost("bulk-import")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> BulkImportDealers()
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var baplRows      = await FetchBaplDealers();
            var existingCodes = await GetExistingDealerCodes();

            const string defaultPassword = "Dealer@123";
            var passwordHash = PasswordHasher.Hash(defaultPassword);

            int created = 0, skipped = 0, failed = 0;
            var errors       = new List<string>();
            var createdList  = new List<object>();

            foreach (var row in baplRows)
            {
                // Already has a login
                if (existingCodes.Contains(row.CustomerCode))
                {
                    skipped++;
                    continue;
                }

                try
                {
                    // Build email — real email preferred, mobile fallback, code fallback
                    var email = BuildDealerEmail(row);

                    // If email already used by another row, suffix with dealer code
                    var emailTaken = await _db.Users
                        .AnyAsync(u => u.Email.ToLower() == email.ToLower());
                    if (emailTaken)
                        email = $"{row.CustomerCode.Trim().ToLower()}@dealer.bgauss.local";

                    var nameParts    = (row.ContactPerson ?? row.CustomerName).Trim().Split(' ');
                    var firstName    = nameParts[0];
                    var lastName     = nameParts.Length > 1
                                      ? string.Join(' ', nameParts.Skip(1)) : "";

                    var user = new User
                    {
                        Email          = email,
                        DisplayName    = row.CustomerName,
                        FirstName      = firstName,
                        LastName       = lastName,
                        Role           = "Dealer",
                        AuthType       = "Local",
                        PasswordHash   = passwordHash,
                        DealerCode     = row.CustomerCode,
                        DealerName     = row.CustomerName,
                        PhoneNumber    = row.Mobile,
                        IsActive       = true,
                        CreatedByEmail = guard.CallerEmail,
                    };

                    _db.Users.Add(user);
                    created++;
                    createdList.Add(new
                    {
                        row.CustomerCode,
                        row.CustomerName,
                        row.City,
                        row.State,
                        email,
                    });

                    // Save in batches of 50 to avoid large transactions
                    if (created % 50 == 0)
                        await _db.SaveChangesAsync();
                }
                catch (Exception ex)
                {
                    failed++;
                    errors.Add($"{row.CustomerCode} ({row.CustomerName}): {ex.Message}");
                }
            }

            // Final save
            if (created % 50 != 0)
                await _db.SaveChangesAsync();

            _logger.LogInformation(
                "Bulk dealer import by {Admin}: created={C}, skipped={S}, failed={F}",
                guard.CallerEmail, created, skipped, failed);

            return Ok(new
            {
                message = $"Import complete: {created} created, {skipped} already existed, {failed} failed.",
                created,
                skipped,
                failed,
                defaultPassword,
                errors,
                dealers = createdList,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bulk dealer import failed");
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── GET /api/dealer-auth/bulk-status — Admin only ─────────────────────────
    // Shows how many dealers from BaplFinal have/don't have logins
    [HttpGet("bulk-status")]
    [Authorize(AuthenticationSchemes = "AzureAD")]
    public async Task<IActionResult> BulkStatus()
    {
        try
        {
            var guard = await EnsureCallerIsAdmin();
            if (guard.Error is not null) return guard.Error;

            var baplTotal     = await CountBaplDealers();
            var existingCodes = await GetExistingDealerCodes();
            var activeUsers   = await _db.Users.CountAsync(u => u.Role == "Dealer" && u.IsActive);

            return Ok(new
            {
                totalDealersInBapl  = baplTotal,
                loginsCreated       = existingCodes.Count,
                activeLogins        = activeUsers,
                pendingImport       = baplTotal - existingCodes.Count,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bulk status failed");
            return StatusCode(500, new { message = ex.Message });
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FORGOT / RESET PASSWORD (used from dealer profile dashboard)
    // ══════════════════════════════════════════════════════════════════════════

    // ── POST /api/dealer-auth/forgot-password — public ─────────────────────────
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email))
                return BadRequest(new { message = "Email is required." });

            var user = await _db.Users.FirstOrDefaultAsync(
                u => u.Email.ToLower() == dto.Email.Trim().ToLower()
                  && u.AuthType == "Local"
                  && u.Role == "Dealer");

            // Always return success to avoid leaking which emails exist
            if (user is null || !user.IsActive)
                return Ok(new { message = "If an account exists with this email, a reset link has been sent." });

            var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .Replace("+", "-").Replace("/", "_").Replace("=", "");

            user.ResetToken       = rawToken;
            user.ResetTokenExpiry = DateTime.UtcNow.AddHours(1);
            await _db.SaveChangesAsync();

            var origin    = HttpContext.Request.Headers["Origin"].FirstOrDefault()
                            ?? "https://44.210.115.237";
            var resetLink = $"{origin}/reset-password?token={rawToken}&email={Uri.EscapeDataString(user.Email)}";

            // Send via a simple email using the email service
            // We use SendRevisionEmailAsync as a generic "send to user" fallback
            // or log the link if email fails (dealer portal is internal)
            try
            {
                // Send password reset email via GraphEmailService.
                // We reuse SendRevisionEmailAsync(proposal, note, makerEmail) where
                // the 'note' field carries the reset link and body for the dealer.
                // ProposalResponseDto is constructed with the exact 38-param signature:
                // Guid,str,str,str,str, int?,str?, str,str,str?,
                // str,str?,str,str?, decimal,int,int,decimal,decimal,
                // str,DateTimeOffset,str?, str,str?,str?,DateTimeOffset?,
                // str?,int,str?, str?,DateTimeOffset?,
                // bool,str?,str?,bool,DateTimeOffset?, str?, List<ActivityResponseDto>
                if (_emailService is GraphEmailService graphSvc)
                    await graphSvc.SendRevisionEmailAsync(
                        new BGL_BT_App.Backend.DTOs.ProposalResponseDto(
                            Guid.Empty,                           //  1 Id
                            "",                                   //  2 State
                            "",                                   //  3 Location
                            "",                                   //  4 Type
                            user.DealerName ?? user.DisplayName,  //  5 DealerName
                            null,                                 //  6 VendorId      int?
                            null,                                 //  7 VendorName    string?
                            "",                                   //  8 RsmName
                            "",                                   //  9 TsmName
                            null,                                 // 10 CommandoName  string?
                            "",                                   // 11 Month
                            null,                                 // 12 Eligibility   string?
                            "",                                   // 13 Remarks       string
                            null,                                 // 14               string?
                            0m,                                   // 15 TotalBudget   decimal
                            0,                                    // 16 TotalLeadTarget
                            0,                                    // 17 TotalRetailTarget
                            0m,                                   // 18 Cac           decimal
                            0m,                                   // 19 Cpl           decimal
                            user.Email,                           // 20 SubmittedBy
                            DateTimeOffset.UtcNow,                // 21 CreatedAt
                            user.DisplayName,                     // 22 SubmittedByDisplayName string?
                            "Pending",                            // 23 Status
                            null,                                 // 24 ApproverNote  string?
                            null,                                 // 25 ApprovedBy    string?
                            null,                                 // 26 DecidedAt     DateTimeOffset?
                            null,                                 // 27 TokenNumber   string?
                            0,                                    // 28 AllowedCac    int
                            null,                                 // 29 CacWarning    string?
                            null,                                 // 30 CheckedByEmail string?
                            null,                                 // 31 CheckedAt     DateTimeOffset?
                            false,                                // 32 DealerNotified bool
                            null,                                 // 33 DealerEmail   string?
                            null,                                 // 34 DealerSendBackNote string?
                            false,                                // 35 DealerSentBack bool
                            null,                                 // 36 DealerSentBackAt DateTimeOffset?
                            null,                                 // 37 CheckerRemarks string?
                            new List<BGL_BT_App.Backend.DTOs.ActivityResponseDto>()), // 38 Activities
                        $"Hi {user.DisplayName},\n\nClick this link to reset your BGauss BTL portal password (valid 1 hour):\n{resetLink}\n\nIf you didn't request this, ignore this email.",
                        user.Email);
                else
                    _logger.LogInformation(
                        "EMAIL SERVICE NOT GRAPH — PASSWORD RESET LINK for {Email}: {Link}",
                        user.Email, resetLink);
            }
            catch (Exception mailEx)
            {
                _logger.LogWarning(mailEx, "Reset email failed — link logged for {Email}", user.Email);
                _logger.LogInformation("PASSWORD RESET LINK for {Email}: {Link}", user.Email, resetLink);
            }

            return Ok(new { message = "If an account exists with this email, a reset link has been sent." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Forgot-password failed for {Email}", dto.Email);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── POST /api/dealer-auth/reset-password — public ──────────────────────────
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Token)
                || string.IsNullOrWhiteSpace(dto.NewPassword))
                return BadRequest(new { message = "Email, token, and new password are required." });

            if (dto.NewPassword.Length < 8)
                return BadRequest(new { message = "Password must be at least 8 characters." });

            var user = await _db.Users.FirstOrDefaultAsync(
                u => u.Email.ToLower() == dto.Email.Trim().ToLower()
                  && u.ResetToken == dto.Token);

            if (user is null || user.ResetTokenExpiry is null
                || user.ResetTokenExpiry < DateTime.UtcNow)
                return BadRequest(new
                {
                    message = "This reset link is invalid or has expired. Please request a new one."
                });

            user.PasswordHash     = PasswordHasher.Hash(dto.NewPassword);
            user.ResetToken       = null;
            user.ResetTokenExpiry = null;
            await _db.SaveChangesAsync();

            return Ok(new { message = "Password reset successfully. You can now log in." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Reset-password failed for {Email}", dto.Email);
            return StatusCode(500, new { message = ex.Message, inner = ex.InnerException?.Message });
        }
    }

    // ── PATCH /api/dealer-auth/change-password — Dealer (self) ───────────────
    // Dealer can change their own password from the profile dashboard
    [HttpPatch("change-password")]
    [Authorize(AuthenticationSchemes = "DealerJwt")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordDto dto)
    {
        try
        {
            var sub = User.FindFirstValue("sub");
            if (string.IsNullOrWhiteSpace(sub) || !int.TryParse(sub, out var userId))
                return Unauthorized();

            if (string.IsNullOrWhiteSpace(dto.CurrentPassword)
                || string.IsNullOrWhiteSpace(dto.NewPassword))
                return BadRequest(new { message = "Current and new password are required." });

            if (dto.NewPassword.Length < 8)
                return BadRequest(new { message = "New password must be at least 8 characters." });

            var user = await _db.Users.FirstOrDefaultAsync(
                u => u.Id == userId && u.AuthType == "Local" && u.Role == "Dealer");

            if (user is null)
                return NotFound(new { message = "Account not found." });

            if (!PasswordHasher.Verify(dto.CurrentPassword, user.PasswordHash ?? ""))
                return BadRequest(new { message = "Current password is incorrect." });

            user.PasswordHash = PasswordHasher.Hash(dto.NewPassword);
            user.UpdatedAt    = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            return Ok(new { message = "Password changed successfully." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Change-password failed");
            return StatusCode(500, new { message = ex.Message });
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    private async Task<List<BaplDealerRaw>> FetchBaplDealers() =>
        await _bapl.Database
            .SqlQueryRaw<BaplDealerRaw>(@"
                SELECT
                    c.CustomerCode,
                    c.CustomerName,
                    ISNULL(ci.CityName, '')      AS City,
                    ISNULL(st.StateName, '')     AS State,
                    ISNULL(c.Mobile, '')         AS Mobile,
                    ISNULL(c.ContactPerson, '')  AS ContactPerson,
                    ISNULL(c.Email, '')          AS ContactEmail
                FROM [dbo].[C_CustomerMaster] c
                LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
                LEFT JOIN [dbo].[C_CityMaster]  ci ON ci.Id = c.CityId
                WHERE c.Active = 'Y'
                ORDER BY c.CustomerName")
            .ToListAsync();

    private async Task<HashSet<string>> GetExistingDealerCodes() =>
        (await _db.Users
            .Where(u => u.Role == "Dealer" && u.DealerCode != null)
            .Select(u => u.DealerCode!)
            .ToListAsync())
            .ToHashSet();

    private async Task<int> CountBaplDealers() =>
        (await _bapl.Database
            .SqlQueryRaw<CountRow>("SELECT COUNT(*) AS Value FROM [dbo].[C_CustomerMaster] WHERE Active = 'Y'")
            .ToListAsync())
            .FirstOrDefault()?.Value ?? 0;

    private static string BuildDealerEmail(BaplDealerRaw row)
    {
        if (!string.IsNullOrWhiteSpace(row.ContactEmail) && row.ContactEmail.Contains('@'))
            return row.ContactEmail.Trim().ToLower();
        if (!string.IsNullOrWhiteSpace(row.Mobile))
            return $"{row.Mobile.Trim()}@dealer.bgauss.local";
        return $"{row.CustomerCode.Trim().ToLower()}@dealer.bgauss.local";
    }

    private async Task<(IActionResult? Error, string? CallerEmail)> EnsureCallerIsAdmin()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
               ?? User.FindFirstValue("oid");
        if (string.IsNullOrEmpty(oid))
            return (Unauthorized(new { message = "Missing identity claim." }), null);

        var caller = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.AzureObjectId == oid);
        if (caller is null)
            return (Unauthorized(new { message = "Caller not found in Users table." }), null);

        if (!string.Equals(caller.Role, "Admin", StringComparison.OrdinalIgnoreCase))
            return (Forbid(), null);

        return (null, caller.Email);
    }
}

// ── Tiny helper for COUNT query ────────────────────────────────────────────────
internal class CountRow { public int Value { get; set; } }

// ── ChangePasswordDto ──────────────────────────────────────────────────────────
// Add this to Backend/DTOs/DealerDtos.cs if not already present:
// public record ChangePasswordDto(string CurrentPassword, string NewPassword);

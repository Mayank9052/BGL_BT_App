using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Security.Cryptography;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/dealer-auth")]
public class DealerAuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly JwtTokenService _jwt;
    private readonly IEmailService _emailService;
    private readonly ILogger<DealerAuthController> _logger;

    public DealerAuthController(
        AppDbContext db, JwtTokenService jwt,
        IEmailService emailService, ILogger<DealerAuthController> logger)
    {
        _db = db; _jwt = jwt; _emailService = emailService; _logger = logger;
    }

    // ── POST /api/dealer-auth/login — public, no [Authorize] ──────────────────
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

    // ── POST /api/dealer-auth/create — Admin only (Azure-authenticated) ───────
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

    // ── PATCH /api/dealer-auth/{id}/toggle — Admin only ────────────────────────
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
                  && u.AuthType == "Local" && u.Role == "Dealer");

            // Always return success to avoid leaking which emails exist
            if (user is null || !user.IsActive)
                return Ok(new { message = "If an account exists with this email, a reset link has been sent." });

            var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .Replace("+", "-").Replace("/", "_").Replace("=", "");

            user.ResetToken       = rawToken;
            user.ResetTokenExpiry = DateTime.UtcNow.AddHours(1);
            await _db.SaveChangesAsync();

            var resetLink = $"{(HttpContext.Request.Headers["Origin"].FirstOrDefault() ?? "https://44.210.115.237")}/reset-password?token={rawToken}&email={Uri.EscapeDataString(user.Email)}";

            var body = $"""
                <p>Hi {user.DisplayName},</p>
                <p>We received a request to reset your BGauss BTL dealer portal password.</p>
                <p><a href="{resetLink}">Click here to reset your password</a> (valid for 1 hour).</p>
                <p>If you didn't request this, you can ignore this email.</p>
                """;

            // Reuses the existing Graph email service — sent from the admin's mailbox
            // context isn't available here since this is a public endpoint, so this
            // falls back gracefully if no graph token is available.
            try
            {
                await _emailService.SendDecisionMailAsync(
                    new BGL_BT_App.Backend.Models.Proposal
                    {
                        SubmittedBy = user.Email,
                        DealerName = user.DealerName ?? user.DisplayName,
                        TokenNumber = "PASSWORD-RESET",
                    },
                    new BGL_BT_App.Backend.Models.ApprovalDecision { Status = "Approved", ApprovedBy = "System" },
                    ""
                );
            }
            catch (Exception mailEx)
            {
                _logger.LogWarning(mailEx, "Could not send reset email to {Email} — link logged instead.", user.Email);
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

    // ── POST /api/dealer-auth/{id}/admin-reset-password — Admin only ───────────
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

    // ── POST /api/dealer-auth/reset-password — public ──────────────────────────
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordDto dto)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Token) || string.IsNullOrWhiteSpace(dto.NewPassword))
                return BadRequest(new { message = "Email, token, and new password are required." });

            if (dto.NewPassword.Length < 8)
                return BadRequest(new { message = "Password must be at least 8 characters." });

            var user = await _db.Users.FirstOrDefaultAsync(
                u => u.Email.ToLower() == dto.Email.Trim().ToLower()
                  && u.ResetToken == dto.Token);

            if (user is null || user.ResetTokenExpiry is null || user.ResetTokenExpiry < DateTime.UtcNow)
                return BadRequest(new { message = "This reset link is invalid or has expired. Please request a new one." });

            user.PasswordHash    = PasswordHasher.Hash(dto.NewPassword);
            user.ResetToken      = null;
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

    // ── Helper ──────────────────────────────────────────────────────────────────
    private async Task<(IActionResult? Error, string? CallerEmail)> EnsureCallerIsAdmin()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
               ?? User.FindFirstValue("oid");
        if (string.IsNullOrEmpty(oid)) return (Unauthorized(new { message = "Missing identity claim." }), null);

        var caller = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.AzureObjectId == oid);
        if (caller is null) return (Unauthorized(new { message = "Caller not found in Users table." }), null);

        if (!string.Equals(caller.Role, "Admin", StringComparison.OrdinalIgnoreCase))
            return (Forbid(), null);

        return (null, caller.Email);
    }
}
using System.Security.Claims;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/auth")]
[Authorize]
public class AuthController : ControllerBase
{
    private readonly IUserService _userService;

    public AuthController(IUserService userService) => _userService = userService;

    // POST /api/auth/login-sync
    // Called by the frontend right after MSAL login completes.
    // Reads the Azure AD claims out of the validated JWT and
    // upserts a row into the Users table.
    [HttpPost("login-sync")]
    public async Task<IActionResult> LoginSync()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
            ?? User.FindFirstValue("oid");

        var email       = User.FindFirstValue("preferred_username")
                    ?? User.FindFirstValue(ClaimTypes.Email)
                    ?? User.FindFirstValue(ClaimTypes.Upn) ?? "";
        var displayName = User.FindFirstValue("name") ?? email;
        var given       = User.FindFirstValue(ClaimTypes.GivenName) ?? User.FindFirstValue("given_name");
        var family      = User.FindFirstValue(ClaimTypes.Surname)   ?? User.FindFirstValue("family_name");
        var jobTitle    = User.FindFirstValue("jobTitle");
        var dept        = User.FindFirstValue("department");

        if (string.IsNullOrEmpty(oid))
            return Unauthorized(new { message = "Invalid token: missing OID claim." });

        // Capture IP + UA for session log
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString()
            ?? Request.Headers["X-Forwarded-For"].FirstOrDefault();
        var ua = Request.Headers["User-Agent"].ToString();

        var profile = await _userService.UpsertFromAzureAsync(
            new LoginSyncRequest(oid, email, displayName, given, family, jobTitle, dept),
            ip, ua
        );

        return Ok(profile);
    }
}
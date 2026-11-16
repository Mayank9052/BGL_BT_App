using System.Security.Claims;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly AzureDirectorySyncService _dirSync;

    public UsersController(IUserService userService, AzureDirectorySyncService dirSync)
    {
        _userService = userService;
        _dirSync = dirSync;
    }

    // GET /api/users — list everyone (frontend restricts the page to Admins,
    // but the API itself just needs a valid signed-in user).
    [HttpGet]
    public async Task<IActionResult> GetAll()
        => Ok(await _userService.GetAllUsersAsync());

    // GET /api/users/{id}
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var user = await _userService.GetUserByIdAsync(id);
        return user is null ? NotFound() : Ok(user);
    }

    // PATCH /api/users/{id} — Admin only. Edit details, role, and active status.
    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Update(int id, UpdateUserDto dto)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        try
        {
            var updated = await _userService.UpdateUserAsync(id, dto, guard.CallerEmail!);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    // POST /api/users/sync-directory?dryRun=true — Admin only.
    // Adds Azure AD users that have never logged in (role "User"). Existing users' roles / active flags
    // are never changed. dryRun=true only reports what would be added.
    [HttpPost("sync-directory")]
    public async Task<IActionResult> SyncDirectory([FromQuery] bool dryRun = true)
    {
        var guard = await EnsureCallerIsAdmin();
        if (guard.Error is not null) return guard.Error;

        try
        {
            return Ok(await _dirSync.SyncAsync(dryRun));
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
    }

    // Confirms the calling user is an Admin in our own Users table —
    // the Azure AD token alone doesn't carry our app-specific role.
    private async Task<(IActionResult? Error, string? CallerEmail)> EnsureCallerIsAdmin()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
               ?? User.FindFirstValue("oid");

        if (string.IsNullOrEmpty(oid)) return (Unauthorized(), null);

        var caller = await _userService.GetByAzureIdAsync(oid);
        if (caller is null) return (Unauthorized(), null);

        if (!string.Equals(caller.Role, "Admin", StringComparison.OrdinalIgnoreCase))
            return (Forbid(), null);

        return (null, caller.Email);
    }
}
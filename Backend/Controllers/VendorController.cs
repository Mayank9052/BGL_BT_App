using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/vendors")]
[Authorize]
public class VendorController : ControllerBase
{
    private readonly AppDbContext _db;
    public VendorController(AppDbContext db) => _db = db;

    // GET /api/vendors — all active vendors
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var list = await _db.VendorMasters
            .Where(v => v.IsActive)
            .OrderBy(v => v.VendorName)
            .Select(v => new { v.Id, v.VendorName, v.IsActive })
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/vendors/all — admin view
    [HttpGet("all")]
    public async Task<IActionResult> GetAllAdmin()
    {
        var list = await _db.VendorMasters
            .OrderBy(v => v.VendorName)
            .Select(v => new { v.Id, v.VendorName, v.IsActive, v.CreatedAt })
            .ToListAsync();
        return Ok(list);
    }

    // POST /api/vendors — admin only
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] VendorMasterDto dto)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        if (string.IsNullOrWhiteSpace(dto.VendorName))
            return BadRequest(new { message = "Vendor name is required." });

        var exists = await _db.VendorMasters
            .AnyAsync(v => v.VendorName.ToLower() == dto.VendorName.Trim().ToLower());
        if (exists)
            return Conflict(new { message = "Vendor already exists." });

        var vendor = new VendorMaster { VendorName = dto.VendorName.Trim(), IsActive = true };
        _db.VendorMasters.Add(vendor);
        await _db.SaveChangesAsync();
        return Ok(new { vendor.Id, vendor.VendorName, vendor.IsActive });
    }

    // PATCH /api/vendors/{id}
    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] VendorMasterDto dto)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        var vendor = await _db.VendorMasters.FindAsync(id);
        if (vendor is null) return NotFound();

        if (!string.IsNullOrWhiteSpace(dto.VendorName))
            vendor.VendorName = dto.VendorName.Trim();
        if (dto.IsActive.HasValue)
            vendor.IsActive = dto.IsActive.Value;

        await _db.SaveChangesAsync();
        return Ok(new { vendor.Id, vendor.VendorName, vendor.IsActive });
    }

    // DELETE /api/vendors/{id} — soft delete
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var guard = await EnsureAdmin();
        if (guard != null) return guard;

        var vendor = await _db.VendorMasters.FindAsync(id);
        if (vendor is null) return NotFound();

        vendor.IsActive = false;
        await _db.SaveChangesAsync();
        return Ok(new { message = "Deactivated." });
    }

    private async Task<IActionResult?> EnsureAdmin()
    {
        var oid = User.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
               ?? User.FindFirstValue("oid");
        if (string.IsNullOrEmpty(oid)) return Unauthorized();
        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.AzureObjectId == oid);
        if (user is null) return Unauthorized();
        if (!string.Equals(user.Role, "Admin", StringComparison.OrdinalIgnoreCase)) return Forbid();
        return null;
    }
}
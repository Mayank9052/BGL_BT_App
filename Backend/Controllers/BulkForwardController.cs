// Controllers/BulkForwardController.cs
// POST /api/proposals/bulk-forward
// Marks proposals as forwarded. Stores Graph token for the DailyDigestService.
// Does NOT send individual emails — one digest goes at the scheduled time.

using System.Security.Claims;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BTL_API.Controllers;

[ApiController]
[Route("api/proposals")]
[Authorize]
public class BulkForwardController : ControllerBase
{
    private readonly AppDbContext    _db;
    private readonly IConfiguration  _cfg;
    private readonly GraphTokenStore _tokenStore;

    public BulkForwardController(AppDbContext db, IConfiguration cfg, GraphTokenStore tokenStore)
    {
        _db         = db;
        _cfg        = cfg;
        _tokenStore = tokenStore;
    }

    public record BulkForwardRequest(List<string> ProposalIds);
    public record BulkForwardResult(int Forwarded, int Failed, string Message);

    [HttpPost("bulk-forward")]
    public async Task<IActionResult> BulkForward([FromBody] BulkForwardRequest req)
    {
        if (req?.ProposalIds == null || req.ProposalIds.Count == 0)
            return BadRequest("No proposal IDs provided.");

        // Caller email from MSAL token — try all common claim types
        var callerEmail = User.FindFirst("preferred_username")?.Value
                       ?? User.FindFirst(ClaimTypes.Email)?.Value
                       ?? User.FindFirst(ClaimTypes.Upn)?.Value
                       ?? User.FindFirst("upn")?.Value
                       ?? User.FindFirst("unique_name")?.Value
                       ?? "";

        if (string.IsNullOrEmpty(callerEmail))
            return Unauthorized("Could not determine caller email from token.");

        // Store Graph token for DailyDigestService to use when sending email
        var graphToken = Request.Headers["X-Graph-Token"].FirstOrDefault();
        if (!string.IsNullOrEmpty(graphToken))
            _tokenStore.Store(graphToken, callerEmail);

        int forwarded = 0, failed = 0;
        var now = DateTimeOffset.UtcNow;

        foreach (var idStr in req.ProposalIds)
        {
            if (!Guid.TryParse(idStr, out var guid)) { failed++; continue; }

            try
            {
                var proposal = await _db.Proposals.FindAsync(guid);
                if (proposal == null) { failed++; continue; }

                if (proposal.Status != "Pending" || proposal.CheckedByEmail != null)
                { failed++; continue; }

                proposal.CheckedByEmail = callerEmail;
                proposal.CheckedAt      = now;
                proposal.DigestSent     = false; // queued for scheduled digest
                forwarded++;
            }
            catch { failed++; }
        }

        if (forwarded > 0)
            await _db.SaveChangesAsync();

        var msg = $"{forwarded} proposal{(forwarded != 1 ? "s" : "")} queued for digest." +
                  (failed > 0 ? $" {failed} skipped (not pending or already forwarded)." : "");

        return Ok(new BulkForwardResult(forwarded, failed, msg));
    }
}
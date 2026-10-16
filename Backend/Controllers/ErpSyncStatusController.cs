// Backend/Controllers/ErpSyncStatusController.cs
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/erp-sync")]
[Authorize(AuthenticationSchemes = "AzureAD")]
public class ErpSyncStatusController : ControllerBase
{
    // ── GET /api/erp-sync/status — any signed-in staff member can check when
    // the automatic hourly ERP sync last ran, so the Admin screens no longer
    // need to rely on manual Preview/Import to know data is current. ────────
    [HttpGet("status")]
    public IActionResult GetStatus()
    {
        return Ok(new
        {
            lastRunUtc         = ErpSyncState.LastRunUtc,
            lastSuccessUtc     = ErpSyncState.LastSuccessUtc,
            lastError          = ErpSyncState.LastError,
            lastDealersCreated = ErpSyncState.LastDealersCreated,
            lastDealersUpdated = ErpSyncState.LastDealersUpdated,
            lastStaffCreated   = ErpSyncState.LastStaffCreated,
            lastStaffUpdated   = ErpSyncState.LastStaffUpdated,
        });
    }
}
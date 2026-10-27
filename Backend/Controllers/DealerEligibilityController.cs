using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using BGL_BT_App.Backend.DTOs;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/dealer-eligibility")]
[Authorize]
public class DealerEligibilityController : ControllerBase
{
    private readonly BaplDbContext                        _bapl;
    private readonly DealerTypeService                    _dealerType;   // shared RRERP Old/New rule
    private readonly ILogger<DealerEligibilityController> _logger;

    public DealerEligibilityController(
        BaplDbContext bapl,
        DealerTypeService dealerType,
        ILogger<DealerEligibilityController> logger)
    {
        _bapl       = bapl;
        _dealerType = dealerType;
        _logger     = logger;
    }

    // GET /api/dealer-eligibility?dealerCode=CUS0011
    [HttpGet]
    public async Task<ActionResult<DealerEligibilityDto>> Check([FromQuery] string dealerCode)
    {
        if (string.IsNullOrWhiteSpace(dealerCode))
            return BadRequest(new { message = "dealerCode is required." });
        try
        {
            return Ok(await ComputeAsync(dealerCode.Trim()));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Eligibility check failed for {Code}", dealerCode);
            // Permissive fallback — ERP unavailable, don't block RSM
            return Ok(new DealerEligibilityDto(
                dealerCode, true, false, 0,
                "Could not verify eligibility — ERP unavailable.",
                4000, "Old"));
        }
    }

    // ── Core eligibility logic ────────────────────────────────────────────
    private async Task<DealerEligibilityDto> ComputeAsync(string dealerCode)
    {
        var months = _dealerType.WindowMonths;   // default 3 (appsettings "DealerType:NewWindowMonths")
        var cutoff = _dealerType.Cutoff;

        // Old / New — shared RRERP rule: onboarding OR first sale within the window
        var type  = await _dealerType.ClassifyOneAsync(dealerCode);
        var isNew = type?.IsNew ?? false;

        // Retails over the same window
        var rows = await _bapl.Database
            .SqlQueryRaw<MonthlyCount>(@"
                SELECT
                    YEAR(TRY_CONVERT(DATE, salebill_date, 105))  AS [Year],
                    MONTH(TRY_CONVERT(DATE, salebill_date, 105)) AS [Month],
                    COUNT(*) AS RetailCount
                FROM DMS_SaleBill
                WHERE dealer_code = {0}
                  AND IsDelete    = 0
                  AND TRY_CONVERT(DATE, salebill_date, 105) IS NOT NULL
                  AND TRY_CONVERT(DATE, salebill_date, 105) >= {1}
                GROUP BY
                    YEAR(TRY_CONVERT(DATE, salebill_date, 105)),
                    MONTH(TRY_CONVERT(DATE, salebill_date, 105))",
                dealerCode, cutoff)
            .ToListAsync();

        // Average always divided by the window (missing months = 0)
        double avg              = (double)rows.Sum(r => r.RetailCount) / months;
        bool   eligibleByRetail = avg >= 8;
        bool   isEligible       = isNew || eligibleByRetail;
        int    baseCac          = isNew ? 6000 : 4000;

        string reason = isNew
            ? $"New dealer — {type?.Reason}"
            : eligibleByRetail
                ? $"Avg {avg:N1} retails/month over last {months} months (≥8 required) · {type?.Reason}"
                : $"Not eligible — avg {avg:N1} retails/month (minimum 8 required) · {type?.Reason}";

        return new DealerEligibilityDto(
            dealerCode, isEligible, isNew,
            Math.Round(avg, 1), reason, baseCac,
            isNew ? "New" : "Old");
    }
}

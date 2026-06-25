using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
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
    private readonly ILogger<DealerEligibilityController> _logger;

    public DealerEligibilityController(
        BaplDbContext bapl,
        ILogger<DealerEligibilityController> logger)
    {
        _bapl   = bapl;
        _logger = logger;
    }

    // GET /api/dealer-eligibility?dealerCode=CUS0011
    [HttpGet]
    public async Task<ActionResult<DealerEligibilityDto>> Check(
        [FromQuery] string dealerCode)
    {
        if (string.IsNullOrWhiteSpace(dealerCode))
            return BadRequest(new { message = "dealerCode is required." });
        try
        {
            return Ok(await ComputeAsync(dealerCode));
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
        var cutoff = DateTime.UtcNow.AddMonths(-3).Date;

        // Step 1 — get dealer master
        var dealer = await _bapl.DealerMasters
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.CustomerCode == dealerCode);

        // Step 2 — new dealer check (inaugurated within last 3 months)
        bool isNew = dealer?.OnboardedDate.HasValue == true &&
                     dealer.OnboardedDate!.Value.Date >= cutoff;

        // Step 3 — count retails using raw SQL
        // salebill_date is nvarchar "dd-MM-yyyy" so use TRY_CONVERT(DATE, ..., 105)
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

        // Step 4 — average always divided by 3 (missing months = 0)
        double avg            = (double)rows.Sum(r => r.RetailCount) / 3.0;
        bool   eligibleByRetail = avg >= 8;
        bool   isEligible       = isNew || eligibleByRetail;
        int    baseCac          = isNew ? 6000 : 4000;

        string reason = isNew
            ? "New dealer — onboarded within last 3 months"
            : eligibleByRetail
                ? $"Avg {avg:N1} retails/month over last 3 months (≥8 required)"
                : $"Not eligible — avg {avg:N1} retails/month (minimum 8 required)";

        return new DealerEligibilityDto(
            dealerCode, isEligible, isNew,
            Math.Round(avg, 1), reason, baseCac,
            isNew ? "New" : "Old");
    }
}
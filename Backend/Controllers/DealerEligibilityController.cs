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
    private readonly BaplDbContext _bapl;
    private readonly ILogger<DealerEligibilityController> _logger;

    public DealerEligibilityController(
        BaplDbContext bapl,
        ILogger<DealerEligibilityController> logger)
    {
        _bapl   = bapl;
        _logger = logger;
    }

    // ── GET /api/dealer-eligibility?dealerCode=XXX ────────────────────────
    [HttpGet]
    public async Task<ActionResult<DealerEligibilityDto>> Check(
        [FromQuery] string dealerCode)
    {
        if (string.IsNullOrWhiteSpace(dealerCode))
            return BadRequest(new { message = "dealerCode is required." });

        try
        {
            return Ok(await ComputeEligibility(dealerCode));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Eligibility check failed for {Code}", dealerCode);
            // Don't block the user — return a permissive default
            return Ok(new DealerEligibilityDto(
                DealerCode:         dealerCode,
                IsEligible:         true,
                IsNewDealer:        false,
                AvgMonthlyRetails:  0,
                EligibilityReason:  "Could not verify eligibility — ERP unavailable.",
                BaseCacPerVehicle:  4000,
                DealerType:         "Old"
            ));
        }
    }

    // ── GET /api/dealer-eligibility/all — admin view ──────────────────────
    [HttpGet("all")]
    public async Task<ActionResult<IEnumerable<DealerEligibilityDto>>> GetAll()
    {
        try
        {
            var dealers = await _bapl.DealerMasters
                .AsNoTracking()
                .Select(d => d.CustomerCode)
                .ToListAsync();

            var result = new List<DealerEligibilityDto>();

            foreach (var code in dealers)
            {
                var elig = await ComputeEligibility(code);
                if (elig.IsEligible) result.Add(elig);
            }

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetAll eligibility failed");
            return StatusCode(500, new { message = "Could not load eligibility data." });
        }
    }

    // ── Core eligibility logic ────────────────────────────────────────────
    private async Task<DealerEligibilityDto> ComputeEligibility(string dealerCode)
    {
        var cutoff = DateTime.UtcNow.AddMonths(-3).Date;
        var today  = DateTime.UtcNow.Date;

        // ── 1. Is new dealer? (onboarded in last 3 months) ─────────────────
        var dealer = await _bapl.DealerMasters
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.CustomerCode == dealerCode);

        bool isNew = dealer?.OnboardedDate.HasValue == true &&
                     dealer.OnboardedDate!.Value.Date >= cutoff;

        // ── 2. Average monthly retails in last 3 months ────────────────────
        var monthlyGroups = await _bapl.RetailBillings
            .AsNoTracking()
            .Where(r => r.DealerCode == dealerCode &&
                        r.BillingDate >= cutoff &&
                        r.BillingDate <= today)
            .GroupBy(r => new { r.BillingDate.Year, r.BillingDate.Month })
            .Select(g => g.Count())
            .ToListAsync();

        // Fill missing months with 0 so we always average over 3 months
        double avgRetails = monthlyGroups.Count > 0
            ? (double)monthlyGroups.Sum() / 3.0   // divide by 3 months always
            : 0;

        bool eligibleByRetails = avgRetails >= 8;
        bool isEligible        = isNew || eligibleByRetails;

        // ── 3. CAC matrix ──────────────────────────────────────────────────
        int baseCac = isNew ? 6000 : 4000;

        string reason = isNew
            ? "New dealer — onboarded within last 3 months"
            : eligibleByRetails
                ? $"Avg {avgRetails:N1} retails/month over last 3 months (≥8 required)"
                : $"Not eligible — avg {avgRetails:N1} retails/month (minimum 8 required)";

        return new DealerEligibilityDto(
            DealerCode:        dealerCode,
            IsEligible:        isEligible,
            IsNewDealer:       isNew,
            AvgMonthlyRetails: Math.Round(avgRetails, 1),
            EligibilityReason: reason,
            BaseCacPerVehicle: baseCac,
            DealerType:        isNew ? "New" : "Old"
        );
    }
}
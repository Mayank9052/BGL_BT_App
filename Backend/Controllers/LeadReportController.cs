// Backend/Controllers/LeadReportController.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/lead-report")]
public class LeadReportController : ControllerBase
{
    private readonly AppDbContext _db;
    public LeadReportController(AppDbContext db) { _db = db; }

    private static readonly string[] Channels = { "Walkin", "BTL", "Referral", "ATL", "Digital" };

    // GET /api/lead-report?month=8&year=2026
    // Defaults to the current month/year if not supplied.
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] int? month, [FromQuery] int? year)
    {
        var now = DateTime.UtcNow;
        int m = month ?? now.Month;
        int y = year  ?? now.Year;

        var monthStart = new DateTime(y, m, 1);
        var monthEnd   = monthStart.AddMonths(1).AddTicks(-1);
        var daysInMonth = DateTime.DaysInMonth(y, m);
        // "Today" for MTD purposes — if reporting a past month, MTD = whole month
        var mtdEnd = (y == now.Year && m == now.Month) ? now : monthEnd;
        var daysElapsed = (y == now.Year && m == now.Month) ? now.Day : daysInMonth;
        double monthFrac = (double)daysElapsed / daysInMonth;

        // ── 1. Load the channel mapping once (Source/SubSource → Channel) ──
        var mappings = await _db.LeadChannelMappings.AsNoTracking().ToListAsync();

        // ── 2. Load this month's raw leads once, then bucket in memory ──
        // (bucketing in SQL would need a big CASE/JOIN; in-memory is simpler
        // and the mapping table is small, so this scales fine)
        var leadsThisMonth = await _db.LmsLeadRecords.AsNoTracking()
            .Where(l => l.LeadDate >= monthStart && l.LeadDate <= monthEnd)
            .Select(l => new { l.State, l.Source, l.SubSource, l.LeadDate })
            .ToListAsync();

        string? Bucket(string? source, string? subSource)
        {
            // Prefer an exact Source+SubSource match, fall back to Source-only (SubSource = null)
            var exact = mappings.FirstOrDefault(mp => mp.Source == source && mp.SubSource == subSource);
            if (exact != null) return exact.Channel;
            var sourceOnly = mappings.FirstOrDefault(mp => mp.Source == source && mp.SubSource == null);
            return sourceOnly?.Channel;
        }

        // ── 3. Group into State → Channel → counts (Month-total, MTD-total) ──
        var grouped = new Dictionary<string, Dictionary<string, (int monthCount, int mtdCount)>>();
        foreach (var lead in leadsThisMonth)
        {
            var state = lead.State ?? "Unknown";
            var channel = Bucket(lead.Source, lead.SubSource);
            if (channel == null) continue; // unmapped Source/SubSource — see LeadChannelMappings to fix

            if (!grouped.TryGetValue(state, out var byChannel))
                grouped[state] = byChannel = Channels.ToDictionary(c => c, _ => (0, 0));

            var (monthCount, mtdCount) = byChannel[channel];
            monthCount++;
            if (lead.LeadDate <= mtdEnd) mtdCount++;
            byChannel[channel] = (monthCount, mtdCount);
        }

        // ── 4. Load targets for this month/year ──
        var targets = await _db.LeadTargets.AsNoTracking()
            .Where(t => t.Month == m && t.Year == y).ToListAsync();

        var allStates = grouped.Keys.Union(targets.Select(t => t.State)).Distinct().OrderBy(s => s);

        var rows = new List<LeadReportRowDto>();
        foreach (var state in allStates)
        {
            grouped.TryGetValue(state, out var byChannel);
            byChannel ??= Channels.ToDictionary(c => c, _ => (0, 0));

            int TargetFor(string ch) => targets.FirstOrDefault(t => t.State == state && t.Channel == ch)?.TargetValue ?? 0;
            int MtdTargetFor(string ch) => (int)Math.Round(TargetFor(ch) * monthFrac);

            var walkinTarget = TargetFor("Walkin");
            var btlTarget    = TargetFor("BTL");
            var referralTarget = TargetFor("Referral");
            var atlTarget    = TargetFor("ATL");
            var digitalTarget = TargetFor("Digital");

            var walkinMtdA   = byChannel["Walkin"].mtdCount;
            var btlMtdA      = byChannel["BTL"].mtdCount;
            var referralMtdA = byChannel["Referral"].mtdCount;
            var atlMtdA      = byChannel["ATL"].mtdCount;
            var digitalMtdA  = byChannel["Digital"].mtdCount;

            var leadsMonthTarget = walkinTarget + btlTarget + referralTarget + atlTarget + digitalTarget;
            var leadsMtdTarget = MtdTargetFor("Walkin") + MtdTargetFor("BTL") + MtdTargetFor("Referral")
                                + MtdTargetFor("ATL") + MtdTargetFor("Digital");
            var totalReceived = walkinMtdA + btlMtdA + referralMtdA + atlMtdA + digitalMtdA;

            // Same sign convention established for this project:
            // Variance = Received − Target (negative = shortfall, positive = over-target)
            var variance = totalReceived - leadsMonthTarget;
            var achPct    = leadsMonthTarget > 0 ? Math.Round((double)totalReceived / leadsMonthTarget * 100, 1) : 0;
            var achPctMtd = leadsMtdTarget   > 0 ? Math.Round((double)totalReceived / leadsMtdTarget   * 100, 1) : 0;

            rows.Add(new LeadReportRowDto
            {
                State = state,
                LeadsMonthTarget = leadsMonthTarget,
                LeadsMtdTarget = leadsMtdTarget,
                WalkinTarget = walkinTarget, WalkinMtdTarget = MtdTargetFor("Walkin"), WalkinMtdAch = walkinMtdA,
                BtlTarget = btlTarget, BtlMtdTarget = MtdTargetFor("BTL"), BtlMtdAch = btlMtdA,
                ReferralTarget = referralTarget, ReferralMtdTarget = MtdTargetFor("Referral"), ReferralMtdAch = referralMtdA,
                AtlTarget = atlTarget, AtlMtdTarget = MtdTargetFor("ATL"), AtlMtdAch = atlMtdA,
                DigitalTarget = digitalTarget, DigitalMtdTarget = MtdTargetFor("Digital"), DigitalMtdAch = digitalMtdA,
                TotalLeadsReceived = totalReceived,
                LeadsVariance = variance,
                LeadsAchievementPct = achPct,
                LeadsAchievementPctMtd = achPctMtd,
                // Retail-side columns are intentionally 0 here — they come from
                // the BTL app's own daily-activity data (retailActual / manual
                // retail targets), not from LMS. Join them in on the frontend
                // (as AnalyticsDashboard.tsx already does) or extend this
                // endpoint once you decide where that data should be combined.
                RetailTargets = 0, MtdRetailTargets = 0, MtdRetailAchieved = 0,
                MtdRetailAchievementPct = 0, RetailsEnquiriesPct = 0,
            });
        }

        return Ok(new { month = m, year = y, generatedAt = DateTime.UtcNow, rows });
    }

    // Diagnostic endpoint — shows any Source/SubSource combos with NO mapping,
    // so you can see exactly what still needs to be added to LeadChannelMappings.
    [HttpGet("unmapped")]
    public async Task<IActionResult> Unmapped()
    {
        var mappings = await _db.LeadChannelMappings.AsNoTracking().ToListAsync();
        var combos = await _db.LmsLeadRecords.AsNoTracking()
            .Select(l => new { l.Source, l.SubSource })
            .Distinct()
            .ToListAsync();

        var unmapped = combos.Where(c =>
            !mappings.Any(mp => mp.Source == c.Source && mp.SubSource == c.SubSource) &&
            !mappings.Any(mp => mp.Source == c.Source && mp.SubSource == null)
        ).ToList();

        return Ok(unmapped);
    }
}
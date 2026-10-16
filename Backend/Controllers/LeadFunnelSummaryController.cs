// Backend/Controllers/LeadFunnelSummaryController.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using BGL_BT_App.Backend.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

/// <summary>
/// Reproduces the "L2R / Autobiz Group Dashboard" table (Total Leads / Not
/// Called / Follow-Up / Closed / Qualified→Hot,Warm,Normal,NotSet / Booked /
/// Lost) directly from our own ingested lead data — no dependency on that
/// third-party dashboard staying available or unchanged.
///
/// Supports two grouping modes via ?groupBy=:
///   groupBy=rsm    (default) — one row per RSM, matches the original screenshot
///   groupBy=dealer            — one row per Dealer, with City/State shown
///
/// Bucket rules (confirmed against real Lead Data sample):
///   Not Called = Stage == "Not called"
///   Follow-Up  = Stage == "Follow-up"
///   Closed     = Stage == "Closed"
///   Qualified  = Stage == "Qualified", split by SubStage:
///       Active  → further split by Eagerness (Hot/Warm/Normal/Not Set)
///       Booked  → SubStage == "Booked"
///       Lost    → SubStage == "Lost"
/// </summary>
[ApiController]
[Route("api/lead-funnel-summary")]
public class LeadFunnelSummaryController : ControllerBase
{
    private readonly AppDbContext _db;
    public LeadFunnelSummaryController(AppDbContext db) { _db = db; }

    // GET /api/lead-funnel-summary?state=Maharashtra&groupBy=dealer&fromDate=2026-08-01&toDate=2026-08-24
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] DateTime? fromDate,
        [FromQuery] DateTime? toDate,
        [FromQuery] string? state,
        [FromQuery] string? dealerCode,
        [FromQuery] string groupBy = "rsm")
    {
        groupBy = (groupBy ?? "rsm").Trim().ToLowerInvariant();
        if (groupBy != "rsm" && groupBy != "dealer")
            return BadRequest(new { error = "groupBy must be 'rsm' or 'dealer'." });

        var from = fromDate ?? DateTime.UtcNow.AddDays(-30);
        var to   = toDate   ?? DateTime.UtcNow;

        var q = _db.LmsLeadRecords.AsNoTracking()
            .Where(l => l.LeadDate >= from && l.LeadDate <= to);
        if (!string.IsNullOrWhiteSpace(state))
            q = q.Where(l => l.State == state);
        if (!string.IsNullOrWhiteSpace(dealerCode))
            q = q.Where(l => l.DealerCode == dealerCode);

        var leads = await q.Select(l => new
        {
            l.RSM, l.DealerCode, l.OrganizationName, l.City, l.State,
            l.Stage, l.SubStage, l.Eagerness,
        }).ToListAsync();

        Dictionary<string, object?> BuildRow(
            string key, string? dCode, string? dName, string? city, string? st,
            IEnumerable<dynamic> g)
        {
            var list = g.ToList();
            var totalLeads = list.Count;
            var notCalled  = list.Count(l => l.Stage == "Not called");
            var followUp   = list.Count(l => l.Stage == "Follow-up");
            var closed     = list.Count(l => l.Stage == "Closed");

            var qualified  = list.Where(l => l.Stage == "Qualified").ToList();
            var active     = qualified.Where(l => l.SubStage == "Active").ToList();
            var booked     = qualified.Count(l => l.SubStage == "Booked");
            var lost       = qualified.Count(l => l.SubStage == "Lost");

            var hot        = active.Count(l => l.Eagerness == "Hot");
            var warm       = active.Count(l => l.Eagerness == "Warm");
            var normal     = active.Count(l => l.Eagerness == "Normal");
            var notSet     = active.Count(l => l.Eagerness == "Not Set");
            var activeTotal = active.Count;
            var qualifiedTotal = activeTotal + booked + lost;

            var row = new Dictionary<string, object?>
            {
                ["name"] = key,
                ["totalLeads"] = totalLeads,
                ["notCalled"] = notCalled,
                ["followUp"] = followUp,
                ["closed"] = closed,
                ["qualified"] = new Dictionary<string, object?>
                {
                    ["total"] = qualifiedTotal,
                    ["hot"] = hot, ["warm"] = warm, ["normal"] = normal, ["notSet"] = notSet,
                    ["activeTotal"] = activeTotal,
                },
                ["booked"] = booked,
                ["lost"] = lost,
            };

            // Dealer-wise view additionally shows dealer identity + location
            if (dCode != null)
            {
                row["dealerCode"] = dCode;
                row["dealerName"] = dName;
                row["city"] = city;
                row["state"] = st;
            }
            return row;
        }

        List<Dictionary<string, object?>> rows;
        if (groupBy == "dealer")
        {
            rows = leads
                .GroupBy(l => l.DealerCode ?? "Unassigned")
                .Select(g =>
                {
                    var first = g.First();
                    return BuildRow(first.OrganizationName ?? g.Key, g.Key, first.OrganizationName, first.City, first.State, g);
                })
                .OrderByDescending(r => (int)(r["totalLeads"] ?? 0))
                .ToList();
        }
        else
        {
            rows = leads
                .GroupBy(l => l.RSM ?? "Unassigned")
                .Select(g => BuildRow(g.Key, null, null, null, null, g))
                .OrderByDescending(r => (int)(r["totalLeads"] ?? 0))
                .ToList();
        }

        // Grand total row, summed across every group
        int SumField(string field) => rows.Sum(r => (int)(r[field] ?? 0));
        int SumQualified(string field) => rows.Sum(r => (int)(((Dictionary<string, object?>)r["qualified"]!)[field] ?? 0));

        var total = new Dictionary<string, object?>
        {
            ["name"] = "Total",
            ["totalLeads"] = SumField("totalLeads"),
            ["notCalled"]  = SumField("notCalled"),
            ["followUp"]   = SumField("followUp"),
            ["closed"]     = SumField("closed"),
            ["qualified"] = new Dictionary<string, object?>
            {
                ["total"] = SumQualified("total"),
                ["hot"] = SumQualified("hot"),
                ["warm"] = SumQualified("warm"),
                ["normal"] = SumQualified("normal"),
                ["notSet"] = SumQualified("notSet"),
                ["activeTotal"] = SumQualified("activeTotal"),
            },
            ["booked"] = SumField("booked"),
            ["lost"]   = SumField("lost"),
        };

        return Ok(new { fromDate = from, toDate = to, groupBy, rows, total });
    }
}

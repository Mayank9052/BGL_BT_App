using BGL_BT_App.Backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OfficeOpenXml;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using System.Security.Claims;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/reports")]
[Authorize(AuthenticationSchemes = "AzureAD")]
public class ReportsController : ControllerBase
{
    private readonly AppDbContext _db;
    private const string AuthorizedEmail = "oat@bgauss.com";

    public ReportsController(AppDbContext db)
    {
        _db = db;
        ExcelPackage.License.SetNonCommercialPersonal("BGauss BTL App");
    }

    private bool IsAuthorized()
    {
        var email = User.FindFirstValue("preferred_username")
                ?? User.FindFirstValue(ClaimTypes.Email)
                ?? User.FindFirstValue("email")
                ?? User.FindFirstValue(ClaimTypes.Upn);

        // TEMP: log every claim so we can see exactly what the token contains
        foreach (var claim in User.Claims)
            Console.WriteLine($"CLAIM: {claim.Type} = {claim.Value}");

        Console.WriteLine($"Resolved email: '{email}', comparing to '{AuthorizedEmail}'");

        return string.Equals(email, AuthorizedEmail, StringComparison.OrdinalIgnoreCase);
    }

    // ── GET /api/reports/data?period=daily|weekly|monthly&from=&to=&state=&dealer= ──
    [HttpGet("data")]
    public async Task<IActionResult> GetReportData(
        [FromQuery] string? period,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? state,
        [FromQuery] string? dealer)
    {
        if (!IsAuthorized()) return Forbid();

        var (start, end) = ResolveDateRange(period, from, to);

        var query = _db.Proposals
            .Include(p => p.Activities)
            .Where(p => p.CreatedAt >= start && p.CreatedAt <= end);

        if (!string.IsNullOrWhiteSpace(state))
            query = query.Where(p => p.State == state);
        if (!string.IsNullOrWhiteSpace(dealer))
            query = query.Where(p => p.DealerName == dealer);

        var proposals = await query.OrderByDescending(p => p.CreatedAt).AsNoTracking().ToListAsync();

        var rows = proposals.SelectMany(p => p.Activities.Select(a => new
        {
            p.TokenNumber, p.DealerName, p.State, p.Location, p.RsmName, p.Month, p.Status,
            ActivityType = a.ActivityType, a.Category,
            a.LeadTarget, a.RetailTarget,
            a.Budget, a.AdditionalBudget,
            Total = a.Budget + a.AdditionalBudget,
            StartDate = a.StartDate, EndDate = a.EndDate,
            p.CreatedAt,
        })).ToList();

        // State-wise summary (mirrors dashboard)
        var stateSummary = proposals.GroupBy(p => p.State).Select(g =>
        {
            var totalBudget = g.Sum(p => p.TotalBudget);
            var totalRetail = g.Sum(p => p.TotalRetailTarget);
            var totalLead   = g.Sum(p => p.TotalLeadTarget);
            return new
            {
                State = g.Key,
                Dealers = g.Select(p => p.DealerName).Distinct().Count(),
                TotalBudget = totalBudget,
                TotalRetailTarget = totalRetail,
                TotalLeadTarget = totalLead,
                Cac = totalRetail > 0 ? Math.Round(totalBudget / totalRetail, 2) : 0,
                Cpl = totalLead   > 0 ? Math.Round(totalBudget / totalLead, 2)   : 0,
                Pending  = g.Count(p => p.Status == "Pending"),
                Approved = g.Count(p => p.Status == "Approved"),
                Rejected = g.Count(p => p.Status == "Rejected"),
            };
        }).OrderBy(s => s.State).ToList();

        // Dealer-wise summary (mirrors dashboard)
        var dealerSummary = proposals.GroupBy(p => new { p.State, p.DealerName }).Select(g =>
        {
            var totalBudget = g.Sum(p => p.TotalBudget);
            var totalRetail = g.Sum(p => p.TotalRetailTarget);
            var totalLead   = g.Sum(p => p.TotalLeadTarget);
            return new
            {
                State = g.Key.State,
                Dealer = g.Key.DealerName,
                Activities = g.Sum(p => p.Activities.Count),
                TotalBudget = totalBudget,
                TotalRetailTarget = totalRetail,
                TotalLeadTarget = totalLead,
                Cac = totalRetail > 0 ? Math.Round(totalBudget / totalRetail, 2) : 0,
                Cpl = totalLead   > 0 ? Math.Round(totalBudget / totalLead, 2)   : 0,
                Pending  = g.Count(p => p.Status == "Pending"),
                Approved = g.Count(p => p.Status == "Approved"),
                Rejected = g.Count(p => p.Status == "Rejected"),
            };
        }).OrderBy(d => d.State).ThenBy(d => d.Dealer).ToList();

        var totalBudgetAll  = rows.Sum(r => r.Total);
        var totalRetailAll  = proposals.Sum(p => p.TotalRetailTarget);
        var totalLeadAll    = proposals.Sum(p => p.TotalLeadTarget);

        return Ok(new
        {
            periodLabel = $"{start:dd-MMM-yyyy} to {end:dd-MMM-yyyy}",
            totalProposals = proposals.Count,
            totalActivities = rows.Count,
            totalBudget = totalBudgetAll,
            overallCac = totalRetailAll > 0 ? Math.Round(totalBudgetAll / totalRetailAll, 2) : 0,
            overallCpl = totalLeadAll   > 0 ? Math.Round(totalBudgetAll / totalLeadAll, 2)   : 0,
            rows,
            stateSummary,
            dealerSummary,
        });
    }

    // ── GET /api/reports/excel?period=&from=&to=&state=&dealer= ──────────────
    [HttpGet("excel")]
    public async Task<IActionResult> ExportExcel(
        [FromQuery] string? period, [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] string? state, [FromQuery] string? dealer)
    {
        if (!IsAuthorized()) return Forbid();

        var (start, end) = ResolveDateRange(period, from, to);
        var query = _db.Proposals.Include(p => p.Activities)
            .Where(p => p.CreatedAt >= start && p.CreatedAt <= end);
        if (!string.IsNullOrWhiteSpace(state))  query = query.Where(p => p.State == state);
        if (!string.IsNullOrWhiteSpace(dealer)) query = query.Where(p => p.DealerName == dealer);

        var proposals = await query.OrderBy(p => p.State).ThenBy(p => p.DealerName)
            .AsNoTracking().ToListAsync();

        using var package = new ExcelPackage();

        // ── Sheet 1: BTL Report (raw activity detail) ───────────────────────
        var sheet = package.Workbook.Worksheets.Add("BTL Report");

        string[] headers = {
            "Token", "Dealer", "State", "City", "RSM", "Month", "Status",
            "Activity Type", "Category", "Lead Target", "Retail Target",
            "Budget", "Additional Budget", "Total", "CPL", "CAC", "Start Date", "End Date", "Submitted"
        };
        for (int i = 0; i < headers.Length; i++)
        {
            sheet.Cells[1, i + 1].Value = headers[i];
            sheet.Cells[1, i + 1].Style.Font.Bold = true;
            sheet.Cells[1, i + 1].Style.Fill.PatternType = OfficeOpenXml.Style.ExcelFillStyle.Solid;
            sheet.Cells[1, i + 1].Style.Fill.BackgroundColor.SetColor(System.Drawing.Color.FromArgb(10, 37, 64));
            sheet.Cells[1, i + 1].Style.Font.Color.SetColor(System.Drawing.Color.White);
        }

        int row = 2;
        foreach (var p in proposals)
        {
            foreach (var a in p.Activities)
            {
                var total = a.Budget + a.AdditionalBudget;
                var cpl = a.LeadTarget   > 0 ? total / a.LeadTarget   : 0;
                var cac = a.RetailTarget > 0 ? total / a.RetailTarget : 0;

                sheet.Cells[row, 1].Value  = p.TokenNumber;
                sheet.Cells[row, 2].Value  = p.DealerName;
                sheet.Cells[row, 3].Value  = p.State;
                sheet.Cells[row, 4].Value  = p.Location;
                sheet.Cells[row, 5].Value  = p.RsmName;
                sheet.Cells[row, 6].Value  = p.Month;
                sheet.Cells[row, 7].Value  = p.Status;
                sheet.Cells[row, 8].Value  = a.ActivityType;
                sheet.Cells[row, 9].Value  = a.Category;
                sheet.Cells[row, 10].Value = a.LeadTarget;
                sheet.Cells[row, 11].Value = a.RetailTarget;
                sheet.Cells[row, 12].Value = (double)a.Budget;
                sheet.Cells[row, 13].Value = (double)a.AdditionalBudget;
                sheet.Cells[row, 14].Value = (double)total;
                sheet.Cells[row, 15].Value = (double)cpl;
                sheet.Cells[row, 16].Value = (double)cac;
                sheet.Cells[row, 17].Value = a.StartDate?.ToString("dd-MM-yyyy") ?? "";
                sheet.Cells[row, 18].Value = a.EndDate?.ToString("dd-MM-yyyy") ?? "";
                sheet.Cells[row, 19].Value = p.CreatedAt.ToString("dd-MM-yyyy HH:mm");
                row++;
            }
        }
        sheet.Cells[sheet.Dimension.Address].AutoFitColumns();

        // ── Sheet 2: State-wise Summary ──────────────────────────────────────
        var stateSheet = package.Workbook.Worksheets.Add("State Summary");
        string[] stateHeaders = { "State", "Dealers", "Total Budget", "Retail Target", "Lead Target", "CAC", "CPL", "Pending", "Approved", "Rejected" };
        for (int i = 0; i < stateHeaders.Length; i++)
        {
            stateSheet.Cells[1, i + 1].Value = stateHeaders[i];
            stateSheet.Cells[1, i + 1].Style.Font.Bold = true;
            stateSheet.Cells[1, i + 1].Style.Fill.PatternType = OfficeOpenXml.Style.ExcelFillStyle.Solid;
            stateSheet.Cells[1, i + 1].Style.Fill.BackgroundColor.SetColor(System.Drawing.Color.FromArgb(10, 37, 64));
            stateSheet.Cells[1, i + 1].Style.Font.Color.SetColor(System.Drawing.Color.White);
        }

        var stateGroups = proposals.GroupBy(p => p.State);
        int stateRow = 2;
        foreach (var g in stateGroups)
        {
            var dealersCount = g.Select(p => p.DealerName).Distinct().Count();
            var totalBudget  = g.Sum(p => p.TotalBudget);
            var totalRetail  = g.Sum(p => p.TotalRetailTarget);
            var totalLead    = g.Sum(p => p.TotalLeadTarget);
            var cac = totalRetail > 0 ? totalBudget / totalRetail : 0;
            var cpl = totalLead   > 0 ? totalBudget / totalLead   : 0;

            stateSheet.Cells[stateRow, 1].Value = g.Key;
            stateSheet.Cells[stateRow, 2].Value = dealersCount;
            stateSheet.Cells[stateRow, 3].Value = (double)totalBudget;
            stateSheet.Cells[stateRow, 4].Value = totalRetail;
            stateSheet.Cells[stateRow, 5].Value = totalLead;
            stateSheet.Cells[stateRow, 6].Value = (double)cac;
            stateSheet.Cells[stateRow, 7].Value = (double)cpl;
            stateSheet.Cells[stateRow, 8].Value = g.Count(p => p.Status == "Pending");
            stateSheet.Cells[stateRow, 9].Value = g.Count(p => p.Status == "Approved");
            stateSheet.Cells[stateRow, 10].Value = g.Count(p => p.Status == "Rejected");
            stateRow++;
        }
        stateSheet.Cells[stateSheet.Dimension.Address].AutoFitColumns();

        // ── Sheet 3: Dealer-wise Summary ─────────────────────────────────────
        var dealerSheet = package.Workbook.Worksheets.Add("Dealer Summary");
        string[] dealerHeaders = { "State", "Dealer", "Activities", "Total Budget", "Retail Target", "Lead Target", "CAC", "CPL", "Pending", "Approved", "Rejected" };
        for (int i = 0; i < dealerHeaders.Length; i++)
        {
            dealerSheet.Cells[1, i + 1].Value = dealerHeaders[i];
            dealerSheet.Cells[1, i + 1].Style.Font.Bold = true;
            dealerSheet.Cells[1, i + 1].Style.Fill.PatternType = OfficeOpenXml.Style.ExcelFillStyle.Solid;
            dealerSheet.Cells[1, i + 1].Style.Fill.BackgroundColor.SetColor(System.Drawing.Color.FromArgb(10, 37, 64));
            dealerSheet.Cells[1, i + 1].Style.Font.Color.SetColor(System.Drawing.Color.White);
        }

        var dealerGroups = proposals.GroupBy(p => new { p.State, p.DealerName });
        int dealerRow = 2;
        foreach (var g in dealerGroups)
        {
            var totalBudget = g.Sum(p => p.TotalBudget);
            var totalRetail = g.Sum(p => p.TotalRetailTarget);
            var totalLead   = g.Sum(p => p.TotalLeadTarget);
            var activities  = g.Sum(p => p.Activities.Count);
            var cac = totalRetail > 0 ? totalBudget / totalRetail : 0;
            var cpl = totalLead   > 0 ? totalBudget / totalLead   : 0;

            dealerSheet.Cells[dealerRow, 1].Value = g.Key.State;
            dealerSheet.Cells[dealerRow, 2].Value = g.Key.DealerName;
            dealerSheet.Cells[dealerRow, 3].Value = activities;
            dealerSheet.Cells[dealerRow, 4].Value = (double)totalBudget;
            dealerSheet.Cells[dealerRow, 5].Value = totalRetail;
            dealerSheet.Cells[dealerRow, 6].Value = totalLead;
            dealerSheet.Cells[dealerRow, 7].Value = (double)cac;
            dealerSheet.Cells[dealerRow, 8].Value = (double)cpl;
            dealerSheet.Cells[dealerRow, 9].Value = g.Count(p => p.Status == "Pending");
            dealerSheet.Cells[dealerRow, 10].Value = g.Count(p => p.Status == "Approved");
            dealerSheet.Cells[dealerRow, 11].Value = g.Count(p => p.Status == "Rejected");
            dealerRow++;
        }
        dealerSheet.Cells[dealerSheet.Dimension.Address].AutoFitColumns();

        var bytes = package.GetAsByteArray();
        var fileName = $"BTL_Report_{start:yyyyMMdd}_{end:yyyyMMdd}.xlsx";
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    // ── GET /api/reports/pdf?period=&from=&to=&state=&dealer= ────────────────
    [HttpGet("pdf")]
    public async Task<IActionResult> ExportPdf(
        [FromQuery] string? period, [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] string? state, [FromQuery] string? dealer)
    {
        if (!IsAuthorized()) return Forbid();

        var (start, end) = ResolveDateRange(period, from, to);
        var query = _db.Proposals.Include(p => p.Activities)
            .Where(p => p.CreatedAt >= start && p.CreatedAt <= end);
        if (!string.IsNullOrWhiteSpace(state))  query = query.Where(p => p.State == state);
        if (!string.IsNullOrWhiteSpace(dealer)) query = query.Where(p => p.DealerName == dealer);

        var proposals = await query.OrderBy(p => p.State).ThenBy(p => p.DealerName)
            .AsNoTracking().ToListAsync();

        var rows = proposals.SelectMany(p => p.Activities.Select(a => new
        {
            p.TokenNumber, p.DealerName, p.State, p.RsmName, p.Status,
            a.ActivityType, a.LeadTarget, a.RetailTarget,
            Total = a.Budget + a.AdditionalBudget,
        })).ToList();

        var totalBudget = rows.Sum(r => r.Total);
        var totalRetail = proposals.Sum(p => p.TotalRetailTarget);
        var totalLead   = proposals.Sum(p => p.TotalLeadTarget);
        var overallCac  = totalRetail > 0 ? totalBudget / totalRetail : 0;
        var overallCpl  = totalLead   > 0 ? totalBudget / totalLead   : 0;

        // State summary for second page
        var stateSummary = proposals.GroupBy(p => p.State).Select(g =>
        {
            var tb = g.Sum(p => p.TotalBudget);
            var tr = g.Sum(p => p.TotalRetailTarget);
            var tl = g.Sum(p => p.TotalLeadTarget);
            return new
            {
                State = g.Key,
                Dealers = g.Select(p => p.DealerName).Distinct().Count(),
                TotalBudget = tb,
                Cac = tr > 0 ? tb / tr : 0,
                Cpl = tl > 0 ? tb / tl : 0,
            };
        }).OrderBy(s => s.State).ToList();

        QuestPDF.Settings.License = LicenseType.Community;

        var doc = Document.Create(container =>
        {
            // Page 1 — Detail
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(30);
                page.Header().Text($"BGauss BTL Report — {start:dd-MMM-yyyy} to {end:dd-MMM-yyyy}")
                    .FontSize(16).Bold().FontColor("#0a2540");

                page.Content().Table(table =>
                {
                    table.ColumnsDefinition(cols =>
                    {
                        cols.RelativeColumn(1.2f);
                        cols.RelativeColumn(2f);
                        cols.RelativeColumn(1f);
                        cols.RelativeColumn(1.5f);
                        cols.RelativeColumn(1.8f);
                        cols.RelativeColumn(1f);
                        cols.RelativeColumn(1f);
                        cols.RelativeColumn(1.2f);
                        cols.RelativeColumn(1f);
                    });

                    table.Header(header =>
                    {
                        foreach (var h in new[] { "Token", "Dealer", "State", "RSM", "Activity", "Lead", "Retail", "Total (₹)", "Status" })
                            header.Cell().Background("#0a2540").Padding(4).Text(h).FontColor("#fff").Bold().FontSize(9);
                    });

                    foreach (var r in rows)
                    {
                        table.Cell().Padding(3).Text(r.TokenNumber ?? "—").FontSize(8);
                        table.Cell().Padding(3).Text(r.DealerName).FontSize(8);
                        table.Cell().Padding(3).Text(r.State).FontSize(8);
                        table.Cell().Padding(3).Text(r.RsmName).FontSize(8);
                        table.Cell().Padding(3).Text(r.ActivityType).FontSize(8);
                        table.Cell().Padding(3).Text(r.LeadTarget.ToString()).FontSize(8);
                        table.Cell().Padding(3).Text(r.RetailTarget.ToString()).FontSize(8);
                        table.Cell().Padding(3).Text($"₹{r.Total:N0}").FontSize(8);
                        table.Cell().Padding(3).Text(r.Status).FontSize(8);
                    }
                });

                page.Footer().AlignRight().Text(
                    $"Total Activities: {rows.Count}   ·   Total Budget: ₹{totalBudget:N0}   ·   Overall CAC: ₹{overallCac:N0}   ·   Overall CPL: ₹{overallCpl:N0}   ·   Generated {DateTime.Now:dd-MMM-yyyy HH:mm}"
                ).FontSize(9);
            });

            // Page 2 — State Summary
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(30);
                page.Header().Text("State-wise Summary").FontSize(16).Bold().FontColor("#0a2540");

                page.Content().Table(table =>
                {
                    table.ColumnsDefinition(cols =>
                    {
                        cols.RelativeColumn(1.5f);
                        cols.RelativeColumn(1f);
                        cols.RelativeColumn(1.5f);
                        cols.RelativeColumn(1.2f);
                        cols.RelativeColumn(1.2f);
                    });

                    table.Header(header =>
                    {
                        foreach (var h in new[] { "State", "Dealers", "Total Budget (₹)", "CAC (₹)", "CPL (₹)" })
                            header.Cell().Background("#0a2540").Padding(4).Text(h).FontColor("#fff").Bold().FontSize(9);
                    });

                    foreach (var s in stateSummary)
                    {
                        table.Cell().Padding(3).Text(s.State).FontSize(8);
                        table.Cell().Padding(3).Text(s.Dealers.ToString()).FontSize(8);
                        table.Cell().Padding(3).Text($"₹{s.TotalBudget:N0}").FontSize(8);
                        table.Cell().Padding(3).Text($"₹{s.Cac:N0}").FontSize(8);
                        table.Cell().Padding(3).Text($"₹{s.Cpl:N0}").FontSize(8);
                    }
                });

                page.Footer().AlignRight().Text($"Generated {DateTime.Now:dd-MMM-yyyy HH:mm}").FontSize(9);
            });
        });

        var bytes = doc.GeneratePdf();
        var fileName = $"BTL_Report_{start:yyyyMMdd}_{end:yyyyMMdd}.pdf";
        return File(bytes, "application/pdf", fileName);
    }

    private static (DateTime Start, DateTime End) ResolveDateRange(
        string? period, DateTime? from, DateTime? to)
    {
        if (from.HasValue && to.HasValue)
            return (from.Value.Date, to.Value.Date.AddDays(1).AddTicks(-1));

        var now = DateTime.UtcNow;
        return (period?.ToLower()) switch
        {
            "daily"   => (now.Date, now.Date.AddDays(1).AddTicks(-1)),
            "weekly"  => (now.Date.AddDays(-(int)now.DayOfWeek), now.Date.AddDays(7 - (int)now.DayOfWeek).AddTicks(-1)),
            "monthly" => (new DateTime(now.Year, now.Month, 1), new DateTime(now.Year, now.Month, 1).AddMonths(1).AddTicks(-1)),
            _         => (now.Date.AddDays(-30), now.Date.AddDays(1).AddTicks(-1)),
        };
    }
}
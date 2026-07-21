// Backend/Controllers/ReportsController.cs
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
[Authorize]   // ← MultiScheme (not AzureAD-only) so DbRoleClaimsTransformation runs
public class ReportsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILogger<ReportsController> _logger;

    public ReportsController(AppDbContext db, ILogger<ReportsController> logger)
    {
        _db    = db;
        _logger = logger;
        ExcelPackage.License.SetNonCommercialPersonal("BGauss BTL App");
    }

    // ── IsAuthorized: any authenticated BGauss staff can access reports ────────
    // Strategy: skip role-claim inspection entirely (claim names vary by Azure AD
    // tenant configuration and DbRoleClaimsTransformation timing).
    // Simply verify the caller's email exists in our Users table and is active.
    // The [Authorize] attribute already guarantees a valid Azure AD token.
    private bool IsAuthorized()
    {
        if (User?.Identity?.IsAuthenticated != true) return false;

        var email = CurrentUserEmail();
        if (string.IsNullOrWhiteSpace(email) || email == "unknown")
        {
            _logger.LogWarning("[Reports] Could not resolve email from token claims.");
            return false;
        }

        // Any active user in our system may download reports
        var isActiveUser = _db.Users
            .AsNoTracking()
            .Any(u => u.Email == email && u.IsActive);

        if (!isActiveUser)
            _logger.LogWarning("[Reports] 403 — email '{Email}' not found or inactive in Users table.", email);
        else
            _logger.LogInformation("[Reports] Access granted to '{Email}'.", email);

        return isActiveUser;
    }

    private string CurrentUserEmail()
    {
        // Azure AD tokens use various claim names depending on tenant/app config
        // Try all known variants in priority order
        var email = User.FindFirstValue("preferred_username")   // most common for AAD
                 ?? User.FindFirstValue("upn")
                 ?? User.FindFirstValue(ClaimTypes.Upn)
                 ?? User.FindFirstValue("email")
                 ?? User.FindFirstValue(ClaimTypes.Email)
                 ?? User.FindFirstValue("unique_name")
                 ?? User.FindFirstValue("signInNames.emailAddress")
                 ?? User.Identity?.Name;

        // Log all available claims in dev so we can debug if 403 persists
        if (string.IsNullOrWhiteSpace(email))
        {
            _logger.LogWarning("[Reports] No email claim found. Available claims: {Claims}",
                string.Join(", ", User.Claims.Select(c => $"{c.Type}={c.Value}")));
        }

        return email ?? "unknown";
    }

    // ── GET /api/reports/data ─────────────────────────────────────────────────
    [HttpGet("data")]
    public async Task<IActionResult> GetReportData(
        [FromQuery] string?   period,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string?   state,
        [FromQuery] string?   dealer)
    {
        if (!IsAuthorized()) return Forbid();

        var (start, end) = ResolveDateRange(period, from, to);

        var query = _db.Proposals
            .Include(p => p.Activities)
            .Where(p => p.CreatedAt >= start && p.CreatedAt <= end);

        if (!string.IsNullOrWhiteSpace(state))  query = query.Where(p => p.State == state);
        if (!string.IsNullOrWhiteSpace(dealer)) query = query.Where(p => p.DealerName == dealer);

        var proposals = await query
            .OrderByDescending(p => p.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        var rows = proposals.SelectMany(p => p.Activities.Select(a => new
        {
            p.TokenNumber, p.DealerName, p.State, p.Location,
            p.RsmName, p.Month, p.Status,
            ActivityType = a.ActivityType,
            Category     = a.Category,
            Subcategory  = a.Subcategory,
            Qty          = a.Qty,
            SalesPercent = a.SalesPercent,
            a.LeadTarget, a.RetailTarget,
            a.Budget, a.AdditionalBudget,
            Total        = a.Budget + a.AdditionalBudget,
            BGaussShare  = a.BGaussShare,
            BGaussAmount = Math.Round((a.Budget + a.AdditionalBudget) * (a.BGaussShare / 100m), 0),
            StartDate    = a.StartDate,
            EndDate      = a.EndDate,
            p.CreatedAt,
        })).ToList();

        var stateSummary = proposals
            .GroupBy(p => p.State)
            .Select(g =>
            {
                var tb = g.Sum(p => p.TotalBudget);
                var tr = g.Sum(p => p.TotalRetailTarget);
                var tl = g.Sum(p => p.TotalLeadTarget);
                return new
                {
                    State             = g.Key,
                    Dealers           = g.Select(p => p.DealerName).Distinct().Count(),
                    TotalBudget       = tb,
                    TotalRetailTarget = tr,
                    TotalLeadTarget   = tl,
                    Cac               = tr > 0 ? Math.Round(tb / tr, 0) : 0m,
                    Cpl               = tl > 0 ? Math.Round(tb / tl, 0) : 0m,
                    Pending           = g.Count(p => p.Status == "Pending"),
                    Approved          = g.Count(p => p.Status == "Approved"),
                    Rejected          = g.Count(p => p.Status == "Rejected"),
                    NeedsRevision     = g.Count(p => p.Status == "NeedsRevision"),
                };
            })
            .OrderBy(s => s.State)
            .ToList();

        var dealerSummary = proposals
            .GroupBy(p => new { p.State, p.DealerName })
            .Select(g =>
            {
                var tb = g.Sum(p => p.TotalBudget);
                var tr = g.Sum(p => p.TotalRetailTarget);
                var tl = g.Sum(p => p.TotalLeadTarget);
                return new
                {
                    State             = g.Key.State,
                    Dealer            = g.Key.DealerName,
                    Activities        = g.Sum(p => p.Activities.Count),
                    TotalBudget       = tb,
                    TotalRetailTarget = tr,
                    TotalLeadTarget   = tl,
                    Cac               = tr > 0 ? Math.Round(tb / tr, 0) : 0m,
                    Cpl               = tl > 0 ? Math.Round(tb / tl, 0) : 0m,
                    Pending           = g.Count(p => p.Status == "Pending"),
                    Approved          = g.Count(p => p.Status == "Approved"),
                    Rejected          = g.Count(p => p.Status == "Rejected"),
                    NeedsRevision     = g.Count(p => p.Status == "NeedsRevision"),
                };
            })
            .OrderBy(d => d.State).ThenBy(d => d.Dealer)
            .ToList();

        var totalBudgetAll = rows.Sum(r => r.Total);
        var totalRetailAll = proposals.Sum(p => p.TotalRetailTarget);
        var totalLeadAll   = proposals.Sum(p => p.TotalLeadTarget);

        return Ok(new
        {
            periodLabel     = $"{start:dd-MMM-yyyy} to {end:dd-MMM-yyyy}",
            totalProposals  = proposals.Count,
            totalActivities = rows.Count,
            totalBudget     = totalBudgetAll,
            overallCac      = totalRetailAll > 0 ? Math.Round(totalBudgetAll / totalRetailAll, 0) : 0m,
            overallCpl      = totalLeadAll   > 0 ? Math.Round(totalBudgetAll / totalLeadAll,   0) : 0m,
            rows,
            stateSummary,
            dealerSummary,
        });
    }

    // ── GET /api/reports/excel ────────────────────────────────────────────────
    [HttpGet("excel")]
    public async Task<IActionResult> ExportExcel(
        [FromQuery] string?   period,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string?   state,
        [FromQuery] string?   dealer)
    {
        if (!IsAuthorized()) return Forbid();

        var (start, end) = ResolveDateRange(period, from, to);
        var query = _db.Proposals
            .Include(p => p.Activities)
            .Where(p => p.CreatedAt >= start && p.CreatedAt <= end);
        if (!string.IsNullOrWhiteSpace(state))  query = query.Where(p => p.State == state);
        if (!string.IsNullOrWhiteSpace(dealer)) query = query.Where(p => p.DealerName == dealer);

        var proposals = await query
            .OrderBy(p => p.State).ThenBy(p => p.DealerName)
            .AsNoTracking()
            .ToListAsync();

        using var package = new ExcelPackage();
        var navy  = System.Drawing.Color.FromArgb(10, 37, 64);
        var white = System.Drawing.Color.White;

        void StyleHeader(ExcelRange cell)
        {
            cell.Style.Font.Bold = true;
            cell.Style.Fill.PatternType = OfficeOpenXml.Style.ExcelFillStyle.Solid;
            cell.Style.Fill.BackgroundColor.SetColor(navy);
            cell.Style.Font.Color.SetColor(white);
        }

        // ══ Sheet 1: BTL Report ════════════════════════════════════════════
        var sheet = package.Workbook.Worksheets.Add("BTL Report");
        string[] headers = {
            "Token", "Dealer", "State", "City", "RSM", "Month", "Status",
            "Activity Type", "Type (ATL/BTL)", "Subcategory", "QTY",
            "Sales %", "Lead Target", "Retail Target",
            "Budget (₹)", "Add. Budget (₹)", "Total (₹)",
            "BGauss %", "BGauss Amt (₹)", "CPL (₹)", "CAC (₹)",
            "Start Date", "End Date", "Submitted",
        };
        for (int i = 0; i < headers.Length; i++)
        {
            sheet.Cells[1, i + 1].Value = headers[i];
            StyleHeader(sheet.Cells[1, i + 1]);
        }

        int row = 2;
        foreach (var p in proposals)
        {
            foreach (var a in p.Activities)
            {
                var total = a.Budget + a.AdditionalBudget;
                var bgAmt = Math.Round(total * (a.BGaussShare / 100m), 0);
                var cpl   = a.LeadTarget   > 0 ? total / a.LeadTarget   : 0m;
                var cac   = a.RetailTarget > 0 ? total / a.RetailTarget : 0m;

                sheet.Cells[row, 1].Value  = p.TokenNumber;
                sheet.Cells[row, 2].Value  = p.DealerName;
                sheet.Cells[row, 3].Value  = p.State;
                sheet.Cells[row, 4].Value  = p.Location;
                sheet.Cells[row, 5].Value  = p.RsmName;
                sheet.Cells[row, 6].Value  = p.Month;
                sheet.Cells[row, 7].Value  = p.Status;
                sheet.Cells[row, 8].Value  = a.ActivityType;
                sheet.Cells[row, 9].Value  = a.Category    ?? "";
                sheet.Cells[row, 10].Value = a.Subcategory ?? "";
                sheet.Cells[row, 11].Value = a.Qty;
                sheet.Cells[row, 12].Value = a.SalesPercent.HasValue
                                             ? (double)a.SalesPercent.Value : (object)"";
                sheet.Cells[row, 13].Value = a.LeadTarget;
                sheet.Cells[row, 14].Value = a.RetailTarget;
                sheet.Cells[row, 15].Value = (double)a.Budget;
                sheet.Cells[row, 16].Value = (double)a.AdditionalBudget;
                sheet.Cells[row, 17].Value = (double)total;
                sheet.Cells[row, 18].Value = (double)a.BGaussShare;
                sheet.Cells[row, 19].Value = (double)bgAmt;
                sheet.Cells[row, 20].Value = (double)cpl;
                sheet.Cells[row, 21].Value = (double)cac;
                sheet.Cells[row, 22].Value = a.StartDate?.ToString("dd-MM-yyyy") ?? "";
                sheet.Cells[row, 23].Value = a.EndDate?.ToString("dd-MM-yyyy")   ?? "";
                sheet.Cells[row, 24].Value = p.CreatedAt.ToString("dd-MM-yyyy HH:mm");

                // Status row colours
                var fillColor = p.Status switch
                {
                    "Approved" => System.Drawing.Color.FromArgb(220, 252, 231),
                    "Rejected" => System.Drawing.Color.FromArgb(254, 226, 226),
                    _          => System.Drawing.Color.White,
                };
                if (fillColor != System.Drawing.Color.White)
                {
                    var range = sheet.Cells[row, 1, row, headers.Length];
                    range.Style.Fill.PatternType = OfficeOpenXml.Style.ExcelFillStyle.Solid;
                    range.Style.Fill.BackgroundColor.SetColor(fillColor);
                }
                row++;
            }
        }
        sheet.Cells[sheet.Dimension?.Address ?? "A1"].AutoFitColumns();

        // ══ Sheet 2: State Summary ═════════════════════════════════════════
        var stateSheet = package.Workbook.Worksheets.Add("State Summary");
        string[] stateHdrs = {
            "State", "Dealers", "Total Budget (₹)",
            "Retail Target", "Lead Target",
            "CAC (₹)", "CPL (₹)",
            "Pending", "Approved", "Rejected", "Needs Revision"
        };
        for (int i = 0; i < stateHdrs.Length; i++)
        {
            stateSheet.Cells[1, i + 1].Value = stateHdrs[i];
            StyleHeader(stateSheet.Cells[1, i + 1]);
        }
        int sr = 2;
        foreach (var g in proposals.GroupBy(p => p.State))
        {
            var tb = g.Sum(p => p.TotalBudget);
            var tr = g.Sum(p => p.TotalRetailTarget);
            var tl = g.Sum(p => p.TotalLeadTarget);
            stateSheet.Cells[sr, 1].Value  = g.Key;
            stateSheet.Cells[sr, 2].Value  = g.Select(p => p.DealerName).Distinct().Count();
            stateSheet.Cells[sr, 3].Value  = (double)tb;
            stateSheet.Cells[sr, 4].Value  = tr;
            stateSheet.Cells[sr, 5].Value  = tl;
            stateSheet.Cells[sr, 6].Value  = tr > 0 ? (double)Math.Round(tb / tr, 0) : 0d;
            stateSheet.Cells[sr, 7].Value  = tl > 0 ? (double)Math.Round(tb / tl, 0) : 0d;
            stateSheet.Cells[sr, 8].Value  = g.Count(p => p.Status == "Pending");
            stateSheet.Cells[sr, 9].Value  = g.Count(p => p.Status == "Approved");
            stateSheet.Cells[sr, 10].Value = g.Count(p => p.Status == "Rejected");
            stateSheet.Cells[sr, 11].Value = g.Count(p => p.Status == "NeedsRevision");
            sr++;
        }
        stateSheet.Cells[stateSheet.Dimension?.Address ?? "A1"].AutoFitColumns();

        // ══ Sheet 3: Dealer Summary ════════════════════════════════════════
        var dealerSheet = package.Workbook.Worksheets.Add("Dealer Summary");
        string[] dealerHdrs = {
            "State", "Dealer", "Activities",
            "Total Budget (₹)", "Retail Target", "Lead Target",
            "CAC (₹)", "CPL (₹)",
            "Pending", "Approved", "Rejected", "Needs Revision"
        };
        for (int i = 0; i < dealerHdrs.Length; i++)
        {
            dealerSheet.Cells[1, i + 1].Value = dealerHdrs[i];
            StyleHeader(dealerSheet.Cells[1, i + 1]);
        }
        int dr = 2;
        foreach (var g in proposals.GroupBy(p => new { p.State, p.DealerName }))
        {
            var tb = g.Sum(p => p.TotalBudget);
            var tr = g.Sum(p => p.TotalRetailTarget);
            var tl = g.Sum(p => p.TotalLeadTarget);
            dealerSheet.Cells[dr, 1].Value  = g.Key.State;
            dealerSheet.Cells[dr, 2].Value  = g.Key.DealerName;
            dealerSheet.Cells[dr, 3].Value  = g.Sum(p => p.Activities.Count);
            dealerSheet.Cells[dr, 4].Value  = (double)tb;
            dealerSheet.Cells[dr, 5].Value  = tr;
            dealerSheet.Cells[dr, 6].Value  = tl;
            dealerSheet.Cells[dr, 7].Value  = tr > 0 ? (double)Math.Round(tb / tr, 0) : 0d;
            dealerSheet.Cells[dr, 8].Value  = tl > 0 ? (double)Math.Round(tb / tl, 0) : 0d;
            dealerSheet.Cells[dr, 9].Value  = g.Count(p => p.Status == "Pending");
            dealerSheet.Cells[dr, 10].Value = g.Count(p => p.Status == "Approved");
            dealerSheet.Cells[dr, 11].Value = g.Count(p => p.Status == "Rejected");
            dealerSheet.Cells[dr, 12].Value = g.Count(p => p.Status == "NeedsRevision");
            dr++;
        }
        dealerSheet.Cells[dealerSheet.Dimension?.Address ?? "A1"].AutoFitColumns();

        var bytes    = package.GetAsByteArray();
        var fileName = $"BTL_Report_{start:yyyyMMdd}_{end:yyyyMMdd}.xlsx";
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileName);
    }

    // ── GET /api/reports/pdf ──────────────────────────────────────────────────
    [HttpGet("pdf")]
    public async Task<IActionResult> ExportPdf(
        [FromQuery] string?   period,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string?   state,
        [FromQuery] string?   dealer)
    {
        if (!IsAuthorized()) return Forbid();

        var (start, end) = ResolveDateRange(period, from, to);
        var query = _db.Proposals
            .Include(p => p.Activities)
            .Where(p => p.CreatedAt >= start && p.CreatedAt <= end);
        if (!string.IsNullOrWhiteSpace(state))  query = query.Where(p => p.State == state);
        if (!string.IsNullOrWhiteSpace(dealer)) query = query.Where(p => p.DealerName == dealer);

        var proposals = await query
            .OrderBy(p => p.State).ThenBy(p => p.DealerName)
            .AsNoTracking()
            .ToListAsync();

        var rows = proposals.SelectMany(p => p.Activities.Select(a => new
        {
            p.TokenNumber, p.DealerName, p.State, p.RsmName, p.Month, p.Status,
            a.ActivityType,
            Category    = a.Category    ?? "—",
            Subcategory = a.Subcategory ?? "—",
            Qty         = a.Qty,
            a.LeadTarget, a.RetailTarget,
            Total       = a.Budget + a.AdditionalBudget,
            BGaussAmt   = Math.Round((a.Budget + a.AdditionalBudget) * (a.BGaussShare / 100m), 0),
        })).ToList();

        var totalBudget = rows.Sum(r => r.Total);
        var totalRetail = proposals.Sum(p => p.TotalRetailTarget);
        var totalLead   = proposals.Sum(p => p.TotalLeadTarget);
        var overallCac  = totalRetail > 0 ? totalBudget / totalRetail : 0m;
        var overallCpl  = totalLead   > 0 ? totalBudget / totalLead   : 0m;

        var stateSummary = proposals
            .GroupBy(p => p.State)
            .Select(g =>
            {
                var tb = g.Sum(p => p.TotalBudget);
                var tr = g.Sum(p => p.TotalRetailTarget);
                var tl = g.Sum(p => p.TotalLeadTarget);
                return new
                {
                    State       = g.Key,
                    Dealers     = g.Select(p => p.DealerName).Distinct().Count(),
                    TotalBudget = tb,
                    Cac         = tr > 0 ? Math.Round(tb / tr, 0) : 0m,
                    Cpl         = tl > 0 ? Math.Round(tb / tl, 0) : 0m,
                };
            })
            .OrderBy(s => s.State)
            .ToList();

        QuestPDF.Settings.License = LicenseType.Community;

        var doc = Document.Create(container =>
        {
            // ── Page 1: Activity Detail ────────────────────────────────────
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(24);
                page.Header().Column(col =>
                {
                    col.Item().Text($"BGauss BTL Report — {start:dd-MMM-yyyy} to {end:dd-MMM-yyyy}")
                        .FontSize(14).Bold().FontColor("#0a2540");
                    col.Item().Text(
                        $"Activities: {rows.Count}  ·  Budget: ₹{totalBudget:N0}" +
                        $"  ·  CAC: ₹{overallCac:N0}  ·  CPL: ₹{overallCpl:N0}")
                        .FontSize(9).FontColor("#64748b");
                });

                page.Content().Table(table =>
                {
                    table.ColumnsDefinition(cols =>
                    {
                        cols.RelativeColumn(1.1f); // Token
                        cols.RelativeColumn(2.0f); // Dealer
                        cols.RelativeColumn(1.0f); // State
                        cols.RelativeColumn(1.4f); // RSM
                        cols.RelativeColumn(1.6f); // Activity
                        cols.RelativeColumn(0.7f); // Type
                        cols.RelativeColumn(1.4f); // Subcategory
                        cols.RelativeColumn(0.5f); // QTY
                        cols.RelativeColumn(0.7f); // Lead
                        cols.RelativeColumn(0.7f); // Retail
                        cols.RelativeColumn(1.1f); // Total
                        cols.RelativeColumn(1.1f); // BGauss Amt
                        cols.RelativeColumn(0.8f); // Status
                    });

                    table.Header(header =>
                    {
                        foreach (var h in new[]
                        {
                            "Token", "Dealer", "State", "RSM",
                            "Activity", "Type", "Subcategory", "QTY",
                            "Lead", "Retail", "Total (₹)", "BGauss (₹)", "Status"
                        })
                            header.Cell().Background("#0a2540").Padding(4)
                                .Text(h).FontColor("#fff").Bold().FontSize(8);
                    });

                    bool alt = false;
                    foreach (var r in rows)
                    {
                        var bg = alt ? "#f8fafc" : "#ffffff";
                        alt = !alt;
                        table.Cell().Background(bg).Padding(3).Text(r.TokenNumber ?? "—").FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.DealerName).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.State).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.RsmName).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.ActivityType).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.Category).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.Subcategory).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.Qty.ToString()).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.LeadTarget.ToString()).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.RetailTarget.ToString()).FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text($"₹{r.Total:N0}").FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text($"₹{r.BGaussAmt:N0}").FontSize(7);
                        table.Cell().Background(bg).Padding(3).Text(r.Status).FontSize(7);
                    }
                });

                page.Footer().AlignRight()
                    .Text($"Generated {DateTime.Now:dd-MMM-yyyy HH:mm}").FontSize(8);
            });

            // ── Page 2: State Summary ──────────────────────────────────────
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(24);
                page.Header().Text("State-wise Summary")
                    .FontSize(14).Bold().FontColor("#0a2540");

                page.Content().Table(table =>
                {
                    table.ColumnsDefinition(cols =>
                    {
                        cols.RelativeColumn(2f);
                        cols.RelativeColumn(1f);
                        cols.RelativeColumn(1.8f);
                        cols.RelativeColumn(1.4f);
                        cols.RelativeColumn(1.4f);
                    });

                    table.Header(header =>
                    {
                        foreach (var h in new[]
                            { "State", "Dealers", "Total Budget (₹)", "CAC (₹)", "CPL (₹)" })
                            header.Cell().Background("#0a2540").Padding(4)
                                .Text(h).FontColor("#fff").Bold().FontSize(9);
                    });

                    bool alt = false;
                    foreach (var s in stateSummary)
                    {
                        var bg = alt ? "#f8fafc" : "#ffffff";
                        alt = !alt;
                        table.Cell().Background(bg).Padding(3).Text(s.State).FontSize(8);
                        table.Cell().Background(bg).Padding(3).Text(s.Dealers.ToString()).FontSize(8);
                        table.Cell().Background(bg).Padding(3).Text($"₹{s.TotalBudget:N0}").FontSize(8);
                        table.Cell().Background(bg).Padding(3).Text($"₹{s.Cac:N0}").FontSize(8);
                        table.Cell().Background(bg).Padding(3).Text($"₹{s.Cpl:N0}").FontSize(8);
                    }
                });

                page.Footer().AlignRight()
                    .Text($"Generated {DateTime.Now:dd-MMM-yyyy HH:mm}").FontSize(8);
            });
        });

        var bytes    = doc.GeneratePdf();
        var fileName = $"BTL_Report_{start:yyyyMMdd}_{end:yyyyMMdd}.pdf";
        return File(bytes, "application/pdf", fileName);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private static (DateTime Start, DateTime End) ResolveDateRange(
        string? period, DateTime? from, DateTime? to)
    {
        if (from.HasValue && to.HasValue)
            return (from.Value.Date, to.Value.Date.AddDays(1).AddTicks(-1));

        var now = DateTime.UtcNow;
        return (period?.ToLower()) switch
        {
            "daily"   => (now.Date, now.Date.AddDays(1).AddTicks(-1)),
            "weekly"  => (now.Date.AddDays(-(int)now.DayOfWeek),
                          now.Date.AddDays(7 - (int)now.DayOfWeek).AddTicks(-1)),
            "monthly" => (new DateTime(now.Year, now.Month, 1),
                          new DateTime(now.Year, now.Month, 1).AddMonths(1).AddTicks(-1)),
            _         => (now.Date.AddDays(-30), now.Date.AddDays(1).AddTicks(-1)),
        };
    }
}
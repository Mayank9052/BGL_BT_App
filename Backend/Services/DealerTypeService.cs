// Backend/Services/DealerTypeService.cs
// ONE place that decides Old / New for a dealer, from RRERP (BaplFinal) data.
//
// Rule (window = "DealerType:NewWindowMonths", default 3):
//   NEW  if  onboarding date (C_CustomerMaster) is within the window
//        or  the dealer's FIRST sale bill (DMS_SaleBill) is within the window
//        or  the dealer has no sale bill yet and no onboarding date
//   OLD  otherwise.
// A dealer therefore turns Old automatically once its first sale is older than
// the window — nobody has to edit Dealer Mapping by hand.
// Used by: DealerEligibilityController, ProposalsController (CAC limit),
//          DealerTeamMappingController (auto Dealer Type + refresh).
using BGL_BT_App.Backend.Data;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

public sealed class DealerFirstSaleRow
{
    public string DealerCode { get; set; } = "";
    public DateTime? FirstSale { get; set; }
}

public record DealerTypeResult(string Code, bool IsNew, DateTime? FirstSale, DateTime? Onboarded, string Reason)
{
    public string Type => IsNew ? "New" : "Old";
}

public class DealerTypeService
{
    private const string FirstSaleSql = @"
        SELECT dealer_code AS DealerCode,
               MIN(TRY_CONVERT(DATE, salebill_date, 105)) AS FirstSale
        FROM DMS_SaleBill
        WHERE IsDelete = 0
          AND TRY_CONVERT(DATE, salebill_date, 105) IS NOT NULL";

    private readonly BaplDbContext _bapl;
    private readonly IConfiguration _cfg;
    private readonly ILogger<DealerTypeService> _log;

    public DealerTypeService(BaplDbContext bapl, IConfiguration cfg, ILogger<DealerTypeService> log)
    {
        _bapl = bapl; _cfg = cfg; _log = log;
    }

    public int WindowMonths => Math.Clamp(_cfg.GetValue("DealerType:NewWindowMonths", 3), 1, 24);
    public DateTime Cutoff => DateTime.Today.AddMonths(-WindowMonths);

    public async Task<DealerTypeResult?> ClassifyOneAsync(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var r = await ClassifyAsync(new[] { code.Trim() });
        return r.TryGetValue(code.Trim(), out var v) ? v : null;
    }

    /// <summary>Classifies many dealers with 2 queries (first sale per dealer + onboarding dates).</summary>
    public async Task<Dictionary<string, DealerTypeResult>> ClassifyAsync(IEnumerable<string> codes)
    {
        var list = codes.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var result = new Dictionary<string, DealerTypeResult>(StringComparer.OrdinalIgnoreCase);
        if (list.Count == 0) return result;

        List<DealerFirstSaleRow> sales = list.Count == 1
            ? await _bapl.Database.SqlQueryRaw<DealerFirstSaleRow>(FirstSaleSql + " AND dealer_code = {0} GROUP BY dealer_code", list[0]).ToListAsync()
            : await _bapl.Database.SqlQueryRaw<DealerFirstSaleRow>(FirstSaleSql + " GROUP BY dealer_code").ToListAsync();
        var firstSale = sales
            .Where(s => !string.IsNullOrWhiteSpace(s.DealerCode))
            .GroupBy(s => s.DealerCode.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Min(x => x.FirstSale), StringComparer.OrdinalIgnoreCase);

        var masters = await _bapl.DealerMasters.AsNoTracking()
            .Where(d => list.Contains(d.CustomerCode))
            .Select(d => new { d.CustomerCode, d.OnboardedDate })
            .ToListAsync();
        var onboarded = masters
            .GroupBy(m => m.CustomerCode.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Max(x => x.OnboardedDate), StringComparer.OrdinalIgnoreCase);

        var cutoff = Cutoff;
        foreach (var code in list)
        {
            firstSale.TryGetValue(code, out var fs);
            onboarded.TryGetValue(code, out var ob);
            var byOnboard = ob.HasValue && ob.Value.Date >= cutoff;
            var bySale    = fs.HasValue && fs.Value.Date >= cutoff;
            var noData    = !fs.HasValue && !ob.HasValue;
            var isNew     = byOnboard || bySale || noData;

            var reason = byOnboard ? $"Onboarded {ob:dd.MM.yyyy} (within last {WindowMonths} months)"
                       : bySale    ? $"First sale {fs:dd.MM.yyyy} (within last {WindowMonths} months)"
                       : noData    ? "No sale bill or onboarding date in RRERP yet — treated as New"
                       : fs.HasValue ? $"First sale {fs:dd.MM.yyyy} (older than {WindowMonths} months)"
                       :               $"Onboarded {ob:dd.MM.yyyy} (older than {WindowMonths} months), no sales";
            result[code] = new DealerTypeResult(code, isNew, fs, ob, reason);
        }
        return result;
    }
}

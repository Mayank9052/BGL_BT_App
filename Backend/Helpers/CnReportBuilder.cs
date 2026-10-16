// Backend/Helpers/CnReportBuilder.cs
//
// One row per APPROVED activity: Approved (planned) vs Actual.
// Used by: CN emails (RSM / Accounts), CN panel in dashboards, CN Tracker + Excel.
//
//   Approved Budget = (Budget + AdditionalBudget) × BGaussShare%   (BGauss share)
//   Actual Budget   = CnInvoiceAmount (BGauss-name invoice)        (null until uploaded)
//   Actual Leads    = Σ "In LMS"       (Approver sheet)  → else Σ "LMS Leads Punched" (Dealer sheet) → else Σ "Enquiry Actual"
//   Actual Retail   = Σ "Retail" MTD   (Approver sheet)  → else Σ "Retail Actual"     (Dealer sheet)
//   CPL = Budget ÷ Leads · CAC = Budget ÷ Retail  (0 when divisor is 0)

using System.Text.Json;
using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Helpers;

public record CnReportRow(
    Guid     ProposalId,
    Guid     ActivityId,
    string   TokenNumber,
    string   DealerName,
    string   State,
    string   Month,
    string   Year,
    string   RsmName,
    string   ActivityName,
    string?  Category,
    int      ApprovedLeads,
    int      ApprovedRetail,
    decimal  ApprovedBudget,
    decimal  ApprovedCpl,
    decimal  ApprovedCac,
    int      ActualLeads,
    int      ActualRetail,
    decimal? ActualBudget,
    decimal? ActualCpl,
    decimal? ActualCac,
    decimal  LeadsAchievementPct,
    decimal  RetailAchievementPct,
    string   LeadsSource,
    string   RetailSource,
    int      PhotoCount,
    int      VendorInvoiceCount,
    bool     HasFinalInvoice,
    string   CnStatus,
    string?  CnNumber);

public static class CnReportBuilder
{
    public static bool IsPhoto(string? t) => t != null && t.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
    public static bool IsVideo(string? t) => t != null && t.StartsWith("video/", StringComparison.OrdinalIgnoreCase);
    // Same rule as the dashboards: anything that is not an image/video = invoice / bill document.
    public static bool IsInvoiceDoc(string? t) => !IsPhoto(t) && !IsVideo(t);

    public static decimal ApprovedBgaussAmount(ProposalActivity a)
    {
        var share = a.BGaussShare > 0 ? a.BGaussShare : 100m;
        return Math.Round((a.Budget + a.AdditionalBudget) * share / 100m, 0, MidpointRounding.AwayFromZero);
    }

    public static CnReportRow Build(Proposal p, ProposalActivity a)
    {
        var (leads, retail, leadsSrc, retailSrc) = SumActuals(a.DailyData);
        var approvedBudget = ApprovedBgaussAmount(a);
        decimal? actualBudget = a.CnInvoiceAmount is > 0 ? a.CnInvoiceAmount : null;

        var media    = a.MediaFiles ?? new List<ActivityMedia>();
        var photos   = media.Count(m => IsPhoto(m.FileType));
        var invoices = media.Count(m => IsInvoiceDoc(m.FileType));
        if (!string.IsNullOrWhiteSpace(a.MediaFileUrl) && media.All(m => m.FileUrl != a.MediaFileUrl))
        {
            if (IsPhoto(a.MediaFileType)) photos++;
            else if (IsInvoiceDoc(a.MediaFileType)) invoices++;
        }

        return new CnReportRow(
            p.Id, a.Id,
            p.TokenNumber ?? "", p.DealerName ?? "", p.State ?? "", p.Month ?? "", $"{p.Year}", p.RsmName ?? "",
            a.ActivityType, a.Category,
            a.LeadTarget, a.RetailTarget, approvedBudget,
            Div(approvedBudget, a.LeadTarget), Div(approvedBudget, a.RetailTarget),
            leads, retail, actualBudget,
            actualBudget.HasValue ? (decimal?)Div(actualBudget.Value, leads)  : null,
            actualBudget.HasValue ? (decimal?)Div(actualBudget.Value, retail) : null,
            Pct(leads, a.LeadTarget), Pct(retail, a.RetailTarget),
            leadsSrc, retailSrc,
            photos, invoices,
            !string.IsNullOrWhiteSpace(a.CnFinalInvoiceUrl),
            a.CnStatus.ToString(), a.CnNumber);
    }

    public static (int Leads, int Retail, string LeadsSource, string RetailSource) SumActuals(string? dailyJson)
    {
        if (string.IsNullOrWhiteSpace(dailyJson)) return (0, 0, "No daily data", "No daily data");

        int inLms = 0, punched = 0, enquiry = 0, retailMtd = 0, retailActual = 0;
        try
        {
            using var doc = JsonDocument.Parse(dailyJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return (0, 0, "Invalid daily data", "Invalid daily data");
            foreach (var e in doc.RootElement.EnumerateArray())
            {
                if (e.ValueKind != JsonValueKind.Object) continue;
                inLms        += Int(e, "inLms");
                punched      += Int(e, "leadsPunched");
                enquiry      += Int(e, "enquiryActual");
                retailMtd    += Int(e, "retailMtdActivity");
                retailActual += Int(e, "retailActual");
            }
        }
        catch (JsonException)
        {
            return (0, 0, "Invalid daily data", "Invalid daily data");
        }

        var (leads, ls) = inLms > 0   ? (inLms, "In LMS")
                        : punched > 0 ? (punched, "LMS Leads Punched")
                        :               (enquiry, "Enquiry Actual");
        var (retail, rs) = retailMtd > 0 ? (retailMtd, "Retail (MTD activity)")
                         :                 (retailActual, "Retail Actual");
        return (leads, retail, ls, rs);
    }

    private static int Int(JsonElement e, string name)
    {
        foreach (var prop in e.EnumerateObject())
        {
            if (!string.Equals(prop.Name, name, StringComparison.OrdinalIgnoreCase)) continue;
            var v = prop.Value;
            if (v.ValueKind == JsonValueKind.Number)
            {
                if (v.TryGetInt32(out var i)) return i;
                if (v.TryGetDouble(out var d)) return (int)Math.Round(d);
            }
            if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s)) return s;
            return 0;
        }
        return 0;
    }

    private static decimal Div(decimal n, int d) =>
        d > 0 ? Math.Round(n / d, 0, MidpointRounding.AwayFromZero) : 0m;

    private static decimal Pct(int actual, int target) =>
        target > 0 ? Math.Round(actual * 100m / target, 1, MidpointRounding.AwayFromZero) : 0m;
}

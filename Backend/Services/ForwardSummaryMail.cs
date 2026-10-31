// Backend/Services/ForwardSummaryMail.cs
// ONE state-wise summary mail for proposals forwarded to the Final Approver.
//   • Sent IMMEDIATELY when the Checker clicks "Forward Selected to Final Approver"
//     (no more waiting for the midnight digest).
//   • Sent as the Checker herself (delegated Graph token, /me/sendMail) → the mail is in
//     her Sent Items and she is cc'd, so she can SEE that it went out.
// Format: KPI strip → State-wise summary table (with Grand Total) → proposal list by state
//         → "Open in BTL Portal" button (pre-selects the proposals for the approver).
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public static class ForwardSummaryMail
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private static readonly CultureInfo IN = new("en-IN");
    private static readonly TimeZoneInfo Ist = FindIst();

    private static TimeZoneInfo FindIst()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("India Standard Time"); }
        catch { try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata"); } catch { return TimeZoneInfo.Utc; } }
    }

    public static DateTime NowIst() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Ist);

    private static decimal D(object? v) { try { return v is null ? 0m : Convert.ToDecimal(v, CultureInfo.InvariantCulture); } catch { return 0m; } }
    private static string Inr(decimal v) => "₹" + Math.Round(v).ToString("N0", IN);
    private static string Lakh(decimal v) => v >= 1_00_00_000m ? $"₹{v / 1_00_00_000m:0.00} Cr" : v >= 1_00_000m ? $"₹{v / 1_00_000m:0.0} L" : Inr(v);
    private static string H(string? s) => WebUtility.HtmlEncode(s ?? "");

    private static decimal BgaussAmount(Proposal p) => p.Activities.Sum(a =>
    {
        var share = D(a.BGaussShare); if (share <= 0) share = 100;
        return Math.Round((D(a.Budget) + D(a.AdditionalBudget)) * share / 100m);
    });

    public record Built(string Subject, string Html, int Proposals, int States);

    public static Built Build(IReadOnlyList<Proposal> list, string forwardedBy, string portalUrl)
    {
        var now = NowIst();
        var rows = list.OrderBy(p => p.State).ThenBy(p => p.DealerName).ToList();
        var byState = rows.GroupBy(p => string.IsNullOrWhiteSpace(p.State) ? "—" : p.State.Trim()).ToList();

        decimal tBudget = rows.Sum(p => D(p.TotalBudget)), tBg = rows.Sum(BgaussAmount);
        decimal tLead = rows.Sum(p => D(p.TotalLeadTarget)), tRetail = rows.Sum(p => D(p.TotalRetailTarget));
        int tActs = rows.Sum(p => p.Activities.Count);
        int tDealers = rows.Select(p => (p.DealerName ?? "").Trim().ToLowerInvariant()).Distinct().Count();
        int overCac = rows.Count(p => D(p.TotalRetailTarget) > 0 && BgaussAmount(p) / D(p.TotalRetailTarget) > (D(p.AllowedCac) > 0 ? D(p.AllowedCac) : 4000m));
        string cac(decimal bg, decimal rt) => rt > 0 ? Inr(bg / rt) : "—";
        string cpl(decimal bg, decimal ld) => ld > 0 ? Inr(bg / ld) : "—";

        const string th = "padding:8px 10px;background:#0a2540;color:#ffffff;font-size:12px;font-weight:700;border:1px solid #1e3a5f;text-align:center;";
        const string td = "padding:7px 10px;font-size:12px;border:1px solid #e2e8f0;text-align:center;color:#0a2540;";
        const string tdL = "padding:7px 10px;font-size:12px;border:1px solid #e2e8f0;text-align:left;color:#0a2540;";
        const string tot = "padding:8px 10px;font-size:12px;font-weight:700;border:1px solid #e2e8f0;text-align:center;background:#fce4d6;color:#0a2540;";

        var sb = new StringBuilder();
        sb.Append("<div style=\"font-family:Segoe UI,Arial,sans-serif;color:#0a2540;max-width:1100px\">");
        sb.Append("<div style=\"background:#00b050;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0\">")
          .Append("<div style=\"font-size:18px;font-weight:700\">BTL Proposals for Approval — State-wise Summary</div>")
          .Append($"<div style=\"font-size:12px;opacity:.9;margin-top:2px\">Forwarded by {H(forwardedBy)} on {now:dd.MM.yyyy} at {now:HH:mm} IST</div></div>");
        sb.Append("<div style=\"border:1px solid #e2e8f0;border-top:none;padding:16px 18px;border-radius:0 0 8px 8px\">");
        sb.Append($"<p style=\"font-size:13px;margin:0 0 12px\">Dear Sir,<br/>The following <b>{rows.Count} BTL proposal{(rows.Count == 1 ? "" : "s")}</b> from <b>{byState.Count} state{(byState.Count == 1 ? "" : "s")}</b> have been checked and are pending your approval.</p>");

        // KPI strip
        sb.Append("<table cellspacing=\"6\" cellpadding=\"0\" style=\"border-collapse:separate;margin:0 0 14px -6px\"><tr>");
        foreach (var (label, value, color) in new[] {
            ("Proposals", rows.Count.ToString(IN), "#0a2540"), ("Dealers", tDealers.ToString(IN), "#0a2540"),
            ("Activities", tActs.ToString(IN), "#0a2540"), ("Total Budget", Lakh(tBudget), "#1d4ed8"),
            ("BGauss Budget", Lakh(tBg), "#1d4ed8"), ("Lead Target", tLead.ToString("N0", IN), "#7c3aed"),
            ("Retail Target", tRetail.ToString("N0", IN), "#16a34a"), ("Avg CAC", cac(tBg, tRetail), overCac > 0 ? "#dc2626" : "#16a34a") })
            sb.Append($"<td style=\"background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid {color};border-radius:6px;padding:8px 12px;min-width:92px\">")
              .Append($"<div style=\"font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase\">{label}</div>")
              .Append($"<div style=\"font-size:16px;font-weight:800;color:{color}\">{value}</div></td>");
        sb.Append("</tr></table>");
        if (overCac > 0)
            sb.Append($"<div style=\"background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;padding:8px 12px;font-size:12px;color:#991b1b;margin-bottom:12px\">⚠ {overCac} proposal{(overCac == 1 ? "" : "s")} above the allowed CAC per vehicle — marked ⚠ below (deviation approval).</div>");

        // State-wise summary
        sb.Append("<div style=\"font-size:14px;font-weight:700;margin:6px 0\">1. State-wise Summary</div>");
        sb.Append("<table cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;width:100%\"><tr>");
        foreach (var c in new[] { "#", "State", "Proposals", "Dealers", "Activities", "Total Budget", "BGauss Budget", "Lead", "Retail", "CAC", "CPL", "Over CAC" })
            sb.Append($"<th style=\"{th}\">{c}</th>");
        sb.Append("</tr>");
        int i = 0;
        foreach (var g in byState)
        {
            var bg = g.Sum(BgaussAmount); var ld = g.Sum(p => D(p.TotalLeadTarget)); var rt = g.Sum(p => D(p.TotalRetailTarget));
            var oc = g.Count(p => D(p.TotalRetailTarget) > 0 && BgaussAmount(p) / D(p.TotalRetailTarget) > (D(p.AllowedCac) > 0 ? D(p.AllowedCac) : 4000m));
            var zebra = (i % 2 == 1) ? "background:#f8fafc;" : "";
            sb.Append("<tr>")
              .Append($"<td style=\"{td}{zebra}\">{++i}</td><td style=\"{tdL}{zebra}font-weight:700\">{H(g.Key)}</td>")
              .Append($"<td style=\"{td}{zebra}\">{g.Count()}</td>")
              .Append($"<td style=\"{td}{zebra}\">{g.Select(p => (p.DealerName ?? "").Trim().ToLowerInvariant()).Distinct().Count()}</td>")
              .Append($"<td style=\"{td}{zebra}\">{g.Sum(p => p.Activities.Count)}</td>")
              .Append($"<td style=\"{td}{zebra}\">{Inr(g.Sum(p => D(p.TotalBudget)))}</td><td style=\"{td}{zebra}\">{Inr(bg)}</td>")
              .Append($"<td style=\"{td}{zebra}\">{ld.ToString("N0", IN)}</td><td style=\"{td}{zebra}\">{rt.ToString("N0", IN)}</td>")
              .Append($"<td style=\"{td}{zebra}\">{cac(bg, rt)}</td><td style=\"{td}{zebra}\">{cpl(bg, ld)}</td>")
              .Append($"<td style=\"{td}{zebra}{(oc > 0 ? "color:#dc2626;font-weight:700" : "color:#94a3b8")}\">{(oc > 0 ? $"⚠ {oc}" : "—")}</td></tr>");
        }
        sb.Append("<tr>")
          .Append($"<td style=\"{tot}\" colspan=\"2\">Grand Total</td><td style=\"{tot}\">{rows.Count}</td><td style=\"{tot}\">{tDealers}</td><td style=\"{tot}\">{tActs}</td>")
          .Append($"<td style=\"{tot}\">{Inr(tBudget)}</td><td style=\"{tot}\">{Inr(tBg)}</td><td style=\"{tot}\">{tLead.ToString("N0", IN)}</td>")
          .Append($"<td style=\"{tot}\">{tRetail.ToString("N0", IN)}</td><td style=\"{tot}\">{cac(tBg, tRetail)}</td><td style=\"{tot}\">{cpl(tBg, tLead)}</td>")
          .Append($"<td style=\"{tot}{(overCac > 0 ? "color:#dc2626" : "")}\">{(overCac > 0 ? $"⚠ {overCac}" : "—")}</td></tr></table>");

        // Proposal list grouped by state
        sb.Append("<div style=\"font-size:14px;font-weight:700;margin:18px 0 6px\">2. Proposals (State → Dealer)</div>");
        sb.Append("<table cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse:collapse;width:100%\"><tr>");
        foreach (var c in new[] { "Token", "Dealer, City", "Type", "RSM", "Month", "Activities", "Budget", "BGauss", "Lead", "Retail", "CAC" })
            sb.Append($"<th style=\"{th}\">{c}</th>");
        sb.Append("</tr>");
        foreach (var g in byState)
        {
            sb.Append($"<tr><td colspan=\"11\" style=\"padding:6px 10px;background:#e2e8f0;font-weight:700;font-size:12px;border:1px solid #cbd5e1\">{H(g.Key)} · {g.Count()} proposal{(g.Count() == 1 ? "" : "s")} · {Inr(g.Sum(p => D(p.TotalBudget)))}</td></tr>");
            foreach (var p in g)
            {
                var bg = BgaussAmount(p); var rt = D(p.TotalRetailTarget);
                var allowed = D(p.AllowedCac) > 0 ? D(p.AllowedCac) : 4000m;
                var over = rt > 0 && bg / rt > allowed;
                var acts = string.Join(", ", p.Activities.Select(a => a.ActivityType).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct());
                sb.Append("<tr>")
                  .Append($"<td style=\"{td}font-family:Consolas,monospace;font-size:11px\">{H(p.TokenNumber)}</td>")
                  .Append($"<td style=\"{tdL}\"><b>{H(p.DealerName)}</b><br/><span style=\"color:#64748b;font-size:11px\">{H(p.Location)}</span></td>")
                  .Append($"<td style=\"{td}\">{H(p.Type)}</td><td style=\"{tdL}\">{H(p.RsmName)}</td><td style=\"{td}\">{H(p.Month)}</td>")
                  .Append($"<td style=\"{tdL}font-size:11px\">{H(acts)}</td>")
                  .Append($"<td style=\"{td}\">{Inr(D(p.TotalBudget))}</td><td style=\"{td}\">{Inr(bg)}</td>")
                  .Append($"<td style=\"{td}\">{D(p.TotalLeadTarget).ToString("N0", IN)}</td><td style=\"{td}\">{rt.ToString("N0", IN)}</td>")
                  .Append($"<td style=\"{td}{(over ? "color:#dc2626;font-weight:700" : "")}\">{cac(bg, rt)}{(over ? " ⚠" : "")}</td></tr>");
            }
        }
        sb.Append("</table>");

        if (!string.IsNullOrWhiteSpace(portalUrl))
        {
            var link = portalUrl + (portalUrl.Contains('?') ? "&" : "?") + "highlight=" + string.Join(",", rows.Select(p => p.Id));
            sb.Append($"<div style=\"margin:18px 0 6px\"><a href=\"{H(link)}\" style=\"background:#0a2540;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:6px;font-weight:700;font-size:13px;display:inline-block\">Open in BTL Portal — proposals pre-selected</a></div>");
        }
        sb.Append("<p style=\"font-size:11px;color:#94a3b8;margin-top:16px\">Auto-generated by the BGauss BTL Portal. CAC = BGauss budget ÷ retail target; CPL = BGauss budget ÷ lead target. ⚠ = above the allowed CAC per vehicle (Old ₹4,000 / New ₹6,000).</p>");
        sb.Append("</div></div>");

        var subject = $"BTL Proposals for Approval — {rows.Count} proposal{(rows.Count == 1 ? "" : "s")} · {byState.Count} state{(byState.Count == 1 ? "" : "s")} · {Lakh(tBudget)} · {now:dd.MM.yyyy HH:mm}";
        return new Built(subject, sb.ToString(), rows.Count, byState.Count);
    }

    /// <summary>Send as the signed-in user (delegated token from the X-Graph-Token header).</summary>
    public static async Task<(bool Sent, string? Error)> SendAsUserAsync(string graphToken, Built mail,
        IEnumerable<string> to, IEnumerable<string> cc)
    {
        if (string.IsNullOrWhiteSpace(graphToken)) return (false, "no delegated Graph token");
        object Rcpt(string e) => new { emailAddress = new { address = e } };
        var payload = new
        {
            message = new
            {
                subject = mail.Subject,
                body = new { contentType = "HTML", content = mail.Html },
                toRecipients = to.Select(Rcpt).ToArray(),
                ccRecipients = cc.Select(Rcpt).ToArray(),
                importance = "high",
            },
            saveToSentItems = true,
        };
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://graph.microsoft.com/v1.0/me/sendMail")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", graphToken);
        using var res = await Http.SendAsync(req);
        if (res.IsSuccessStatusCode) return (true, null);
        var body = await res.Content.ReadAsStringAsync();
        return (false, $"Graph {(int)res.StatusCode}: {(body.Length > 300 ? body[..300] : body)}");
    }

    public static List<string> SplitEmails(string? s) =>
        (s ?? "").Split(',', ';').Select(x => x.Trim()).Where(x => x.Contains('@'))
                 .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}

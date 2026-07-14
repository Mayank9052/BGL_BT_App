// Backend/Services/GraphEmailService.cs
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;

namespace BGL_BT_App.Backend.Services;

public class SmtpSettings
{
    public string Host                    { get; set; } = string.Empty;
    public int    Port                    { get; set; } = 587;
    public string User                    { get; set; } = string.Empty;
    public string Password                { get; set; } = string.Empty;
    public string From                    { get; set; } = string.Empty;
    public bool   EnableSsl               { get; set; } = true;
    public string ApproverEmail           { get; set; } = string.Empty;
    public string ApproverEmail2          { get; set; } = string.Empty;
    public string FinalApproverEmail      { get; set; } = string.Empty;
    public string PortalBaseUrl           { get; set; } = "https://44.210.115.237";

    // ── Derived: first name from email local-part ─────────────────────────
    // e.g. "seema.shakya@bgauss.com"  → "Seema"
    //      "durgesh.guptaa@bgauss.com" → "Durgesh"
    public string ApproverFirstName =>
        FirstName(ApproverEmail);

    public string FinalApproverFirstName =>
        FirstName(FinalApproverEmail);

    private static string FirstName(string email)
    {
        if (string.IsNullOrWhiteSpace(email)) return "Team";
        var local = email.Split('@')[0];          // "seema.shakya"
        var first = local.Split('.')[0];          // "seema"
        return char.ToUpper(first[0]) + first[1..]; // "Seema"
    }
}

public class GraphEmailService : IEmailService
{
    private readonly HttpClient                 _http;
    private readonly SmtpSettings              _settings;
    private readonly ILogger<GraphEmailService> _logger;

    public GraphEmailService(
        HttpClient http,
        IOptions<SmtpSettings> settings,
        ILogger<GraphEmailService> logger)
    {
        _http     = http;
        _settings = settings.Value;
        _logger   = logger;
    }

    // ── Public interface methods ──────────────────────────────────────────────

    public Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal p, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, null,
            BuildSubject("New Proposal", p), BuildSubmissionBody(p));

    public Task<(bool Sent, string? Error)> SendCheckerForwardMailAsync(Proposal p, string graphToken) =>
        SendAsync(graphToken, _settings.FinalApproverEmail, _settings.ApproverEmail,
            BuildSubject("Forwarded for Approval", p), BuildCheckerForwardBody(p));

    public Task<(bool Sent, string? Error)> SendDecisionMailAsync(
        Proposal p, ApprovalDecision decision, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, p.SubmittedBy,
            BuildSubject($"Re: Proposal {decision.Status}", p), BuildDecisionBody(p, decision));

    public Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(
        Proposal p, string? note, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, p.SubmittedBy,
            BuildSubject("Revision Requested", p), BuildRevisionBody(p, note));

    public Task<(bool Sent, string? Error)> SendResubmissionMailAsync(Proposal p, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, null,
            BuildSubject("Resubmitted for Review", p), BuildResubmissionBody(p));

    public Task<(bool Sent, string? Error)> SendDealerNotificationMailAsync(
        Proposal p, string dealerEmail, string graphToken)
    {
        if (string.IsNullOrWhiteSpace(dealerEmail))
            return Task.FromResult<(bool, string?)>((false, "No dealer email provided."));
        return SendAsync(graphToken, dealerEmail, $"{_settings.ApproverEmail},{p.SubmittedBy}",
            BuildSubject("Activity Proposal Approved — Your Action Required", p),
            BuildDealerNotificationBody(p));
    }

    public Task<(bool Sent, string? Error)> SendDealerSendBackMailAsync(
        Proposal p, string dealerEmail, string requestNote, string graphToken) =>
        SendAsync(graphToken,
            to:      _settings.ApproverEmail,
            cc:      p.SubmittedBy,
            subject: BuildSubject("Budget Add-On Request from Dealer", p),
            body:    BuildDealerSendBackBody(p, dealerEmail, requestNote));

    // ── Core send ─────────────────────────────────────────────────────────────

    private async Task<(bool Sent, string? Error)> SendAsync(
        string graphToken, string to, string? cc, string subject, string body)
    {
        if (string.IsNullOrWhiteSpace(to)) return (false, "No recipient.");
        if (string.IsNullOrWhiteSpace(graphToken))
        {
            _logger.LogWarning("No Graph token for {To}", to);
            return (false, "No Graph token.");
        }

        var toList = to.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                       .Select(a => new { emailAddress = new { address = a } }).ToArray();
        var ccList = string.IsNullOrWhiteSpace(cc)
            ? Array.Empty<object>()
            : cc.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(a => (object)new { emailAddress = new { address = a } }).ToArray();

        var payload = new
        {
            message = new
            {
                subject,
                body         = new { contentType = "HTML", content = body },
                toRecipients = toList,
                ccRecipients = ccList,
            },
            saveToSentItems = true,
        };

        using var req = new HttpRequestMessage(
            HttpMethod.Post, "https://graph.microsoft.com/v1.0/me/sendMail")
            { Content = JsonContent.Create(payload) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", graphToken);

        try
        {
            var resp = await _http.SendAsync(req);
            if (resp.IsSuccessStatusCode)
            {
                _logger.LogInformation("Mail sent to {To} (cc: {Cc})", to, cc ?? "none");
                return (true, null);
            }
            var err = await resp.Content.ReadAsStringAsync();
            _logger.LogError("Graph {Status}: {Err}", resp.StatusCode, err);
            return (false, $"Graph {resp.StatusCode}: {err}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Graph exception for {To}", to);
            return (false, ex.Message);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Shared HTML helpers
    // ─────────────────────────────────────────────────────────────────────────

    private static string BuildSubject(string tag, Proposal p) =>
        $"{p.TokenNumber} — {tag} — {p.DealerName.ToUpper()} — {p.Month} — {p.State}";

    private static string Shell(string headerBg, string tagLine, string token, string bodyHtml) =>
        $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a2233;max-width:700px;margin:0 auto;">
          <div style="background:{headerBg};color:#fff;padding:12px 20px;border-radius:6px 6px 0 0;">
            <span style="font-size:9px;letter-spacing:1px;text-transform:uppercase;opacity:.7;">BGauss BTL · {tagLine}</span>
            <div style="font-size:17px;font-weight:700;margin-top:2px;">{token}</div>
          </div>
          <div style="padding:16px 20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;">
            {bodyHtml}
          </div>
        </div>
        """;

    private static string LinkBtn(string href, string label, string bg = "#1e3a5f") =>
        $"""
        <div style="margin:14px 0 6px;text-align:center;">
          <a href="{href}" style="display:inline-block;background:{bg};color:#fff;
             text-decoration:none;padding:10px 28px;border-radius:6px;font-weight:600;font-size:13px;">{label}</a>
        </div>
        <p style="font-size:10px;color:#9ca3af;text-align:center;margin:0 0 12px;">
          <a href="{href}" style="color:#64748b;">{href}</a></p>
        """;

    // ── Compact 2-per-row proposal info table ─────────────────────────────────
    private static string BuildProposalInfoTable(Proposal p)
    {
        var vendor    = string.IsNullOrWhiteSpace(p.VendorName)   ? "—" : p.VendorName;
        var tsmName   = string.IsNullOrWhiteSpace(p.TsmName)      ? "—" : p.TsmName;
        var commando  = string.IsNullOrWhiteSpace(p.CommandoName) ? "—" : p.CommandoName;
        var submitter = $"{p.SubmittedByDisplayName ?? p.RsmName} ({p.SubmittedBy})";

        const string lbl = "padding:4px 8px 4px 10px;color:#6b7280;font-size:11px;white-space:nowrap;width:90px;";
        const string val = "padding:4px 12px 4px 0;font-weight:600;font-size:12px;color:#0a2540;";
        const string sep = "border-right:1px solid #e2e8f0;";

        return $"""
            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#f8fafc;
                          border:1px solid #e2e8f0;border-radius:6px;margin-bottom:12px;font-size:12px;">
              <tr>
                <td style="{lbl}">Token</td>
                <td style="{val}{sep}font-family:monospace;color:#1e3a5f;">{p.TokenNumber}</td>
                <td style="{lbl}">Dealer</td>
                <td style="{val}">{p.DealerName}</td>
              </tr>
              <tr style="background:#fff;">
                <td style="{lbl}">Location</td>
                <td style="{val}{sep}">{p.Location}, {p.State}</td>
                <td style="{lbl}">Month</td>
                <td style="{val}">{p.Month}</td>
              </tr>
              <tr>
                <td style="{lbl}">RSM / TSM</td>
                <td style="{val}{sep}">{p.RsmName}</td>
                <td style="{lbl}">TSM</td>
                <td style="{val}{sep}">{tsmName}</td>
              </tr>
              <tr>
                <td style="{lbl}">Commando</td>
                <td style="{val}">{commando}</td>
              </tr>
              <tr style="background:#fff;">
                <td style="{lbl}">Eligibility</td>
                <td style="{val}{sep}">{p.Eligibility}</td>
                <td style="{lbl}">Type</td>
                <td style="{val}">{p.Type}</td>
              </tr>
              <tr>
                <td style="{lbl}">Vendor</td>
                <td style="{val}{sep}">{vendor}</td>
                <td style="{lbl}">Submitted by</td>
                <td style="padding:4px 0 4px 0;font-size:11px;color:#6b7280;">{submitter}</td>
              </tr>
            </table>
            """;
    }

    // ── Flat activity table — From | To | Days columns ────────────────────────
    private static string BuildActivityTable(Proposal p)
    {
        var rows       = new System.Text.StringBuilder();
        var overallCac = p.TotalRetailTarget > 0 ? Math.Round(p.TotalBudget / (decimal)p.TotalRetailTarget, 0) : 0;
        var overallCpl = p.TotalLeadTarget   > 0 ? Math.Round(p.TotalBudget / (decimal)p.TotalLeadTarget,   0) : 0;

        foreach (var a in p.Activities)
        {
            var total  = a.Budget + a.AdditionalBudget;
            var days   = (a.EndDate.HasValue && a.StartDate.HasValue)
                         ? (a.EndDate.Value.DayNumber - a.StartDate.Value.DayNumber + 1) : 0;
            var cac    = a.RetailTarget > 0 ? Math.Round(total / (decimal)a.RetailTarget, 0) : 0;
            var cpl    = a.LeadTarget   > 0 ? Math.Round(total / (decimal)a.LeadTarget,   0) : 0;
            var cacCol = cac > 4000 ? "#dc2626" : "#374151";
            var fromDt = a.StartDate?.ToString("dd-MMM-yyyy") ?? "—";
            var toDt   = a.EndDate?.ToString("dd-MMM-yyyy")   ?? "—";

            rows.Append(
                "<tr>" +
                $"<td style='padding:5px 8px;font-weight:600;color:#0a2540;border-bottom:1px solid #f1f5f9;white-space:nowrap;'>{a.ActivityType}</td>" +
                $"<td style='padding:5px 8px;text-align:center;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap;'>{fromDt}</td>" +
                $"<td style='padding:5px 8px;text-align:center;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap;'>{toDt}</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{days}d</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{a.LeadTarget}</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{a.RetailTarget}</td>" +
                $"<td style='padding:5px 8px;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;'>Rs.{total:N0}/-</td>" +
                $"<td style='padding:5px 8px;text-align:right;color:#6b7280;border-bottom:1px solid #f1f5f9;'>Rs.{cpl:N0}/-</td>" +
                $"<td style='padding:5px 8px;text-align:right;color:{cacCol};border-bottom:1px solid #f1f5f9;font-weight:{(cac > 4000 ? "700" : "400")};'>Rs.{cac:N0}/-</td>" +
                "</tr>");
        }

        rows.Append(
            "<tr style='background:#f0fdf4;'>" +
            "<td style='padding:5px 8px;font-weight:700;color:#166534;' colspan='4'>Totals</td>" +
            $"<td style='padding:5px 8px;text-align:center;font-weight:700;color:#166534;'>{p.TotalLeadTarget}</td>" +
            $"<td style='padding:5px 8px;text-align:center;font-weight:700;color:#166534;'>{p.TotalRetailTarget}</td>" +
            $"<td style='padding:5px 8px;text-align:right;font-weight:700;color:#0a2540;'>Rs.{p.TotalBudget:N0}/-</td>" +
            $"<td style='padding:5px 8px;text-align:right;font-weight:700;color:#166534;'>Rs.{overallCpl:N0}/-</td>" +
            $"<td style='padding:5px 8px;text-align:right;font-weight:700;color:{(overallCac > 4000 ? "#dc2626" : "#166534")};'>Rs.{overallCac:N0}/-</td>" +
            "</tr>");

        return $"""
            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#fff;
                          border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;
                          margin-bottom:12px;font-size:12px;">
              <thead>
                <tr style="background:#0a2540;">
                  <th style="padding:6px 8px;text-align:left;color:#e2e8f0;font-size:10px;white-space:nowrap;">Activity</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">From</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">To</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Days</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Lead Target</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Retail Target</th>
                  <th style="padding:6px 8px;text-align:right;color:#e2e8f0;font-size:10px;">Budget</th>
                  <th style="padding:6px 8px;text-align:right;color:#e2e8f0;font-size:10px;">CPL</th>
                  <th style="padding:6px 8px;text-align:right;color:#e2e8f0;font-size:10px;">CAC</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
            """;
    }

    // ── Cross-tab table: Parameter rows × Activity columns ────────────────────
    private static string BuildCrossTabActivityTable(Proposal p)
    {
        var overallCac = p.TotalRetailTarget > 0
            ? Math.Round(p.TotalBudget / (decimal)p.TotalRetailTarget, 0) : 0;
        var overallCpl = p.TotalLeadTarget   > 0
            ? Math.Round(p.TotalBudget / (decimal)p.TotalLeadTarget,   0) : 0;

        var acts     = p.Activities.ToList();
        char ltr     = 'A';
        var letters  = acts.Select(_ => ltr++).ToList();
        var totals   = acts.Select(a => a.Budget + a.AdditionalBudget).ToList();
        var daysList = acts.Select(a =>
            (a.EndDate.HasValue && a.StartDate.HasValue)
            ? (a.EndDate.Value.DayNumber - a.StartDate.Value.DayNumber + 1) : 0).ToList();
        var cacs = acts.Select((a, i) =>
            a.RetailTarget > 0 ? Math.Round(totals[i] / (decimal)a.RetailTarget, 0) : 0).ToList();
        var cpls = acts.Select((a, i) =>
            a.LeadTarget > 0   ? Math.Round(totals[i] / (decimal)a.LeadTarget,   0) : 0).ToList();

        var headerCols = new System.Text.StringBuilder();
        for (int i = 0; i < acts.Count; i++)
        {
            headerCols.Append(
                $"<th style='padding:8px 12px;text-align:left;color:#1a2233;font-size:12px;" +
                $"background:#e8edf2;border-left:1px solid #d1d9e0;min-width:120px;'>" +
                $"<span style='font-weight:700;color:#0a2540;'>{letters[i]}) </span>{acts[i].ActivityType}</th>");
        }

        static string DataRow(string param, IEnumerable<string> values, bool alt)
        {
            var bg    = alt ? "background:#fff;" : "background:#f8fafc;";
            var cells = string.Join("", values.Select(v =>
                $"<td style='padding:6px 12px;font-size:12px;{bg}" +
                $"border-left:1px solid #e2e8f0;border-bottom:1px solid #f1f5f9;'>{v}</td>"));
            return
                $"<tr>" +
                $"<td style='padding:6px 12px;{bg}color:#6b7280;font-size:11px;white-space:nowrap;" +
                $"font-weight:500;border-bottom:1px solid #f1f5f9;border-right:2px solid #d1d9e0;'>{param}</td>" +
                cells + "</tr>";
        }

        var rows = new System.Text.StringBuilder();
        rows.Append(DataRow("From",       acts.Select(a => a.StartDate?.ToString("dd-MMM-yyyy") ?? "—"), false));
        rows.Append(DataRow("To",         acts.Select(a => a.EndDate?.ToString("dd-MMM-yyyy")   ?? "—"), true));
        rows.Append(DataRow("No. of Days",daysList.Select(d => $"{d} days"), false));
        rows.Append(DataRow("Lead Target",acts.Select(a => a.LeadTarget.ToString()), true));
        rows.Append(DataRow("Retail Target", acts.Select(a => a.RetailTarget.ToString()), false));
        rows.Append(DataRow("Total Budget (Incl. Taxes)", totals.Select(t => $"Rs. {t:N0}/-"), true));
        rows.Append(DataRow("CPL (from total amount)", cpls.Select(c => $"Rs. {c:N0}/-"), false));

        var cacValues = cacs.Select((c, i) =>
        {
            var over  = c > 4000;
            var style = over ? "color:#dc2626;font-weight:700;" : "";
            var note  = over ? " <em style='font-size:10px;'>(exceeds limit)</em>" : "";
            return $"<span style='{style}'>Rs. {c:N0}/-</span>{note}";
        });
        rows.Append(DataRow("CAC (from total amount)", cacValues, true));

        // Amount for Consideration summary box
        var cacColor   = overallCac > 4000 ? "#fca5a5" : "#e2e8f0";
        var cacNote    = overallCac > 4000 ? " ⚠ exceeds limit" : " (from total amount)";
        var budgetBold = $"<strong style='color:#ffffff;'>Rs. {p.TotalBudget:N0}/- (incl. of taxes)</strong>";

        var amountBox = $"""
            <div style="background:#0a2540;border-radius:8px;padding:16px 20px;margin-bottom:12px;">
              <div style="font-size:14px;font-weight:700;color:#ffffff;margin-bottom:12px;">
                Amount for Consideration (Total)
              </div>
              <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:5px 0;color:#94a3b8;font-size:13px;width:50%;">Total Budget</td>
                  <td style="padding:5px 0;font-size:13px;">{budgetBold}</td>
                </tr>
                <tr>
                  <td style="padding:5px 0;color:#94a3b8;font-size:13px;">Total CPL</td>
                  <td style="padding:5px 0;color:#e2e8f0;font-size:13px;">Rs. {overallCpl:N0}/- (from total amount)</td>
                </tr>
                <tr>
                  <td style="padding:5px 0;color:#94a3b8;font-size:13px;">Total CAC</td>
                  <td style="padding:5px 0;color:{cacColor};font-size:13px;">Rs. {overallCac:N0}/-{cacNote}</td>
                </tr>
              </table>
            </div>
            """;

        return $"""
            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#f8fafc;
                          border:1px solid #d1d9e0;border-radius:6px;overflow:hidden;
                          margin-bottom:12px;font-size:12px;">
              <thead>
                <tr style="background:#e8edf2;">
                  <th style="padding:8px 12px;text-align:left;color:#374151;font-size:11px;
                             font-weight:700;white-space:nowrap;min-width:160px;
                             border-right:2px solid #d1d9e0;border-bottom:1px solid #d1d9e0;">
                    Parameter
                  </th>
                  {headerCols}
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
            {amountBox}
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body builders — all greetings use config-derived first names
    // ─────────────────────────────────────────────────────────────────────────

    // Step 1 — RSM submits → Approver (e.g. Seema)
    private string BuildSubmissionBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var sender   = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks  = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;" +
            $"padding:6px 10px;margin-bottom:10px;font-size:12px;'>" +
            $"<strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#0a2540", "New Proposal — Awaiting Your Review", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {approver},<br/>
              New BTL proposal submitted by <strong>{sender}</strong> —
              please review before forwarding to {final}.</p>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {remarks}
            {LinkBtn(link, "🔍 Review in Portal")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Thanks &amp; Regards · <strong>{sender}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    // Step 2 — Approver forwards → Final Approver (e.g. Durgesh)
    private string BuildCheckerForwardBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var link     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks  = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;" +
            $"padding:6px 10px;margin-bottom:10px;font-size:12px;'>" +
            $"<strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#1e3a5f", $"Forwarded for Final Approval — Reviewed by {approver}", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {final},<br/>
              Please find below the working for CN reviewed and forwarded by {approver}.</p>
            {BuildProposalInfoTable(p)}
            {BuildCrossTabActivityTable(p)}
            {remarks}
            <p style="margin:0 0 8px;font-size:12px;color:#374151;">
              @{final} — please approve/reject this proposal in the portal.</p>
            {LinkBtn(link, "✅ Click Here to Review", "#166534")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Thanks &amp; Regards · <strong>{approver}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    // Step 3a — Final Approver decides → Approver + CC RSM
    private string BuildDecisionBody(Proposal p, ApprovalDecision decision)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var ok       = decision.Status == "Approved";
        var color    = ok ? "#166534" : "#991B1B";
        var bg       = ok ? "#f0fdf4" : "#fef2f2";
        var border   = ok ? "#bbf7d0" : "#fecaca";
        var link     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var note     = string.IsNullOrWhiteSpace(decision.ApproverNote) ? "" :
            $"<div style='background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;" +
            $"padding:6px 10px;margin-bottom:10px;font-size:12px;'>" +
            $"<strong>{final}'s Note:</strong> {decision.ApproverNote}</div>";
        var hint     = ok
            ? $"<div style='background:#eff6ff;border-left:3px solid #3b82f6;border-radius:4px;" +
              $"padding:6px 10px;margin-bottom:10px;font-size:12px;color:#1e40af;'>" +
              $"ℹ Next step: use the <strong>Notify Dealer</strong> button in the portal to send " +
              $"activity details to <strong>{p.DealerName}</strong>.</div>" : "";

        return Shell(ok ? "#166534" : "#991B1B",
            $"Final Decision — Proposal {decision.Status}", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 10px;font-size:13px;">Hi {approver},<br/>
              {final} has <strong>{decision.Status.ToLower()}</strong> the proposal below.
              RSM is CC'd on this mail.</p>
            <div style="background:{bg};border:1px solid {border};border-left:3px solid {color};
                         border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:13px;">
              <strong style="color:{color};">{(ok ? "✓" : "✕")} Proposal {decision.Status}</strong>
              <span style="color:#6b7280;margin-left:10px;">
                {p.DealerName} · {p.Location}, {p.State} · {p.Month}
              </span>
            </div>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {note}{hint}
            {LinkBtn(link, "View Proposal in Portal")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Regards · <strong>BGauss BTL System</strong></p>
            """);
    }

    // Step 3b — Final Approver sends back → Approver + CC RSM
    private string BuildRevisionBody(Proposal p, string? note)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var editLink = $"{_settings.PortalBaseUrl}/rsm-form?edit={p.Id}";
        var noteHtml = string.IsNullOrWhiteSpace(note) ? "" :
            $"<div style='background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;" +
            $"padding:6px 10px;margin-bottom:10px;font-size:12px;'>" +
            $"<strong>{final}'s Note:</strong> {note}</div>";

        return Shell("#92400e", "Revision Requested by Final Approver", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 10px;font-size:13px;">Hi {approver},<br/>
              {final} has requested revisions. Please coordinate with RSM
              <strong>{p.SubmittedByDisplayName ?? p.RsmName}</strong>.</p>
            {BuildProposalInfoTable(p)}
            {noteHtml}
            {BuildActivityTable(p)}
            {LinkBtn(editLink, "✏ Edit & Resubmit", "#92400e")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Regards · <strong>BGauss BTL System</strong></p>
            """);
    }

    // Step 3c — RSM resubmits → Approver
    private string BuildResubmissionBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var sender   = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks  = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;" +
            $"padding:6px 10px;margin-bottom:10px;font-size:12px;'>" +
            $"<strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#1e3a5f", "Resubmitted — Awaiting Your Review", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {approver},<br/>
              <strong>{sender}</strong> has resubmitted after revisions —
              please review and forward to {final}.</p>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {remarks}
            {LinkBtn(link, "🔍 Review Resubmission")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Thanks &amp; Regards · <strong>{sender}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    // Step 4 — Dealer notification (cross-tab format)
    private string BuildDealerNotificationBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        return Shell("#0a2540", "Approved BTL Activity Plan — Action Required", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 10px;font-size:13px;">Dear <strong>{p.DealerName}</strong> Team,<br/>
              The approved BTL activity plan for your dealership is below.
              Please <strong>reply to this email</strong> to:</p>
            <ul style="font-size:12px;color:#374151;margin:0 0 12px;padding-left:18px;">
              <li style="margin-bottom:4px;">
                <strong>Approve</strong> — reply "Approved" to confirm alignment.</li>
              <li>
                <strong>Request budget addition</strong> — reply with your request &amp; justification.</li>
            </ul>
            {BuildProposalInfoTable(p)}
            {BuildCrossTabActivityTable(p)}
            <div style="background:#eff6ff;border-left:3px solid #3b82f6;border-radius:4px;
                         padding:6px 10px;margin-bottom:10px;font-size:12px;color:#1e40af;">
              <strong>Action Required</strong> — Activities begin only after your confirmation.
            </div>
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Thanks &amp; Regards · <strong>{approver}</strong> · BGauss Auto Pvt. Ltd.<br/>
              <span style="color:#9ca3af;">RSM contact: {p.RsmName} ({p.SubmittedBy})</span></p>
            """);
    }

    // Dealer budget add-on request → Approver
    private string BuildDealerSendBackBody(Proposal p, string dealerEmail, string requestNote)
    {
        var approver = _settings.ApproverFirstName;
        return Shell("#92400e", "Dealer Budget Add-On Request", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {approver},<br/>
              The dealer <strong>{p.DealerName}</strong> has reviewed the approved activity plan
              and is requesting a budget addition. Details below.</p>

            <div style="background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;
                        padding:10px 14px;margin-bottom:12px;font-size:13px;">
              <strong>Dealer's Request:</strong><br/>
              <span style="color:#78350f;white-space:pre-wrap;">{requestNote}</span>
            </div>

            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}

            <div style="background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;
                        padding:6px 10px;margin-bottom:10px;font-size:12px;color:#991b1b;">
              <strong>Action Required</strong> — Please review this request and coordinate with the dealer
              ({dealerEmail}) and RSM ({p.RsmName}, {p.SubmittedBy}).
            </div>

            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Dealer contact: <strong>{p.DealerName}</strong>
              (<a href="mailto:{dealerEmail}" style="color:#1e3a5f;">{dealerEmail}</a>)<br/>
              RSM contact: {p.RsmName} ({p.SubmittedBy})
            </p>
            """);
    }
}

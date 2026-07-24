// Backend/Services/GraphEmailService.cs
using System.Net.Http.Headers;
using System.Net.Http.Json;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;
using BGL_BT_App.Backend.DTOs;

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

    public string ApproverFirstName =>
        FirstName(ApproverEmail);

    public string FinalApproverFirstName =>
        FirstName(FinalApproverEmail);

    private static string FirstName(string email)
    {
        if (string.IsNullOrWhiteSpace(email)) return "Team";
        var local = email.Split('@')[0];
        var first = local.Split('.')[0];
        return char.ToUpper(first[0]) + first[1..];
    }
}

public class GraphEmailService : IEmailService
{
    private readonly HttpClient                 _http;
    private readonly SmtpSettings              _settings;
    private readonly ILogger<GraphEmailService> _logger;
    private readonly IConfiguration            _config;

    public GraphEmailService(
        HttpClient http,
        IOptions<SmtpSettings> settings,
        ILogger<GraphEmailService> logger,
        IConfiguration config)
    {
        _http     = http;
        _settings = settings.Value;
        _logger   = logger;
        _config   = config;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC INTERFACE METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    // Step 1: RSM submits → Checker (Seema)
    public Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal p, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, null,
            BuildSubject("New Proposal", p), BuildSubmissionBody(p));

    // Step 2: Checker forwards → Final Approver (Vijay)
    public Task<(bool Sent, string? Error)> SendCheckerForwardMailAsync(Proposal p, string graphToken) =>
        SendAsync(graphToken, _settings.FinalApproverEmail, _settings.ApproverEmail,
            BuildSubject("Forwarded for Approval", p), BuildCheckerForwardBody(p));

    // Step 3a: Final Approver decides → Checker + CC RSM
    public Task<(bool Sent, string? Error)> SendDecisionMailAsync(
        Proposal p, ApprovalDecision decision, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, p.SubmittedBy,
            BuildSubject($"Re: Proposal {decision.Status}", p), BuildDecisionBody(p, decision));

    // Step 3b: Send back for revision → Checker + CC RSM
    public Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(
        Proposal p, string? note, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, p.SubmittedBy,
            BuildSubject("Revision Requested", p), BuildRevisionBody(p, note));

    // Step 3c: RSM resubmits → Checker
    public Task<(bool Sent, string? Error)> SendResubmissionMailAsync(Proposal p, string graphToken) =>
        SendAsync(graphToken, _settings.ApproverEmail, null,
            BuildSubject("Resubmitted for Review", p), BuildResubmissionBody(p));

    // Step 4: Notify Dealer (after approval) → Dealer + CC Seema + RSM
    public Task<(bool Sent, string? Error)> SendDealerNotificationMailAsync(
        Proposal p, string dealerEmail, string graphToken)
    {
        if (string.IsNullOrWhiteSpace(dealerEmail))
            return Task.FromResult<(bool, string?)>((false, "No dealer email provided."));
        return SendAsync(graphToken, dealerEmail,
            $"{_settings.ApproverEmail},{p.SubmittedBy}",
            BuildSubject("Activity Proposal Approved — Your Action Required", p),
            BuildDealerNotificationBody(p));
    }

    // Step 5: Dealer requests budget addition → Checker (Seema) + CC RSM
    public Task<(bool Sent, string? Error)> SendDealerSendBackMailAsync(
        Proposal p, string dealerEmail, string requestNote, string graphToken) =>
        SendAsync(graphToken,
            to:      _settings.ApproverEmail,
            cc:      p.SubmittedBy,
            subject: BuildSubject("Budget Add-On Request from Dealer", p),
            body:    BuildDealerSendBackBody(p, dealerEmail, requestNote));

    // Step 6: Checker forwards → Final Approver
    // When Email:SuppressIndividualForwardMails = "true", this method is a NO-OP.
    // Instead, the Checker should use the bulk-forward panel which calls
    // SendConsolidatedForwardSummaryAsync once for all forwarded proposals.
    public async Task SendForwardEmailAsync(ProposalResponseDto proposal, string checkerName)
    {
        // ── SUPPRESSION CHECK ────────────────────────────────────────────────
        // If suppress flag is on, skip individual forward mails entirely.
        // Only the consolidated summary (state-wise) should be sent.
        var suppress = _config["Email:SuppressIndividualForwardMails"];
        if (suppress?.Equals("true", StringComparison.OrdinalIgnoreCase) == true)
        {
            _logger.LogInformation(
                "Individual forward mail suppressed for {Token} (SuppressIndividualForwardMails=true)",
                proposal.TokenNumber);
            return; // NO-OP — consolidated mail sent separately by the Checker
        }
        // ── SEND (only reaches here when suppress=false) ─────────────────────
        var finalApproverEmail = _config["FinalApproverEmail"] ?? _settings.FinalApproverEmail;
        var approverEmail      = _config["ApproverEmail"]      ?? _settings.ApproverEmail;
        var portalUrl          = _config["PortalUrl"]          ?? _settings.PortalBaseUrl;

        var subject = $"[BTL Approval] Final Review Required — {proposal.DealerName} ({proposal.Month})";
        var body    = BuildForwardSummaryBody(proposal, checkerName, portalUrl, isBudgetAddition: false);

        await SendEmailAsync(
            to:      finalApproverEmail,
            subject: subject,
            body:    body,
            cc:      new[] { approverEmail }
        );
    }

    // Step 6b: Consolidated state-wise summary — Checker sends ONE email covering ALL
    // forwarded proposals for a state/batch. Called manually from the portal "📤 Send Summary" button.
    public async Task SendConsolidatedForwardSummaryAsync(
        IEnumerable<ProposalResponseDto> proposals,
        string checkerName,
        string graphToken)
    {
        var finalApproverEmail = _config["FinalApproverEmail"] ?? _settings.FinalApproverEmail;
        var approverEmail      = _config["ApproverEmail"]      ?? _settings.ApproverEmail;
        var portalUrl          = _config["PortalUrl"]          ?? _settings.PortalBaseUrl;

        var proposalList = proposals.ToList();
        if (!proposalList.Any()) return;

        // Group by State for the subject
        var states   = string.Join(", ", proposalList.Select(p => p.State).Distinct().Take(4));
        var months   = proposalList.Select(p => p.Month).Distinct().FirstOrDefault() ?? "—";
        var subject  = $"[BTL Approval] {proposalList.Count} Proposals Ready for Final Approval — {states} · {months}";

        var body = BuildConsolidatedSummaryBody(proposalList, checkerName, portalUrl);

        await SendAsync(graphToken, finalApproverEmail, approverEmail, subject, body);
    }

    // Step 7: Checker sends budget addition for re-approval → Final Approver
    // Called when Mayank fills additional budget amounts and clicks "Save & Submit for Re-Approval"
    public async Task SendBudgetAdditionEmailAsync(
        ProposalResponseDto proposal,
        string checkerName,
        Dictionary<string, decimal> additionalAmounts,
        string? checkerNote)
    {
        var finalApproverEmail = _config["FinalApproverEmail"] ?? _settings.FinalApproverEmail;
        var approverEmail      = _config["ApproverEmail"]      ?? _settings.ApproverEmail;
        var portalUrl          = _config["PortalUrl"]          ?? _settings.PortalBaseUrl;

        var subject = $"[BTL Budget Addition] Re-Approval Required — {proposal.DealerName} ({proposal.Month})";
        var body    = BuildBudgetAdditionBody(proposal, checkerName, additionalAmounts, checkerNote, portalUrl);

        await SendEmailAsync(
            to:      finalApproverEmail,
            subject: subject,
            body:    body,
            cc:      new[] { approverEmail }
        );
    }

    // Step 8: Checker sends revision email to Maker
    public async Task SendRevisionEmailAsync(
        ProposalResponseDto proposal, string checkerNote, string makerEmail)
    {
        var portalUrl = _config["PortalUrl"] ?? _settings.PortalBaseUrl;
        var subject   = $"[BTL] Your Proposal Needs Revision — {proposal.DealerName} ({proposal.Month})";
        var body      = BuildRevisionToMakerBody(proposal, checkerNote, portalUrl);
        await SendEmailAsync(to: makerEmail, subject: subject, body: body);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE SEND
    // ═══════════════════════════════════════════════════════════════════════════

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

    private Task<(bool Sent, string? Error)> SendEmailAsync(
        string to, string subject, string body,
        string[]? cc = null, string graphToken = "")
    {
        var ccStr = cc is { Length: > 0 } ? string.Join(",", cc) : null;
        return SendAsync(graphToken, to, ccStr, subject, body);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HTML HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

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
                <td style="{lbl}">RSM</td>
                <td style="{val}{sep}">{p.RsmName}</td>
                <td style="{lbl}">TSM</td>
                <td style="{val}">{tsmName}</td>
              </tr>
              <tr style="background:#fff;">
                <td style="{lbl}">Commando</td>
                <td style="{val}{sep}">{commando}</td>
                <td style="{lbl}">Eligibility</td>
                <td style="{val}">{p.Eligibility}</td>
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
            var addBudget = a.AdditionalBudget > 0
                ? $" <span style='color:#f59e0b;font-size:10px;'>+{a.AdditionalBudget:N0}</span>" : "";

            rows.Append(
                "<tr>" +
                $"<td style='padding:5px 8px;font-weight:600;color:#0a2540;border-bottom:1px solid #f1f5f9;white-space:nowrap;'>{a.ActivityType}</td>" +
                $"<td style='padding:5px 8px;text-align:center;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap;'>{a.StartDate?.ToString("dd-MMM") ?? "—"} → {a.EndDate?.ToString("dd-MMM-yyyy") ?? "—"}</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{days}d</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{a.LeadTarget}</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{a.RetailTarget}</td>" +
                $"<td style='padding:5px 8px;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;'>Rs.{total:N0}/-{addBudget}</td>" +
                $"<td style='padding:5px 8px;text-align:right;color:#6b7280;border-bottom:1px solid #f1f5f9;'>Rs.{cpl:N0}/-</td>" +
                $"<td style='padding:5px 8px;text-align:right;color:{cacCol};border-bottom:1px solid #f1f5f9;font-weight:{( cac > 4000 ? "700" : "400" )};'>" +
                $"Rs.{cac:N0}/-{( cac > 4000 ? " <em style='font-size:9px;'>(⚠ over)</em>" : "" )}</td>" +
                "</tr>");
        }

        rows.Append(
            "<tr style='background:#f0fdf4;'>" +
            "<td style='padding:5px 8px;font-weight:700;color:#166534;' colspan='3'>Totals</td>" +
            $"<td style='padding:5px 8px;text-align:center;font-weight:700;color:#166534;'>{p.TotalLeadTarget}</td>" +
            $"<td style='padding:5px 8px;text-align:center;font-weight:700;color:#166534;'>{p.TotalRetailTarget}</td>" +
            $"<td style='padding:5px 8px;text-align:right;font-weight:700;color:#0a2540;'>Rs.{p.TotalBudget:N0}/-</td>" +
            $"<td style='padding:5px 8px;text-align:right;font-weight:700;color:#166534;'>Rs.{overallCpl:N0}/-</td>" +
            $"<td style='padding:5px 8px;text-align:right;font-weight:700;color:{( overallCac > 4000 ? "#dc2626" : "#166534" )};'>Rs.{overallCac:N0}/-</td>" +
            "</tr>");

        return $"""
            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#fff;
                          border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;
                          margin-bottom:12px;font-size:12px;">
              <thead>
                <tr style="background:#0a2540;">
                  <th style="padding:6px 8px;text-align:left;color:#e2e8f0;font-size:10px;white-space:nowrap;">Activity</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Dates</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Days</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Lead</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Retail</th>
                  <th style="padding:6px 8px;text-align:right;color:#e2e8f0;font-size:10px;">Budget</th>
                  <th style="padding:6px 8px;text-align:right;color:#e2e8f0;font-size:10px;">CPL</th>
                  <th style="padding:6px 8px;text-align:right;color:#e2e8f0;font-size:10px;">CAC</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
            """;
    }

    private static string BuildCrossTabActivityTable(Proposal p)
    {
        var overallCac = p.TotalRetailTarget > 0 ? Math.Round(p.TotalBudget / (decimal)p.TotalRetailTarget, 0) : 0;
        var overallCpl = p.TotalLeadTarget   > 0 ? Math.Round(p.TotalBudget / (decimal)p.TotalLeadTarget,   0) : 0;

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
            a.LeadTarget > 0 ? Math.Round(totals[i] / (decimal)a.LeadTarget, 0) : 0).ToList();

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
                $"<tr><td style='padding:6px 12px;{bg}color:#6b7280;font-size:11px;" +
                $"white-space:nowrap;font-weight:500;border-bottom:1px solid #f1f5f9;" +
                $"border-right:2px solid #d1d9e0;'>{param}</td>{cells}</tr>";
        }

        var rows = new System.Text.StringBuilder();
        rows.Append(DataRow("From",          acts.Select(a => a.StartDate?.ToString("dd-MMM-yyyy") ?? "—"), false));
        rows.Append(DataRow("To",            acts.Select(a => a.EndDate?.ToString("dd-MMM-yyyy")   ?? "—"), true));
        rows.Append(DataRow("No. of Days",   daysList.Select(d => $"{d} days"),                            false));
        rows.Append(DataRow("Lead Target",   acts.Select(a => a.LeadTarget.ToString()),                    true));
        rows.Append(DataRow("Retail Target", acts.Select(a => a.RetailTarget.ToString()),                  false));
        rows.Append(DataRow("Total Budget",  totals.Select(t => $"Rs. {t:N0}/-"),                          true));
        rows.Append(DataRow("CPL",           cpls.Select(c => $"Rs. {c:N0}/-"),                            false));
        rows.Append(DataRow("CAC",           cacs.Select(c =>
        {
            var over  = c > 4000;
            return $"<span style='{( over ? "color:#dc2626;font-weight:700;" : "" )}'>" +
                   $"Rs. {c:N0}/-</span>{( over ? " ⚠" : "" )}";
        }), true));

        var cacColor  = overallCac > 4000 ? "#fca5a5" : "#e2e8f0";
        var cacNote   = overallCac > 4000 ? " ⚠ exceeds limit" : "";
        var amountBox = $"""
            <div style="background:#0a2540;border-radius:8px;padding:16px 20px;margin-bottom:12px;">
              <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:10px;">Amount for Consideration (Total)</div>
              <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:4px 0;color:#94a3b8;font-size:13px;width:50%">Total Budget</td>
                    <td style="padding:4px 0;font-weight:700;color:#fff;font-size:14px;">Rs. {p.TotalBudget:N0}/- (incl. taxes)</td></tr>
                <tr><td style="padding:4px 0;color:#94a3b8;font-size:13px;">Total CPL</td>
                    <td style="padding:4px 0;color:#e2e8f0;font-size:13px;">Rs. {overallCpl:N0}/-</td></tr>
                <tr><td style="padding:4px 0;color:#94a3b8;font-size:13px;">Total CAC</td>
                    <td style="padding:4px 0;color:{cacColor};font-size:13px;">Rs. {overallCac:N0}/-{cacNote}</td></tr>
              </table>
            </div>
            """;

        return $"""
            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#f8fafc;
                          border:1px solid #d1d9e0;border-radius:6px;overflow:hidden;margin-bottom:12px;font-size:12px;">
              <thead>
                <tr style="background:#e8edf2;">
                  <th style="padding:8px 12px;text-align:left;color:#374151;font-size:11px;
                             font-weight:700;white-space:nowrap;min-width:160px;
                             border-right:2px solid #d1d9e0;border-bottom:1px solid #d1d9e0;">Parameter</th>
                  {headerCols}
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
            {amountBox}
            """;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BODY BUILDERS
    // ═══════════════════════════════════════════════════════════════════════════

    // 1. RSM submits → Checker
    private string BuildSubmissionBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var sender   = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks  = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#0a2540", "New Proposal — Awaiting Your Review", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {approver},<br/>
              New BTL proposal submitted by <strong>{sender}</strong> — please review before forwarding to {final}.</p>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {remarks}
            {LinkBtn(link, "🔍 Review in Portal")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Thanks &amp; Regards · <strong>{sender}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    // 2. Checker forwards → Final Approver
    private string BuildCheckerForwardBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var link     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks  = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#1e3a5f", $"Forwarded for Final Approval — Reviewed by {approver}", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {final},<br/>
              Please find below the proposal reviewed and forwarded by {approver}.</p>
            {BuildProposalInfoTable(p)}
            {BuildCrossTabActivityTable(p)}
            {remarks}
            {LinkBtn(link, "✅ Click Here to Review &amp; Approve", "#166534")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Thanks &amp; Regards · <strong>{approver}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    // 3a. Final Approver decides → Checker + CC RSM
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
            $"<div style='background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>Note:</strong> {decision.ApproverNote}</div>";
        var hint     = ok
            ? $"<div style='background:#eff6ff;border-left:3px solid #3b82f6;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;color:#1e40af;'>ℹ Next step: use the <strong>Notify Dealer</strong> button in the portal to send activity details to <strong>{p.DealerName}</strong>.</div>"
            : "";

        return Shell(ok ? "#166534" : "#991B1B", $"Final Decision — Proposal {decision.Status}", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 10px;font-size:13px;">Hi {approver},<br/>
              {final} has <strong>{decision.Status.ToLower()}</strong> the proposal below. RSM is CC'd.</p>
            <div style="background:{bg};border:1px solid {border};border-left:3px solid {color};border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:13px;">
              <strong style="color:{color};">{( ok ? "✓" : "✕" )} Proposal {decision.Status}</strong>
              <span style="color:#6b7280;margin-left:10px;">{p.DealerName} · {p.Location}, {p.State} · {p.Month}</span>
            </div>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {note}{hint}
            {LinkBtn(link, "View Proposal in Portal")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Regards · <strong>BGauss BTL System</strong></p>
            """);
    }

    // 3b. Send back for revision → Checker + CC RSM
    private string BuildRevisionBody(Proposal p, string? note)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var editLink = $"{_settings.PortalBaseUrl}/rsm-form?edit={p.Id}";
        var noteHtml = string.IsNullOrWhiteSpace(note) ? "" :
            $"<div style='background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>Note:</strong> {note}</div>";

        return Shell("#92400e", "Revision Requested by Final Approver", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 10px;font-size:13px;">Hi {approver},<br/>
              {final} has requested revisions. Please coordinate with RSM <strong>{p.SubmittedByDisplayName ?? p.RsmName}</strong>.</p>
            {BuildProposalInfoTable(p)}
            {noteHtml}
            {BuildActivityTable(p)}
            {LinkBtn(editLink, "✏ Edit &amp; Resubmit", "#92400e")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Regards · <strong>BGauss BTL System</strong></p>
            """);
    }

    // 3c. RSM resubmits → Checker
    private string BuildResubmissionBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        var final    = _settings.FinalApproverFirstName;
        var sender   = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks  = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#1e3a5f", "Resubmitted — Awaiting Your Review", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {approver},<br/>
              <strong>{sender}</strong> has resubmitted after revisions — please review and forward to {final}.</p>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {remarks}
            {LinkBtn(link, "🔍 Review Resubmission")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Thanks &amp; Regards · <strong>{sender}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    // 4. Dealer notification (cross-tab) → Dealer + CC Seema + RSM
    private string BuildDealerNotificationBody(Proposal p)
    {
        var approver = _settings.ApproverFirstName;
        return Shell("#0a2540", "Approved BTL Activity Plan — Action Required", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 10px;font-size:13px;">Dear <strong>{p.DealerName}</strong> Team,<br/>
              The approved BTL activity plan for your dealership is below. Please <strong>reply to this email</strong> to:</p>
            <ul style="font-size:12px;color:#374151;margin:0 0 12px;padding-left:18px;">
              <li style="margin-bottom:4px;"><strong>Approve</strong> — reply "Approved" to confirm alignment.</li>
              <li><strong>Request budget addition</strong> — reply with your request &amp; justification.</li>
            </ul>
            {BuildProposalInfoTable(p)}
            {BuildCrossTabActivityTable(p)}
            <div style="background:#eff6ff;border-left:3px solid #3b82f6;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;color:#1e40af;">
              <strong>Action Required</strong> — Activities begin only after your confirmation.
            </div>
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Thanks &amp; Regards · <strong>{approver}</strong> · BGauss Auto Pvt. Ltd.<br/>
              <span style="color:#9ca3af;">RSM contact: {p.RsmName} ({p.SubmittedBy})</span></p>
            """);
    }

    // 5. Dealer budget add-on request → Checker (Seema)
    private string BuildDealerSendBackBody(Proposal p, string dealerEmail, string requestNote)
    {
        var approver = _settings.ApproverFirstName;
        return Shell("#92400e", "Dealer Budget Add-On Request", p.TokenNumber ?? "",
            $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {approver},<br/>
              <strong>{p.DealerName}</strong> has reviewed the approved activity plan and is requesting a budget addition.</p>
            <div style="background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;padding:10px 14px;margin-bottom:12px;font-size:13px;">
              <strong>Dealer's Request:</strong><br/>
              <span style="color:#78350f;white-space:pre-wrap;">{requestNote}</span>
            </div>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            <div style="background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;color:#991b1b;">
              <strong>Action Required</strong> — Open the portal, fill in the additional budget amounts per activity, and submit for Final Approver's re-approval.
            </div>
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Dealer: <strong>{p.DealerName}</strong> (<a href="mailto:{dealerEmail}" style="color:#1e3a5f;">{dealerEmail}</a>)<br/>
              RSM: {p.RsmName} ({p.SubmittedBy})
            </p>
            """);
    }

    // 6. Forward summary to Final Approver (ONE consolidated email)
    private string BuildForwardSummaryBody(
        ProposalResponseDto proposal, string checkerName,
        string portalUrl, bool isBudgetAddition)
    {
        var headerColor = isBudgetAddition ? "#f59e0b" : "#0a2540";
        var tag         = isBudgetAddition ? "Budget Addition — Re-Approval Required" : "BTL Proposal — Final Approval Required";
        var tsmDisplay  = proposal.TsmName ?? "—";

        var activitiesHtml = string.Join("\n", proposal.Activities.Select((a, i) =>
            $"""
            <tr style="background:{( i%2==0?"#f8fafc":"#fff" )}">
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">{i+1}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-weight:600">{a.ActivityType ?? "—"}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px">{a.StartDate:dd-MMM-yyyy} → {a.EndDate:dd-MMM-yyyy}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">₹{(a.Budget + a.AdditionalBudget):N0}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center">{a.RetailTarget}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center">{a.LeadTarget}</td>
            </tr>
            """));

        return $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;
                    background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <div style="background:{headerColor};padding:20px 28px">
            <div style="color:#fff;font-size:18px;font-weight:700">{tag}</div>
            <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">
              {( isBudgetAddition ? "Budget addition filled by" : "Reviewed by" )} {checkerName} · {DateTime.Now:dd-MMM-yyyy HH:mm}
            </div>
          </div>
          <div style="padding:24px 28px">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr><td style="color:#64748b;font-size:12px;padding:4px 0;width:140px">Dealer</td>
                  <td style="font-weight:700;font-size:15px;color:#0a2540">{proposal.DealerName}</td></tr>
              <tr><td style="color:#64748b;font-size:12px;padding:4px 0">Location</td>
                  <td style="font-size:13px;color:#374151">{proposal.Location}, {proposal.State}</td></tr>
              <tr><td style="color:#64748b;font-size:12px;padding:4px 0">Month</td>
                  <td style="font-size:13px;color:#374151">{proposal.Month}</td></tr>
              <tr><td style="color:#64748b;font-size:12px;padding:4px 0">RSM / TSM</td>
                  <td style="font-size:13px;color:#374151">{proposal.RsmName ?? "—"} / {tsmDisplay}</td></tr>
              <tr><td style="color:#64748b;font-size:12px;padding:4px 0">Token</td>
                  <td style="font-family:monospace;font-size:13px;color:#1e3a5f">{proposal.TokenNumber}</td></tr>
            </table>

            <div style="display:flex;gap:10px;margin-bottom:20px">
              <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;text-align:center">
                <div style="font-size:11px;color:#166534;font-weight:600">Total Budget</div>
                <div style="font-size:20px;font-weight:800;color:#15803d">₹{proposal.TotalBudget:N0}</div>
              </div>
              <div style="flex:1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;text-align:center">
                <div style="font-size:11px;color:#1e40af;font-weight:600">Retail Target</div>
                <div style="font-size:20px;font-weight:800;color:#1d4ed8">{proposal.TotalRetailTarget}</div>
              </div>
              <div style="flex:1;background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;text-align:center">
                <div style="font-size:11px;color:#92400e;font-weight:600">Lead Target</div>
                <div style="font-size:20px;font-weight:800;color:#b45309">{proposal.TotalLeadTarget}</div>
              </div>
              <div style="flex:1;background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px 16px;text-align:center">
                <div style="font-size:11px;color:#6b21a8;font-weight:600">Activities</div>
                <div style="font-size:20px;font-weight:800;color:#7c3aed">{proposal.Activities.Count}</div>
              </div>
            </div>

            <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px">
              Activities ({proposal.Activities.Count})
            </div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px">
              <thead><tr style="background:#0a2540">
                <th style="color:#fff;font-size:11px;padding:8px 10px;text-align:left;width:30px">#</th>
                <th style="color:#fff;font-size:11px;padding:8px 10px;text-align:left">Activity</th>
                <th style="color:#fff;font-size:11px;padding:8px 10px;text-align:left">Dates</th>
                <th style="color:#fff;font-size:11px;padding:8px 10px;text-align:right">Budget</th>
                <th style="color:#fff;font-size:11px;padding:8px 10px;text-align:center">Retail</th>
                <th style="color:#fff;font-size:11px;padding:8px 10px;text-align:center">Lead</th>
              </tr></thead>
              <tbody>{activitiesHtml}</tbody>
            </table>

            {( !string.IsNullOrWhiteSpace(proposal.CheckerRemarks) ? $"""
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px">
              <div style="font-size:11px;color:#92400e;font-weight:700;margin-bottom:4px">Checker / Manager Note</div>
              <div style="font-size:13px;color:#78350f">{proposal.CheckerRemarks}</div>
            </div>
            """ : "" )}

            <div style="text-align:center;margin-top:24px">
              <a href="{portalUrl}/approver?proposal={proposal.Id}"
                style="background:{headerColor};color:#fff;text-decoration:none;
                        padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">
                View Full Details in Portal →
              </a>
              <p style="font-size:11px;color:#94a3b8;margin-top:12px">
                Individual activity details, uploaded files, and approval history are in the BTL Portal.
              </p>
            </div>
          </div>
          <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;font-size:11px;color:#94a3b8;text-align:center">
            BGauss BTL Activity Management System ·
            <a href="{portalUrl}" style="color:#2563eb">Open Portal</a>
          </div>
        </div>
        """;
    }

    // NEW: 7. Budget addition re-approval → Final Approver
    // Shows the dealer's original request + Mayank's filled additional amounts
    private string BuildBudgetAdditionBody(
        ProposalResponseDto proposal,
        string checkerName,
        Dictionary<string, decimal> additionalAmounts,
        string? checkerNote,
        string portalUrl)
    {
        var totalAdd = additionalAmounts.Values.Sum();
        var newTotal = proposal.TotalBudget + totalAdd;

        var activityRows = string.Join("\n", proposal.Activities.Select((a, i) =>
        {
            var addAmt = additionalAmounts.TryGetValue(a.Id.ToString(), out var amt) ? amt : 0m;
            var newAmt = a.Budget + addAmt;   // both decimal
            var addCls = addAmt > 0 ? "color:#f59e0b;font-weight:700" : "color:#9ca3af";
            return $"""
                <tr style="background:{( i%2==0?"#f8fafc":"#fff" )}">
                  <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0a2540">{a.ActivityType ?? "—"}</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">₹{a.Budget:N0}</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;{addCls}">
                    {( addAmt > 0 ? $"+₹{addAmt:N0}" : "—" )}</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0a2540">₹{newAmt:N0}</td>
                </tr>
                """;
        }));

        var dealerNote = string.IsNullOrWhiteSpace(proposal.DealerSendBackNote) ? "" : $"""
            <div style="background:#fef9c3;border-left:4px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:16px">
              <div style="font-size:11px;color:#92400e;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.04em">Dealer's Original Request</div>
              <div style="font-size:13px;color:#78350f;white-space:pre-wrap">{proposal.DealerSendBackNote}</div>
            </div>
            """;

        var managerNote = string.IsNullOrWhiteSpace(checkerNote) ? "" : $"""
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:16px">
              <div style="font-size:11px;color:#92400e;font-weight:700;margin-bottom:4px">Manager's Note ({checkerName})</div>
              <div style="font-size:13px;color:#78350f">{checkerNote}</div>
            </div>
            """;

        return $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;
                    background:#fff;border:2px solid #f59e0b;border-radius:10px;overflow:hidden">
          <div style="background:#f59e0b;padding:20px 28px">
            <div style="color:#fff;font-size:18px;font-weight:700">↩ Budget Addition Request — Re-Approval Required</div>
            <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:4px">
              Filled by {checkerName} · {DateTime.Now:dd-MMM-yyyy HH:mm}
            </div>
          </div>
          <div style="padding:24px 28px">
            <p style="margin:0 0 16px;font-size:14px;color:#374151">
              <strong>{proposal.DealerName}</strong> has requested additional budget for their approved activity.
              {checkerName} has reviewed the request and filled in the approved additional amounts below.
              Please review and approve/reject.
            </p>

            <!-- Proposal info -->
            <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px;font-size:13px">
              <tr><td style="padding:6px 12px;color:#6b7280;width:130px">Dealer</td><td style="padding:6px 12px;font-weight:700;color:#0a2540">{proposal.DealerName}</td></tr>
              <tr style="background:#fff"><td style="padding:6px 12px;color:#6b7280">Location</td><td style="padding:6px 12px;color:#374151">{proposal.Location}, {proposal.State}</td></tr>
              <tr><td style="padding:6px 12px;color:#6b7280">Month</td><td style="padding:6px 12px;color:#374151">{proposal.Month}</td></tr>
              <tr style="background:#fff"><td style="padding:6px 12px;color:#6b7280">RSM</td><td style="padding:6px 12px;color:#374151">{proposal.RsmName ?? "—"}</td></tr>
            </table>

            {dealerNote}
            {managerNote}

            <!-- Budget breakdown -->
            <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px">Budget Breakdown</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin-bottom:16px">
              <thead><tr style="background:#0a2540">
                <th style="color:#fff;font-size:11px;padding:8px 10px;text-align:left">Activity</th>
                <th style="color:#e2e8f0;font-size:11px;padding:8px 10px;text-align:right">Original Budget</th>
                <th style="color:#fbbf24;font-size:11px;padding:8px 10px;text-align:right">Additional</th>
                <th style="color:#86efac;font-size:11px;padding:8px 10px;text-align:right">New Total</th>
              </tr></thead>
              <tbody>{activityRows}</tbody>
              <tfoot><tr style="background:#0a2540">
                <td style="padding:8px 10px;color:#e2e8f0;font-weight:700">Totals</td>
                <td style="padding:8px 10px;text-align:right;color:#e2e8f0;font-weight:700">₹{proposal.TotalBudget:N0}</td>
                <td style="padding:8px 10px;text-align:right;color:#fbbf24;font-weight:700">+₹{totalAdd:N0}</td>
                <td style="padding:8px 10px;text-align:right;color:#86efac;font-weight:800;font-size:14px">₹{newTotal:N0}</td>
              </tr></tfoot>
            </table>

            <div style="text-align:center;margin-top:24px">
              <a href="{portalUrl}/approver?proposal={proposal.Id}"
                style="background:#f59e0b;color:#fff;text-decoration:none;
                        padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">
                Review &amp; Approve in Portal →
              </a>
            </div>
          </div>
          <div style="background:#fffbeb;border-top:1px solid #fde68a;padding:14px 28px;font-size:11px;color:#94a3b8;text-align:center">
            BGauss BTL Activity Management System ·
            <a href="{portalUrl}" style="color:#2563eb">Open Portal</a>
          </div>
        </div>
        """;
    }

    // 9. Consolidated state-wise summary for final approver
    private string BuildConsolidatedSummaryBody(
        List<ProposalResponseDto> proposals,
        string checkerName,
        string portalUrl)
    {
        var byState = proposals.GroupBy(p => p.State ?? "—").OrderBy(g => g.Key);
        var stateRows = new System.Text.StringBuilder();

        foreach (var grp in byState)
        {
            var totalBudget  = grp.Sum(p => p.TotalBudget);
            var totalRetail  = grp.Sum(p => p.TotalRetailTarget);
            var totalLead    = grp.Sum(p => p.TotalLeadTarget);
            var dealers      = string.Join(", ", grp.Select(p => p.DealerName).Take(5));
            if (grp.Count() > 5) dealers += $" +{grp.Count()-5} more";

            stateRows.Append($"""
                <tr>
                  <td style="padding:8px 12px;font-weight:700;color:#0a2540;border-bottom:1px solid #e2e8f0;white-space:nowrap">{grp.Key}</td>
                  <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">{grp.Count()}</td>
                  <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #e2e8f0;font-weight:600">₹{totalBudget:N0}</td>
                  <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">{totalRetail}</td>
                  <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #e2e8f0">{totalLead}</td>
                  <td style="padding:8px 12px;font-size:11px;color:#6b7280;border-bottom:1px solid #e2e8f0">{dealers}</td>
                </tr>
                """);
        }

        var grandBudget = proposals.Sum(p => p.TotalBudget);
        var grandRetail = proposals.Sum(p => p.TotalRetailTarget);
        var grandLead   = proposals.Sum(p => p.TotalLeadTarget);
        var month       = proposals.FirstOrDefault()?.Month ?? "—";

        return $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:0 auto;
                    background:#fff;border:2px solid #0a2540;border-radius:10px;overflow:hidden">
          <div style="background:#0a2540;padding:20px 28px">
            <div style="color:#fff;font-size:18px;font-weight:700">
              ✅ {proposals.Count} BTL Proposals — Final Approval Required
            </div>
            <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px">
              Reviewed &amp; forwarded by {checkerName} · {month} · {DateTime.Now:dd-MMM-yyyy HH:mm}
            </div>
          </div>
          <div style="padding:24px 28px">
            <p style="margin:0 0 16px;font-size:14px;color:#374151">
              All proposals listed below have been reviewed by the Manager and are ready for your approval.
              Please review each proposal in the portal and take action.
            </p>

            <!-- Summary by state -->
            <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px">State-wise Summary</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px">
              <thead><tr style="background:#0a2540">
                <th style="color:#fff;font-size:11px;padding:8px 12px;text-align:left">State</th>
                <th style="color:#fff;font-size:11px;padding:8px 12px;text-align:center">Proposals</th>
                <th style="color:#fff;font-size:11px;padding:8px 12px;text-align:right">Total Budget</th>
                <th style="color:#fff;font-size:11px;padding:8px 12px;text-align:center">Retail Target</th>
                <th style="color:#fff;font-size:11px;padding:8px 12px;text-align:center">Lead Target</th>
                <th style="color:#fff;font-size:11px;padding:8px 12px;text-align:left">Dealers</th>
              </tr></thead>
              <tbody>{stateRows}</tbody>
              <tfoot><tr style="background:#f0fdf4">
                <td style="padding:8px 12px;font-weight:700;color:#166534">Grand Total</td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;color:#166534">{proposals.Count}</td>
                <td style="padding:8px 12px;text-align:right;font-weight:700;color:#166534">₹{grandBudget:N0}</td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;color:#166534">{grandRetail}</td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;color:#166534">{grandLead}</td>
                <td></td>
              </tr></tfoot>
            </table>

            <div style="text-align:center;margin-top:24px">
              <a href="{portalUrl}/approver" style="background:#0a2540;color:#fff;text-decoration:none;
                        padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">
                Review All Proposals in Portal →
              </a>
            </div>
          </div>
          <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;font-size:11px;color:#94a3b8;text-align:center">
            BGauss BTL Activity Management System ·
            <a href="{portalUrl}" style="color:#2563eb">Open Portal</a>
          </div>
        </div>
        """;
    }

    // 8. Revision email to Maker
    private string BuildRevisionToMakerBody(
        ProposalResponseDto proposal, string checkerNote, string portalUrl)
    {
        return $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#f59e0b;padding:16px 24px;border-radius:10px 10px 0 0">
            <div style="color:#fff;font-size:16px;font-weight:700">⚠ Proposal Sent for Revision</div>
          </div>
          <div style="background:#fff;border:1px solid #fde68a;border-radius:0 0 10px 10px;padding:24px">
            <p style="margin:0 0 16px;color:#374151;font-size:14px">
              Your BTL proposal for <strong>{proposal.DealerName}</strong> ({proposal.Month})
              has been sent back for revision.
            </p>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px">
              <div style="font-size:12px;color:#92400e;font-weight:700;margin-bottom:4px">Changes Required:</div>
              <div style="font-size:13px;color:#78350f">{checkerNote}</div>
            </div>
            <p style="margin:0 0 20px;color:#64748b;font-size:13px">
              Please log into the portal, open this proposal, make the required changes, and re-submit.
            </p>
            <div style="text-align:center">
              <a href="{portalUrl}"
                style="background:#f59e0b;color:#fff;text-decoration:none;
                        padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">
                Open My Proposals →
              </a>
            </div>
          </div>
        </div>
        """;
    }
}

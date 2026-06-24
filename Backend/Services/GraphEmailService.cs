using System.Net.Http.Headers;
using System.Net.Http.Json;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;

namespace BGL_BT_App.Backend.Services;

public class SmtpSettings
{
    public string Host           { get; set; } = string.Empty;
    public int    Port           { get; set; } = 587;
    public string User           { get; set; } = string.Empty;
    public string Password       { get; set; } = string.Empty;
    public string From           { get; set; } = string.Empty;
    public bool   EnableSsl      { get; set; } = true;
    public string ApproverEmail  { get; set; } = string.Empty;
    public string ApproverEmail2 { get; set; } = string.Empty;
    public string PortalBaseUrl  { get; set; } = "https://44.210.115.237";
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

    // ── Submission — send to BOTH approvers ──────────────────────────────────
    public async Task<(bool Sent, string? Error)> SendSubmissionMailAsync(
    Proposal p, string graphToken)
    {
        var subject = p.TokenNumber + "-" +
                    (p.Activities.FirstOrDefault()?.ActivityType ?? "Activity") + "-" +
                    p.DealerName.ToUpper() + "-" + p.Month + "-" + p.State;
        var body    = BuildSubmissionBody(p);

        var t1 = SendViaGraphAsync(graphToken, _settings.ApproverEmail,  subject, body);
        var t2 = !string.IsNullOrWhiteSpace(_settings.ApproverEmail2)
                ? SendViaGraphAsync(graphToken, _settings.ApproverEmail2, subject, body)
                : Task.FromResult<(bool, string?)>((true, null));

        var results = await Task.WhenAll(t1, t2);
        var sent    = results.Any(r => r.Item1);
        var errors  = string.Join("; ", results
                        .Where(r => !r.Item1 && r.Item2 != null)
                        .Select(r => r.Item2));
        return (sent, string.IsNullOrEmpty(errors) ? null : errors);
    }

    // ── Decision — send only to RSM (submitter) ───────────────────────────────
    public Task<(bool Sent, string? Error)> SendDecisionMailAsync(
        Proposal p, ApprovalDecision decision, string graphToken)
    {
        var subject = "Re: " + p.TokenNumber + "-" +
                      (p.Activities.FirstOrDefault()?.ActivityType ?? "Activity") + "-" +
                      p.DealerName.ToUpper() + "-" + p.Month + "-" + p.State;
        return SendViaGraphAsync(graphToken, p.SubmittedBy, subject, BuildDecisionBody(p, decision));
    }

    // ── Revision request — send only to RSM ──────────────────────────────────
    public Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(
        Proposal p, string? note, string graphToken)
    {
        var subject = "Revision Requested - " + p.TokenNumber + " - " +
                      p.DealerName.ToUpper() + " - " + p.Month;
        return SendViaGraphAsync(graphToken, p.SubmittedBy, subject, BuildRevisionBody(p, note));
    }

    // ── Resubmission — send to BOTH approvers ────────────────────────────────
    public async Task<(bool Sent, string? Error)> SendResubmissionMailAsync(
    Proposal p, string graphToken)
    {
        var subject = "Resubmitted - " + p.TokenNumber + " - " +
                    p.DealerName.ToUpper() + " - " + p.Month;
        var body    = BuildResubmissionBody(p);

        var t1 = SendViaGraphAsync(graphToken, _settings.ApproverEmail,  subject, body);
        var t2 = !string.IsNullOrWhiteSpace(_settings.ApproverEmail2)
                ? SendViaGraphAsync(graphToken, _settings.ApproverEmail2, subject, body)
                : Task.FromResult<(bool, string?)>((true, null));

        var results = await Task.WhenAll(t1, t2);
        var sent    = results.Any(r => r.Item1);
        var errors  = string.Join("; ", results
                        .Where(r => !r.Item1 && r.Item2 != null)
                        .Select(r => r.Item2));
        return (sent, string.IsNullOrEmpty(errors) ? null : errors);
    }

    // ── Core send ─────────────────────────────────────────────────────────────
    private async Task<(bool Sent, string? Error)> SendViaGraphAsync(
        string graphToken, string to, string subject, string htmlBody)
    {
        if (string.IsNullOrWhiteSpace(to))
            return (false, "No recipient address.");
        if (string.IsNullOrWhiteSpace(graphToken))
        {
            _logger.LogWarning("No Graph token — skipping mail to {To}", to);
            return (false, "No Graph token supplied.");
        }

        var payload = new
        {
            message = new
            {
                subject,
                body         = new { contentType = "HTML", content = htmlBody },
                toRecipients = new[] { new { emailAddress = new { address = to } } }
            },
            saveToSentItems = true
        };

        using var req = new HttpRequestMessage(
            HttpMethod.Post, "https://graph.microsoft.com/v1.0/me/sendMail")
        {
            Content = JsonContent.Create(payload)
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", graphToken);

        try
        {
            var resp = await _http.SendAsync(req);
            if (resp.IsSuccessStatusCode)
            {
                _logger.LogInformation("Graph mail sent to {To}", to);
                return (true, null);
            }
            var err = await resp.Content.ReadAsStringAsync();
            _logger.LogError("Graph sendMail {Status}: {Error}", resp.StatusCode, err);
            return (false, "Graph error " + resp.StatusCode + ": " + err);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Graph sendMail exception for {To}", to);
            return (false, ex.Message);
        }
    }

    // ── HTML builders ─────────────────────────────────────────────────────────

    private static string H(string tag, string style, string content) =>
        "<" + tag + " style=\"" + style + "\">" + content + "</" + tag + ">";

    private static string Td(string style, string content) => H("td", style, content);
    private static string TdPad(string content) =>
        Td("padding:7px 16px 7px 14px;color:#6b7280;width:160px;font-size:13px;", content);
    private static string TdVal(string content) =>
        Td("padding:7px 0;font-weight:600;font-size:13px;", content);

    private static string BuildActivityTableRows(Proposal p)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var a in p.Activities)
        {
            var total    = a.Budget + a.Incentive;
            var days     = (a.EndDate.HasValue && a.StartDate.HasValue)
                           ? (a.EndDate.Value.DayNumber - a.StartDate.Value.DayNumber + 1) : 0;
            var fromDate = a.StartDate?.ToString("dd-MMM-yyyy") ?? "-";
            var toDate   = a.EndDate?.ToString("dd-MMM-yyyy")   ?? "-";
            var cac      = a.Target > 0 ? Math.Round(total / (decimal)a.Target, 0) : 0;
            sb.Append("<tr>");
            sb.Append(Td("padding:9px 12px;font-weight:600;color:#0a2540;border-bottom:1px solid #f1f5f9;", a.ActivityType));
            sb.Append(Td("padding:9px 12px;color:#374151;border-bottom:1px solid #f1f5f9;", fromDate));
            sb.Append(Td("padding:9px 12px;color:#374151;border-bottom:1px solid #f1f5f9;", toDate));
            sb.Append(Td("padding:9px 12px;text-align:center;color:#374151;border-bottom:1px solid #f1f5f9;", days + "d"));
            sb.Append(Td("padding:9px 12px;font-weight:600;color:#0a2540;border-bottom:1px solid #f1f5f9;", "Rs." + total.ToString("N0")));
            sb.Append(Td("padding:9px 12px;text-align:center;border-bottom:1px solid #f1f5f9;", a.Target.ToString()));
            sb.Append(Td("padding:9px 12px;color:#6b7280;border-bottom:1px solid #f1f5f9;", "Rs." + cac.ToString("N0")));
            sb.Append("</tr>");
        }
        return sb.ToString();
    }

    private static string BuildActivityTable(Proposal p)
    {
        var rows = BuildActivityTableRows(p);
        var cac  = p.TotalTarget > 0 ? Math.Round(p.TotalBudget / (decimal)p.TotalTarget, 0) : 0;
        return
            "<p style=\"margin:0 0 8px;font-size:12px;font-weight:700;color:#0a2540;text-transform:uppercase;\">Activities</p>" +
            "<table cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px;font-size:13px;\">" +
            "<thead><tr style=\"background:#0a2540;\">" +
            "<th style=\"padding:9px 12px;text-align:left;color:#e2e8f0;font-size:11px;\">Activity</th>" +
            "<th style=\"padding:9px 12px;text-align:left;color:#e2e8f0;font-size:11px;\">From</th>" +
            "<th style=\"padding:9px 12px;text-align:left;color:#e2e8f0;font-size:11px;\">To</th>" +
            "<th style=\"padding:9px 12px;text-align:center;color:#e2e8f0;font-size:11px;\">Days</th>" +
            "<th style=\"padding:9px 12px;text-align:left;color:#e2e8f0;font-size:11px;\">Budget</th>" +
            "<th style=\"padding:9px 12px;text-align:center;color:#e2e8f0;font-size:11px;\">Target</th>" +
            "<th style=\"padding:9px 12px;text-align:left;color:#e2e8f0;font-size:11px;\">CAC</th>" +
            "</tr></thead><tbody>" + rows + "</tbody></table>" +
            "<table cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:collapse;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:20px;\">" +
            "<tr><td colspan=\"2\" style=\"padding:8px 16px;color:#166534;font-weight:700;font-size:13px;\">Summary</td></tr>" +
            "<tr>" + TdPad("Total Target") + TdVal(p.TotalTarget + " leads") + "</tr>" +
            "<tr>" + TdPad("Total Budget") + TdVal("Rs." + p.TotalBudget.ToString("N0")) + "</tr>" +
            "<tr>" + TdPad("Overall CAC")  + TdVal("Rs." + cac.ToString("N0")) + "</tr>" +
            "</table>";
    }

    private static string BuildProposalInfoTable(Proposal p)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("<table cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;margin-bottom:20px;font-size:13px;\">");
        sb.Append("<tr>" + TdPad("Token")       + TdVal(p.TokenNumber ?? "") + "</tr>");
        sb.Append("<tr>" + TdPad("Dealer")      + TdVal(p.DealerName) + "</tr>");
        sb.Append("<tr>" + TdPad("Location")    + TdVal(p.Location + ", " + p.State) + "</tr>");
        sb.Append("<tr>" + TdPad("Month")       + TdVal(p.Month) + "</tr>");
        sb.Append("<tr>" + TdPad("Eligibility") + TdVal(p.Eligibility) + "</tr>");
        sb.Append("<tr>" + TdPad("RSM / TSM")   + TdVal(p.RsmName) + "</tr>");
        if (!string.IsNullOrWhiteSpace(p.CommandoName))
            sb.Append("<tr>" + TdPad("Commando") + TdVal(p.CommandoName) + "</tr>");
        sb.Append("</table>");
        return sb.ToString();
    }

    private static string BuildLinkButton(string href, string label, string bg = "#1e3a5f") =>
        "<div style=\"margin:22px 0;text-align:center;\">" +
        "<a href=\"" + href + "\" style=\"display:inline-block;background:" + bg + ";color:#fff;" +
        "text-decoration:none;padding:13px 32px;border-radius:8px;font-weight:600;font-size:14px;\">" +
        label + "</a></div>" +
        "<p style=\"font-size:11px;color:#9ca3af;text-align:center;margin:0 0 20px;\">Or copy: " +
        "<a href=\"" + href + "\" style=\"color:#1e3a5f;\">" + href + "</a></p>";

    private static string Shell(string headerBg, string tag, string token, string body) =>
        "<div style=\"font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#1a2233;max-width:680px;margin:0 auto;\">" +
        "<div style=\"background:" + headerBg + ";color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;\">" +
        "<p style=\"margin:0;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;opacity:.75;\">" + tag + "</p>" +
        "<p style=\"margin:4px 0 0;font-size:20px;font-weight:700;\">" + token + "</p></div>" +
        "<div style=\"padding:22px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;\">" +
        body + "</div></div>";

    private string BuildSubmissionBody(Proposal p)
    {
        var sender = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link   = _settings.PortalBaseUrl + "/approver?id=" + p.Id;
        var body   =
            "<p style=\"margin:0 0 18px;font-size:14px;\">Hi BGauss Team,<br/>A new BTL proposal has been submitted and requires your review.</p>" +
            BuildProposalInfoTable(p) +
            BuildActivityTable(p) +
            (string.IsNullOrWhiteSpace(p.Remarks) ? "" :
                "<div style=\"background:#fefce8;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:13px;\"><strong>RSM Remarks:</strong> " + p.Remarks + "</div>") +
            BuildLinkButton(link, "Review Proposal in Portal") +
            "<hr style=\"margin:20px 0;border:none;border-top:1px solid #e2e8f0;\"/>" +
            "<p style=\"margin:0;font-size:13px;\">Thanks &amp; Regards<br/><strong style=\"color:#0a2540;\">" + sender + "</strong><br/>" +
            "<span style=\"color:#6b7280;\">BGauss Auto Pvt. Ltd.</span></p>";
        return Shell("#0a2540", "BGauss BTL - New Proposal", p.TokenNumber ?? "", body);
    }

    private string BuildDecisionBody(Proposal p, ApprovalDecision decision)
    {
        var sender = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var ok     = decision.Status == "Approved";
        var color  = ok ? "#166534" : "#991B1B";
        var bg     = ok ? "#f0fdf4" : "#fef2f2";
        var border = ok ? "#bbf7d0" : "#fecaca";
        var icon   = ok ? "&#10003;" : "&#10005;";
        var link   = _settings.PortalBaseUrl + "/approver?id=" + p.Id;
        var body   =
            "<p style=\"margin:0 0 18px;\">Dear <strong>" + sender + "</strong>,</p>" +
            "<div style=\"background:" + bg + ";border:1px solid " + border + ";border-left:3px solid " + color + ";border-radius:8px;padding:14px 18px;margin-bottom:20px;\">" +
            "<p style=\"margin:0;font-size:17px;font-weight:700;color:" + color + ";\">" + icon + " Proposal " + decision.Status + "</p>" +
            "<p style=\"margin:6px 0 0;font-size:13px;color:#6b7280;\">" + p.DealerName + " - " + p.Location + ", " + p.State + " - " + p.Month + "</p></div>" +
            BuildActivityTable(p) +
            (string.IsNullOrWhiteSpace(decision.ApproverNote) ? "" :
                "<div style=\"background:#fefce8;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:13px;\"><p style=\"margin:0 0 4px;font-weight:700;color:#92400e;\">Approver Note</p><p style=\"margin:0;\">" + decision.ApproverNote + "</p></div>") +
            BuildLinkButton(link, "View Proposal") +
            "<hr style=\"margin:20px 0;border:none;border-top:1px solid #e2e8f0;\"/>" +
            "<p style=\"margin:0;font-size:13px;color:#6b7280;\">Regards,<br/><strong style=\"color:#0a2540;\">BGauss BTL Team</strong></p>";
        return Shell(ok ? "#166534" : "#991B1B", "BGauss BTL - Proposal " + decision.Status, p.TokenNumber ?? "", body);
    }

    private string BuildRevisionBody(Proposal p, string? note)
    {
        var sender = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link   = _settings.PortalBaseUrl + "/rsm-form?edit=" + p.Id;
        var body   =
            "<p style=\"margin:0 0 12px;\">Dear <strong>" + sender + "</strong>,</p>" +
            "<p style=\"margin:0 0 18px;font-size:13px;color:#374151;\">Your proposal for <strong>" + p.DealerName +
            "</strong> (" + p.Location + ", " + p.State + ") for <strong>" + p.Month + "</strong> has been sent back for revision.</p>" +
            (string.IsNullOrWhiteSpace(note) ? "" :
                "<div style=\"background:#fef9c3;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:13px;\"><p style=\"margin:0 0 4px;font-weight:700;color:#92400e;\">Reviewer Note</p><p style=\"margin:0;color:#78350f;\">" + note + "</p></div>") +
            BuildProposalInfoTable(p) +
            BuildActivityTable(p) +
            BuildLinkButton(link, "Edit &amp; Resubmit Proposal", "#92400e") +
            "<hr style=\"margin:20px 0;border:none;border-top:1px solid #e2e8f0;\"/>" +
            "<p style=\"margin:0;font-size:13px;color:#6b7280;\">Regards,<br/><strong style=\"color:#0a2540;\">BGauss BTL Team</strong></p>";
        return Shell("#92400e", "BGauss BTL - Revision Requested", p.TokenNumber ?? "", body);
    }

    private string BuildResubmissionBody(Proposal p)
    {
        var sender = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link   = _settings.PortalBaseUrl + "/approver?id=" + p.Id;
        var body   =
            "<p style=\"margin:0 0 18px;font-size:14px;\">Hi BGauss Team,<br/><strong>" + sender +
            "</strong> has resubmitted the following proposal after incorporating the requested revisions.</p>" +
            BuildProposalInfoTable(p) +
            BuildActivityTable(p) +
            (string.IsNullOrWhiteSpace(p.Remarks) ? "" :
                "<div style=\"background:#fefce8;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:13px;\"><strong>RSM Remarks:</strong> " + p.Remarks + "</div>") +
            BuildLinkButton(link, "Review Resubmitted Proposal") +
            "<hr style=\"margin:20px 0;border:none;border-top:1px solid #e2e8f0;\"/>" +
            "<p style=\"margin:0;font-size:13px;\">Thanks &amp; Regards<br/><strong style=\"color:#0a2540;\">" + sender +
            "</strong><br/><span style=\"color:#6b7280;\">BGauss Auto Pvt. Ltd.</span></p>";
        return Shell("#1e3a5f", "BGauss BTL - Resubmitted for Review", p.TokenNumber ?? "", body);
    }
}
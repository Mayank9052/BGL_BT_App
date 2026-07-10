// Backend/Services/EmailService.cs
using System.Net;
using System.Net.Mail;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;

namespace BGL_BT_App.Backend.Services;

public class EmailService : IEmailService
{
    private readonly SmtpSettings          _settings;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IOptions<SmtpSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger   = logger;
    }

    // ── Step 1: RSM submits → Mayank ─────────────────────────────────────────
    public async Task<(bool Sent, string? Error)> SendSubmissionMailAsync(
        Proposal p, string graphToken)
    {
        return await SendAsync(
            to:      _settings.ApproverEmail,
            cc:      null,
            subject: BuildSubject("New Proposal", p),
            body:    BuildSubmissionBody(p));
    }

    // ── Step 2: Mayank forwards to Vijay — SMTP not supported ────────────────
    public Task<(bool Sent, string? Error)> SendCheckerForwardMailAsync(
        Proposal p, string graphToken)
    {
        _logger.LogWarning("SendCheckerForwardMailAsync: SMTP not supported. Use Graph. Proposal {Token}", p.TokenNumber);
        return Task.FromResult<(bool, string?)>((false, "SMTP not supported for checker-forward. Use Graph."));
    }

    // ── Step 3a: Decision → Mayank + CC RSM ──────────────────────────────────
    public async Task<(bool Sent, string? Error)> SendDecisionMailAsync(
        Proposal p, ApprovalDecision decision, string graphToken)
    {
        return await SendAsync(
            to:      _settings.ApproverEmail,
            cc:      p.SubmittedBy,
            subject: BuildSubject($"Re: Proposal {decision.Status}", p),
            body:    BuildDecisionBody(p, decision));
    }

    // ── Step 3b: Revision → Mayank + CC RSM ──────────────────────────────────
    public async Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(
        Proposal p, string? note, string graphToken)
    {
        return await SendAsync(
            to:      _settings.ApproverEmail,
            cc:      p.SubmittedBy,
            subject: BuildSubject("Revision Requested", p),
            body:    BuildRevisionBody(p, note));
    }

    // ── Step 3c: RSM resubmits → Mayank ──────────────────────────────────────
    public async Task<(bool Sent, string? Error)> SendResubmissionMailAsync(
        Proposal p, string graphToken)
    {
        return await SendAsync(
            to:      _settings.ApproverEmail,
            cc:      null,
            subject: BuildSubject("Resubmitted for Review", p),
            body:    BuildResubmissionBody(p));
    }
    public Task<(bool Sent, string? Error)> SendDealerSendBackMailAsync(
        Proposal p, string dealerEmail, string requestNote, string graphToken)
    {
        _logger.LogWarning("SendDealerSendBackMailAsync: SMTP not supported. Use Graph. Proposal {Token}", p.TokenNumber);
        return Task.FromResult<(bool, string?)>((false, "SMTP not supported for dealer send-back. Use Graph."));
    }

    // ── Step 4: Dealer notification — SMTP not supported ─────────────────────
    public Task<(bool Sent, string? Error)> SendDealerNotificationMailAsync(
        Proposal p, string dealerEmail, string graphToken)
    {
        _logger.LogWarning("SendDealerNotificationMailAsync: SMTP not supported. Use Graph. Proposal {Token}", p.TokenNumber);
        return Task.FromResult<(bool, string?)>((false, "SMTP not supported for dealer notification. Use Graph."));
    }

    // ── Core SMTP send with optional CC ──────────────────────────────────────
    private async Task<(bool Sent, string? Error)> SendAsync(
        string to, string? cc, string subject, string body)
    {
        if (string.IsNullOrWhiteSpace(to))
            return (false, "No recipient address.");
        try
        {
            using var client = new SmtpClient(_settings.Host, _settings.Port)
            {
                Credentials = new NetworkCredential(_settings.User, _settings.Password),
                EnableSsl   = _settings.EnableSsl,
            };
            using var msg = new MailMessage
            {
                From       = ParseFrom(_settings.From),
                Subject    = subject,
                Body       = body,
                IsBodyHtml = true,
            };
            msg.To.Add(to);
            if (!string.IsNullOrWhiteSpace(cc))
            {
                foreach (var addr in cc.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    try { msg.CC.Add(new MailAddress(addr)); } catch { /* skip invalid */ }
            }
            await client.SendMailAsync(msg);
            return (true, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "SMTP failed to {To}", to);
            return (false, ex.Message);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────────

    private static string BuildSubject(string tag, Proposal p) =>
        $"{p.TokenNumber} — {tag} — {p.DealerName.ToUpper()} — {p.Month} — {p.State}";

    private static string Shell(string headerBg, string tagLine, string token, string bodyHtml) =>
        $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a2233;max-width:680px;margin:0 auto;">
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

    // ── Compact activity table with totals footer row ─────────────────────────
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

            rows.Append(
                "<tr>" +
                $"<td style='padding:5px 8px;font-weight:600;color:#0a2540;border-bottom:1px solid #f1f5f9;white-space:nowrap;'>{a.ActivityType}</td>" +
                $"<td style='padding:5px 8px;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap;'>{a.StartDate?.ToString("dd-MMM") ?? "—"} – {a.EndDate?.ToString("dd-MMM-yyyy") ?? "—"}</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{days}d</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{a.LeadTarget}</td>" +
                $"<td style='padding:5px 8px;text-align:center;border-bottom:1px solid #f1f5f9;'>{a.RetailTarget}</td>" +
                $"<td style='padding:5px 8px;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;'>Rs.{total:N0}/-</td>" +
                $"<td style='padding:5px 8px;text-align:right;color:#6b7280;border-bottom:1px solid #f1f5f9;'>Rs.{cpl:N0}/-</td>" +
                $"<td style='padding:5px 8px;text-align:right;color:{cacCol};border-bottom:1px solid #f1f5f9;font-weight:{(cac > 4000 ? "700" : "400")};'>Rs.{cac:N0}/-</td>" +
                "</tr>");
        }

        // Totals footer row
        rows.Append(
            "<tr style='background:#f0fdf4;'>" +
            "<td style='padding:5px 8px;font-weight:700;color:#166534;' colspan='3'>Totals</td>" +
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
                  <th style="padding:6px 8px;text-align:left;color:#e2e8f0;font-size:10px;">Dates</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Days</th>
                  <th style="padding:6px 8px;text-align:center;color:#e2e8f0;font-size:10px;">Leads Target</th>
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

    // ─────────────────────────────────────────────────────────────────────────
    // Body builders
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildSubmissionBody(Proposal p)
    {
        var sender  = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link    = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#0a2540", "New Proposal — Awaiting Review", p.TokenNumber ?? "", $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi Seema,<br/>
              New BTL proposal submitted by <strong>{sender}</strong> —
              please review before forwarding to Vijay.</p>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {remarks}
            {LinkBtn(link, "🔍 Review in Portal")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Thanks &amp; Regards · <strong>{sender}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    private string BuildDecisionBody(Proposal p, ApprovalDecision decision)
    {
        var ok     = decision.Status == "Approved";
        var color  = ok ? "#166534" : "#991B1B";
        var bg     = ok ? "#f0fdf4" : "#fef2f2";
        var border = ok ? "#bbf7d0" : "#fecaca";
        var link   = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var note   = string.IsNullOrWhiteSpace(decision.ApproverNote) ? "" :
            $"<div style='background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>Approver Note:</strong> {decision.ApproverNote}</div>";

        return Shell(ok ? "#166534" : "#991B1B", $"Proposal {decision.Status}", p.TokenNumber ?? "", $"""
            <p style="margin:0 0 10px;font-size:13px;">Hi Seema,<br/>
              The following proposal has been <strong>{decision.Status.ToLower()}</strong>.
              RSM is CC'd on this mail.</p>
            <div style="background:{bg};border:1px solid {border};border-left:3px solid {color};
                         border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:13px;">
              <strong style="color:{color};">{(ok ? "✓" : "✕")} Proposal {decision.Status}</strong>
              <span style="color:#6b7280;margin-left:10px;">
                {p.DealerName} · {p.Location}, {p.State} · {p.Month}
                {(decision.ApprovedBy != null ? $" · by {decision.ApprovedBy}" : "")}
              </span>
            </div>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {note}
            {LinkBtn(link, "View Proposal")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Regards · <strong>BGauss BTL Team</strong></p>
            """);
    }

    private string BuildRevisionBody(Proposal p, string? note)
    {
        var sender   = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var editLink = $"{_settings.PortalBaseUrl}/rsm-form?edit={p.Id}";
        var noteHtml = string.IsNullOrWhiteSpace(note) ? "" :
            $"<div style='background:#fef9c3;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>Reviewer Note:</strong> {note}</div>";

        return Shell("#92400e", "Revision Requested", p.TokenNumber ?? "", $"""
            <p style="margin:0 0 10px;font-size:13px;">Hi Seema,<br/>
              Revision requested for <strong>{p.DealerName}</strong>
              ({p.Location}, {p.State}) — <strong>{p.Month}</strong>.
              Please coordinate with RSM <strong>{sender}</strong>.</p>
            {BuildProposalInfoTable(p)}
            {noteHtml}
            {BuildActivityTable(p)}
            {LinkBtn(editLink, "✏ Edit & Resubmit", "#92400e")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Regards · <strong>BGauss BTL Team</strong></p>
            """);
    }

    private string BuildResubmissionBody(Proposal p)
    {
        var sender  = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var link    = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var remarks = string.IsNullOrWhiteSpace(p.Remarks) ? "" :
            $"<div style='background:#fefce8;border-left:3px solid #f59e0b;border-radius:4px;padding:6px 10px;margin-bottom:10px;font-size:12px;'><strong>RSM Remarks:</strong> {p.Remarks}</div>";

        return Shell("#1e3a5f", "Resubmitted — Awaiting Review", p.TokenNumber ?? "", $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi Mayank,<br/>
              <strong>{sender}</strong> has resubmitted after revisions —
              please review and forward to Vijay.</p>
            {BuildProposalInfoTable(p)}
            {BuildActivityTable(p)}
            {remarks}
            {LinkBtn(link, "🔍 Review Resubmission")}
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
              Thanks &amp; Regards · <strong>{sender}</strong> · BGauss Auto Pvt. Ltd.</p>
            """);
    }

    // ── Helper ────────────────────────────────────────────────────────────────
    private static MailAddress ParseFrom(string from)
    {
        var s = from.IndexOf('<');
        var e = from.IndexOf('>');
        if (s >= 0 && e > s)
            return new MailAddress(from[(s + 1)..e].Trim(), from[..s].Trim());
        return new MailAddress(from.Trim());
    }
}
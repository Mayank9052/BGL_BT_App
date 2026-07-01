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

    public async Task<(bool Sent, string? Error)> SendSubmissionMailAsync(
        Proposal p, string graphToken)
    {
        var subject = $"{p.TokenNumber}" +
                      $"-{p.Activities.FirstOrDefault()?.ActivityType ?? "Activity"}" +
                      $"-{p.DealerName.ToUpper()}-{p.Month}-{p.State}";
        return await SendAsync(_settings.ApproverEmail, p.SubmittedBy, subject, BuildSubmissionBody(p));
    }

    public async Task<(bool Sent, string? Error)> SendDecisionMailAsync(
        Proposal p, ApprovalDecision decision, string graphToken)
    {
        var subject = $"Re: {p.TokenNumber}" +
                      $"-{p.Activities.FirstOrDefault()?.ActivityType ?? "Activity"}" +
                      $"-{p.DealerName.ToUpper()}-{p.Month}-{p.State}";
        return await SendAsync(p.SubmittedBy, _settings.ApproverEmail, subject, BuildDecisionBody(p, decision));
    }

    public async Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(
        Proposal p, string? note, string graphToken)
    {
        var subject = $"Revision Requested — {p.TokenNumber} — {p.DealerName.ToUpper()} — {p.Month}";
        return await SendAsync(p.SubmittedBy, _settings.ApproverEmail, subject, BuildRevisionBody(p, note));
    }

    public async Task<(bool Sent, string? Error)> SendResubmissionMailAsync(
        Proposal p, string graphToken)
    {
        var subject = $"Resubmitted — {p.TokenNumber} — {p.DealerName.ToUpper()} — {p.Month}";
        return await SendAsync(_settings.ApproverEmail, p.SubmittedBy, subject, BuildResubmissionBody(p));
    }

    private async Task<(bool Sent, string? Error)> SendAsync(
        string to, string? replyTo, string subject, string htmlBody)
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
                Body       = htmlBody,
                IsBodyHtml = true,
            };
            msg.To.Add(to);
            if (!string.IsNullOrWhiteSpace(replyTo))
                try { msg.ReplyToList.Add(new MailAddress(replyTo)); } catch { }
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
    // Shared: activity table rows (used by all 4 mail types)
    // ─────────────────────────────────────────────────────────────────────────

    private static string BuildActivityTableRows(Proposal p)
    {
        return string.Join("\n", p.Activities.Select(a =>
        {
            var total    = a.Budget + a.AdditionalBudget;
            var days     = (a.EndDate.HasValue && a.StartDate.HasValue)
                ? (a.EndDate.Value.DayNumber - a.StartDate.Value.DayNumber + 1) : 0;
            var fromDate = a.StartDate.HasValue
                ? a.StartDate.Value.ToString("dd-MMM-yyyy") : "—";
            var toDate   = a.EndDate.HasValue
                ? a.EndDate.Value.ToString("dd-MMM-yyyy") : "—";
            var cac      = a.RetailTarget > 0
                ? Math.Round(total / (decimal)a.RetailTarget, 0) : 0;
            var cpl      = a.LeadTarget > 0
                ? Math.Round(total / (decimal)a.LeadTarget, 0) : 0;

            return $"""
                <tr>
                  <td style="padding:9px 12px;font-weight:600;color:#0a2540;
                              border-bottom:1px solid #f1f5f9;">{a.ActivityType}</td>
                  <td style="padding:9px 12px;color:#374151;
                              border-bottom:1px solid #f1f5f9;">{fromDate}</td>
                  <td style="padding:9px 12px;color:#374151;
                              border-bottom:1px solid #f1f5f9;">{toDate}</td>
                  <td style="padding:9px 12px;text-align:center;color:#374151;
                              border-bottom:1px solid #f1f5f9;">{days} days</td>
                  <td style="padding:9px 12px;font-weight:600;color:#0a2540;
                              border-bottom:1px solid #f1f5f9;">Rs. {total:N0}/-</td>
                  <td style="padding:9px 12px;text-align:center;color:#374151;
                              border-bottom:1px solid #f1f5f9;">{a.LeadTarget} leads</td>
                  <td style="padding:9px 12px;text-align:center;color:#374151;
                              border-bottom:1px solid #f1f5f9;">{a.RetailTarget} retail</td>
                  <td style="padding:9px 12px;color:#6b7280;
                              border-bottom:1px solid #f1f5f9;">Rs. {cpl:N0}/-</td>
                  <td style="padding:9px 12px;color:#6b7280;
                              border-bottom:1px solid #f1f5f9;">Rs. {cac:N0}/-</td>
                </tr>
                """;
        }));
    }

    private static string BuildActivityTable(Proposal p)
    {
        var rows       = BuildActivityTableRows(p);
        var overallCac = p.TotalRetailTarget > 0
            ? Math.Round(p.TotalBudget / (decimal)p.TotalRetailTarget, 0) : 0;
        var overallCpl = p.TotalLeadTarget > 0
            ? Math.Round(p.TotalBudget / (decimal)p.TotalLeadTarget, 0) : 0;

        return $"""
            <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#0a2540;
                       text-transform:uppercase;letter-spacing:.5px;">Activities</p>

            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#fff;
                          border:1px solid #e2e8f0;border-radius:8px;
                          overflow:hidden;margin-bottom:20px;font-size:13px;">
              <thead>
                <tr style="background:#0a2540;">
                  <th style="padding:9px 12px;text-align:left;color:#e2e8f0;
                              font-weight:600;font-size:12px;">Activity</th>
                  <th style="padding:9px 12px;text-align:left;color:#e2e8f0;
                              font-weight:600;font-size:12px;">From Date</th>
                  <th style="padding:9px 12px;text-align:left;color:#e2e8f0;
                              font-weight:600;font-size:12px;">To Date</th>
                  <th style="padding:9px 12px;text-align:center;color:#e2e8f0;
                              font-weight:600;font-size:12px;">Days</th>
                  <th style="padding:9px 12px;text-align:left;color:#e2e8f0;
                              font-weight:600;font-size:12px;">Budget</th>
                  <th style="padding:9px 12px;text-align:center;color:#e2e8f0;
                              font-weight:600;font-size:12px;">Lead Target</th>
                  <th style="padding:9px 12px;text-align:center;color:#e2e8f0;
                              font-weight:600;font-size:12px;">Retail Target</th>
                  <th style="padding:9px 12px;text-align:left;color:#e2e8f0;
                              font-weight:600;font-size:12px;">CPL</th>
                  <th style="padding:9px 12px;text-align:left;color:#e2e8f0;
                              font-weight:600;font-size:12px;">CAC</th>
                </tr>
              </thead>
              <tbody>
                {rows}
              </tbody>
            </table>

            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#f0fdf4;
                          border:1px solid #bbf7d0;border-radius:8px;margin-bottom:20px;">
              <tr>
                <td style="padding:8px 16px;color:#166534;font-weight:600;
                            font-size:13px;" colspan="2">Overall Summary</td>
              </tr>
              <tr>
                <td style="padding:4px 16px;color:#6b7280;width:200px;font-size:13px;">
                  Total Lead Target</td>
                <td style="padding:4px 0;font-weight:600;font-size:13px;">{p.TotalLeadTarget}</td>
              </tr>
              <tr>
                <td style="padding:4px 16px;color:#6b7280;width:200px;font-size:13px;">
                  Total Retail Target</td>
                <td style="padding:4px 0;font-weight:600;font-size:13px;">{p.TotalRetailTarget}</td>
              </tr>
              <tr>
                <td style="padding:4px 16px;color:#6b7280;font-size:13px;">Total Budget</td>
                <td style="padding:4px 0;font-weight:600;font-size:13px;">
                  Rs. {p.TotalBudget:N0}/-</td>
              </tr>
              <tr>
                <td style="padding:4px 16px;color:#6b7280;font-size:13px;">
                  Overall CPL</td>
                <td style="padding:4px 0;font-weight:600;font-size:13px;">
                  Rs. {overallCpl:N0}/-</td>
              </tr>
              <tr>
                <td style="padding:4px 16px 10px;color:#6b7280;font-size:13px;">
                  Overall CAC</td>
                <td style="padding:4px 0 10px;font-weight:600;font-size:13px;">
                  Rs. {overallCac:N0}/-</td>
              </tr>
            </table>
            """;
    }

    private static string BuildProposalInfoTable(Proposal p)
    {
        return $"""
            <table cellpadding="0" cellspacing="0"
                   style="width:100%;border-collapse:collapse;background:#f8fafc;
                          border-radius:8px;margin-bottom:20px;font-size:13px;">
              <tr>
                <td style="padding:7px 16px 7px 14px;color:#6b7280;width:160px;">
                  Token</td>
                <td style="padding:7px 0;font-weight:600;font-family:monospace;">
                  {p.TokenNumber}</td>
              </tr>
              <tr style="background:#fff;">
                <td style="padding:7px 16px 7px 14px;color:#6b7280;">Dealer Name</td>
                <td style="padding:7px 0;font-weight:600;">{p.DealerName}</td>
              </tr>
              {(string.IsNullOrWhiteSpace(p.VendorName) ? "" : $"""
              <tr>
                <td style="padding:7px 16px 7px 14px;color:#6b7280;">Vendor</td>
                <td style="padding:7px 0;">{p.VendorName}</td>
              </tr>
              """)}
              <tr style="background:#fff;">
                <td style="padding:7px 16px 7px 14px;color:#6b7280;">Location</td>
                <td style="padding:7px 0;">{p.Location}, {p.State}</td>
              </tr>
              <tr>
                <td style="padding:7px 16px 7px 14px;color:#6b7280;">Month</td>
                <td style="padding:7px 0;">{p.Month}</td>
              </tr>
              <tr style="background:#fff;">
                <td style="padding:7px 16px 7px 14px;color:#6b7280;">Eligibility</td>
                <td style="padding:7px 0;">{p.Eligibility}</td>
              </tr>
              <tr>
                <td style="padding:7px 16px 7px 14px;color:#6b7280;">RSM / TSM</td>
                <td style="padding:7px 0;">{p.RsmName}</td>
              </tr>
              {(string.IsNullOrWhiteSpace(p.CommandoName) ? "" : $"""
              <tr style="background:#fff;">
                <td style="padding:7px 16px 7px 14px;color:#6b7280;">Commando</td>
                <td style="padding:7px 0;">{p.CommandoName}</td>
              </tr>
              """)}
            </table>
            """;
    }

    private static string BuildLinkButton(string href, string label, string bgColor = "#1e3a5f")
    {
        return $"""
            <div style="margin:22px 0;text-align:center;">
              <a href="{href}"
                 style="display:inline-block;background:{bgColor};color:#fff;
                        text-decoration:none;padding:13px 32px;border-radius:8px;
                        font-weight:600;font-size:14px;letter-spacing:.2px;">
                {label}
              </a>
            </div>
            <p style="font-size:11px;color:#9ca3af;text-align:center;margin:0 0 20px;">
              Or copy this link:
              <a href="{href}" style="color:#1e3a5f;">{href}</a>
            </p>
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body: new submission (RSM → Approver)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildSubmissionBody(Proposal p)
    {
        var senderName = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var portalLink = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:680px;">

              <div style="background:#0a2540;color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:11px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.7;">BGauss BTL — New Proposal</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:22px 24px;border:1px solid #e2e8f0;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 18px;font-size:14px;">
                  Hi BGauss Team,<br/>
                  A new BTL proposal has been submitted and requires your review.
                </p>

                {BuildProposalInfoTable(p)}
                {BuildActivityTable(p)}

                {(string.IsNullOrWhiteSpace(p.Remarks) ? "" : $"""
                <div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;
                             padding:10px 14px;margin-bottom:20px;font-size:13px;">
                  <strong>RSM Remarks:</strong> {p.Remarks}
                </div>
                """)}

                <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">
                  Please review and take action in the Approver Portal.
                </p>

                {BuildLinkButton(portalLink, "🔍 Review Proposal in Portal")}

                <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;"/>

                <p style="margin:0;font-size:13px;">
                  Thanks &amp; Regards<br/>
                  <strong style="color:#0a2540;font-size:14px;">{senderName}</strong><br/>
                  {(string.IsNullOrWhiteSpace(p.CommandoName) ? "" : p.CommandoName + "<br/>")}
                  <span style="color:#6b7280;">BGauss Auto Pvt. Ltd.</span><br/>
                  <span style="color:#9ca3af;font-size:12px;">{p.SubmittedBy}</span>
                </p>

              </div>
            </div>
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body: decision approved/rejected (Approver → RSM)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildDecisionBody(Proposal p, ApprovalDecision decision)
    {
        var senderName   = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var isApproved   = decision.Status == "Approved";
        var statusColor  = isApproved ? "#166534"  : "#991B1B";
        var statusBg     = isApproved ? "#f0fdf4"  : "#fef2f2";
        var statusBorder = isApproved ? "#bbf7d0"  : "#fecaca";
        var statusIcon   = isApproved ? "✓"        : "✕";
        var headerColor  = isApproved ? "#166534"  : "#991B1B";
        var viewLink     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:680px;">

              <div style="background:{headerColor};color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:11px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.8;">
                  BGauss BTL — Proposal {decision.Status}</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:22px 24px;border:1px solid #e2e8f0;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 18px;">Dear <strong>{senderName}</strong>,</p>

                <div style="background:{statusBg};border:1px solid {statusBorder};
                             border-radius:8px;padding:14px 18px;margin-bottom:20px;">
                  <p style="margin:0;font-size:17px;font-weight:700;color:{statusColor};">
                    {statusIcon} Proposal {decision.Status}
                  </p>
                  <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">
                    {p.DealerName} · {p.Location}, {p.State} · {p.Month}
                  </p>
                </div>

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#f8fafc;
                              border-radius:8px;margin-bottom:20px;font-size:13px;">
                  <tr>
                    <td style="padding:7px 16px 7px 14px;color:#6b7280;width:160px;">
                      Decided by</td>
                    <td style="padding:7px 0;">{decision.ApprovedBy}</td>
                  </tr>
                  <tr style="background:#fff;">
                    <td style="padding:7px 16px 7px 14px;color:#6b7280;">Total Budget</td>
                    <td style="padding:7px 0;font-weight:600;">₹{p.TotalBudget:N0}</td>
                  </tr>
                  <tr>
                    <td style="padding:7px 16px 7px 14px;color:#6b7280;">Lead Target</td>
                    <td style="padding:7px 0;">{p.TotalLeadTarget} leads</td>
                  </tr>
                  <tr style="background:#fff;">
                    <td style="padding:7px 16px 7px 14px;color:#6b7280;">Retail Target</td>
                    <td style="padding:7px 0;">{p.TotalRetailTarget} retail</td>
                  </tr>
                  <tr>
                    <td style="padding:7px 16px 7px 14px;color:#6b7280;">CPL</td>
                    <td style="padding:7px 0;">₹{p.Cpl:N0}</td>
                  </tr>
                  <tr style="background:#fff;">
                    <td style="padding:7px 16px 7px 14px;color:#6b7280;">CAC</td>
                    <td style="padding:7px 0;">₹{p.Cac:N0}</td>
                  </tr>
                </table>

                {BuildActivityTable(p)}

                {(string.IsNullOrWhiteSpace(decision.ApproverNote) ? "" : $"""
                <div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;
                             padding:12px 16px;margin-bottom:20px;font-size:13px;">
                  <p style="margin:0 0 4px;font-weight:600;color:#92400e;">Approver Note</p>
                  <p style="margin:0;">{decision.ApproverNote}</p>
                </div>
                """)}

                <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">
                  You can view the full proposal details in the portal.
                </p>

                {BuildLinkButton(viewLink, "View Proposal")}

                <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;"/>

                <p style="margin:0;font-size:13px;color:#6b7280;">
                  Regards,<br/>
                  <strong style="color:#0a2540;">BGauss BTL Team</strong>
                </p>

              </div>
            </div>
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body: revision request (Approver → RSM to edit and resubmit)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildRevisionBody(Proposal p, string? note)
    {
        var senderName = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var editLink   = $"{_settings.PortalBaseUrl}/rsm-form?edit={p.Id}";

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:680px;">

              <div style="background:#92400e;color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:11px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.8;">
                  BGauss BTL — Revision Requested</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:22px 24px;border:1px solid #e2e8f0;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 12px;">Dear <strong>{senderName}</strong>,</p>

                <p style="margin:0 0 18px;font-size:13px;color:#374151;">
                  Your proposal for <strong>{p.DealerName}</strong>
                  ({p.Location}, {p.State}) for <strong>{p.Month}</strong>
                  has been sent back for revision. Please update and resubmit.
                </p>

                {(string.IsNullOrWhiteSpace(note) ? "" : $"""
                <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;
                             padding:12px 16px;margin-bottom:20px;font-size:13px;">
                  <p style="margin:0 0 4px;font-weight:600;color:#92400e;">
                    Reviewer note</p>
                  <p style="margin:0;color:#78350f;">{note}</p>
                </div>
                """)}

                {BuildProposalInfoTable(p)}
                {BuildActivityTable(p)}

                <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">
                  Click below to open your proposal and make the required changes.
                </p>

                {BuildLinkButton(editLink, "✏ Open &amp; Edit Proposal", "#92400e")}

                <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;"/>

                <p style="margin:0;font-size:13px;color:#6b7280;">
                  Regards,<br/>
                  <strong style="color:#0a2540;">BGauss BTL Team</strong>
                </p>

              </div>
            </div>
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body: resubmission (RSM resubmitted after revision → Approver)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildResubmissionBody(Proposal p)
    {
        var senderName = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var adminLink  = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:680px;">

              <div style="background:#1e3a5f;color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:11px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.8;">
                  BGauss BTL — Resubmitted for Review</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:22px 24px;border:1px solid #e2e8f0;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 18px;font-size:14px;">
                  Hi BGauss Team,<br/>
                  <strong>{senderName}</strong> has <strong>resubmitted</strong> the following
                  proposal after incorporating the requested revisions.
                  Please review and take action.
                </p>

                {BuildProposalInfoTable(p)}
                {BuildActivityTable(p)}

                {(string.IsNullOrWhiteSpace(p.Remarks) ? "" : $"""
                <div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;
                             padding:10px 14px;margin-bottom:20px;font-size:13px;">
                  <strong>RSM Remarks:</strong> {p.Remarks}
                </div>
                """)}

                <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">
                  Please review and take action in the Approver Portal.
                </p>

                {BuildLinkButton(adminLink, "🔍 Review Resubmitted Proposal")}

                <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;"/>

                <p style="margin:0;font-size:13px;">
                  Thanks &amp; Regards<br/>
                  <strong style="color:#0a2540;font-size:14px;">{senderName}</strong><br/>
                  {(string.IsNullOrWhiteSpace(p.CommandoName) ? "" : p.CommandoName + "<br/>")}
                  <span style="color:#6b7280;">BGauss Auto Pvt. Ltd.</span><br/>
                  <span style="color:#9ca3af;font-size:12px;">{p.SubmittedBy}</span>
                </p>

              </div>
            </div>
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private static MailAddress ParseFrom(string from)
    {
        var s = from.IndexOf('<');
        var e = from.IndexOf('>');
        if (s >= 0 && e > s)
            return new MailAddress(from[(s + 1)..e].Trim(), from[..s].Trim());
        return new MailAddress(from.Trim());
    }
}
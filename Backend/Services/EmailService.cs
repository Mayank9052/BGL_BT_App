using System.Net;
using System.Net.Mail;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;


namespace BGL_BT_App.Backend.Services;

public class SmtpSettings
{
    public string Host          { get; set; } = string.Empty;
    public int    Port          { get; set; } = 587;
    public string User          { get; set; } = string.Empty;
    public string Password      { get; set; } = string.Empty;
    public string From          { get; set; } = string.Empty;
    public bool   EnableSsl     { get; set; } = true;
    public string ApproverEmail { get; set; } = string.Empty;
    public string PortalBaseUrl { get; set; } = "http://localhost:5173";
}

public class EmailService : IEmailService
{
    private readonly SmtpSettings          _settings;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IOptions<SmtpSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger   = logger;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public interface
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>New proposal submitted by RSM → notify approver</summary>
    public async Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal p)
    {
        var subject = $"{p.TokenNumber}" +
                      $"-{p.Activities.FirstOrDefault()?.ActivityType ?? "Activity"}" +
                      $"-{p.DealerName.ToUpper()}-{p.Month}-{p.State}";

        return await SendAsync(
            to:       _settings.ApproverEmail,
            replyTo:  p.SubmittedBy,
            subject:  subject,
            htmlBody: BuildSubmissionBody(p));
    }

    /// <summary>Approver approved/rejected → notify RSM</summary>
    public async Task<(bool Sent, string? Error)> SendDecisionMailAsync(
        Proposal p, ApprovalDecision decision)
    {
        var subject = $"Re: {p.TokenNumber}" +
                      $"-{p.Activities.FirstOrDefault()?.ActivityType ?? "Activity"}" +
                      $"-{p.DealerName.ToUpper()}-{p.Month}-{p.State}";

        return await SendAsync(
            to:       p.SubmittedBy,
            replyTo:  null,
            subject:  subject,
            htmlBody: BuildDecisionBody(p, decision));
    }

    /// <summary>Approver sent back for revision → notify RSM with edit link</summary>
    public async Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(
        Proposal p, string? note)
    {
        var subject = $"Revision Requested — {p.TokenNumber}" +
                      $" — {p.DealerName.ToUpper()} — {p.Month}";

        return await SendAsync(
            to:       p.SubmittedBy,
            replyTo:  null,
            subject:  subject,
            htmlBody: BuildRevisionBody(p, note));
    }

    /// <summary>RSM resubmitted after revision → notify approver again</summary>
    public async Task<(bool Sent, string? Error)> SendResubmissionMailAsync(Proposal p)
    {
        var subject = $"Resubmitted — {p.TokenNumber}" +
                      $" — {p.DealerName.ToUpper()} — {p.Month}";

        return await SendAsync(
            to:       _settings.ApproverEmail,
            replyTo:  p.SubmittedBy,
            subject:  subject,
            htmlBody: BuildResubmissionBody(p));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core SMTP send
    // ─────────────────────────────────────────────────────────────────────────

    private async Task<(bool Sent, string? Error)> SendAsync(
        string to, string? replyTo, string subject, string htmlBody)
    {
        if (string.IsNullOrWhiteSpace(to))
            return (false, "No recipient address available.");

        try
        {
            using var client = new SmtpClient(_settings.Host, _settings.Port)
            {
                Credentials = new NetworkCredential(_settings.User, _settings.Password),
                EnableSsl   = _settings.EnableSsl,
            };

            using var message = new MailMessage
            {
                From       = ParseFrom(_settings.From),
                Subject    = subject,
                Body       = htmlBody,
                IsBodyHtml = true,
            };

            message.To.Add(to);

            if (!string.IsNullOrWhiteSpace(replyTo))
                message.ReplyToList.Add(new MailAddress(replyTo));

            await client.SendMailAsync(message);
            return (true, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send mail to {To}", to);
            return (false, ex.Message);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body: new submission (RSM → Approver)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildSubmissionBody(Proposal p)
    {
        var senderName = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var portalLink = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var overallCac = p.TotalTarget > 0
            ? Math.Round(p.TotalBudget / (decimal)p.TotalTarget, 0) : 0;

        var activitySections = string.Join("\n", p.Activities.Select((a, i) =>
        {
            var days  = (a.EndDate.HasValue && a.StartDate.HasValue)
                ? (a.EndDate.Value.DayNumber - a.StartDate.Value.DayNumber + 1) : 0;
            var total = a.Budget + a.Incentive;
            var cpl   = a.Target > 0 ? Math.Round(total / (decimal)a.Target, 0) : 0;
            var cac   = a.Target > 0 ? Math.Round(total / (decimal)a.Target, 0) : 0;
            var label = p.Activities.Count > 1
                ? $"{(char)('A' + i)}) {a.ActivityType}"
                : $"A) {a.ActivityType}";
            var dateRange = (a.StartDate.HasValue && a.EndDate.HasValue)
                ? $"{a.StartDate.Value:dd-MMM-yyyy} to {a.EndDate.Value:dd-MMM-yyyy}"
                : "—";

            return $"""
                <tr>
                  <td colspan="2" style="padding:12px 0 4px;font-weight:600;
                      color:#0a2540;border-top:1px solid #e5e7eb;">{label}</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0;color:#6b7280;width:180px;">No. of Days</td>
                  <td style="padding:3px 0;">{days} days</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0;color:#6b7280;">Date Range</td>
                  <td style="padding:3px 0;">{dateRange}</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0;color:#6b7280;">Expected Leads</td>
                  <td style="padding:3px 0;">{a.Target}</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0;color:#6b7280;">Expected Retail</td>
                  <td style="padding:3px 0;">{(int)Math.Ceiling(a.Target / 20.0)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 16px 3px 0;color:#6b7280;font-weight:600;">
                    Amount for Consideration</td>
                  <td></td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0;color:#6b7280;">Total Budget</td>
                  <td style="padding:3px 0;">Rs. {total:N0}/- (incl. of taxes)</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0;color:#6b7280;">CPL</td>
                  <td style="padding:3px 0;">Rs. {cpl:N0}/- (per lead)</td>
                </tr>
                <tr>
                  <td style="padding:3px 16px 3px 0;color:#6b7280;">CAC</td>
                  <td style="padding:3px 0;">Rs. {cac:N0}/- (per acquisition)</td>
                </tr>
                """;
        }));

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:640px;">

              <div style="background:#0a2540;color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:12px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.7;">BGauss BTL Proposal</p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:20px 24px;border:1px solid #e5e7eb;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 16px;">
                  Hi BGauss Team,<br/>
                  Please find below the working for <strong>Pre-Campaign</strong>:
                </p>

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#f8fafc;
                              border-radius:6px;padding:12px;margin-bottom:20px;">
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;width:160px;">
                      Dealer Name</td>
                    <td style="padding:5px 0;font-weight:600;">{p.DealerName}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Location</td>
                    <td style="padding:5px 0;">{p.Location}, {p.State}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Month</td>
                    <td style="padding:5px 0;">{p.Month}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Eligibility</td>
                    <td style="padding:5px 0;">{p.Eligibility}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">RSM / TSM</td>
                    <td style="padding:5px 0;">{p.RsmName}</td>
                  </tr>
                  {(string.IsNullOrWhiteSpace(p.CommandoName) ? "" : $"""
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Commando</td>
                    <td style="padding:5px 0;">{p.CommandoName}</td>
                  </tr>
                  """)}
                </table>

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                  {activitySections}
                </table>

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#f0fdf4;
                              border:1px solid #bbf7d0;border-radius:6px;margin-bottom:20px;">
                  <tr>
                    <td style="padding:8px 16px;color:#166534;font-weight:600;">
                      Overall Summary</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td style="padding:4px 16px;color:#6b7280;width:200px;">
                      Total Target (Leads)</td>
                    <td style="padding:4px 0;font-weight:600;">{p.TotalTarget}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 16px;color:#6b7280;">Total Budget</td>
                    <td style="padding:4px 0;font-weight:600;">Rs. {p.TotalBudget:N0}/-</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 16px 8px;color:#6b7280;">Overall CAC</td>
                    <td style="padding:4px 0 8px;font-weight:600;">Rs. {overallCac:N0}/-</td>
                  </tr>
                </table>

                {(string.IsNullOrWhiteSpace(p.Remarks) ? "" : $"""
                <p style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;
                           padding:10px 14px;margin-bottom:20px;">
                  <strong>Remarks:</strong> {p.Remarks}
                </p>
                """)}

                <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">
                  Please review and approve or reject this proposal in the Approver Portal.
                </p>

                <div style="margin:20px 0;text-align:center;">
                  <a href="{portalLink}"
                     style="display:inline-block;background:#1e3a5f;color:#fff;
                            text-decoration:none;padding:13px 30px;border-radius:8px;
                            font-weight:600;font-size:14px;letter-spacing:.2px;">
                    🔍 Review Proposal in Portal
                  </a>
                </div>
                <p style="font-size:11px;color:#9ca3af;text-align:center;margin:0 0 20px;">
                  Or visit: <a href="{portalLink}" style="color:#1e3a5f;">{portalLink}</a>
                </p>

                <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;"/>

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
    // Body: decision (Approver → RSM)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildDecisionBody(Proposal p, ApprovalDecision decision)
    {
        var senderName   = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        var statusColor  = decision.Status == "Approved" ? "#166534"  : "#991B1B";
        var statusBg     = decision.Status == "Approved" ? "#f0fdf4"  : "#fef2f2";
        var statusBorder = decision.Status == "Approved" ? "#bbf7d0"  : "#fecaca";
        var statusIcon   = decision.Status == "Approved" ? "✓"        : "✕";
        // RSM clicks → my proposals view, auto-opens this proposal
        var viewLink     = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:600px;">

              <div style="background:#0a2540;color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:12px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.7;">BGauss BTL Proposal</p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:20px 24px;border:1px solid #e5e7eb;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 16px;">Dear <strong>{senderName}</strong>,</p>

                <div style="background:{statusBg};border:1px solid {statusBorder};
                             border-radius:8px;padding:14px 18px;margin-bottom:20px;">
                  <p style="margin:0;font-size:16px;font-weight:700;color:{statusColor};">
                    {statusIcon} Proposal {decision.Status}
                  </p>
                  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">
                    {p.DealerName} · {p.Location}, {p.State} · {p.Month}
                  </p>
                </div>

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#f8fafc;
                              border-radius:6px;margin-bottom:20px;">
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;width:160px;">
                      Token Number</td>
                    <td style="padding:6px 0;font-weight:600;font-family:monospace;">
                      {p.TokenNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;">Decided by</td>
                    <td style="padding:6px 0;">{decision.ApprovedBy}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;">Total Budget</td>
                    <td style="padding:6px 0;font-weight:600;">₹{p.TotalBudget:N0}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;">Total Target</td>
                    <td style="padding:6px 0;">{p.TotalTarget}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;">CAC</td>
                    <td style="padding:6px 0;">₹{p.Cac:N0}</td>
                  </tr>
                </table>

                {(string.IsNullOrWhiteSpace(decision.ApproverNote) ? "" : $"""
                <div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;
                             padding:12px 16px;margin-bottom:20px;">
                  <p style="margin:0 0 4px;font-weight:600;color:#92400e;">Approver Note</p>
                  <p style="margin:0;">{decision.ApproverNote}</p>
                </div>
                """)}

                <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">
                  You can view the full proposal details in the portal.
                </p>

                <div style="margin:16px 0;text-align:center;">
                  <a href="{viewLink}"
                     style="display:inline-block;background:#1e3a5f;color:#fff;
                            text-decoration:none;padding:11px 26px;border-radius:8px;
                            font-weight:600;font-size:13px;">
                    View Proposal
                  </a>
                </div>
                <p style="font-size:11px;color:#9ca3af;text-align:center;margin:0 0 20px;">
                  Or visit: <a href="{viewLink}" style="color:#1e3a5f;">{viewLink}</a>
                </p>

                <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;"/>

                <p style="margin:0;font-size:13px;color:#6b7280;">
                  Regards,<br/>
                  <strong style="color:#0a2540;">BGauss BTL Team</strong>
                </p>

              </div>
            </div>
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body: revision request (Approver → RSM)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildRevisionBody(Proposal p, string? note)
    {
        var senderName = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        // RSM clicks → opens RSMForm in edit mode pre-loaded with this proposal
        var editLink   = $"{_settings.PortalBaseUrl}/rsm-form?edit={p.Id}";

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:600px;">

              <div style="background:#92400e;color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:11px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.7;">
                  BGauss BTL — Revision Requested</p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:20px 24px;border:1px solid #e5e7eb;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 12px;">Dear <strong>{senderName}</strong>,</p>

                <p style="margin:0 0 16px;">
                  Your proposal for <strong>{p.DealerName}</strong>
                  ({p.Location}, {p.State}) for <strong>{p.Month}</strong>
                  has been sent back for revision.
                </p>

                {(string.IsNullOrWhiteSpace(note) ? "" : $"""
                <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;
                             padding:12px 16px;margin:0 0 20px;">
                  <p style="margin:0 0 4px;font-weight:600;color:#92400e;">Reviewer note</p>
                  <p style="margin:0;">{note}</p>
                </div>
                """)}

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#f8fafc;
                              border-radius:6px;margin-bottom:20px;">
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;width:160px;">
                      Token</td>
                    <td style="padding:6px 0;font-family:monospace;font-weight:600;">
                      {p.TokenNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;">Dealer</td>
                    <td style="padding:6px 0;">{p.DealerName}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;">Month</td>
                    <td style="padding:6px 0;">{p.Month}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 16px 6px 12px;color:#6b7280;">Total Budget</td>
                    <td style="padding:6px 0;font-weight:600;">₹{p.TotalBudget:N0}</td>
                  </tr>
                </table>

                <div style="margin:0 0 20px;text-align:center;">
                  <a href="{editLink}"
                     style="display:inline-block;background:#1e3a5f;color:#fff;
                            text-decoration:none;padding:13px 30px;border-radius:8px;
                            font-weight:600;font-size:14px;">
                    ✏ Open &amp; Edit Proposal
                  </a>
                </div>
                <p style="font-size:11px;color:#9ca3af;text-align:center;margin:0 0 20px;">
                  Or copy this link:
                  <a href="{editLink}" style="color:#1e3a5f;">{editLink}</a>
                </p>

                <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;"/>

                <p style="margin:0;font-size:13px;color:#6b7280;">
                  Regards,<br/>
                  <strong style="color:#0a2540;">BGauss BTL Team</strong>
                </p>

              </div>
            </div>
            """;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Body: resubmission (RSM revised and resubmitted → Approver)
    // ─────────────────────────────────────────────────────────────────────────

    private string BuildResubmissionBody(Proposal p)
    {
        var senderName = p.SubmittedByDisplayName ?? p.RsmName ?? p.SubmittedBy;
        // Admin clicks → approver portal opens with this specific proposal's drawer
        var adminLink  = $"{_settings.PortalBaseUrl}/approver?id={p.Id}";
        var overallCac = p.TotalTarget > 0
            ? Math.Round(p.TotalBudget / (decimal)p.TotalTarget, 0) : 0;

        var activityRows = string.Join("\n", p.Activities.Select(a =>
        {
            var total = a.Budget + a.Incentive;
            var days  = (a.EndDate.HasValue && a.StartDate.HasValue)
                ? (a.EndDate.Value.DayNumber - a.StartDate.Value.DayNumber + 1) : 0;
            var dateRange = (a.StartDate.HasValue && a.EndDate.HasValue)
                ? $"{a.StartDate.Value:dd-MMM-yyyy} to {a.EndDate.Value:dd-MMM-yyyy}"
                : "—";
            var cac = a.Target > 0 ? Math.Round(total / (decimal)a.Target, 0) : 0;

            return $"""
                <tr style="border-top:1px solid #e5e7eb;">
                  <td style="padding:8px 12px;font-weight:600;color:#0a2540;">
                    {a.ActivityType}</td>
                  <td style="padding:8px 12px;color:#6b7280;">{dateRange}</td>
                  <td style="padding:8px 12px;color:#6b7280;">{days} days</td>
                  <td style="padding:8px 12px;font-weight:600;">Rs. {total:N0}/-</td>
                  <td style="padding:8px 12px;color:#6b7280;">{a.Target} leads</td>
                  <td style="padding:8px 12px;color:#6b7280;">CAC: Rs. {cac:N0}</td>
                </tr>
                """;
        }));

        return $"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;
                        color:#1a2233;max-width:680px;">

              <div style="background:#1e3a5f;color:#fff;padding:16px 24px;
                          border-radius:8px 8px 0 0;">
                <p style="margin:0;font-size:12px;letter-spacing:1px;
                           text-transform:uppercase;opacity:.7;">
                  BGauss BTL — Resubmitted for Review</p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:700;">{p.TokenNumber}</p>
              </div>

              <div style="padding:20px 24px;border:1px solid #e5e7eb;
                          border-top:none;border-radius:0 0 8px 8px;">

                <p style="margin:0 0 16px;">
                  Hi BGauss Team,<br/>
                  <strong>{senderName}</strong> has <strong>resubmitted</strong> the following
                  proposal after incorporating the requested revisions. Please review and take action.
                </p>

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#f8fafc;
                              border-radius:6px;margin-bottom:20px;">
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;width:160px;">
                      Token</td>
                    <td style="padding:5px 0;font-weight:600;font-family:monospace;">
                      {p.TokenNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Dealer</td>
                    <td style="padding:5px 0;font-weight:600;">{p.DealerName}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Location</td>
                    <td style="padding:5px 0;">{p.Location}, {p.State}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Month</td>
                    <td style="padding:5px 0;">{p.Month}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Eligibility</td>
                    <td style="padding:5px 0;">{p.Eligibility}</td>
                  </tr>
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">RSM / TSM</td>
                    <td style="padding:5px 0;">{p.RsmName}</td>
                  </tr>
                  {(string.IsNullOrWhiteSpace(p.CommandoName) ? "" : $"""
                  <tr>
                    <td style="padding:5px 16px 5px 12px;color:#6b7280;">Commando</td>
                    <td style="padding:5px 0;">{p.CommandoName}</td>
                  </tr>
                  """)}
                </table>

                <p style="margin:0 0 8px;font-size:12px;font-weight:600;
                           color:#0a2540;text-transform:uppercase;letter-spacing:.5px;">
                  Activities
                </p>
                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#fff;
                              border:1px solid #e5e7eb;border-radius:6px;
                              margin-bottom:20px;font-size:13px;">
                  <thead>
                    <tr style="background:#f8fafc;">
                      <th style="padding:8px 12px;text-align:left;color:#6b7280;
                                  font-weight:500;">Activity</th>
                      <th style="padding:8px 12px;text-align:left;color:#6b7280;
                                  font-weight:500;">Dates</th>
                      <th style="padding:8px 12px;text-align:left;color:#6b7280;
                                  font-weight:500;">Days</th>
                      <th style="padding:8px 12px;text-align:left;color:#6b7280;
                                  font-weight:500;">Budget</th>
                      <th style="padding:8px 12px;text-align:left;color:#6b7280;
                                  font-weight:500;">Target</th>
                      <th style="padding:8px 12px;text-align:left;color:#6b7280;
                                  font-weight:500;">CAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityRows}
                  </tbody>
                </table>

                <table cellpadding="0" cellspacing="0"
                       style="width:100%;border-collapse:collapse;background:#f0fdf4;
                              border:1px solid #bbf7d0;border-radius:6px;margin-bottom:20px;">
                  <tr>
                    <td style="padding:8px 16px;color:#166534;font-weight:600;">
                      Overall Summary</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td style="padding:4px 16px;color:#6b7280;width:200px;">
                      Total Target (Leads)</td>
                    <td style="padding:4px 0;font-weight:600;">{p.TotalTarget}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 16px;color:#6b7280;">Total Budget</td>
                    <td style="padding:4px 0;font-weight:600;">Rs. {p.TotalBudget:N0}/-</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 16px 8px;color:#6b7280;">Overall CAC</td>
                    <td style="padding:4px 0 8px;font-weight:600;">Rs. {overallCac:N0}/-</td>
                  </tr>
                </table>

                {(string.IsNullOrWhiteSpace(p.Remarks) ? "" : $"""
                <p style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;
                           padding:10px 14px;margin-bottom:20px;">
                  <strong>Remarks:</strong> {p.Remarks}
                </p>
                """)}

                <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">
                  Please review and take action in the Approver Portal.
                </p>

                <div style="margin:20px 0;text-align:center;">
                  <a href="{adminLink}"
                     style="display:inline-block;background:#1e3a5f;color:#fff;
                            text-decoration:none;padding:13px 30px;border-radius:8px;
                            font-weight:600;font-size:14px;letter-spacing:.2px;">
                    🔍 Review Resubmitted Proposal
                  </a>
                </div>
                <p style="font-size:11px;color:#9ca3af;text-align:center;margin:0 0 20px;">
                  Or visit: <a href="{adminLink}" style="color:#1e3a5f;">{adminLink}</a>
                </p>

                <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;"/>

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
        var start = from.IndexOf('<');
        var end   = from.IndexOf('>');
        if (start >= 0 && end > start)
        {
            var name    = from[..start].Trim();
            var address = from[(start + 1)..end].Trim();
            return new MailAddress(address, name);
        }
        return new MailAddress(from.Trim());
    }
}
using System.Net;
using System.Net.Mail;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;

namespace BGL_BT_App.Backend.Services;

public class SmtpSettings
{
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public string User { get; set; } = string.Empty;       // SMTP auth username
    public string Password { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;       // "Display Name <address@bgauss.com>"
    public bool EnableSsl { get; set; } = true;

    // Fixed mailbox that receives every new RSM proposal for approval.
    public string ApproverEmail { get; set; } = string.Empty;
}

public class EmailService : IEmailService
{
    private readonly SmtpSettings _settings;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IOptions<SmtpSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal p)
    {
        var subject = $"New RSM Proposal — {p.DealerName} ({p.Month}) — Token {p.TokenNumber}";
        var body = BuildSubmissionBody(p);
        return await SendAsync(_settings.ApproverEmail, subject, body);
    }

    public async Task<(bool Sent, string? Error)> SendDecisionMailAsync(Proposal p, ApprovalDecision decision)
    {
        var subject = $"Proposal {decision.Status} — {p.DealerName} ({p.Month}) — Token {p.TokenNumber}";
        var body = BuildDecisionBody(p, decision);

        // The RSM's own sign-in email is stored as SubmittedBy.
        return await SendAsync(p.SubmittedBy, subject, body);
    }

    private async Task<(bool Sent, string? Error)> SendAsync(string to, string subject, string htmlBody)
    {
        if (string.IsNullOrWhiteSpace(to))
            return (false, "No recipient address available.");

        try
        {
            using var client = new SmtpClient(_settings.Host, _settings.Port)
            {
                Credentials = new NetworkCredential(_settings.User, _settings.Password),
                EnableSsl = _settings.EnableSsl,
            };

            using var message = new MailMessage
            {
                From = ParseFrom(_settings.From),
                Subject = subject,
                Body = htmlBody,
                IsBodyHtml = true,
            };
            message.To.Add(to);

            await client.SendMailAsync(message);
            return (true, null);
        }
        catch (Exception ex)
        {
            // Don't let an SMTP outage block the approval/submission workflow —
            // log it and let the caller record MailSent = false for retry.
            _logger.LogError(ex, "Failed to send mail to {To}", to);
            return (false, ex.Message);
        }
    }

    private static MailAddress ParseFrom(string from)
    {
        // Supports "Display Name <address@domain.com>" or a bare address.
        var start = from.IndexOf('<');
        var end = from.IndexOf('>');
        if (start >= 0 && end > start)
        {
            var name = from[..start].Trim();
            var address = from[(start + 1)..end].Trim();
            return new MailAddress(address, name);
        }
        return new MailAddress(from.Trim());
    }

    private static string BuildSubmissionBody(Proposal p)
    {
        var activityRows = string.Join("", p.Activities.Select(a => $"""
            <tr>
              <td>{a.ActivityType}</td>
              <td style="text-align:right">{a.Target}</td>
              <td>{a.StartDate} → {a.EndDate}</td>
              <td style="text-align:right">₹{a.Budget:N0}</td>
              <td style="text-align:right">₹{a.Incentive:N0}</td>
            </tr>
            """));

        return $"""
            <div style="font-family:Segoe UI, Arial, sans-serif; font-size:14px; color:#0a2540;">
              <p>A new proposal has been submitted by <strong>{p.RsmName}</strong>
              ({p.SubmittedBy}) and is awaiting your review.</p>

              <p><strong>Token Number:</strong> {p.TokenNumber}</p>

              <table cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
                <tr><td><strong>Dealer</strong></td><td>{p.DealerName}</td></tr>
                <tr><td><strong>Location</strong></td><td>{p.Location}, {p.State}</td></tr>
                <tr><td><strong>Type</strong></td><td>{p.Type}</td></tr>
                <tr><td><strong>Month</strong></td><td>{p.Month}</td></tr>
                <tr><td><strong>Eligibility</strong></td><td>{p.Eligibility}</td></tr>
                <tr><td><strong>Total Target</strong></td><td>{p.TotalTarget}</td></tr>
                <tr><td><strong>Total Budget</strong></td><td>₹{p.TotalBudget:N0}</td></tr>
                <tr><td><strong>CAC</strong></td><td>₹{p.Cac:N0}</td></tr>
              </table>

              <h3>Activities</h3>
              <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse; width:100%; font-size:13px;">
                <thead>
                  <tr><th>Activity</th><th>Target</th><th>Dates</th><th>Budget</th><th>Incentive</th></tr>
                </thead>
                <tbody>{activityRows}</tbody>
              </table>

              {(string.IsNullOrWhiteSpace(p.Remarks) ? "" : $"<p><strong>Remarks:</strong> {p.Remarks}</p>")}

              <p>Please review and approve or reject this proposal in the Approver Dashboard.</p>
            </div>
            """;
    }

    private static string BuildDecisionBody(Proposal p, ApprovalDecision decision)
    {
        var statusColor = decision.Status == "Approved" ? "#166534" : "#991B1B";

        return $"""
            <div style="font-family:Segoe UI, Arial, sans-serif; font-size:14px; color:#0a2540;">
              <p>Dear {p.RsmName},</p>

              <p>Your proposal for <strong>{p.DealerName}</strong> ({p.State} – {p.Location}),
              month <strong>{p.Month}</strong>, has been
              <strong style="color:{statusColor};">{decision.Status}</strong>.</p>

              <p><strong>Token Number:</strong> {p.TokenNumber}</p>
              <p><strong>Decided by:</strong> {decision.ApprovedBy}</p>

              {(string.IsNullOrWhiteSpace(decision.ApproverNote)
                  ? ""
                  : $"""<p><strong>Approver note:</strong> {decision.ApproverNote}</p>""")}

              <table cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
                <tr><td><strong>Total Budget</strong></td><td>₹{p.TotalBudget:N0}</td></tr>
                <tr><td><strong>Total Target</strong></td><td>{p.TotalTarget}</td></tr>
                <tr><td><strong>CAC</strong></td><td>₹{p.Cac:N0}</td></tr>
              </table>

              <p>Regards,<br/>BGauss BTL Team</p>
            </div>
            """;
    }
}
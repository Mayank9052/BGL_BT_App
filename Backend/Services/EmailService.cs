// backend/Services/EmailService.cs
using System.Net;
using System.Net.Mail;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;

namespace BGL_BT_App.Backend.Services;

public class SmtpSettings
{
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public string User { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;
    public bool EnableSsl { get; set; } = true;
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
        var subject = $"{p.TokenNumber}-{p.Activities.FirstOrDefault()?.ActivityType ?? "Activity"}-{p.DealerName.ToUpper()}-{p.Month}-{p.State}";
        var body = BuildSubmissionBody(p);
        return await SendAsync(_settings.ApproverEmail, subject, body);
    }

    public async Task<(bool Sent, string? Error)> SendDecisionMailAsync(Proposal p, ApprovalDecision decision)
    {
        var subject = $"Re: {p.TokenNumber}-{p.Activities.FirstOrDefault()?.ActivityType ?? "Activity"}-{p.DealerName.ToUpper()}-{p.Month}-{p.State}";
        var body = BuildDecisionBody(p, decision);
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
            _logger.LogError(ex, "Failed to send mail to {To}", to);
            return (false, ex.Message);
        }
    }

    private static MailAddress ParseFrom(string from)
    {
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
        // Calculate CPL = TotalBudget / TotalTarget (leads)
        var cpl = p.TotalTarget > 0 ? Math.Round(p.TotalBudget / p.TotalTarget, 0) : 0;

        // Build per-activity sections
        var activitySections = string.Join("\n", p.Activities.Select((a, i) =>
        {
            var days = (a.EndDate.HasValue && a.StartDate.HasValue)
                ? (a.EndDate.Value.DayNumber - a.StartDate.Value.DayNumber + 1)
                : 0;
            var actCpl = a.Target > 0 ? Math.Round((a.Budget + a.Incentive) / (decimal)a.Target, 0) : 0;
            var actCac = p.TotalTarget > 0 ? Math.Round((a.Budget + a.Incentive) / (decimal)p.TotalTarget, 0) : 0;
            var label = p.Activities.Count > 1 ? $"{(char)('A' + i)}) {a.ActivityType}" : $"A) {a.ActivityType}";

            return $"""
                <p style="margin:12px 0 4px 0;"><strong>{label}</strong></p>
                <p style="margin:2px 0;">No. of Days – {days} days</p>
                <p style="margin:2px 0;">Expected Leads - {a.Target}</p>
                <p style="margin:2px 0;">Expected Retail - {(int)Math.Ceiling(a.Target / 20.0)}</p>
                <br/>
                <p style="margin:2px 0;"><strong>Amount for Consideration:</strong></p>
                <p style="margin:2px 0;">Total budget - Rs. {a.Budget + a.Incentive:N0}/- (incl. of taxes)</p>
                <p style="margin:2px 0;">CPL - Rs. {actCpl:N0}/- (from total amount)</p>
                <p style="margin:2px 0;">CAC - Rs. {actCac:N0}/- (from total amount)</p>
                """;
        }));

        return $"""
            <div style="font-family:Arial, sans-serif; font-size:14px; color:#000;">
              <p>Hi BGauss Team,</p>
              <p>Please find below the working for Pre-Campaign:</p>

              <p style="margin:4px 0;"><strong>Dealer Name:</strong> {p.DealerName}</p>

              {activitySections}

              {(string.IsNullOrWhiteSpace(p.Remarks) ? "" : $"<p><strong>Remarks:</strong> {p.Remarks}</p>")}

              <br/>
              <p>Thanks &amp; Regards<br/>
              {p.RsmName}<br/>
              {(string.IsNullOrWhiteSpace(p.CommandoName) ? "" : p.CommandoName + "<br/>")}
              BGauss Auto Pvt. Ltd.</p>
            </div>
            """;
    }

    private static string BuildDecisionBody(Proposal p, ApprovalDecision decision)
    {
        var statusColor = decision.Status == "Approved" ? "#166534" : "#991B1B";

        return $"""
            <div style="font-family:Arial, sans-serif; font-size:14px; color:#000;">
              <p>Dear {p.RsmName},</p>

              <p>Your proposal for <strong>{p.DealerName}</strong> ({p.State} – {p.Location}),
              month <strong>{p.Month}</strong>, has been
              <strong style="color:{statusColor};">{decision.Status}</strong>.</p>

              <p><strong>Token Number:</strong> {p.TokenNumber}</p>
              <p><strong>Decided by:</strong> {decision.ApprovedBy}</p>

              {(string.IsNullOrWhiteSpace(decision.ApproverNote)
                  ? ""
                  : $"<p><strong>Approver note:</strong> {decision.ApproverNote}</p>")}

              <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
                <tr><td><strong>Total Budget</strong></td><td>₹{p.TotalBudget:N0}</td></tr>
                <tr><td><strong>Total Target</strong></td><td>{p.TotalTarget}</td></tr>
                <tr><td><strong>CAC</strong></td><td>₹{p.Cac:N0}</td></tr>
              </table>

              <p>Regards,<br/>BGauss BTL Team</p>
            </div>
            """;
    }
}
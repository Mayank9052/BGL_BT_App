// Services/DailyDigestService.cs
// Background service — fires daily at scheduled time (IST).
// Sends ONE summary email to FinalApproverEmail via Microsoft Graph API
// using the Graph token stored by BulkForwardController.

using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public class DailyDigestService : BackgroundService
{
    private readonly IServiceScopeFactory        _scopeFactory;
    private readonly IConfiguration              _cfg;
    private readonly ILogger<DailyDigestService> _log;
    private readonly GraphTokenStore             _tokenStore;
    private readonly IHttpClientFactory          _httpClientFactory;

    // TEST: 5:00 PM IST = 11:30 UTC  (change back to 18,30,0 for midnight IST production)
    private static readonly TimeSpan DigestTimeUtc = new(13, 0, 0); // 6:30 PM IST

    public DailyDigestService(
        IServiceScopeFactory        scopeFactory,
        IConfiguration              cfg,
        ILogger<DailyDigestService> log,
        GraphTokenStore             tokenStore,
        IHttpClientFactory          httpClientFactory)
    {
        _scopeFactory      = scopeFactory;
        _cfg               = cfg;
        _log               = log;
        _tokenStore        = tokenStore;
        _httpClientFactory = httpClientFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        _log.LogInformation("DailyDigestService started — fires at {utc} UTC ({h}:{m} IST)",
            DigestTimeUtc, (DigestTimeUtc.Hours + 5) % 24, (DigestTimeUtc.Minutes + 30) % 60);

        while (!ct.IsCancellationRequested)
        {
            var delay = TimeUntilNextFire();
            _log.LogInformation("DailyDigest: next fire in {h}h {m}m", (int)delay.TotalHours, delay.Minutes);
            await Task.Delay(delay, ct);

            if (!ct.IsCancellationRequested)
                await SendDailyDigestAsync(ct);
        }
    }

    private static TimeSpan TimeUntilNextFire()
    {
        var now  = DateTime.UtcNow;
        var next = now.Date.Add(DigestTimeUtc);
        if (next <= now) next = next.AddDays(1);
        return next - now;
    }

    private async Task SendDailyDigestAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // IST window for "today"
            var istNow   = DateTime.UtcNow.AddHours(5).AddMinutes(30);
            var todayIst = istNow.Date;
            var startUtc = todayIst.AddHours(-5).AddMinutes(-30);
            var endUtc   = startUtc.AddDays(1);

            var proposals = await db.Proposals
                .Where(p =>
                    p.CheckedByEmail != null &&
                    p.CheckedAt      != null &&
                    p.CheckedAt >= startUtc &&
                    p.CheckedAt <  endUtc   &&
                    (p.DigestSent == null || p.DigestSent == false))
                .Include(p => p.Activities)
                .OrderBy(p => p.State)
                .ToListAsync(ct);

            if (proposals.Count == 0)
            {
                _log.LogInformation("Daily digest: no forwarded proposals today — no email sent.");
                return;
            }

            var finalEmail = _cfg["Smtp:FinalApproverEmail"]
                          ?? _cfg["FinalApproverEmail"]
                          ?? "vijay.maurya@bgauss.com";
            var portalUrl  = _cfg["Smtp:PortalBaseUrl"]
                          ?? _cfg["PortalUrl"]
                          ?? "https://44.210.115.237";

            var subject = $"[BGauss BTL] Daily Forwarded Proposals Digest — " +
                          $"{todayIst:dd MMM yyyy} ({proposals.Count} proposal{(proposals.Count != 1 ? "s" : "")})";

            var html = BuildDigestHtml(proposals, todayIst, portalUrl);

            // Try Graph API first (preferred — same as rest of app)
            var tokenInfo = _tokenStore.GetValid();
            bool sent = false;

            if (tokenInfo != null)
            {
                sent = await SendViaGraphAsync(tokenInfo.Value.SenderEmail, finalEmail, subject, html, tokenInfo.Value.Token);
                if (sent)
                    _log.LogInformation("Digest sent via Graph API → {email}", finalEmail);
            }

            if (!sent)
            {
                _log.LogWarning("Graph token unavailable or expired — trying SMTP fallback.");
                sent = await SendViaSmtpFallbackAsync(finalEmail, subject, html);
            }

            if (!sent)
            {
                _log.LogError("Could not send digest — both Graph and SMTP failed. Will retry tomorrow.");
                return;
            }

            // Mark digested
            foreach (var p in proposals) p.DigestSent = true;
            await db.SaveChangesAsync(ct);
            _log.LogInformation("Daily digest complete — {count} proposals marked digested.", proposals.Count);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "DailyDigestService.SendDailyDigestAsync error");
        }
    }

    // ── Graph API send ──────────────────────────────────────────────────────────
    private async Task<bool> SendViaGraphAsync(
        string senderEmail, string toEmail,
        string subject, string htmlBody,
        string graphToken)
    {
        try
        {
            var payload = new
            {
                message = new
                {
                    subject,
                    body = new { contentType = "HTML", content = htmlBody },
                    toRecipients = new[]
                    {
                        new { emailAddress = new { address = toEmail } }
                    }
                },
                saveToSentItems = false
            };

            var json    = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", graphToken);

            var url = $"https://graph.microsoft.com/v1.0/users/{senderEmail}/sendMail";
            var res = await client.PostAsync(url, content);

            if (res.IsSuccessStatusCode) return true;
            var err = await res.Content.ReadAsStringAsync();
            _log.LogWarning("Graph sendMail failed {status}: {err}", res.StatusCode, err);
            return false;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "SendViaGraphAsync exception");
            return false;
        }
    }

    // ── SMTP fallback ───────────────────────────────────────────────────────────
    private async Task<bool> SendViaSmtpFallbackAsync(string toEmail, string subject, string htmlBody)
    {
        try
        {
            var host      = _cfg["Smtp:Host"]     ?? "";
            var portStr   = _cfg["Smtp:Port"]     ?? "587";
            var user      = _cfg["Smtp:Username"] ?? _cfg["Smtp:ApproverEmail"] ?? "";
            var pass      = _cfg["Smtp:Password"] ?? "";
            var fromEmail = _cfg["Smtp:FromEmail"] ?? user;

            if (string.IsNullOrEmpty(host) || string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass))
            {
                _log.LogWarning("SMTP not configured — no fallback available.");
                return false;
            }

            using var smtp = new System.Net.Mail.SmtpClient(host, int.Parse(portStr));
            smtp.EnableSsl   = true;
            smtp.Credentials = new System.Net.NetworkCredential(user, pass);

            using var msg = new System.Net.Mail.MailMessage();
            msg.From       = new System.Net.Mail.MailAddress(fromEmail, "BGauss BTL Portal");
            msg.To.Add(toEmail);
            msg.Subject    = subject;
            msg.Body       = htmlBody;
            msg.IsBodyHtml = true;

            await smtp.SendMailAsync(msg);
            _log.LogInformation("Digest sent via SMTP → {email}", toEmail);
            return true;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "SMTP fallback failed");
            return false;
        }
    }

    // ── HTML builder ────────────────────────────────────────────────────────────
    private static string BuildDigestHtml(
        List<Proposal> proposals, DateTime date, string portalUrl)
    {
        var totalBudget = proposals.Sum(p => p.TotalBudget);
        var sb          = new StringBuilder();

        sb.Append($@"<!DOCTYPE html>
<html>
<head><meta charset='UTF-8'/>
<style>
  body{{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;color:#1e293b;}}
  .wrap{{max-width:920px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);overflow:hidden;}}
  .hdr{{background:#0a2540;padding:28px 32px;}}
  .hdr h1{{color:#fff;margin:0;font-size:22px;font-weight:700;}}
  .hdr p{{color:#93c5fd;margin:6px 0 0;font-size:14px;}}
  .kpis{{display:flex;border-bottom:2px solid #f1f5f9;}}
  .kpi{{flex:1;padding:18px 24px;text-align:center;border-right:1px solid #f1f5f9;}}
  .kpi:last-child{{border-right:none;}}
  .kv{{font-size:30px;font-weight:800;color:#0a2540;}}
  .kl{{font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;}}
  .sec{{padding:24px 32px;}}
  table{{width:100%;border-collapse:collapse;font-size:13px;}}
  th{{background:#0a2540;color:#e2e8f0;padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}}
  td{{padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top;}}
  tr:nth-child(even) td{{background:#f8fafc;}}
  .badge{{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:#fef3c7;color:#92400e;}}
  .cta{{text-align:center;padding:28px 32px;background:#f0fdf4;}}
  .btn{{display:inline-block;background:#0a2540;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:16px;}}
  .foot{{padding:14px 32px;background:#f8fafc;font-size:11px;color:#94a3b8;text-align:center;}}
  .mono{{font-family:monospace;}}
</style>
</head>
<body>
<div class='wrap'>
  <div class='hdr'>
    <h1>&#128203; BGauss BTL — Daily Forwarded Proposals Digest</h1>
    <p>{date:dddd, dd MMMM yyyy} &middot; {proposals.Count} proposal{(proposals.Count != 1 ? "s" : "")} forwarded by Checker team</p>
  </div>
  <div class='kpis'>
    <div class='kpi'><div class='kv'>{proposals.Count}</div><div class='kl'>Proposals</div></div>
    <div class='kpi'><div class='kv'>&#8377;{totalBudget / 100000m:F1}L</div><div class='kl'>Total Budget</div></div>
    <div class='kpi'><div class='kv'>{proposals.Select(p => p.State).Distinct().Count()}</div><div class='kl'>States</div></div>
    <div class='kpi'><div class='kv'>{proposals.Select(p => p.DealerName).Distinct().Count()}</div><div class='kl'>Dealers</div></div>
  </div>
  <div class='sec'>
    <h2 style='margin:0 0 16px;font-size:16px;color:#0a2540;'>Proposal Summary — Action Required</h2>
    <table>
      <tr><th>#</th><th>Token</th><th>Dealer</th><th>State</th><th>RSM</th><th>Month</th><th>Activities</th><th>Budget</th><th>Forwarded By</th><th>Status</th></tr>");

        int n = 1;
        foreach (var p in proposals)
        {
            var acts   = p.Activities?.Select(a => a.ActivityType).Distinct().Take(3) ?? [];
            var actStr = string.Join(", ", acts);
            var fwdBy  = (p.CheckedByEmail ?? "").Split('@')[0];
            var fwdAt  = p.CheckedAt.HasValue
                ? p.CheckedAt.Value.AddHours(5).AddMinutes(30).ToString("HH:mm")
                : "—";

            sb.Append($@"
      <tr>
        <td>{n++}</td>
        <td><strong>{System.Net.WebUtility.HtmlEncode(p.TokenNumber ?? "—")}</strong></td>
        <td><strong>{System.Net.WebUtility.HtmlEncode(p.DealerName ?? "—")}</strong></td>
        <td>{System.Net.WebUtility.HtmlEncode(p.State ?? "—")}</td>
        <td>{System.Net.WebUtility.HtmlEncode(p.RsmName ?? "—")}</td>
        <td>{System.Net.WebUtility.HtmlEncode(p.Month ?? "—")}</td>
        <td style='font-size:11px;'>{System.Net.WebUtility.HtmlEncode(actStr.Length > 0 ? actStr : "—")}</td>
        <td class='mono'>&#8377;{p.TotalBudget / 100000m:F1}L</td>
        <td style='font-size:11px;'>{System.Net.WebUtility.HtmlEncode(fwdBy)} at {fwdAt} IST</td>
        <td><span class='badge'>Pending</span></td>
      </tr>");
        }

        sb.Append($@"
    </table>
  </div>
  <div class='cta'>
    <p style='color:#374151;font-size:14px;margin-bottom:18px;font-weight:600;'>
      Please log in and review these {proposals.Count} proposal{(proposals.Count != 1 ? "s" : "")} — Approve or Reject from the portal.
    </p>
    <a href='{portalUrl}/approver' class='btn'>&#128269; Open Approver Dashboard</a>
    <p style='color:#94a3b8;font-size:12px;margin-top:14px;'>
      <a href='{portalUrl}/approver' style='color:#2563eb;'>{portalUrl}/approver</a>
    </p>
  </div>
  <div class='foot'>
    Automated daily digest from BGauss BTL Portal &mdash; do not reply.<br/>
    Generated: {DateTime.UtcNow.AddHours(5).AddMinutes(30):dd MMM yyyy HH:mm} IST
  </div>
</div>
</body></html>");

        return sb.ToString();
    }
}
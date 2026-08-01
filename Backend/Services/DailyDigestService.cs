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
    private readonly IHttpClientFactory          _httpClientFactory;

    // ── FIX: 18:30 UTC = 00:00 (midnight) IST — the actual production time. ──
    private static readonly TimeSpan DigestTimeUtc = new(18, 30, 0);
    
    //private static readonly TimeSpan DigestTimeUtc = new(10, 0, 0);
    
    public DailyDigestService(
        IServiceScopeFactory        scopeFactory,
        IConfiguration              cfg,
        ILogger<DailyDigestService> log,
        IHttpClientFactory          httpClientFactory)
    {
        _scopeFactory      = scopeFactory;
        _cfg               = cfg;
        _log               = log;
        _httpClientFactory = httpClientFactory;
    }

    // ── NEW: app-only Graph token via Client Credentials flow.
    // Doesn't depend on any Checker being logged in recently — a fresh
    // token is acquired at send time, every time, guaranteed to be valid. ──
    private async Task<string?> AcquireAppOnlyGraphTokenAsync()
    {
        var tenantId     = _cfg["AzureAd:TenantId"];
        var clientId     = _cfg["AzureAd:ClientId"];
        var clientSecret = _cfg["AzureAd:ClientSecret"];

        _log.LogInformation(
            "AcquireAppOnlyGraphTokenAsync: tenantId={tenant} clientId={client} secretLen={len}",
            tenantId, clientId, clientSecret?.Length ?? 0);

        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            _log.LogError("AzureAd:ClientSecret not configured — cannot acquire app-only Graph token.");
            return null;
        }

        try
        {
            var app = Microsoft.Identity.Client.ConfidentialClientApplicationBuilder
                .Create(clientId)
                .WithClientSecret(clientSecret)
                .WithAuthority(new Uri($"https://login.microsoftonline.com/{tenantId}"))
                .Build();

            var result = await app.AcquireTokenForClient(new[] { "https://graph.microsoft.com/.default" })
                .ExecuteAsync();

            _log.LogInformation(
                "Graph app-only token acquired OK. Expires: {exp}. Scopes: {scopes}. TokenSource: {source}",
                result.ExpiresOn, string.Join(",", result.Scopes), result.AuthenticationResultMetadata.TokenSource);

            return result.AccessToken;
        }
        catch (Microsoft.Identity.Client.MsalServiceException msalEx)
        {
            _log.LogError(msalEx,
                "MSAL service exception acquiring app-only token. ErrorCode={code} CorrelationId={corr} ResponseBody={body}",
                msalEx.ErrorCode, msalEx.CorrelationId, msalEx.ResponseBody);
            return null;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Unexpected exception acquiring app-only Graph token for daily digest. Type={type}", ex.GetType().FullName);
            return null;
        }
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

            // ── FIX: acquire a fresh app-only Graph token every time —
            // no dependency on any Checker's session or its 55-minute window. ──
            var appToken = await AcquireAppOnlyGraphTokenAsync();
            bool sent = false;

            if (appToken != null)
            {
                var senderMailbox = _cfg["Smtp:DigestSenderMailbox"]
                                 ?? _cfg["Smtp:ApproverEmail"]
                                 ?? "mayank.maheshwari@bgauss.com";
                sent = await SendViaGraphAsync(senderMailbox, finalEmail, subject, html, appToken);
                if (sent)
                    _log.LogInformation("Digest sent via app-only Graph API → {email}", finalEmail);
                else
                    _log.LogWarning("App-only Graph send failed — trying SMTP fallback.");
            }
            else
            {
                _log.LogWarning("Could not acquire app-only Graph token — trying SMTP fallback.");
            }

            if (!sent)
            {
                sent = await SendViaSmtpFallbackAsync(finalEmail, subject, html);
            }

            if (!sent)
            {
                _log.LogError("Could not send digest — both app-only Graph and SMTP failed. Will retry tomorrow.");
                foreach (var p in proposals) p.DigestSendError = "Both Graph and SMTP send attempts failed.";
                await db.SaveChangesAsync(ct);
                return;
            }

            // Mark digested — record when it succeeded and clear any prior error
            foreach (var p in proposals)
            {
                p.DigestSent      = true;
                p.DigestSentAt    = DateTime.UtcNow;
                p.DigestSendError = null;
            }
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
                saveToSentItems = true
            };

            var json    = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", graphToken);

            var url = $"https://graph.microsoft.com/v1.0/users/{senderEmail}/sendMail";
            _log.LogInformation("Calling Graph sendMail: {url} (sender={sender}, to={to})", url, senderEmail, toEmail);

            var res = await client.PostAsync(url, content);
            var responseBody = await res.Content.ReadAsStringAsync();

            _log.LogInformation("Graph sendMail response: {status} body={body}",
                res.StatusCode, string.IsNullOrEmpty(responseBody) ? "(empty)" : responseBody);

            if (res.IsSuccessStatusCode) return true;
            _log.LogWarning("Graph sendMail failed {status}: {err}", res.StatusCode, responseBody);
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
        var proposalIds = string.Join(",", proposals.Select(p => p.Id));
        var reviewUrl   = $"{portalUrl}/approver?highlight={Uri.EscapeDataString(proposalIds)}";

        return $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;
                    background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
          <div style="background:#0a2540;padding:24px 28px;text-align:center">
            <div style="color:#fff;font-size:18px;font-weight:700">
              📋 {proposals.Count} Proposal{(proposals.Count != 1 ? "s" : "")} Awaiting Your Review
            </div>
            <div style="color:#93c5fd;font-size:12px;margin-top:6px">
              Forwarded by Checker · {date:dd MMM yyyy}
            </div>
          </div>
          <div style="padding:24px 28px;text-align:center">
            <div style="font-size:13px;color:#374151;margin-bottom:18px">
              Total Budget: <strong>₹{totalBudget:N0}</strong> ·
              States: <strong>{proposals.Select(p => p.State).Distinct().Count()}</strong> ·
              Dealers: <strong>{proposals.Select(p => p.DealerName).Distinct().Count()}</strong>
            </div>
            <a href="{reviewUrl}"
              style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;
                     padding:13px 32px;border-radius:8px;font-weight:700;font-size:14px">
              ✓ Review &amp; Approve →
            </a>
          </div>
          <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 28px;
                     font-size:11px;color:#94a3b8;text-align:center">
            BGauss BTL Portal · Automated digest, do not reply.
          </div>
        </div>
        """;
    }
}
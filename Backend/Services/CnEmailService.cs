// Backend/Services/CnEmailService.cs
//
// All CN workflow emails. Sent with an APP-ONLY Graph token from the Checker
// mailbox (Cn:SenderMailbox → Smtp:DigestSenderMailbox → Smtp:ApproverEmail),
// because RSM / Dealer logins are local and have no Microsoft token.
// Copy of every mail lands in that mailbox's Sent Items.
//
// Attachments:
//   ≤ 3 MB total  → one /sendMail call (Graph request limit is ~4 MB).
//   >  3 MB total → draft + upload session (needs Mail.ReadWrite Application permission).
//                   If that fails, small files are attached and the rest go as portal links.
//
// Graph permissions (app registration, admin consent):
//   Mail.Send      (Application) — already used by password-reset mail
//   Mail.ReadWrite (Application) — only for attachments > 3 MB total

using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using BGL_BT_App.Backend.Helpers;
using BGL_BT_App.Backend.Models;
using Microsoft.Extensions.Options;

namespace BGL_BT_App.Backend.Services;

public record CnMailAttachment(string FileName, string ContentType, byte[] Content, string? SourceUrl = null);
public record CnMailLink(string Label, string Url);
public record CnMailResult(bool Sent, string? Error, List<string> Notes);

internal sealed class CnGraphFileAttachment
{
    [JsonPropertyName("@odata.type")] public string OdataType    { get; init; } = "#microsoft.graph.fileAttachment";
    [JsonPropertyName("name")]         public string Name         { get; init; } = "";
    [JsonPropertyName("contentType")]  public string ContentType  { get; init; } = "";
    [JsonPropertyName("contentBytes")] public string ContentBytes { get; init; } = "";
}

public class CnEmailService
{
    private const string GraphBase        = "https://graph.microsoft.com/v1.0";
    private const int    SimpleLimitBytes = 3 * 1024 * 1024;
    private const int    ChunkBytes       = 320 * 1024 * 10;   // must be a multiple of 320 KiB
    private static readonly CultureInfo Inr = new("en-IN");
    private static readonly TimeSpan    Ist = new(5, 30, 0);
    private static readonly Regex EmailRx = new(@"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$", RegexOptions.Compiled);

    private readonly IHttpClientFactory      _httpFactory;
    private readonly GraphAppTokenService    _appToken;
    private readonly SmtpSettings            _smtp;
    private readonly IConfiguration          _cfg;
    private readonly ILogger<CnEmailService> _log;

    public CnEmailService(IHttpClientFactory httpFactory, GraphAppTokenService appToken,
                          IOptions<SmtpSettings> smtp, IConfiguration cfg, ILogger<CnEmailService> log)
    {
        _httpFactory = httpFactory; _appToken = appToken; _smtp = smtp.Value; _cfg = cfg; _log = log;
    }

    // ── Configuration ─────────────────────────────────────────────────────────
    public string SenderMailbox => FirstNonEmpty(_cfg["Cn:SenderMailbox"], _cfg["Smtp:DigestSenderMailbox"], _smtp.ApproverEmail);
    public string PortalUrl     => (_smtp.PortalBaseUrl ?? "").TrimEnd('/');
    public List<string> CheckerEmails  => Split(_smtp.ApproverEmail, _smtp.ApproverEmail2, _cfg["Cn:CheckerEmails"]);
    public List<string> ViewerEmails   => Split(_smtp.FinalApproverEmail, _cfg["Cn:ViewerEmails"]);
    public List<string> AccountsEmails => Split(FirstNonEmpty(_cfg["Cn:AccountsTeamEmails"], _smtp.AccountsTeamEmails));
    public List<string> AccountsCc     => Split(_cfg["Cn:AccountsCc"]);

    public static bool IsEmail(string? a) => !string.IsNullOrWhiteSpace(a) && EmailRx.IsMatch(a.Trim());

    public static List<string> Split(params string?[] values) => values
        .SelectMany(v => (v ?? "").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
        .Select(x => x.Trim())
        .Where(x => IsEmail(x))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static string FirstNonEmpty(params string?[] v) =>
        v.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x))?.Trim() ?? "";

    // ═══════════════════════════════════════════════════════════════════════════
    // WORKFLOW MAILS
    // ═══════════════════════════════════════════════════════════════════════════

    // Step 1 — Checker → RSM: approve the activity for CN
    public Task<CnMailResult> SendRsmApprovalRequestAsync(
        Proposal p, ProposalActivity a, CnReportRow r, List<string> rsmEmails, string checkerName)
    {
        var html = Shell("#1e3a5f", "Credit Note — RSM Approval Required", p.TokenNumber, $"""
            <p style="margin:0 0 12px;font-size:13px;">Dear RSM,<br/>
              The post-activity proof (photos + vendor invoice) for the activity below has been verified by
              <strong>{H(checkerName)}</strong>. Please review it in the BTL portal and <strong>Approve</strong>
              or <strong>Reject</strong> it for Credit Note processing.</p>
            {InfoTable(p, a)}
            {PlanVsActual(r, includeActualBudget: false)}
            {DocsLine(r)}
            {Button(PortalUrl, "🔍 Review &amp; Approve in Portal")}
            <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Portal path: Approved proposal → {H(a.ActivityType)} → Post-Activity → Credit Note.</p>
            """);
        return SendAsync(rsmEmails, new(), Subject("RSM Approval Required", p, a), html);
    }

    // Step 2a — RSM approved → Dealer: raise invoice in BGauss's name
    public Task<CnMailResult> SendRsmApprovedAsync(
        Proposal p, ProposalActivity a, CnReportRow r, List<string> dealerEmails, List<string> cc, string decidedBy)
    {
        var billing = _cfg["Cn:BillingDetailsHtml"];
        var billingBlock = string.IsNullOrWhiteSpace(billing) ? "" : $"""
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:12px;">
              <strong>Bill to:</strong><br/>{billing}</div>
            """;
        var html = Shell("#166534", "Credit Note — RSM Approved · Invoice Required", p.TokenNumber, $"""
            <p style="margin:0 0 12px;font-size:13px;">Dear <strong>{H(p.DealerName)}</strong> Team,<br/>
              The activity below has been <strong>approved by the RSM</strong> ({H(decidedBy)}) for Credit Note processing.
              Please raise the invoice <strong>in the name of BGauss Auto Pvt. Ltd.</strong> for an amount
              <strong>not exceeding {Rs(r.ApprovedBudget)}</strong> (approved BGauss share) and upload it in the portal.</p>
            {billingBlock}
            {InfoTable(p, a)}
            {PlanVsActual(r, includeActualBudget: false)}
            <div style="background:#eff6ff;border-left:3px solid #3b82f6;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#1e40af;">
              Upload path: Portal → Dealer Dashboard → proposal → Post-Activity → <strong>Credit Note → Upload BGauss Invoice</strong>
              (enter the invoice amount while uploading).</div>
            {Button(PortalUrl, "📤 Upload BGauss Invoice")}
            """);
        return SendAsync(dealerEmails, cc, Subject("RSM Approved — Upload BGauss Invoice", p, a), html);
    }

    // Step 2b — RSM rejected → Checker (+ Dealer + RSM cc)
    public Task<CnMailResult> SendRsmRejectedAsync(
        Proposal p, ProposalActivity a, string note, string decidedBy, List<string> cc)
    {
        var html = Shell("#991B1B", "Credit Note — Rejected by RSM", p.TokenNumber, $"""
            <p style="margin:0 0 10px;font-size:13px;">The CN request for <strong>{H(a.ActivityType)}</strong> at
              <strong>{H(p.DealerName)}</strong> was <strong>rejected</strong> by {H(decidedBy)}.</p>
            <div style="background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#7f1d1d;">
              <strong>Reason:</strong> {H(note)}</div>
            {InfoTable(p, a)}
            <p style="margin:0;font-size:12px;color:#6b7280;">Dealer / RSM: correct the photos or vendor invoice in the portal.
              Checker: re-verify and click <strong>Send for RSM Approval</strong> again.</p>
            {Button(PortalUrl, "Open Portal", "#991B1B")}
            """);
        return SendAsync(CheckerEmails, cc, Subject("Rejected by RSM", p, a), html);
    }

    // Step 3 — BGauss-name invoice uploaded → Checker
    public Task<CnMailResult> SendFinalInvoiceReceivedAsync(
        Proposal p, ProposalActivity a, CnReportRow r, string uploadedBy, List<string> cc)
    {
        var html = Shell("#0369a1", "Credit Note — BGauss Invoice Received", p.TokenNumber, $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi {H(FirstName(_smtp.ApproverEmail))},<br/>
              The invoice in BGauss's name has been uploaded by <strong>{H(uploadedBy)}</strong>.
              Please verify it and click <strong>Send to Accounts</strong> in the portal.</p>
            {InfoTable(p, a)}
            {PlanVsActual(r, includeActualBudget: true)}
            {Button(PortalUrl, "📧 Verify &amp; Send to Accounts", "#0369a1")}
            """);
        return SendAsync(CheckerEmails, cc, Subject("BGauss Invoice Received", p, a), html);
    }

    // Step 4 — Checker → Accounts, with all supporting documents attached
    public Task<CnMailResult> SendToAccountsAsync(
        Proposal p, ProposalActivity a, CnReportRow r,
        List<CnMailAttachment> attachments, List<CnMailLink> links, List<string> cc, string sentBy)
    {
        var attachedList = attachments.Count == 0 ? "<li>None</li>"
            : string.Concat(attachments.Select(x => $"<li>{H(x.FileName)} ({x.Content.Length / 1024:N0} KB)</li>"));
        var linkList = links.Count == 0 ? ""
            : $"""
              <p style="margin:10px 0 4px;font-size:12px;font-weight:600;color:#374151;">Additional documents (links):</p>
              <ul style="margin:0 0 10px;padding-left:18px;font-size:12px;">{string.Concat(links.Select(l => $"<li><a href=\"{H(l.Url)}\">{H(l.Label)}</a></li>"))}</ul>
              """;

        var html = Shell("#166534", "Credit Note — Ready for Processing", p.TokenNumber, $"""
            <p style="margin:0 0 12px;font-size:13px;">Hi Accounts Team,<br/>
              The activity below has been verified by the Checker and approved by the RSM. The dealer has
              submitted the invoice in BGauss's name. Please process the <strong>Credit Note</strong>.
              All supporting documents are attached.</p>
            {PostActivityFormat(r)}
            {InfoTable(p, a)}
            {PlanVsActual(r, includeActualBudget: true)}
            <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:12px;font-size:12px;">
              {KV("BGauss invoice amount", Rs(a.CnInvoiceAmount))}
              {KV("Approved BGauss amount", Rs(r.ApprovedBudget))}
              {KV("RSM approved", $"{H(a.CnRsmDecidedByEmail)} · {D(a.CnRsmDecidedAt)}")}
              {KV("Proof verified by", $"{H(a.CnRequestedByEmail)} · {D(a.CnRequestedAt)}")}
              {KV("Sent by", H(sentBy))}
            </table>
            <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#374151;">Attached ({attachments.Count}):</p>
            <ul style="margin:0 0 10px;padding-left:18px;font-size:12px;">{attachedList}</ul>
            {linkList}
            <p style="margin:12px 0 0;font-size:11px;color:#6b7280;">Once the CN is issued, please reply with the <strong>CN number</strong> so it can be recorded in the portal.<br/>Portal reference: {H(p.TokenNumber)}</p>
            """);
        return SendAsync(AccountsEmails, cc, Subject("Ready for Processing", p, a), html, attachments);
    }

    // Step 5 — CN processed → Dealer + team
    public Task<CnMailResult> SendCnProcessedAsync(
        Proposal p, ProposalActivity a, CnReportRow r, List<string> to, List<string> cc)
    {
        var html = Shell("#166534", "Credit Note Processed", p.TokenNumber, $"""
            <p style="margin:0 0 12px;font-size:13px;">Dear <strong>{H(p.DealerName)}</strong> Team,<br/>
              The Credit Note for the activity below has been processed by BGauss Accounts.</p>
            <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-bottom:12px;font-size:12px;">
              {KV("CN number", H(a.CnNumber))}
              {KV("CN amount (invoice)", Rs(a.CnInvoiceAmount))}
              {KV("Processed on", D(a.CnProcessedAt))}
            </table>
            {InfoTable(p, a)}
            """);
        return SendAsync(to, cc, Subject($"CN Processed — {a.CnNumber}", p, a), html);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE SEND
    // ═══════════════════════════════════════════════════════════════════════════
    private async Task<CnMailResult> SendAsync(
        List<string> to, List<string> cc, string subject, string html, List<CnMailAttachment>? attachments = null)
    {
        var notes  = new List<string>();
        var toList = to.Where(x => IsEmail(x)).Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var ccList = cc.Where(x => IsEmail(x)).Select(x => x.Trim())
                       .Where(x => !toList.Contains(x, StringComparer.OrdinalIgnoreCase))
                       .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        if (toList.Count == 0) return new CnMailResult(false, "No valid recipient email.", notes);
        if (string.IsNullOrWhiteSpace(SenderMailbox))
            return new CnMailResult(false, "Sender mailbox not configured (Cn:SenderMailbox).", notes);

        string token;
        try { token = await _appToken.GetAppOnlyTokenAsync(); }
        catch (Exception ex)
        {
            _log.LogError(ex, "CN mail: app-only token failed");
            return new CnMailResult(false, "Could not get Graph app token: " + ex.Message, notes);
        }

        var http  = _httpFactory.CreateClient("cn-graph");
        var atts  = attachments ?? new List<CnMailAttachment>();
        var total = atts.Sum(x => (long)x.Content.Length);

        if (total <= SimpleLimitBytes)
        {
            var (ok, err) = await PostSendMailAsync(http, token, Message(subject, html, toList, ccList, atts));
            return new CnMailResult(ok, err, notes);
        }

        var (draftOk, draftErr) = await SendViaDraftAsync(http, token, Message(subject, html, toList, ccList, null), atts);
        if (draftOk) return new CnMailResult(true, null, notes);

        // Fallback: attach what fits in one request, link the rest.
        _log.LogWarning("CN mail: large-attachment upload failed ({Err}) — falling back to links.", draftErr);
        var keep = new List<CnMailAttachment>();
        var dropped = new List<CnMailAttachment>();
        long used = 0;
        foreach (var x in atts)
        {
            if (used + x.Content.Length <= SimpleLimitBytes) { keep.Add(x); used += x.Content.Length; }
            else dropped.Add(x);
        }
        var (ok2, err2) = await PostSendMailAsync(http, token,
            Message(subject, html + DroppedFilesHtml(dropped), toList, ccList, keep));
        if (ok2)
            notes.Add($"{dropped.Count} large file(s) sent as portal links — grant Graph 'Mail.ReadWrite' (Application) to attach them. Detail: {Trim(draftErr, 200)}");
        return new CnMailResult(ok2, err2, notes);
    }

    private static Dictionary<string, object?> Message(
        string subject, string html, List<string> to, List<string> cc, List<CnMailAttachment>? atts)
    {
        var m = new Dictionary<string, object?>
        {
            ["subject"]      = subject,
            ["body"]         = new { contentType = "HTML", content = html },
            ["toRecipients"] = to.Select(Rcpt).ToArray(),
            ["ccRecipients"] = cc.Select(Rcpt).ToArray(),
        };
        if (atts is { Count: > 0 }) m["attachments"] = atts.Select(ToGraph).ToArray();
        return m;
    }

    private static object Rcpt(string e) => new { emailAddress = new { address = e } };

    private static CnGraphFileAttachment ToGraph(CnMailAttachment a) => new()
    {
        Name = a.FileName, ContentType = a.ContentType, ContentBytes = Convert.ToBase64String(a.Content),
    };

    private async Task<(bool Ok, string? Body, string? Error)> GraphAsync(
        HttpClient http, string token, HttpMethod method, string url, object? body)
    {
        using var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = body is null ? new StringContent("") : JsonContent.Create(body);
        try
        {
            using var resp = await http.SendAsync(req);
            var text = await resp.Content.ReadAsStringAsync();
            return resp.IsSuccessStatusCode
                ? (true, text, null)
                : (false, text, $"Graph {(int)resp.StatusCode} {resp.StatusCode}: {Trim(text, 400)}");
        }
        catch (Exception ex) { return (false, null, ex.Message); }
    }

    private async Task<(bool, string?)> PostSendMailAsync(HttpClient http, string token, Dictionary<string, object?> message)
    {
        var url = $"{GraphBase}/users/{Uri.EscapeDataString(SenderMailbox)}/sendMail";
        var (ok, _, err) = await GraphAsync(http, token, HttpMethod.Post, url, new { message, saveToSentItems = true });
        if (ok) _log.LogInformation("CN mail sent: {Subject}", message["subject"]);
        else    _log.LogError("CN mail failed: {Subject} — {Err}", message["subject"], err);
        return (ok, err);
    }

    private async Task<(bool, string?)> SendViaDraftAsync(
        HttpClient http, string token, Dictionary<string, object?> message, List<CnMailAttachment> atts)
    {
        var mb = Uri.EscapeDataString(SenderMailbox);
        var (ok, body, err) = await GraphAsync(http, token, HttpMethod.Post, $"{GraphBase}/users/{mb}/messages", message);
        if (!ok || body is null) return (false, "Create draft failed — " + err);

        string? id;
        try { using var doc = JsonDocument.Parse(body); id = doc.RootElement.GetProperty("id").GetString(); }
        catch (Exception ex) { return (false, "Draft id parse failed — " + ex.Message); }
        if (string.IsNullOrEmpty(id)) return (false, "Draft id missing.");

        var msgUrl = $"{GraphBase}/users/{mb}/messages/{Uri.EscapeDataString(id)}";
        try
        {
            foreach (var a in atts)
            {
                if (a.Content.Length < SimpleLimitBytes)
                {
                    var (aok, _, aerr) = await GraphAsync(http, token, HttpMethod.Post, $"{msgUrl}/attachments", ToGraph(a));
                    if (!aok) throw new InvalidOperationException($"Attach '{a.FileName}' failed — {aerr}");
                    continue;
                }

                var sessionBody = new Dictionary<string, object?>
                {
                    ["AttachmentItem"] = new
                    {
                        attachmentType = "file", name = a.FileName,
                        size = a.Content.LongLength, contentType = a.ContentType,
                    },
                };
                var (sok, sbody, serr) = await GraphAsync(http, token, HttpMethod.Post,
                    $"{msgUrl}/attachments/createUploadSession", sessionBody);
                if (!sok || sbody is null)
                    throw new InvalidOperationException($"Upload session for '{a.FileName}' failed — {serr}");

                string uploadUrl;
                using (var sdoc = JsonDocument.Parse(sbody))
                    uploadUrl = sdoc.RootElement.GetProperty("uploadUrl").GetString()!;

                long len = a.Content.LongLength;
                for (long start = 0; start < len; start += ChunkBytes)
                {
                    long end = Math.Min(start + ChunkBytes, len) - 1;
                    var chunk = new ByteArrayContent(a.Content, (int)start, (int)(end - start + 1));
                    chunk.Headers.ContentType  = new MediaTypeHeaderValue("application/octet-stream");
                    chunk.Headers.ContentRange = new ContentRangeHeaderValue(start, end, len);
                    using var put  = new HttpRequestMessage(HttpMethod.Put, uploadUrl) { Content = chunk }; // pre-authorised URL: no Bearer
                    using var resp = await http.SendAsync(put);
                    if (!resp.IsSuccessStatusCode)
                        throw new InvalidOperationException(
                            $"Chunk upload '{a.FileName}' failed — {(int)resp.StatusCode}: {Trim(await resp.Content.ReadAsStringAsync(), 300)}");
                }
            }

            var (sendOk, _, sendErr) = await GraphAsync(http, token, HttpMethod.Post, $"{msgUrl}/send", null);
            if (!sendOk) throw new InvalidOperationException("Send draft failed — " + sendErr);
            _log.LogInformation("CN mail (large attachments) sent: {Subject}", message["subject"]);
            return (true, null);
        }
        catch (Exception ex)
        {
            await GraphAsync(http, token, HttpMethod.Delete, msgUrl, null);   // remove the orphan draft
            return (false, ex.Message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HTML HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    private static string H(string? s) => WebUtility.HtmlEncode(s ?? "");
    private static string Trim(string? s, int n) => string.IsNullOrEmpty(s) ? "" : s.Length <= n ? s : s[..n] + "…";
    private static string Rs(decimal? v) => v.HasValue ? "Rs. " + v.Value.ToString("N0", Inr) + "/-" : "—";
    private static string D(DateOnly? d) => d?.ToString("dd.MM.yyyy") ?? "—";
    private static string D(DateTimeOffset? d) => d?.ToOffset(Ist).ToString("dd.MM.yyyy HH:mm") ?? "—";
    private static string Pct(decimal v) => v.ToString("0.#", Inr) + "%";

    private static string FirstName(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return "Team";
        var first = email.Split('@')[0].Split('.')[0];
        return first.Length == 0 ? "Team" : char.ToUpper(first[0]) + first[1..];
    }

    private static string Subject(string tag, Proposal p, ProposalActivity a) =>
        $"[CN] {tag} — {p.TokenNumber} — {(p.DealerName ?? "").ToUpper()} — {a.ActivityType} — {p.Month} {p.Year}";

    private static string Shell(string color, string tagLine, string? token, string inner) => $"""
        <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a2233;max-width:720px;margin:0 auto;">
          <div style="background:{color};color:#fff;padding:12px 20px;border-radius:6px 6px 0 0;">
            <span style="font-size:9px;letter-spacing:1px;text-transform:uppercase;opacity:.75;">BGauss BTL · {H(tagLine)}</span>
            <div style="font-size:17px;font-weight:700;margin-top:2px;">{H(token)}</div>
          </div>
          <div style="padding:16px 20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;">
            {inner}
            <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">BGauss BTL Activity Management System · BGauss Auto Pvt. Ltd.</p>
          </div>
        </div>
        """;

    private static string Button(string href, string label, string bg = "#1e3a5f") => $"""
        <div style="margin:14px 0 6px;text-align:center;">
          <a href="{H(href)}" style="display:inline-block;background:{bg};color:#fff;text-decoration:none;padding:10px 26px;border-radius:6px;font-weight:600;font-size:13px;">{label}</a>
        </div>
        """;

    private static string KV(string k, string v) =>
        $"<tr><td style=\"padding:5px 10px;color:#6b7280;font-size:11px;width:170px;\">{H(k)}</td><td style=\"padding:5px 10px;font-weight:600;color:#0a2540;\">{v}</td></tr>";

    private static string InfoTable(Proposal p, ProposalActivity a) => $"""
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:12px;font-size:12px;">
          {KV("Dealer", H(p.DealerName))}
          {KV("Location", $"{H(p.Location)}, {H(p.State)}")}
          {KV("Month", $"{H(p.Month)} {p.Year}")}
          {KV("Activity", $"{H(a.ActivityType)}{(string.IsNullOrWhiteSpace(a.Category) ? "" : $" ({H(a.Category)})")}{(string.IsNullOrWhiteSpace(a.Subcategory) ? "" : $" · {H(a.Subcategory)}")}")}
          {KV("Planned dates", $"{D(a.StartDate)} → {D(a.EndDate)}")}
          {KV("Actual dates", $"{D(a.ActualStartDate)} → {D(a.ActualEndDate)}")}
          {KV("RSM / TSM / Commando", $"{H(p.RsmName)} / {H(p.TsmName)} / {H(p.CommandoName)}")}
        </table>
        """;

    private static string PlanVsActual(CnReportRow r, bool includeActualBudget)
    {
        const string th = "padding:6px 10px;color:#e2e8f0;font-size:11px;";
        const string td = "padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;";
        string Row(string m, string ap, string ac, string ach) =>
            $"<tr><td style=\"{td}color:#374151;\">{m}</td><td style=\"{td}text-align:right;\">{ap}</td><td style=\"{td}text-align:right;font-weight:700;\">{ac}</td><td style=\"{td}text-align:right;color:#6b7280;\">{ach}</td></tr>";

        var budgetActual = includeActualBudget ? Rs(r.ActualBudget) : "Pending invoice";
        var cplActual    = includeActualBudget ? Rs(r.ActualCpl)    : "—";
        var cacActual    = includeActualBudget ? Rs(r.ActualCac)    : "—";
        var budgetAch    = includeActualBudget && r.ActualBudget.HasValue && r.ApprovedBudget > 0
            ? Pct(Math.Round(r.ActualBudget.Value * 100m / r.ApprovedBudget, 1)) : "—";

        return $"""
            <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:12px;">
              <tr style="background:#0a2540;"><th style="{th}text-align:left;">Metric</th><th style="{th}text-align:right;">Approved</th><th style="{th}text-align:right;">Actual</th><th style="{th}text-align:right;">Achievement</th></tr>
              {Row("Leads",  r.ApprovedLeads.ToString("N0", Inr),  r.ActualLeads.ToString("N0", Inr),  Pct(r.LeadsAchievementPct))}
              {Row("Retail", r.ApprovedRetail.ToString("N0", Inr), r.ActualRetail.ToString("N0", Inr), Pct(r.RetailAchievementPct))}
              {Row("Budget (BGauss share)", Rs(r.ApprovedBudget), budgetActual, budgetAch)}
              {Row("CPL", Rs(r.ApprovedCpl), cplActual, "")}
              {Row("CAC", Rs(r.ApprovedCac), cacActual, "")}
            </table>
            <p style="margin:-6px 0 12px;font-size:10px;color:#9ca3af;">Leads source: {H(r.LeadsSource)} · Retail source: {H(r.RetailSource)} (from Post-Activity daily entries)</p>
            """;
    }

    // The exact 7-field Post-Activity Format (Actual figures)
    private static string PostActivityFormat(CnReportRow r)
    {
        const string th = "padding:6px 8px;color:#e2e8f0;font-size:10px;text-align:left;";
        const string td = "padding:6px 8px;font-size:12px;border-bottom:1px solid #f1f5f9;";
        return $"""
            <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:12px;">
              <tr style="background:#166534;">
                <th style="{th}">Dealer Name</th><th style="{th}">Activity Name</th><th style="{th}">Total Leads</th>
                <th style="{th}">Total Retail</th><th style="{th}">Total Budget</th><th style="{th}">CPL</th><th style="{th}">CAC</th>
              </tr>
              <tr>
                <td style="{td}font-weight:600;">{H(r.DealerName)}</td><td style="{td}">{H(r.ActivityName)}</td>
                <td style="{td}">{r.ActualLeads:N0}</td><td style="{td}">{r.ActualRetail:N0}</td>
                <td style="{td}font-weight:700;">{Rs(r.ActualBudget)}</td><td style="{td}">{Rs(r.ActualCpl)}</td><td style="{td}">{Rs(r.ActualCac)}</td>
              </tr>
            </table>
            """;
    }

    private static string DocsLine(CnReportRow r) =>
        $"<p style=\"margin:0 0 10px;font-size:12px;color:#374151;\">Documents in portal: <strong>{r.PhotoCount}</strong> photo(s) · <strong>{r.VendorInvoiceCount}</strong> vendor invoice(s).</p>";

    private static string DroppedFilesHtml(List<CnMailAttachment> dropped)
    {
        if (dropped.Count == 0) return "";
        var sb = new StringBuilder();
        sb.Append("<div style=\"font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:10px auto 0;font-size:12px;\">");
        sb.Append("<p style=\"margin:0 0 4px;font-weight:600;color:#92400e;\">Large files (download from portal):</p><ul style=\"margin:0;padding-left:18px;\">");
        foreach (var d in dropped)
            sb.Append(d.SourceUrl is null
                ? $"<li>{H(d.FileName)}</li>"
                : $"<li><a href=\"{H(d.SourceUrl)}\">{H(d.FileName)}</a></li>");
        sb.Append("</ul></div>");
        return sb.ToString();
    }
}

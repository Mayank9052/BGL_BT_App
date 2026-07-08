// Backend/Services/WhatsAppService.cs
using System.Net.Http.Headers;
using System.Text.Json;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

public interface IWhatsAppService
{
    Task<(bool Success, string? WaMessageId, string? Error)>
        SendTextAsync(string toPhone, string body,
            string sentByEmail, string sentByName, string? contactName = null);

    Task<(bool Success, string? WaMessageId, string? Error)>
        SendTemplateAsync(string toPhone, string templateName, List<string> bodyParams,
            string sentByEmail, string sentByName, string? contactName = null);

    Task<List<WhatsAppMessage>> GetConversationAsync(string phone, int take = 50);
    Task ProcessWebhookAsync(JsonElement payload);
    Task UpdateStatusAsync(string waMessageId, string status,
        DateTimeOffset? deliveredAt = null, DateTimeOffset? readAt = null);
}

public class WhatsAppService : IWhatsAppService
{
    private readonly IHttpClientFactory _factory;
    private readonly AppDbContext        _db;
    private readonly IConfiguration      _cfg;
    private readonly ILogger<WhatsAppService> _logger;

    // ── Config — lazy, so missing keys don't throw in constructor ────────────
    private string? PhoneNumberId => _cfg["WhatsApp:PhoneNumberId"];
    private string? AccessToken   => _cfg["WhatsApp:AccessToken"];
    private string  ApiVersion    => _cfg["WhatsApp:ApiVersion"] ?? "v20.0";
    private string  BaseUrl       => $"https://graph.facebook.com/{ApiVersion}/{PhoneNumberId}/messages";

    // ── Is WhatsApp configured? ───────────────────────────────────────────────
    private bool IsConfigured =>
        !string.IsNullOrWhiteSpace(PhoneNumberId) &&
        !string.IsNullOrWhiteSpace(AccessToken);

    public WhatsAppService(
        IHttpClientFactory factory,
        AppDbContext db,
        IConfiguration cfg,
        ILogger<WhatsAppService> logger)
    {
        _factory = factory;
        _db      = db;
        _cfg     = cfg;
        _logger  = logger;
        // No header-setting here — headers set per-request so missing config
        // never causes a constructor exception
    }

    // ── Build a ready-to-use HttpClient for one call ──────────────────────────
    private HttpClient BuildClient()
    {
        var http = _factory.CreateClient("whatsapp");
        http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", AccessToken ?? "");
        http.DefaultRequestHeaders.Accept.Clear();
        http.DefaultRequestHeaders.Accept.Add(
            new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
        return http;
    }

    // ── Send plain text ───────────────────────────────────────────────────────
    public async Task<(bool, string?, string?)> SendTextAsync(
        string toPhone, string body,
        string sentByEmail, string sentByName, string? contactName = null)
    {
        toPhone = NormalisePhone(toPhone);

        if (!IsConfigured)
        {
            _logger.LogWarning("[WhatsApp] Not configured — persisting locally only.");
            await PersistAsync(new WhatsAppMessage
            {
                ToPhone = toPhone, ContactName = contactName, Body = body,
                MessageType = "text", Direction = "outbound",
                SentByEmail = sentByEmail, SentByName = sentByName,
                Status = "failed", ErrorMessage = "WhatsApp not configured in appsettings.",
            });
            return (false, null, "WhatsApp not configured. Set WhatsApp:PhoneNumberId and WhatsApp:AccessToken in appsettings.json.");
        }

        var payload = new
        {
            messaging_product = "whatsapp",
            recipient_type    = "individual",
            to                = toPhone,
            type              = "text",
            text              = new { preview_url = false, body },
        };

        var (success, waId, error) = await PostMessageAsync(payload);

        await PersistAsync(new WhatsAppMessage
        {
            ToPhone = toPhone, ContactName = contactName, Body = body,
            MessageType = "text", Direction = "outbound",
            SentByEmail = sentByEmail, SentByName = sentByName,
            WaMessageId = waId,
            Status      = success ? "sent" : "failed",
            ErrorMessage = error,
        });

        return (success, waId, error);
    }

    // ── Send template ─────────────────────────────────────────────────────────
    public async Task<(bool, string?, string?)> SendTemplateAsync(
        string toPhone, string templateName, List<string> bodyParams,
        string sentByEmail, string sentByName, string? contactName = null)
    {
        toPhone = NormalisePhone(toPhone);

        if (!IsConfigured)
            return (false, null, "WhatsApp not configured.");

        var components = bodyParams.Count > 0
            ? (object)new[]
              {
                  new {
                      type       = "body",
                      parameters = bodyParams.Select(p => new { type = "text", text = p }).ToArray()
                  }
              }
            : Array.Empty<object>();

        var payload = new
        {
            messaging_product = "whatsapp",
            to                = toPhone,
            type              = "template",
            template          = new
            {
                name     = templateName,
                language = new { code = "en" },
                components,
            },
        };

        var (success, waId, error) = await PostMessageAsync(payload);

        await PersistAsync(new WhatsAppMessage
        {
            ToPhone      = toPhone, ContactName = contactName,
            Body         = $"[Template: {templateName}] {string.Join(", ", bodyParams)}",
            MessageType  = "template", TemplateName = templateName,
            Direction    = "outbound",
            SentByEmail  = sentByEmail, SentByName = sentByName,
            WaMessageId  = waId,
            Status       = success ? "sent" : "failed",
            ErrorMessage = error,
        });

        return (success, waId, error);
    }

    // ── Conversation history ──────────────────────────────────────────────────
    public async Task<List<WhatsAppMessage>> GetConversationAsync(string phone, int take = 50)
    {
        phone = NormalisePhone(phone);
        return await _db.WhatsAppMessages
            .Where(m => m.ToPhone == phone)
            .OrderByDescending(m => m.SentAt)
            .Take(take)
            .OrderBy(m => m.SentAt)
            .AsNoTracking()
            .ToListAsync();
    }

    // ── Incoming webhook ──────────────────────────────────────────────────────
    public async Task ProcessWebhookAsync(JsonElement payload)
    {
        try
        {
            if (!payload.TryGetProperty("entry", out var entries)) return;

            foreach (var entry in entries.EnumerateArray())
            {
                if (!entry.TryGetProperty("changes", out var changes)) continue;
                foreach (var change in changes.EnumerateArray())
                {
                    if (!change.TryGetProperty("value", out var value)) continue;

                    // Status updates
                    if (value.TryGetProperty("statuses", out var statuses))
                    {
                        foreach (var st in statuses.EnumerateArray())
                        {
                            var waId   = st.GetProperty("id").GetString() ?? "";
                            var status = st.GetProperty("status").GetString() ?? "";
                            DateTimeOffset? ts = st.TryGetProperty("timestamp", out var tsProp)
                                ? DateTimeOffset.FromUnixTimeSeconds(tsProp.GetInt64()) : null;
                            await UpdateStatusAsync(waId, status,
                                deliveredAt: status == "delivered" ? ts : null,
                                readAt:      status == "read"      ? ts : null);
                        }
                    }

                    // Incoming messages
                    if (value.TryGetProperty("messages", out var msgs))
                    {
                        foreach (var msg in msgs.EnumerateArray())
                        {
                            var waId   = msg.GetProperty("id").GetString()   ?? "";
                            var from   = msg.GetProperty("from").GetString() ?? "";
                            var type   = msg.GetProperty("type").GetString() ?? "text";
                            var sentAt = DateTimeOffset.FromUnixTimeSeconds(
                                msg.GetProperty("timestamp").GetInt64());

                            string body = type switch
                            {
                                "text" when msg.TryGetProperty("text", out var t)
                                    => t.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "",
                                "image"    => "[Image received]",
                                "video"    => "[Video received]",
                                "document" => "[Document received]",
                                "audio"    => "[Audio received]",
                                _          => $"[{type} message]",
                            };

                            string? contactName = null;
                            if (value.TryGetProperty("contacts", out var contacts))
                            {
                                var contact = contacts.EnumerateArray().FirstOrDefault();
                                if (contact.ValueKind != JsonValueKind.Undefined
                                    && contact.TryGetProperty("profile", out var profile))
                                    contactName = profile.TryGetProperty("name", out var n)
                                        ? n.GetString() : null;
                            }

                            await PersistAsync(new WhatsAppMessage
                            {
                                ToPhone     = $"+{from}",
                                ContactName = contactName,
                                Body        = body,
                                MessageType = type,
                                Direction   = "inbound",
                                SentByEmail = $"+{from}@whatsapp",
                                SentByName  = contactName ?? $"+{from}",
                                WaMessageId = waId,
                                Status      = "received",
                                SentAt      = sentAt,
                            });
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[WhatsApp] Webhook processing failed");
        }
    }

    // ── Update status ─────────────────────────────────────────────────────────
    public async Task UpdateStatusAsync(string waMessageId, string status,
        DateTimeOffset? deliveredAt = null, DateTimeOffset? readAt = null)
    {
        var msg = await _db.WhatsAppMessages
            .FirstOrDefaultAsync(m => m.WaMessageId == waMessageId);
        if (msg == null) return;
        msg.Status = status;
        if (deliveredAt.HasValue && msg.DeliveredAt == null) msg.DeliveredAt = deliveredAt;
        if (readAt.HasValue      && msg.ReadAt      == null) msg.ReadAt      = readAt;
        await _db.SaveChangesAsync();
    }

    // ── Internals ─────────────────────────────────────────────────────────────
    private async Task<(bool Success, string? WaId, string? Error)>
    PostMessageAsync(object payload)
    {
        try
        {
            var http = BuildClient();
            var res  = await http.PostAsJsonAsync(BaseUrl, payload);
            var body = await res.Content.ReadAsStringAsync();

            if (!res.IsSuccessStatusCode)
            {
                _logger.LogWarning("[WhatsApp] API error {Code}: {Body}",
                    res.StatusCode, body[..Math.Min(300, body.Length)]);
                return (false, null,
                    $"Meta API error {(int)res.StatusCode}: {body[..Math.Min(200, body.Length)]}");
            }

            var doc  = JsonDocument.Parse(body);
            var waId = doc.RootElement
                .GetProperty("messages")
                .EnumerateArray()
                .FirstOrDefault()
                .TryGetProperty("id", out var idEl) ? idEl.GetString() : null;

            return (true, waId, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[WhatsApp] Send failed");
            return (false, null, ex.Message);
        }
    }

    private async Task PersistAsync(WhatsAppMessage msg)
    {
        _db.WhatsAppMessages.Add(msg);
        await _db.SaveChangesAsync();
    }

    private static string NormalisePhone(string phone)
    {
        // Keep only digits and leading +
        phone = new string(phone.Where(c => char.IsDigit(c) || c == '+').ToArray());
        // Indian 10-digit → +91
        if (!phone.StartsWith("+") && phone.Length == 10)  return "+91" + phone;
        // 91XXXXXXXXXX → +91XXXXXXXXXX
        if (!phone.StartsWith("+") && phone.Length == 12 && phone.StartsWith("91"))
            return "+" + phone;
        // No + at all
        if (!phone.StartsWith("+")) phone = "+" + phone;
        return phone;
    }
}
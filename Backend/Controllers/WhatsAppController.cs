// Backend/Controllers/WhatsAppController.cs
using System.Security.Claims;
using BGL_BT_App.Backend.DTOs;
using System.Text.Json;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/whatsapp")]
public class WhatsAppController : ControllerBase
{
    private readonly IWhatsAppService _wa;
    private readonly AppDbContext     _db;
    private readonly IConfiguration   _cfg;
    private readonly ILogger<WhatsAppController> _logger;

    public WhatsAppController(
        IWhatsAppService wa,
        AppDbContext db,
        IConfiguration cfg,
        ILogger<WhatsAppController> logger)
    {
        _wa     = wa;
        _db     = db;
        _cfg    = cfg;
        _logger = logger;
    }

    private string MyEmail() =>
        User.FindFirstValue("preferred_username")
        ?? User.FindFirstValue(ClaimTypes.Email)
        ?? "unknown";

    private string MyName() =>
        User.FindFirstValue("name")
        ?? User.FindFirstValue(ClaimTypes.Name)
        ?? MyEmail().Split('@')[0];

    // ── POST /api/whatsapp/send ───────────────────────────────────────────────
    // Send a text message to any phone number
    [HttpPost("send")]
    [Authorize]
    public async Task<IActionResult> Send([FromBody] SendWaMessageDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Phone))
            return BadRequest(new { message = "Phone number is required." });
        if (string.IsNullOrWhiteSpace(dto.Body))
            return BadRequest(new { message = "Message body is required." });

        (bool success, string? waId, string? error) = await _wa.SendTextAsync(
            dto.Phone, dto.Body, MyEmail(), MyName(), dto.ContactName);

        if (!success)
        {
            // Check if it's a config issue vs actual send failure
            var isConfigErr = error?.Contains("not configured") == true;
            return StatusCode(isConfigErr ? 503 : 502,
                new { message = isConfigErr
                    ? "WhatsApp not configured. Set WhatsApp:PhoneNumberId and WhatsApp:AccessToken in appsettings.json."
                    : "WhatsApp delivery failed.",
                    detail = error });
        }

        return Ok(new { success = true, waMessageId = waId });
    }

    // ── POST /api/whatsapp/send-template ─────────────────────────────────────
    // Send a pre-approved template (works for first outreach / cold messages)
    [HttpPost("send-template")]
    [Authorize]
    public async Task<IActionResult> SendTemplate([FromBody] SendWaTemplateDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Phone))
            return BadRequest(new { message = "Phone number is required." });

        (bool success, string? waId, string? error) = await _wa.SendTemplateAsync(
            dto.Phone, dto.TemplateName, dto.Params ?? new(),
            MyEmail(), MyName(), dto.ContactName);

        if (!success)
            return StatusCode(502, new { message = "Template send failed.", detail = error });

        return Ok(new { success = true, waMessageId = waId });
    }

    // ── GET /api/whatsapp/conversation?phone=+91... ───────────────────────────
    // Get full conversation history with a phone number
    [HttpGet("conversation")]
    [Authorize]
    public async Task<IActionResult> GetConversation(
        [FromQuery] string phone,
        [FromQuery] int take = 50)
    {
        if (string.IsNullOrWhiteSpace(phone))
            return BadRequest(new { message = "phone is required." });

        var messages = await _wa.GetConversationAsync(phone, take);
        return Ok(messages.Select(m => new
        {
            m.Id, m.ToPhone, m.ContactName,
            m.Body, m.MessageType, m.Direction,
            m.Status, m.WaMessageId,
            sentAt      = m.SentAt.ToString("o"),
            deliveredAt = m.DeliveredAt?.ToString("o"),
            readAt      = m.ReadAt?.ToString("o"),
            m.SentByName, m.SentByEmail,
        }));
    }

    // ── GET /api/whatsapp/contacts ────────────────────────────────────────────
    // List all unique phone numbers you've chatted with
    [HttpGet("contacts")]
    [Authorize]
    public async Task<IActionResult> GetContacts()
    {
        try
        {
            var contacts = await _db.WhatsAppMessages
                .GroupBy(m => m.ToPhone)
                .Select(g => new
                {
                    phone       = g.Key,
                    contactName = g.OrderByDescending(m => m.SentAt)
                                   .Select(m => m.ContactName).FirstOrDefault(),
                    lastMessage = g.OrderByDescending(m => m.SentAt)
                                   .Select(m => m.Body).FirstOrDefault(),
                    lastAt      = g.Max(m => m.SentAt).ToString("o"),
                    unread      = g.Count(m => m.Direction == "inbound" && m.Status == "received"),
                })
                .OrderByDescending(c => c.lastAt)
                .AsNoTracking()
                .ToListAsync();

            return Ok(contacts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[WhatsApp] GetContacts failed — table may not exist yet. Run ChatBotKnowledge_Migration.sql.");
            return Ok(Array.Empty<object>());   // return empty list, not 500
        }
    }

    // ── GET /api/whatsapp/templates ───────────────────────────────────────────
    // Return the approved templates configured in appsettings
    // (In production, fetch from Meta Graph API: GET /{business_account_id}/message_templates)
    [HttpGet("templates")]
    [Authorize]
    public IActionResult GetTemplates()
    {
        var templates = _cfg.GetSection("WhatsApp:Templates")
            .Get<List<WaTemplateConfig>>() ?? new List<WaTemplateConfig>
            {
                // Default templates — update these to match your approved Meta templates
                new("btl_proposal_approved",  "BTL Proposal Approved",   new[]{ "dealer_name", "token_number" }),
                new("btl_proposal_rejected",  "BTL Proposal Rejected",   new[]{ "dealer_name", "reason" }),
                new("btl_activity_reminder",  "Activity Reminder",       new[]{ "dealer_name", "activity", "date" }),
                new("btl_welcome",            "Welcome to BGauss BTL",   new[]{ "dealer_name" }),
                new("general_message",        "General Message",         new[]{ "message" }),
            };
        return Ok(templates);
    }

    // ── GET /api/whatsapp/webhook — Meta verification challenge ───────────────
    [HttpGet("webhook")]
    [AllowAnonymous]
    public IActionResult VerifyWebhook(
        [FromQuery(Name = "hub.mode")]        string? mode,
        [FromQuery(Name = "hub.challenge")]   string? challenge,
        [FromQuery(Name = "hub.verify_token")] string? verifyToken)
    {
        var expected = _cfg["WhatsApp:WebhookVerifyToken"];
        if (mode == "subscribe" && verifyToken == expected)
        {
            _logger.LogInformation("WhatsApp webhook verified.");
            return Ok(int.TryParse(challenge, out var c) ? (object)c : challenge ?? "");
        }
        return Forbid();
    }

    // ── POST /api/whatsapp/webhook — Incoming messages from Meta ─────────────
    [HttpPost("webhook")]
    [AllowAnonymous]
    public async Task<IActionResult> ReceiveWebhook()
    {
        using var reader  = new StreamReader(Request.Body);
        var       body    = await reader.ReadToEndAsync();
        _logger.LogInformation("WA Webhook: {Body}", body[..Math.Min(500, body.Length)]);

        try
        {
            var payload = JsonDocument.Parse(body).RootElement;
            await _wa.ProcessWebhookAsync(payload);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Webhook processing error");
        }

        // Meta requires 200 OK immediately — always return 200
        return Ok();
    }
}
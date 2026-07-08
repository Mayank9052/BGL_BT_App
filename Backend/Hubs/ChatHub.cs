// Backend/Hubs/ChatHub.cs
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BGL_BT_App.Backend.Hubs;

// ── IMPORTANT: [Authorize] without a scheme ──────────────────────────────────
// Must NOT specify AuthenticationSchemes here — the MultiScheme policy selector
// in Program.cs handles routing, and the OnMessageReceived event we added to
// the AzureAD JwtBearer handler reads the token from the ?access_token= query
// string that SignalR appends during the WebSocket upgrade.
[Authorize]
public class ChatHub : Hub
{
    private readonly AppDbContext     _db;
    private readonly IBotService      _bot;
    private readonly ILogger<ChatHub> _logger;

    public ChatHub(AppDbContext db, IBotService bot, ILogger<ChatHub> logger)
    {
        _db     = db;
        _bot    = bot;
        _logger = logger;
    }

    private string MyEmail() =>
        Context.User?.FindFirstValue("preferred_username")
        ?? Context.User?.FindFirstValue(ClaimTypes.Upn)
        ?? Context.User?.FindFirstValue("upn")
        ?? Context.User?.FindFirstValue(ClaimTypes.Email)
        ?? Context.User?.FindFirstValue("email")
        ?? Context.User?.Identity?.Name
        ?? "unknown";

    private string MyName() =>
        Context.User?.FindFirstValue("name")
        ?? Context.User?.FindFirstValue(ClaimTypes.Name)
        ?? MyEmail().Split('@')[0];

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    public override async Task OnConnectedAsync()
    {
        var email = MyEmail();
        _logger.LogInformation("[Chat] Connected: {Email} ({ConnectionId})",
            email, Context.ConnectionId);

        // Join personal group (both original case and lowercase)
        // so bot replies always reach the user regardless of email casing
        await Groups.AddToGroupAsync(Context.ConnectionId, email);
        await Groups.AddToGroupAsync(Context.ConnectionId, email.ToLowerInvariant());
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("[Chat] Disconnected: {Email} ({ConnectionId})",
            MyEmail(), Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    // ── SendMessage ───────────────────────────────────────────────────────────
    // Called by client: await connection.invoke("SendMessage", roomId, body)
    public async Task SendMessage(Guid roomId, string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return;

        var senderEmail = MyEmail();
        var senderName  = MyName();

        // Verify caller is member of the room
        var isMember = await _db.ChatRoomMembers
            .AnyAsync(m => m.RoomId == roomId && m.Email == senderEmail);
        if (!isMember)
        {
            _logger.LogWarning("[Chat] {Email} tried to send to room {Room} but is not a member.",
                senderEmail, roomId);
            return;
        }

        // Persist
        var message = new ChatMessage
        {
            RoomId      = roomId,
            SenderEmail = senderEmail,
            SenderName  = senderName,
            Body        = body,
            IsBot       = false,
            SentAt      = DateTimeOffset.UtcNow,
        };
        _db.ChatMessages.Add(message);
        await _db.SaveChangesAsync();

        // Build payload
        var payload = new
        {
            id          = message.Id,
            roomId,
            senderEmail,
            senderName,
            body        = message.Body,
            isBot       = false,
            sentAt      = message.SentAt.ToString("o"),
        };

        // Broadcast to all members of the room via their personal groups
        var memberEmails = await _db.ChatRoomMembers
            .Where(m => m.RoomId == roomId)
            .Select(m => m.Email)
            .ToListAsync();

        foreach (var email in memberEmails)
            await Clients.Group(email).SendAsync("ReceiveMessage", payload);

        // Bot rooms: trigger AI response
        var room = await _db.ChatRooms.FindAsync(roomId);
        if (room?.RoomType == "bot")
            await TriggerBotResponseAsync(roomId, body, senderEmail);
    }

    // ── MarkTyping ────────────────────────────────────────────────────────────
    // Called by client: await connection.invoke("MarkTyping", roomId, isTyping)
    public async Task MarkTyping(Guid roomId, bool isTyping)
    {
        var senderEmail = MyEmail();
        var senderName  = MyName();

        var memberEmails = await _db.ChatRoomMembers
            .Where(m => m.RoomId == roomId && m.Email != senderEmail)
            .Select(m => m.Email)
            .ToListAsync();

        var payload = new { roomId, senderEmail, senderName, isTyping };
        foreach (var email in memberEmails)
            await Clients.Group(email).SendAsync("UserTyping", payload);
    }

    // ── AI bot response ───────────────────────────────────────────────────────
    private async Task TriggerBotResponseAsync(Guid roomId, string userMessage, string userEmail)
    {
        // Get human members of this room upfront (used for both typing + delivery)
        var humanMembers = await _db.ChatRoomMembers
            .Where(m => m.RoomId == roomId && m.Email != "bot@bgauss.com")
            .Select(m => m.Email)
            .ToListAsync();

        // Helper: send event to all human members (both original + lowercase group)
        async Task BroadcastToHumans(string eventName, object payload)
        {
            foreach (var email in humanMembers)
            {
                await Clients.Group(email).SendAsync(eventName, payload);
                await Clients.Group(email.ToLowerInvariant()).SendAsync(eventName, payload);
            }
        }

        try
        {
            // Show typing indicator
            await BroadcastToHumans("UserTyping",
                new { roomId, senderEmail = "bot@bgauss.com", senderName = "BGauss AI", isTyping = true });

            // Build conversation history (last 20 messages for context)
            var history = await _db.ChatMessages
                .Where(m => m.RoomId == roomId)
                .OrderByDescending(m => m.SentAt)
                .Take(20)
                .OrderBy(m => m.SentAt)
                .Select(m => new { role = m.IsBot ? "assistant" : "user", content = m.Body })
                .ToListAsync();

            // Call AI with full DB context
            var botReply = await _bot.AskAsync(
                history.Select(h => (h.role, h.content)).ToList(),
                userEmail);

            // Persist bot message
            var botMessage = new ChatMessage
            {
                RoomId      = roomId,
                SenderEmail = "bot@bgauss.com",
                SenderName  = "BGauss AI",
                Body        = botReply,
                IsBot       = true,
                SentAt      = DateTimeOffset.UtcNow,
            };
            _db.ChatMessages.Add(botMessage);
            await _db.SaveChangesAsync();

            // Stop typing indicator
            await BroadcastToHumans("UserTyping",
                new { roomId, senderEmail = "bot@bgauss.com", senderName = "BGauss AI", isTyping = false });

            // Deliver bot reply to all human members
            await BroadcastToHumans("ReceiveMessage", new
            {
                id          = botMessage.Id,
                roomId,
                senderEmail = "bot@bgauss.com",
                senderName  = "BGauss AI",
                body        = botReply,
                isBot       = true,
                sentAt      = botMessage.SentAt.ToString("o"),
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Chat] Bot response failed for room {RoomId}", roomId);
            await BroadcastToHumans("UserTyping",
                new { roomId, senderEmail = "bot@bgauss.com", senderName = "BGauss AI", isTyping = false });
        }
    }
}
// Backend/Hubs/ChatHub.cs
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace BGL_BT_App.Backend.Hubs;

[Authorize]
public class ChatHub : Hub
{
    // Inject IServiceScopeFactory so we can create fresh scopes for background work
    // AppDbContext is SCOPED — it gets disposed when the SignalR request ends.
    // Task.Run() runs OUTSIDE that request, so we must create a NEW scope with
    // a fresh DbContext for the bot response. This is the standard ASP.NET pattern
    // for background work in scoped services.
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ChatHub>     _logger;

    public ChatHub(IServiceScopeFactory scopeFactory, ILogger<ChatHub> logger)
    {
        _scopeFactory = scopeFactory;
        _logger       = logger;
    }

    // ── Read email from claims — always lowercase ─────────────────────────────
    private string MyEmail()
    {
        var candidates = new[]
        {
            "preferred_username", "upn", "email", "unique_name",
            ClaimTypes.Upn, ClaimTypes.Email, ClaimTypes.Name,
        };
        foreach (var c in candidates)
        {
            var v = Context.User?.FindFirstValue(c);
            if (!string.IsNullOrWhiteSpace(v) && v.Contains('@'))
                return v.ToLowerInvariant();
        }
        return (Context.User?.Identity?.Name ?? "unknown").ToLowerInvariant();
    }

    private string MyName() =>
        Context.User?.FindFirstValue("name")
        ?? Context.User?.FindFirstValue(ClaimTypes.Name)
        ?? MyEmail().Split('@')[0];

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    public override async Task OnConnectedAsync()
    {
        var email = MyEmail();
        _logger.LogInformation("[Chat] Connected: {Email} ({ConnectionId})", email, Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, email);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("[Chat] Disconnected: {Email}", MyEmail());
        await base.OnDisconnectedAsync(exception);
    }

    // ── JoinRoom / LeaveRoom — no DB, pure in-memory for typing ──────────────
    public async Task JoinRoom(string roomId)
        => await Groups.AddToGroupAsync(Context.ConnectionId, $"room:{roomId}");

    public async Task LeaveRoom(string roomId)
        => await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"room:{roomId}");

    // ── MarkTyping — zero DB queries ──────────────────────────────────────────
    public async Task MarkTyping(Guid roomId, bool isTyping)
    {
        var senderEmail = MyEmail();
        var senderName  = MyName();
        var payload     = new { roomId = roomId.ToString(), senderEmail, senderName, isTyping };
        await Clients.GroupExcept($"room:{roomId}", Context.ConnectionId)
                     .SendAsync("UserTyping", payload);
    }

    // ── SendMessage ───────────────────────────────────────────────────────────
    public async Task SendMessage(Guid roomId, string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return;

        var senderEmail = MyEmail();
        var senderName  = MyName();

        _logger.LogInformation("[Chat] SendMessage room={RoomId} from={Email}", roomId, senderEmail);

        // Use a fresh scope for all DB work in this method
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Verify / auto-fix membership — case-insensitive
        var isMember = await db.ChatRoomMembers
            .AnyAsync(m => m.RoomId == roomId && m.Email.ToLower() == senderEmail);

        if (!isMember)
        {
            var roomExists = await db.ChatRooms.AnyAsync(r => r.Id == roomId);
            if (!roomExists)
            {
                await Clients.Caller.SendAsync("ChatError",
                    "Room not found. Please close and reopen the chat.");
                return;
            }
            // Auto-join (handles old rooms created before lowercase fix)
            db.ChatRoomMembers.Add(new ChatRoomMember
                { RoomId = roomId, UserId = 0, Email = senderEmail });
            await db.SaveChangesAsync();
            _logger.LogInformation("[Chat] Auto-joined {Email} to {RoomId}", senderEmail, roomId);
        }

        // Persist message
        var message = new ChatMessage
        {
            RoomId      = roomId,
            SenderEmail = senderEmail,
            SenderName  = senderName,
            Body        = body,
            IsBot       = false,
            SentAt      = DateTimeOffset.UtcNow,
        };
        db.ChatMessages.Add(message);
        await db.SaveChangesAsync();

        _logger.LogInformation("[Chat] Persisted message {Id}", message.Id);

        // Get all members for broadcast
        var memberEmails = await db.ChatRoomMembers
            .Where(m => m.RoomId == roomId)
            .Select(m => m.Email.ToLower())
            .Distinct()
            .ToListAsync();

        // Echo message to all members
        var payload = new
        {
            id          = message.Id.ToString(),
            roomId      = roomId.ToString(),
            senderEmail,
            senderName,
            body        = message.Body,
            isBot       = false,
            sentAt      = message.SentAt.ToString("o"),
        };
        foreach (var email in memberEmails)
            await Clients.Group(email).SendAsync("ReceiveMessage", payload);

        // Is this a bot room?
        var roomType = await db.ChatRooms
            .Where(r => r.Id == roomId)
            .Select(r => r.RoomType)
            .FirstOrDefaultAsync();

        _logger.LogInformation("[Chat] RoomType={Type}", roomType);

        if (roomType == "bot")
        {
            // Capture everything needed BEFORE the scope closes
            var humanEmailsCopy = memberEmails
                .Where(e => e != "bot@bgauss.com")
                .ToList();
            var roomIdCopy     = roomId;
            var userEmailCopy  = senderEmail;
            var bodyCopy       = body;
            var clientsCopy    = Clients;  // HubCallerClients is safe to pass to background

            // Fire background task — creates its OWN scope so DbContext is never shared
            _ = Task.Run(async () =>
            {
                try
                {
                    await TriggerBotResponseAsync(
                        roomIdCopy, bodyCopy, userEmailCopy,
                        humanEmailsCopy, clientsCopy);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Bot] Background task failed for room {RoomId}", roomIdCopy);
                }
            });
        }
    }

    // ── Bot response — runs in background with its own fresh scope ────────────
    private async Task TriggerBotResponseAsync(
        Guid roomId, string userMessage, string userEmail,
        List<string> humanEmails, IHubCallerClients clients)
    {
        _logger.LogInformation("[Bot] Starting for room {RoomId}", roomId);

        // Show typing to all human members
        var typingOn = new
        {
            roomId      = roomId.ToString(),
            senderEmail = "bot@bgauss.com",
            senderName  = "BGauss AI",
            isTyping    = true,
        };
        foreach (var email in humanEmails)
            await clients.Group(email).SendAsync("UserTyping", typingOn);

        // ── Fresh scope for bot response (critical — the outer scope is gone) ─
        using var botScope = _scopeFactory.CreateScope();
        var db     = botScope.ServiceProvider.GetRequiredService<AppDbContext>();
        var botSvc = botScope.ServiceProvider.GetRequiredService<IBotService>();

        string botReply;
        try
        {
            // Load 24-hr conversation history
            var cutoff = DateTimeOffset.UtcNow.AddHours(-24);
            var history = await db.ChatMessages
                .Where(m => m.RoomId == roomId && m.SentAt >= cutoff)
                .OrderByDescending(m => m.SentAt)
                .Take(40)
                .OrderBy(m => m.SentAt)
                .Select(m => new { role = m.IsBot ? "assistant" : "user", content = m.Body })
                .ToListAsync();

            _logger.LogInformation("[Bot] History: {Count} messages, calling AskAsync…", history.Count);

            botReply = await botSvc.AskAsync(
                history.Select(h => (h.role, h.content)).ToList(),
                userEmail) ?? "I'm unable to respond right now. Please try again.";

            _logger.LogInformation("[Bot] Reply generated ({Len} chars)", botReply?.Length ?? 0);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Bot] AskAsync failed");
            botReply = "⚠ I encountered an error. Please try again.";
        }

        // Persist bot message
        var botMessage = new ChatMessage
        {
            RoomId      = roomId,
            SenderEmail = "bot@bgauss.com",
            SenderName  = "BGauss AI",
            Body        = botReply?.Trim() ?? "",
            IsBot       = true,
            SentAt      = DateTimeOffset.UtcNow,
        };
        db.ChatMessages.Add(botMessage);
        await db.SaveChangesAsync();

        // Stop typing
        var typingOff = new
        {
            roomId      = roomId.ToString(),
            senderEmail = "bot@bgauss.com",
            senderName  = "BGauss AI",
            isTyping    = false,
        };
        foreach (var email in humanEmails)
            await clients.Group(email).SendAsync("UserTyping", typingOff);

        // Deliver reply
        var replyPayload = new
        {
            id          = botMessage.Id.ToString(),
            roomId      = roomId.ToString(),
            senderEmail = "bot@bgauss.com",
            senderName  = "BGauss AI",
            body        = botMessage.Body,
            isBot       = true,
            sentAt      = botMessage.SentAt.ToString("o"),
        };

        foreach (var email in humanEmails)
        {
            _logger.LogInformation("[Bot] Delivering to group: {Email}", email);
            await clients.Group(email).SendAsync("ReceiveMessage", replyPayload);
        }

        _logger.LogInformation("[Bot] Done for room {RoomId}", roomId);
    }
}
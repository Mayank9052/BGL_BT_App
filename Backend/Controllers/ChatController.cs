// Backend/Controllers/ChatController.cs
using System.Security.Claims;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using BGL_BT_App.Backend.DTOs;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/chat")]
[Authorize]
public class ChatController : ControllerBase
{
    private readonly AppDbContext _db;

    public ChatController(AppDbContext db) => _db = db;

        private string MyEmail()
    {
        var claims = new[]
        {
            "preferred_username", "upn", "email", "unique_name",
            ClaimTypes.Upn, ClaimTypes.Email, ClaimTypes.Name,
        };
        foreach (var c in claims)
        {
            var v = User.FindFirstValue(c);
            if (!string.IsNullOrWhiteSpace(v) && v.Contains('@'))
                return v.ToLowerInvariant();
        }
        return (User.Identity?.Name ?? "unknown").ToLowerInvariant();
    }

    private string MyName() =>
        User.FindFirstValue("name")
        ?? User.FindFirstValue(ClaimTypes.Name)
        ?? MyEmail().Split('@')[0];

    // ── GET /api/chat/employees ───────────────────────────────────────────────
    // Returns all active BGauss users for the employee list
    [HttpGet("employees")]
    public async Task<IActionResult> GetEmployees()
    {
        var myEmail = MyEmail();
        var users = await _db.Users
            .Where(u => u.IsActive && u.Email != myEmail)
            .Select(u => new
            {
                u.Id,
                u.Email,
                displayName = u.DisplayName ?? (u.FirstName + " " + u.LastName).Trim(),
                u.Department,
                u.JobTitle,
                u.Role,
                initials = (u.DisplayName ?? u.FirstName ?? "?").Length > 0
                    ? (u.DisplayName ?? u.FirstName ?? "?").Substring(0, 1).ToUpper()
                    + ((u.LastName ?? "").Length > 0 ? u.LastName!.Substring(0, 1).ToUpper() : "")
                    : "?",
            })
            .OrderBy(u => u.displayName)
            .ToListAsync();

        return Ok(users);
    }

    // ── GET /api/chat/rooms ───────────────────────────────────────────────────
    // Returns all chat rooms the current user is in (with last message)
    [HttpGet("rooms")]
    public async Task<IActionResult> GetRooms()
    {
        var myEmail = MyEmail();

        var rooms = await _db.ChatRooms
            .Include(r => r.Members)
            .Include(r => r.Messages.OrderByDescending(m => m.SentAt).Take(1))
            .Where(r => r.Members.Any(m => m.Email == myEmail))
            .OrderByDescending(r => r.LastMessageAt ?? r.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        var result = rooms.Select(r =>
        {
            var other = r.Members.FirstOrDefault(m => m.Email != myEmail);
            var last  = r.Messages.FirstOrDefault();
            return new
            {
                r.Id,
                r.RoomType,
                otherName   = r.RoomType == "bot" ? "BGauss Assistant" : (other?.Email?.Split('@')[0] ?? "Unknown"),
                otherEmail  = r.RoomType == "bot" ? "bot@bgauss.com"   : other?.Email,
                lastMessage = last?.Body?.Length > 60 ? last.Body[..60] + "…" : last?.Body ?? "",
                lastAt      = last?.SentAt.ToString("o") ?? r.CreatedAt.ToString("o"),
            };
        });

        return Ok(result);
    }

    // ── POST /api/chat/rooms/direct ───────────────────────────────────────────
    // Get or create a direct room between the caller and another employee
    [HttpPost("rooms/direct")]
    public async Task<IActionResult> GetOrCreateDirect([FromBody] CreateDirectDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.TargetEmail)) return BadRequest("targetEmail required");

        var myEmail = MyEmail();
        var myName  = MyName();

        // Find existing direct room between these two users
        var existing = await _db.ChatRooms
            .Include(r => r.Members)
            .Where(r => r.RoomType == "direct"
                     && r.Members.Any(m => m.Email == myEmail)
                     && r.Members.Any(m => m.Email == dto.TargetEmail))
            .FirstOrDefaultAsync();

        if (existing != null) return Ok(new { roomId = existing.Id });

        // Create new room
        var targetUser = await _db.Users
            .FirstOrDefaultAsync(u => u.Email == dto.TargetEmail);

        var room = new ChatRoom { RoomType = "direct" };
        room.Members.Add(new ChatRoomMember
        {
            UserId = 0, // resolved from session
            Email  = myEmail,
        });
        room.Members.Add(new ChatRoomMember
        {
            UserId = targetUser?.Id ?? 0,
            Email  = dto.TargetEmail,
        });

        _db.ChatRooms.Add(room);
        await _db.SaveChangesAsync();

        return Ok(new { roomId = room.Id });
    }

    // ── POST /api/chat/rooms/bot ──────────────────────────────────────────────
    // Get or create the user's bot room
    [HttpPost("rooms/bot")]
    public async Task<IActionResult> GetOrCreateBotRoom()
    {
        var myEmail = MyEmail();
        var myName  = MyName();

        var existing = await _db.ChatRooms
            .Include(r => r.Members)
            .Where(r => r.RoomType == "bot"
                     && r.Members.Any(m => m.Email == myEmail))
            .FirstOrDefaultAsync();

        if (existing != null) return Ok(new { roomId = existing.Id });

        var room = new ChatRoom { RoomType = "bot" };
        room.Members.Add(new ChatRoomMember { UserId = 0, Email = myEmail.ToLowerInvariant() });
        room.Members.Add(new ChatRoomMember { UserId = -1, Email = "bot@bgauss.com" });

        _db.ChatRooms.Add(room);
        await _db.SaveChangesAsync();

        return Ok(new { roomId = room.Id });
    }

    // ── GET /api/chat/rooms/{roomId}/messages ─────────────────────────────────
    [HttpGet("rooms/{roomId:guid}/messages")]
    public async Task<IActionResult> GetMessages(Guid roomId, [FromQuery] int skip = 0, [FromQuery] int take = 50)
    {
        var myEmail = MyEmail();
        var isMember = await _db.ChatRoomMembers
            .AnyAsync(m => m.RoomId == roomId && m.Email == myEmail);

        if (!isMember) return Forbid();

        var messages = await _db.ChatMessages
            .Where(m => m.RoomId == roomId)
            .OrderByDescending(m => m.SentAt)
            .Skip(skip)
            .Take(take)
            .OrderBy(m => m.SentAt)
            .AsNoTracking()
            .Select(m => new
            {
                m.Id, m.RoomId, m.SenderEmail, m.SenderName,
                m.Body, m.IsBot, sentAt = m.SentAt.ToString("o"),
            })
            .ToListAsync();

        return Ok(messages);
    }
}

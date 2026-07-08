namespace BGL_BT_App.Backend.Models;

public class ChatRoom
{
    public Guid   Id            { get; set; } = Guid.NewGuid();
    public string RoomType      { get; set; } = "direct"; // "direct" | "bot"
    public DateTimeOffset CreatedAt     { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastMessageAt { get; set; }

    public List<ChatRoomMember>  Members  { get; set; } = new();
    public List<ChatMessage>     Messages { get; set; } = new();
}
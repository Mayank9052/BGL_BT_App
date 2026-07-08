namespace BGL_BT_App.Backend.Models;

public class ChatMessage
{
    public Guid   Id          { get; set; } = Guid.NewGuid();
    public Guid   RoomId      { get; set; }
    public ChatRoom? Room     { get; set; }
    public string SenderEmail { get; set; } = string.Empty;
    public string SenderName  { get; set; } = string.Empty;
    public string Body        { get; set; } = string.Empty;
    public bool   IsBot       { get; set; } = false;
    public DateTimeOffset SentAt { get; set; } = DateTimeOffset.UtcNow;
}

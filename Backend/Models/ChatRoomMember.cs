namespace BGL_BT_App.Backend.Models;

public class ChatRoomMember
{
    public int    Id     { get; set; }
    public Guid   RoomId { get; set; }
    public ChatRoom? Room { get; set; }
    public int    UserId { get; set; }
    public string Email  { get; set; } = string.Empty;
}
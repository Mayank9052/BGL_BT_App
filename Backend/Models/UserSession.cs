namespace BGL_BT_App.Backend.Models;
public class UserSession
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string SessionId { get; set; } = string.Empty;
    public DateTime LoginAt { get; set; } = DateTime.UtcNow;
    public DateTime? LogoutAt { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }

    public User User { get; set; } = null!;
}
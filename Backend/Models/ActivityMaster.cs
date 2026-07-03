namespace BGL_BT_App.Backend.Models;

public class ActivityMaster
{
    public int Id { get; set; }
    public string ActivityName { get; set; } = string.Empty;
    public string ActivityType { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
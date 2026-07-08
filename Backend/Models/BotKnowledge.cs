// Backend/Models/BotKnowledge.cs
namespace BGL_BT_App.Backend.Models;

public class BotKnowledge
{
    public int    Id        { get; set; }
    public string Category  { get; set; } = string.Empty;
    public string Question  { get; set; } = string.Empty;
    public string Answer    { get; set; } = string.Empty;
    public string Keywords  { get; set; } = string.Empty;   // comma-separated
    public bool   IsActive  { get; set; } = true;
    public int    SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

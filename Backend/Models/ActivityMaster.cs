// Backend/Models/ActivityMaster.cs
namespace BGL_BT_App.Backend.Models;

public class ActivityMaster
{
    public int    Id           { get; set; }
    public string ActivityName { get; set; } = string.Empty;  // e.g. "Digital", "Canopy"
    public string ActivityType { get; set; } = string.Empty;  // "ATL" | "BTL"
    public string? Subcategory { get; set; }                   // e.g. "Facebook", "YouTube"
    public int    MaxQty       { get; set; } = 5;             // max selectable qty
    public bool   IsActive     { get; set; } = true;
    public DateTime CreatedAt  { get; set; } = DateTime.UtcNow;
}
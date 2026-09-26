// Backend/Models/DealerTeamMapping.cs
namespace BGL_BT_App.Backend.Models;

public class DealerTeamMapping
{
    public int Id { get; set; }

    public string DealerName    { get; set; } = "";
    public string? DealerCode   { get; set; }
    public string? City         { get; set; }
    public string? State        { get; set; }

    public string  Rsm          { get; set; } = "";
    public string? RsmEmail     { get; set; }
    public string? Tsm          { get; set; }
    public string? TsmEmail     { get; set; }
    public string? Commando     { get; set; }
    public string? CommandoEmail{ get; set; }
    public string? DealerEmail  { get; set; }

    public bool IsEligible      { get; set; } = true; // drives the dashboard's Old/New/Non-Eligible bucket
    public string? DealerType   { get; set; }          // "Old" | "New" — manual override, optional

    public DateTime CreatedAt      { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt      { get; set; } = DateTime.UtcNow;
    public string?  UpdatedByEmail { get; set; }
}
namespace BGL_BT_App.Backend.Models;

/// <summary>
/// Manually-entered monthly lead target per State + Channel — the number
/// that "Total Leads Received" is measured against in the report.
/// </summary>
public class LeadTarget
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string State { get; set; } = string.Empty;
    public string Channel { get; set; } = string.Empty; // Walkin | BTL | Referral | ATL | Digital
    public int Month { get; set; }
    public int Year { get; set; }
    public int TargetValue { get; set; }
    public string? UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
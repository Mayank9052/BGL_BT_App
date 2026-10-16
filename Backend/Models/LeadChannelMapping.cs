namespace BGL_BT_App.Backend.Models;
/// <summary>
/// Editable mapping of a raw (Source, SubSource) pair to one of the five
/// report channels. SubSource = null matches on Source alone (e.g. Walk-In
/// Showroom has only one meaningful SubSource, so we match at the Source level).
/// </summary>
public class LeadChannelMapping
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Source { get; set; } = string.Empty;
    public string? SubSource { get; set; }
    public string Channel { get; set; } = string.Empty; // Walkin | BTL | Referral | ATL | Digital
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
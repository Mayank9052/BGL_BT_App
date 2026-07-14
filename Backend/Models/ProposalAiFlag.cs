using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;
/// <summary>
/// A single issue the agent flagged. Never auto-approves/rejects — a human
/// still makes the final call via the existing /decide endpoint.
/// </summary>
public class ProposalAiFlag
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid              ReviewId { get; set; }
    public ProposalAiReview? Review   { get; set; }

    [MaxLength(20)]  public string  Severity            { get; set; } = "Warning"; // Blocking | Warning | Info
    [MaxLength(150)] public string  Title               { get; set; } = "";
    [MaxLength(1000)] public string Detail              { get; set; } = "";
    [MaxLength(100)] public string? RelatedActivityType { get; set; }
}

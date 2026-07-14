using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

/// <summary>
/// One AI review run for a proposal. A proposal can have multiple reviews
/// over time (e.g. re-run after edits); the controller returns the latest.
/// </summary>
public class ProposalAiReview
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid      ProposalId { get; set; }
    public Proposal? Proposal   { get; set; }

    [MaxLength(20)]   public string  Status         { get; set; } = "Running"; // Running | Completed | Failed
    [MaxLength(20)]   public string  OverallVerdict { get; set; } = "Clean";   // Clean | Warning | Blocking
    [MaxLength(4000)] public string? Summary        { get; set; }
    [MaxLength(100)]  public string  ModelUsed      { get; set; } = "";
    public int ToolCallCount { get; set; }
    public DateTimeOffset RunAt { get; set; } = DateTimeOffset.UtcNow;
    [MaxLength(2000)] public string? ErrorMessage { get; set; }

    public List<ProposalAiFlag> Flags { get; set; } = new();
}

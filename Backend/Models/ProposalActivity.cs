using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class ProposalActivity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ProposalId { get; set; }
    public Proposal? Proposal { get; set; }

    [MaxLength(100)] public string ActivityType { get; set; } = string.Empty;
    public int Target { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public decimal Budget { get; set; }
    public decimal Incentive { get; set; }
    [MaxLength(1000)] public string? Remarks { get; set; }

    // ── Post-approval actuals (filled by RSM after approval) ──
    public DateOnly? ActualStartDate { get; set; }
    public DateOnly? ActualEndDate   { get; set; }
    [MaxLength(500)] public string? MediaFileUrl  { get; set; }
    [MaxLength(255)] public string? MediaFileName { get; set; }
    [MaxLength(100)] public string? MediaFileType { get; set; }
}
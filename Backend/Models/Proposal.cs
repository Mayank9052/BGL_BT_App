using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class Proposal
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [MaxLength(100)] public string State { get; set; } = string.Empty;
    [MaxLength(150)] public string Location { get; set; } = string.Empty;
    [MaxLength(20)]  public string Type { get; set; } = string.Empty;          // Old | New
    [MaxLength(200)] public string DealerName { get; set; } = string.Empty;
    [MaxLength(150)] public string RsmName { get; set; } = string.Empty;
    [MaxLength(150)] public string CommandoName { get; set; } = string.Empty;
    [MaxLength(20)]  public string Month { get; set; } = string.Empty;
    [MaxLength(50)]  public string Eligibility { get; set; } = string.Empty;   // Eligible | Not Eligible | Pending Approval
    [MaxLength(2000)] public string? Remarks { get; set; }

    public decimal TotalBudget { get; set; }
    public int TotalTarget { get; set; }
    public decimal Cac { get; set; }

    [MaxLength(200)] public string SubmittedBy { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    // ── Approval workflow ──────────────────────────────────────────
    [MaxLength(50)] public string Status { get; set; } = "Pending"; // Pending | Approved | Rejected
    [MaxLength(2000)] public string? ApproverNote { get; set; }
    [MaxLength(200)] public string? ApprovedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }

    // Per-activity token shown to the RSM in the decision email; generated
    // once on submission so it's stable even if the mail is resent.
    [MaxLength(50)] public string? TokenNumber { get; set; }

    public List<ProposalActivity> Activities { get; set; } = new();

    public string? SubmittedByDisplayName { get; set; }  // ← add this
}
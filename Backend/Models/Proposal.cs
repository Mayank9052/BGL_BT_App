using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class Proposal
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [MaxLength(100)]  public string  State        { get; set; } = string.Empty;
    [MaxLength(150)]  public string  Location     { get; set; } = string.Empty;
    [MaxLength(20)]   public string  Type         { get; set; } = string.Empty;
    [MaxLength(200)]  public string  DealerName   { get; set; } = string.Empty;
    [MaxLength(200)]  public string? VendorName   { get; set; }
    public int?       VendorId  { get; set; }
    [MaxLength(150)]  public string  RsmName      { get; set; } = string.Empty;
    [MaxLength(150)]  public string  CommandoName { get; set; } = string.Empty;
    [MaxLength(20)]   public string  Month        { get; set; } = string.Empty;
    [MaxLength(50)]   public string  Eligibility  { get; set; } = string.Empty;
    [MaxLength(2000)] public string? Remarks      { get; set; }

    public decimal TotalBudget       { get; set; }
    public int     TotalLeadTarget   { get; set; }
    public int     TotalRetailTarget { get; set; }
    public decimal Cac               { get; set; }  // TotalBudget / TotalRetailTarget
    public decimal Cpl               { get; set; }  // TotalBudget / TotalLeadTarget

    public int      AllowedCac  { get; set; } = 4000;
    [MaxLength(500)] public string? CacWarning { get; set; }

    [MaxLength(200)] public string  SubmittedBy            { get; set; } = string.Empty;
    [MaxLength(255)] public string? SubmittedByDisplayName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [MaxLength(50)]   public string  Status       { get; set; } = "Pending";
    [MaxLength(2000)] public string? ApproverNote { get; set; }
    [MaxLength(200)]  public string? ApprovedBy   { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }

    // Per-activity token shown to the RSM in the decision email; generated
    // once on submission so it's stable even if the mail is resent.
    [MaxLength(50)] public string? TokenNumber { get; set; }
    public string?          CheckedByEmail { get; set; }  // Mayank's confirm step
    public DateTimeOffset?  CheckedAt      { get; set; }
    public string?          DealerEmail    { get; set; }  // dealer's email for notification
    public bool             DealerNotified { get; set; } = false;
    public string? DealerSendBackNote    { get; set; }
    public bool    DealerSentBack        { get; set; } = false;
    public DateTimeOffset? DealerSentBackAt { get; set; }
    public List<ProposalActivity> Activities { get; set; } = new();
}
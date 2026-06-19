using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class ApprovalDecision
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ProposalId { get; set; }
    public Proposal? Proposal { get; set; }

    [MaxLength(50)] public string Status { get; set; } = string.Empty;   // Approved | Rejected
    [MaxLength(2000)] public string? ApproverNote { get; set; }
    [MaxLength(200)] public string ApprovedBy { get; set; } = string.Empty;
    public DateTimeOffset DecidedAt { get; set; } = DateTimeOffset.UtcNow;

    public bool MailSent { get; set; }
    public DateTimeOffset? MailSentAt { get; set; }
    [MaxLength(500)] public string? MailError { get; set; }
}
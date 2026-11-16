using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class CnEmailLog
{
    public Guid Id         { get; set; } = Guid.NewGuid();
    public Guid ProposalId { get; set; }
    public Guid ActivityId { get; set; }

    [MaxLength(60)]  public string  Action  { get; set; } = "";   // RsmApprovalRequest, SentToAccounts, Accounts_reject …
    [MaxLength(500)] public string  Subject { get; set; } = "";
    public string  ToEmails { get; set; } = "";
    public string  CcEmails { get; set; } = "";
    public string  BodyHtml { get; set; } = "";
    public string? AttachmentNames { get; set; }
    public bool    Success  { get; set; }
    public string? Error    { get; set; }
    [MaxLength(200)] public string SentBy { get; set; } = "";
    public DateTimeOffset SentAt { get; set; } = DateTimeOffset.UtcNow;
}
using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class Proposal
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [MaxLength(100)] public string State { get; set; } = string.Empty;
    [MaxLength(150)] public string Location { get; set; } = string.Empty;
    [MaxLength(100)] public string Type { get; set; } = string.Empty;
    [MaxLength(200)] public string DealerName { get; set; } = string.Empty;
    [MaxLength(150)] public string RsmName { get; set; } = string.Empty;
    [MaxLength(150)] public string CommandoName { get; set; } = string.Empty;
    [MaxLength(20)] public string Month { get; set; } = string.Empty;
    [MaxLength(50)] public string Eligibility { get; set; } = string.Empty;
    [MaxLength(2000)] public string? Remarks { get; set; }

    public decimal TotalBudget { get; set; }
    public int TotalTarget { get; set; }
    public decimal Cac { get; set; }

    [MaxLength(200)] public string SubmittedBy { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<ProposalActivity> Activities { get; set; } = new();
}
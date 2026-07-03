using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BGL_BT_App.Backend.Models;

public class ProposalActivity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ProposalId { get; set; }
    public Proposal? Proposal { get; set; }

    [MaxLength(100)] public string ActivityType { get; set; } = string.Empty;
    [MaxLength(100)] public string? Category    { get; set; }

    // Renamed: Target → LeadTarget, Incentive → AdditionalBudget
    public int     LeadTarget        { get; set; }
    public int     RetailTarget      { get; set; }
    public DateOnly? StartDate       { get; set; }
    public DateOnly? EndDate         { get; set; }
    public decimal Budget            { get; set; }
    public decimal AdditionalBudget  { get; set; }   // was Incentive

    [JsonPropertyName("bgaussShare")]
    public decimal  BGaussShare       { get; init; } = 100m;
    [MaxLength(1000)] public string? Remarks { get; set; }

    // Vendor
    public int? VendorId { get; set; }

    // Post-approval actuals
    public DateOnly? ActualStartDate { get; set; }
    public DateOnly? ActualEndDate   { get; set; }

    // Legacy single media (keep for backward compat)
    [MaxLength(500)] public string? MediaFileUrl  { get; set; }
    [MaxLength(255)] public string? MediaFileName { get; set; }
    [MaxLength(100)] public string? MediaFileType { get; set; }

    // Multiple media
    public List<ActivityMedia> MediaFiles { get; set; } = new();
}
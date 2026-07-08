// Backend/Models/ProposalActivity.cs
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace BGL_BT_App.Backend.Models;

public class ProposalActivity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ProposalId { get; set; }
    public Proposal? Proposal { get; set; }

    [MaxLength(100)] public string  ActivityType { get; set; } = string.Empty;
    [MaxLength(100)] public string? Category     { get; set; }
    [MaxLength(100)] public string? Subcategory  { get; set; }
    public int Qty { get; set; } = 1;

    // Sales % — used to auto-calculate Retail Target on the frontend
    // Stored so approver/history views can show how Retail was derived
    public decimal? SalesPercent { get; set; }

    public int     LeadTarget       { get; set; }
    public int     RetailTarget     { get; set; }
    public DateOnly? StartDate      { get; set; }
    public DateOnly? EndDate        { get; set; }
    public decimal Budget           { get; set; }
    public decimal AdditionalBudget { get; set; }

    [JsonPropertyName("bgaussShare")]
    public decimal BGaussShare      { get; set; } = 100m;

    [MaxLength(1000)] public string? Remarks { get; set; }

    public int? VendorId { get; set; }

    public DateOnly? ActualStartDate { get; set; }
    public DateOnly? ActualEndDate   { get; set; }

    [MaxLength(500)] public string? MediaFileUrl  { get; set; }
    [MaxLength(255)] public string? MediaFileName { get; set; }
    [MaxLength(100)] public string? MediaFileType { get; set; }

    public List<ActivityMedia> MediaFiles { get; set; } = new();
}
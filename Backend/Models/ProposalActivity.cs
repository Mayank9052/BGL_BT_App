// Backend/Models/ProposalActivity.cs
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;

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

    // ═══ CN (Credit Note) workflow ═══════════════════════════════════════════
    public CnStatus CnStatus { get; set; } = CnStatus.NotStarted;

    // Step 1: Checker → RSM
    public string?         CnRequestedByEmail { get; set; }
    public DateTimeOffset? CnRequestedAt      { get; set; }

    // Step 2: RSM decision
    public string?         CnRsmDecisionNote   { get; set; }
    public string?         CnRsmDecidedByEmail { get; set; }
    public DateTimeOffset? CnRsmDecidedAt      { get; set; }

    // Step 3: Dealer's final invoice, in BGauss's name
    public string?         CnFinalInvoiceUrl      { get; set; }
    public string?         CnFinalInvoiceFileName { get; set; }
    public DateTimeOffset? CnFinalInvoiceAt       { get; set; }

    // NEW — invoiced amount on the BGauss-name invoice = "Actual Budget".
    // Must be ≤ approved BGauss amount ((Budget + AdditionalBudget) × BGaussShare%).
    [Precision(18, 2)]
    public decimal?        CnInvoiceAmount        { get; set; }

    // Step 4: Checker → Accounts
    public DateTimeOffset? CnSentToAccountsAt      { get; set; }
    public string?         CnSentToAccountsByEmail { get; set; }

    // Step 5: Accounts issued the CN — Checker records the CN number
    public DateTimeOffset? CnProcessedAt { get; set; }
    [MaxLength(50)]
    public string?         CnNumber           { get; set; }   // NEW
    public string?         CnProcessedByEmail { get; set; }   // NEW

    public string? DailyData { get; set; }  // JSON: [{date, enquiryPlanned, enquiryActual, ...}]

    public List<ActivityMedia> MediaFiles { get; set; } = new();
}

public enum CnStatus
{
    NotStarted          = 0,
    SentForRsmApproval  = 1,
    RsmApproved         = 2,
    RsmRejected         = 3,
    SentToAccounts      = 4,
    CnProcessed         = 5,
}

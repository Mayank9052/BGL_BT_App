// Backend/Models/LeadReportModels.cs
using System;

namespace BGL_BT_App.Backend.Models;

/// <summary>
/// One row = one lead record, matching the "Lead Data" sheet's 37 columns exactly.
/// UniqueLeadId is the real-world business key (unique per lead in the source LMS).
/// </summary>
public class LmsLeadRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string? ApplicationId { get; set; }
    public int? SrNo { get; set; }
    public long UniqueLeadId { get; set; }
    public string? ZH { get; set; }
    public string? RSM { get; set; }
    public string? TSM { get; set; }
    public string? Commando { get; set; }
    public string? DealerCode { get; set; }
    public string? OrganizationName { get; set; }
    public string? DealerPinCode { get; set; }
    public string? CustomerName { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? Source { get; set; }
    public string? SubSource { get; set; }
    public string? LeadOrigin { get; set; }
    public string? Make { get; set; }
    public string? Model { get; set; }
    public string? Version { get; set; }
    public DateTime? LeadDate { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? CustomerPinCode { get; set; }
    public string? User { get; set; }
    public string? Stage { get; set; }
    public string? SubStage { get; set; }
    public string? QualifiedBy { get; set; }
    public string? LostClosedReason { get; set; }
    public string? LostClosedSubReason { get; set; }
    public string? LostClosedBy { get; set; }
    public string? LeadStatus { get; set; }
    public DateTime? LeadStatusUpdationDate { get; set; }
    public string? Eagerness { get; set; }
    public string? LastCallComment { get; set; }
    public DateTime? FollowUpDate { get; set; }
    public DateTime? LastCallDate { get; set; }
    public string? ScheduleTR { get; set; }
    public int? NumberOfAttempts { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
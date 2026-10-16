// Backend/DTOs/LeadRecordListItemDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

public class LeadRecordListItemDto
{
    public Guid Id { get; set; }
    public long UniqueLeadId { get; set; }
    public string? RSM { get; set; }
    public string? TSM { get; set; }
    public string? DealerCode { get; set; }
    public string? OrganizationName { get; set; }
    public string? CustomerName { get; set; }
    public string? Mobile { get; set; }
    public string? Source { get; set; }
    public string? SubSource { get; set; }
    public string? Channel { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? LeadStatus { get; set; }
    public string? Eagerness { get; set; }
    public DateTime? LeadDate { get; set; }
}

// Backend/DTOs/LeadRecordBulkRequestDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

public class LeadRecordBulkRequestDto
{
    public List<LeadRecordDto> Leads { get; set; } = new();
}
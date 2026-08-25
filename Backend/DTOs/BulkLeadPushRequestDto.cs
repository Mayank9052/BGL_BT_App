using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

public class BulkLeadPushRequestDto
{
    public List<LeadRecordDto> Leads { get; set; } = new();
}
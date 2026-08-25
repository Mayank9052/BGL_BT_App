using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

public class BulkLeadPushResponseDto
{
    public int Received { get; set; }
    public int Inserted { get; set; }
    public int Updated { get; set; }
    public int Rejected { get; set; }
    public List<LeadPushErrorDto> Errors { get; set; } = new();
}
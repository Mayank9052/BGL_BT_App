// Backend/DTOs/LeadPushErrorDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

public class LeadPushErrorDto
{
    public long? UniqueLeadId { get; set; }
    public string Reason { get; set; } = string.Empty;
}
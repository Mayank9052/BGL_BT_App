// Backend/DTOs/LeadChannelMappingDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

// ── Channel mapping DTOs ─────────────────────────────────────────────────
public class LeadChannelMappingDto
{
    public Guid? Id { get; set; }
    public string Source { get; set; } = string.Empty;
    public string? SubSource { get; set; }
    public string Channel { get; set; } = string.Empty;
}

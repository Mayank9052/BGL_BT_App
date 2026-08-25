// Backend/DTOs/LeadTargetDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

// ── Lead target DTOs ─────────────────────────────────────────────────────
public class LeadTargetDto
{
    public Guid? Id { get; set; }
    public string State { get; set; } = string.Empty;
    public string Channel { get; set; } = string.Empty;
    public int Month { get; set; }
    public int Year { get; set; }
    public int TargetValue { get; set; }
}
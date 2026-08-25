// Backend/DTOs/ChannelTargetDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

// ── Targets CRUD ────────────────────────────────────────────────────────────
public class ChannelTargetDto
{
    public string State { get; set; } = string.Empty;
    public int Year { get; set; }
    public int Month { get; set; }
    public string Channel { get; set; } = string.Empty;
    public int TargetValue { get; set; }
}
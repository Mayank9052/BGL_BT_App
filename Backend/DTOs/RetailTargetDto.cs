// Backend/DTOs/RetailTargetDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

public class RetailTargetDto
{
    public string State { get; set; } = string.Empty;
    public int Year { get; set; }
    public int Month { get; set; }
    public int TargetValue { get; set; }
}
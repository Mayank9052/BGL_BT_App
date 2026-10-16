// Backend/DTOs/ChannelBreakdownDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

public class ChannelBreakdownDto
{
    public int Target { get; set; }
    public int MtdTarget { get; set; }
    public int MtdAchieved { get; set; }
}

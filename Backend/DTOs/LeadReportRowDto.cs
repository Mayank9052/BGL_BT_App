// Backend/DTOs/LeadReportRowDto.cs
using System;
using System.Collections.Generic;

namespace BGL_BT_App.Backend.DTOs;

// ── Lead Report aggregation response — matches the Excel sheet exactly ─────
public class LeadReportRowDto
{
    public string State { get; set; } = string.Empty;

    public int LeadsMonthTarget { get; set; }
    public int LeadsMtdTarget { get; set; }

    public int WalkinTarget { get; set; }
    public int WalkinMtdTarget { get; set; }
    public int WalkinMtdAch { get; set; }

    public int BtlTarget { get; set; }
    public int BtlMtdTarget { get; set; }
    public int BtlMtdAch { get; set; }

    public int ReferralTarget { get; set; }
    public int ReferralMtdTarget { get; set; }
    public int ReferralMtdAch { get; set; }

    public int AtlTarget { get; set; }
    public int AtlMtdTarget { get; set; }
    public int AtlMtdAch { get; set; }

    public int DigitalTarget { get; set; }
    public int DigitalMtdTarget { get; set; }
    public int DigitalMtdAch { get; set; }

    public int TotalLeadsReceived { get; set; }
    public int LeadsVariance { get; set; }
    public double LeadsAchievementPct { get; set; }
    public double LeadsAchievementPctMtd { get; set; }

    // Retail-side columns — populated only if a retail target/achieved
    // value is supplied by the BTL app; otherwise left at 0 (see README).
    public int RetailTargets { get; set; }
    public int MtdRetailTargets { get; set; }
    public int MtdRetailAchieved { get; set; }
    public double MtdRetailAchievementPct { get; set; }
    public double RetailsEnquiriesPct { get; set; }
}
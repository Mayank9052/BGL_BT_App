// Backend/Services/LeadChannelClassifier.cs
namespace BGL_BT_App.Backend.Services;

/// <summary>
/// Maps a lead's raw Source/SubSource into one of the 5 report channels:
/// Walkin, BTL, Referral, ATL, Digital.
///
/// Based on the actual distinct values found in your LeadSummaryData export:
///   Source = 'Digital Marketing'   → always Digital
///   Source = 'Walk-In Showroom'    → SubSource 'Reference' → Referral
///                                     SubSource 'Walk In Showroom' → Walkin
///   Source = 'ATL | BTL Leads'     → split by SubSource:
///       ATL (mass media): Paper Marketing, Radio Advertising, TV Advertising, Outdoor Advertising
///       BTL (ground activity): Campaign Activity, Incoming Calls
///
/// ⚠️ CONFIRM WITH YOUR TEAM: the ATL vs BTL SubSource split above is a
/// reasonable business assumption (mass-media vs ground activity) but was
/// NOT explicitly confirmed by LMS — adjust the two lists below if your
/// team defines these differently.
/// </summary>
public static class LeadChannelClassifier
{
    private static readonly HashSet<string> AtlSubSources = new(StringComparer.OrdinalIgnoreCase)
    {
        "Paper Marketing",
        "Radio Advertising",
        "TV Advertising",
        "Outdoor Advertising",
    };

    private static readonly HashSet<string> BtlSubSources = new(StringComparer.OrdinalIgnoreCase)
    {
        "Campaign Activity",
        "Incoming Calls",
    };

    public static string Classify(string? source, string? subSource)
    {
        var src = (source ?? "").Trim();
        var sub = (subSource ?? "").Trim();

        if (src.Equals("Digital Marketing", StringComparison.OrdinalIgnoreCase))
            return "Digital";

        if (src.Equals("Walk-In Showroom", StringComparison.OrdinalIgnoreCase))
            return sub.Equals("Reference", StringComparison.OrdinalIgnoreCase) ? "Referral" : "Walkin";

        if (src.Contains("ATL", StringComparison.OrdinalIgnoreCase) ||
            src.Contains("BTL", StringComparison.OrdinalIgnoreCase))
        {
            if (AtlSubSources.Contains(sub)) return "ATL";
            if (BtlSubSources.Contains(sub)) return "BTL";
            return "BTL"; // default bucket for this Source group if SubSource is new/unrecognized
        }

        return "Unclassified";
    }
}

// Backend/Services/DealerNameMatcher.cs
using System.Text.RegularExpressions;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

// Single matching rule for "which dealer is this": Dealer Code first, else
// dealer name normalised (lower-case, letters+digits only). Ambiguous → no match.
// "GREEN MOTOR'S" == "Green Motors" ; "GREEN MOTORS" != "GREEN MOTORS PVT LTD".
public static class DealerNameMatcher
{
    private static readonly Regex NonAlnum = new("[^a-z0-9]", RegexOptions.Compiled);

    public static string Normalize(string? s) =>
        string.IsNullOrWhiteSpace(s) ? "" : NonAlnum.Replace(s.ToLowerInvariant(), "");

    public static bool SameDealer(string? a, string? b)
    {
        var na = Normalize(a);
        return na.Length > 0 && na == Normalize(b);
    }

    public static async Task<DealerTeamMapping?> FindMappingAsync(
        AppDbContext db, string? dealerName, string? dealerCode = null)
    {
        var rows = await db.Set<DealerTeamMapping>().AsNoTracking().ToListAsync();

        if (!string.IsNullOrWhiteSpace(dealerCode))
        {
            var byCode = rows.FirstOrDefault(r =>
                string.Equals(r.DealerCode?.Trim(), dealerCode.Trim(), StringComparison.OrdinalIgnoreCase));
            if (byCode is not null) return byCode;
        }

        var key = Normalize(dealerName);
        if (key.Length == 0) return null;
        var matches = rows.Where(r => Normalize(r.DealerName) == key).ToList();
        return matches.Count == 1 ? matches[0] : null;   // ambiguous → null, never guess
    }

    public static List<string> TeamEmails(DealerTeamMapping? m) =>
        m is null ? new List<string>() :
        new[] { m.RsmEmail, m.TsmEmail, m.CommandoEmail }
            .SelectMany(e => (e ?? "").Split(',', ';'))
            .Select(e => e.Trim())
            .Where(e => e.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
}
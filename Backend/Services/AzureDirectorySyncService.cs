using System.Net.Http.Headers;
using System.Text.Json;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

public record DirectoryNewUser(string Email, string DisplayName);
public record DirectorySyncResult(
    bool DryRun, int TotalInDirectory, int ToCreate, int Linked, int AlreadyPresent,
    int Skipped, int Conflicts, List<DirectoryNewUser> NewUsers);

public class AzureDirectorySyncService
{
    private readonly AppDbContext _db;
    private readonly GraphAppTokenService _token;
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _cfg;
    private readonly ILogger<AzureDirectorySyncService> _log;

    public AzureDirectorySyncService(AppDbContext db, GraphAppTokenService token, IHttpClientFactory http,
        IConfiguration cfg, ILogger<AzureDirectorySyncService> log)
    { _db = db; _token = token; _http = http; _cfg = cfg; _log = log; }

    private sealed record Dir(string Id, string Email, string Display, string? First, string? Last,
                              string? Job, string? Dept, string? Phone);

    public async Task<DirectorySyncResult> SyncAsync(bool dryRun)
    {
        // Only real staff mailboxes: enabled, member accounts, company domain (config: Directory:EmailDomain)
        var domain = (_cfg["Directory:EmailDomain"] ?? "bgauss.com").Trim().ToLowerInvariant();
        var includeGuests = _cfg.GetValue("Directory:IncludeGuests", false);

        var dir = await FetchAsync(domain, includeGuests);

        var users = await _db.Users.ToListAsync();
        var byOid   = users.Where(u => !string.IsNullOrWhiteSpace(u.AzureObjectId))
                           .GroupBy(u => u.AzureObjectId!.ToLowerInvariant()).ToDictionary(g => g.Key, g => g.First());
        var byEmail = users.Where(u => !string.IsNullOrWhiteSpace(u.Email))
                           .GroupBy(u => u.Email.ToLowerInvariant()).ToDictionary(g => g.Key, g => g.First());

        int linked = 0, present = 0, skipped = 0, conflicts = 0;
        var created = new List<DirectoryNewUser>();

        foreach (var d in dir)
        {
            if (byOid.TryGetValue(d.Id.ToLowerInvariant(), out var existing))
            {
                present++;
                Fill(existing, d, dryRun);
                continue;
            }
            if (byEmail.TryGetValue(d.Email, out var sameMail))
            {
                if (string.IsNullOrWhiteSpace(sameMail.AzureObjectId))
                {   // manually-created row → link it to the Azure account instead of duplicating
                    linked++;
                    if (!dryRun) { sameMail.AzureObjectId = d.Id; Fill(sameMail, d, false); }
                }
                else conflicts++;          // same email, different Azure ID — leave for a human
                continue;
            }

            created.Add(new DirectoryNewUser(d.Email, d.Display));
            if (dryRun) continue;
            _db.Users.Add(new User
            {
                AzureObjectId = d.Id, Email = d.Email, DisplayName = d.Display,
                FirstName = d.First, LastName = d.Last, JobTitle = d.Job, Department = d.Dept,
                PhoneNumber = d.Phone, Role = "User", IsActive = true,
            });
        }

        if (!dryRun) await _db.SaveChangesAsync();
        skipped = 0;
        _log.LogInformation("Azure directory sync (dryRun={Dry}): {Total} in directory, {New} new, {Linked} linked, {Present} present, {Conf} conflicts",
            dryRun, dir.Count, created.Count, linked, present, conflicts);

        return new DirectorySyncResult(dryRun, dir.Count, created.Count, linked, present, skipped, conflicts,
            created.Take(300).ToList());
    }

    // Fill only blank profile fields — never touch Role / IsActive / existing values.
    private static void Fill(User u, Dir d, bool dryRun)
    {
        if (dryRun) return;
        if (string.IsNullOrWhiteSpace(u.DisplayName)) u.DisplayName = d.Display;
        if (string.IsNullOrWhiteSpace(u.FirstName))   u.FirstName   = d.First;
        if (string.IsNullOrWhiteSpace(u.LastName))    u.LastName    = d.Last;
        if (string.IsNullOrWhiteSpace(u.JobTitle))    u.JobTitle    = d.Job;
        if (string.IsNullOrWhiteSpace(u.Department))  u.Department  = d.Dept;
    }

    private async Task<List<Dir>> FetchAsync(string domain, bool includeGuests)
    {
        var token = await _token.GetAppOnlyTokenAsync();
        var http = _http.CreateClient();
        var list = new List<Dir>();
        string? url = "https://graph.microsoft.com/v1.0/users" +
            "?$select=id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,mobilePhone,accountEnabled,userType&$top=999";

        while (url != null)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var resp = await http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException(resp.StatusCode == System.Net.HttpStatusCode.Forbidden
                    ? "Graph denied access. Add the Microsoft Graph APPLICATION permission 'User.Read.All' to the app registration and grant admin consent."
                    : $"Graph {(int)resp.StatusCode}: {(body.Length > 300 ? body[..300] : body)}");

            using var doc = JsonDocument.Parse(body);
            foreach (var el in doc.RootElement.GetProperty("value").EnumerateArray())
            {
                string? S(string n) => el.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                if (el.TryGetProperty("accountEnabled", out var en) && en.ValueKind == JsonValueKind.False) continue;
                if (!includeGuests && string.Equals(S("userType"), "Guest", StringComparison.OrdinalIgnoreCase)) continue;

                var email = (S("mail") ?? S("userPrincipalName") ?? "").Trim().ToLowerInvariant();
                var id = S("id");
                if (id is null || !email.Contains('@') || email.Contains("#EXT#", StringComparison.OrdinalIgnoreCase)) continue;
                if (domain.Length > 0 && !email.EndsWith("@" + domain)) continue;

                var digits = new string((S("mobilePhone") ?? "").Where(char.IsDigit).ToArray());
                list.Add(new Dir(id, email, S("displayName") ?? email, S("givenName"), S("surname"),
                                 S("jobTitle"), S("department"), digits.Length >= 10 ? digits[^10..] : null));
            }
            url = doc.RootElement.TryGetProperty("@odata.nextLink", out var next) ? next.GetString() : null;
        }
        return list;
    }
}
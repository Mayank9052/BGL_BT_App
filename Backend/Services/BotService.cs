// Backend/Services/BotService.cs
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using BGL_BT_App.Backend.Data;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

public interface IBotService
{
    Task<string> AskAsync(List<(string role, string content)> history, string userEmail = "");
}

public class BotService : IBotService
{
    private readonly IHttpClientFactory  _factory;
    private readonly IConfiguration      _cfg;
    private readonly AppDbContext        _db;
    private readonly ILogger<BotService> _logger;

    public BotService(IHttpClientFactory factory, IConfiguration cfg,
        AppDbContext db, ILogger<BotService> logger)
    {
        _factory = factory; _cfg = cfg; _db = db; _logger = logger;
    }

    public async Task<string> AskAsync(
        List<(string role, string content)> history, string userEmail = "")
    {
        try
        {
            // Pull live DB data + business rules
            var dataContext = await BuildDataContextAsync(userEmail);

            var systemPrompt = $"""
You are BGauss AI Assistant — the intelligent assistant embedded in the BGauss BTL (Below-the-Line) portal.
You have LIVE access to the BTL database. Always answer with real numbers from the data below.

═══════════════════════════════════════════════════════
LIVE BTL DATABASE (as of {DateTime.Now:dd-MMM-yyyy HH:mm} IST)
═══════════════════════════════════════════════════════
{dataContext}

═══════════════════════════════════════════════════════
BTL BUSINESS RULES & LOGIC (always apply these)
═══════════════════════════════════════════════════════

## ELIGIBILITY CRITERIA (3-Month Average Sales Logic)
A dealer's eligibility is determined by their average retail sales over the LAST 3 MONTHS:

| Category               | 3-Month Avg Retail Sales | BTL Budget Limit     | CAC Limit |
|------------------------|--------------------------|----------------------|-----------|
| Eligible Old Dealer    | ≥ 25 units/month avg     | Up to ₹4,000 × units | ≤ ₹4,000  |
| Eligible New Dealer    | < 25 units (new/growing) | Up to ₹6,000 × units | ≤ ₹6,000  |
| Non-Eligible Dealer    | < 10 units/month avg     | No BTL budget        | N/A       |

- "Old" means dealership active > 6 months with track record
- "New" means dealership < 6 months OR recently onboarded
- Non-eligible dealers can still submit proposals but BGauss does NOT fund them

## CAC LOGIC (Cost of Acquisition per Customer)
CAC = Total BTL Budget ÷ Total Retail Target (units)

RULES:
- Eligible Old Dealer: CAC must be ≤ ₹4,000 per unit
- Eligible New Dealer: CAC must be ≤ ₹6,000 per unit
- If CAC exceeds limit → proposal gets WARNING and may be rejected
- BGauss Share % determines how much BGauss contributes:
  BGauss Amount = Total Budget × (BGauss Share / 100)
  Dealer self-funds the remaining %

## CPL LOGIC (Cost per Lead)
CPL = Total BTL Budget ÷ Total Lead Target

- No hard CPL limit, but flagged if CPL > ₹5,000 (considered inefficient)
- CPL is tracked alongside CAC to measure campaign quality
- Lower CPL = more leads per rupee = better campaign

## BUDGET CALCULATION LOGIC
Total Budget = Base Budget + Additional Budget
BGauss Contribution = Total Budget × BGauss Share %
Expected ROI = Retail Target × Average Vehicle Price

## PROPOSAL WORKFLOW
1. RSM submits proposal → Status: Pending
2. Manager reviews → Approves or Rejects with remarks
3. Final Approver (vijay.maurya@bgauss.com) gives final approval
4. Approved → Activities can be executed
5. Rejected → RSM can revise and resubmit

## ACTIVITY TYPES & CATEGORIES
- ATL (Above-the-Line): Hoardings, Radio, Newspaper, Digital Ads
- BTL (Below-the-Line): Test rides, Dealer events, In-shop branding, Melas, Roadshows,
  Display activities, Loyalty programs, Service camps

## ROLE PERMISSIONS
- RSM (User role): Can submit proposals, view own proposals, chat, download own reports
- Manager: Can approve/reject all proposals, view all data
- Admin: Full access — users, activities, approvals, reports

═══════════════════════════════════════════════════════
RESPONSE GUIDELINES
═══════════════════════════════════════════════════════
- Always use REAL numbers from the live data snapshot above
- Format numbers in Indian style: ₹4,000 / 1,25,000 / 3.5L
- Be specific: name the state, dealer, RSM when answering
- For CAC/CPL analysis: state whether it's within limits
- If data is missing, say "not in current data" — never make up numbers
- Keep replies concise but complete. Use bullet points for lists.
- For "show all" queries: list top 10 sorted by budget/CAC
""";

            var apiKey = _cfg["Anthropic:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey))
                return "⚠ AI not configured. Set Anthropic:ApiKey in appsettings.json.";

            var http = _factory.CreateClient("anthropic");
            http.DefaultRequestHeaders.Clear();
            http.DefaultRequestHeaders.Add("x-api-key", apiKey);
            http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
            http.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json"));

            var messages = history
                .Select(h => new { role = h.role, content = h.content })
                .ToList();

            var requestBody = new
            {
                model      = "claude-sonnet-4-6",
                max_tokens = 1500,
                system     = systemPrompt,
                messages,
            };

            var res = await http.PostAsync(
                "https://api.anthropic.com/v1/messages",
                new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"));

            var responseText = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                _logger.LogError("[Bot] API error {Code}: {Body}", res.StatusCode,
                    responseText[..Math.Min(300, responseText.Length)]);
                return $"⚠ AI error ({(int)res.StatusCode}). Check Anthropic API key.";
            }

            var doc = JsonDocument.Parse(responseText);
            return doc.RootElement
                .GetProperty("content")[0]
                .GetProperty("text")
                .GetString() ?? "No response.";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Bot] AskAsync failed");
            return "⚠ Something went wrong. Please try again.";
        }
    }

    // ── Build comprehensive live data context ─────────────────────────────────
    private async Task<string> BuildDataContextAsync(string userEmail)
    {
        try
        {
            var sb = new StringBuilder();
            var now = DateTime.UtcNow;
            var threeMonthsAgo = now.AddMonths(-3);

            // Load all proposals with activities
            var allProposals = await _db.Proposals
                .Include(p => p.Activities)
                .AsNoTracking()
                .ToListAsync();

            if (!allProposals.Any())
            {
                sb.AppendLine("No proposals in database yet.");
                return sb.ToString();
            }

            // Last 3 months proposals
            var recentProposals = allProposals
                .Where(p => p.CreatedAt >= threeMonthsAgo)
                .ToList();

            // ── OVERALL SUMMARY ───────────────────────────────────────────
            sb.AppendLine("## OVERALL SUMMARY (All Time)");
            AppendSummary(sb, allProposals, "all-time");
            sb.AppendLine();

            sb.AppendLine($"## LAST 3 MONTHS SUMMARY ({threeMonthsAgo:dd-MMM-yyyy} to {now:dd-MMM-yyyy})");
            AppendSummary(sb, recentProposals, "3-month");
            sb.AppendLine();

            // ── STATE-WISE BREAKDOWN ──────────────────────────────────────
            sb.AppendLine("## STATE-WISE BREAKDOWN (All Time)");
            var stateGroups = allProposals
                .GroupBy(p => p.State)
                .OrderBy(g => g.Key);

            foreach (var g in stateGroups)
            {
                var tb  = g.Sum(p => p.TotalBudget);
                var tr  = g.Sum(p => p.TotalRetailTarget);
                var tl  = g.Sum(p => p.TotalLeadTarget);
                var cac = tr > 0 ? Math.Round(tb / tr, 0) : 0;
                var cpl = tl > 0 ? Math.Round(tb / tl, 0) : 0;
                var cacStatus = cac > 0 && cac <= 4000 ? "✓ Within limit"
                              : cac > 4000 && cac <= 6000 ? "⚠ New dealer range"
                              : cac > 6000 ? "✗ Exceeds limit" : "—";
                sb.AppendLine($"### {g.Key}");
                sb.AppendLine($"  Dealers: {g.Select(p => p.DealerName).Distinct().Count()} | " +
                              $"Budget: ₹{tb:N0} | Retail: {tr:N0} units | Leads: {tl:N0}");
                sb.AppendLine($"  CAC: ₹{cac:N0} [{cacStatus}] | CPL: ₹{cpl:N0} | " +
                              $"Pending: {g.Count(p => p.Status == "Pending")} | " +
                              $"Approved: {g.Count(p => p.Status == "Approved")} | " +
                              $"Rejected: {g.Count(p => p.Status == "Rejected")}");

                // 3-month avg for this state
                var stateRecent = recentProposals.Where(p => p.State == g.Key).ToList();
                if (stateRecent.Any())
                {
                    var rTb = stateRecent.Sum(p => p.TotalBudget);
                    var rTr = stateRecent.Sum(p => p.TotalRetailTarget);
                    var rCac = rTr > 0 ? Math.Round(rTb / rTr, 0) : 0;
                    sb.AppendLine($"  3-Month: Budget ₹{rTb:N0} | Retail {rTr:N0} | CAC ₹{rCac:N0}");
                }
            }
            sb.AppendLine();

            // ── DEALER-WISE WITH ELIGIBILITY ──────────────────────────────
            sb.AppendLine("## DEALER-WISE BREAKDOWN WITH ELIGIBILITY");
            var dealerGroups = allProposals
                .GroupBy(p => new { p.State, p.DealerName })
                .OrderBy(g => g.Key.State).ThenBy(g => g.Key.DealerName);

            foreach (var g in dealerGroups)
            {
                var tb       = g.Sum(p => p.TotalBudget);
                var tr       = g.Sum(p => p.TotalRetailTarget);
                var tl       = g.Sum(p => p.TotalLeadTarget);
                var acts     = g.Sum(p => p.Activities.Count);
                var cac      = tr > 0 ? Math.Round(tb / tr, 0) : 0;
                var cpl      = tl > 0 ? Math.Round(tb / tl, 0) : 0;
                var eligib   = g.First().Eligibility ?? "";
                var dealType = g.First().Type ?? "";
                var month    = g.First().Month ?? "";
                var status   = string.Join("/", g.Select(p => p.Status).Distinct());

                // 3-month avg retail for this dealer
                var dealerRecent = recentProposals
                    .Where(p => p.DealerName == g.Key.DealerName && p.State == g.Key.State)
                    .ToList();
                var avgMonthlyRetail = dealerRecent.Any()
                    ? dealerRecent.Sum(p => p.TotalRetailTarget) / 3.0
                    : 0;

                // Determine eligibility from data
                var eligCategory = eligib.ToLower().Contains("not") || eligib.ToLower().Contains("non")
                    ? "Non-Eligible"
                    : dealType.ToLower() == "new" ? "Eligible New"
                    : "Eligible Old";

                var cacLimit = eligCategory == "Eligible Old" ? 4000
                             : eligCategory == "Eligible New" ? 6000 : int.MaxValue;
                var cacFlag  = cac > 0 && cac > cacLimit ? " ⚠ EXCEEDS LIMIT" : "";

                sb.AppendLine($"  [{g.Key.State}] {g.Key.DealerName}");
                sb.AppendLine($"    Category: {eligCategory} | Month: {month} | Status: {status}");
                sb.AppendLine($"    Budget: ₹{tb:N0} | Retail: {tr:N0} | Leads: {tl:N0} | Activities: {acts}");
                sb.AppendLine($"    CAC: ₹{cac:N0}{cacFlag} | CPL: ₹{cpl:N0} | " +
                              $"3M Avg Retail: {avgMonthlyRetail:F1}/month");
            }
            sb.AppendLine();

            // ── CAC ANALYSIS SUMMARY ──────────────────────────────────────
            sb.AppendLine("## CAC ANALYSIS");
            var allWithCac = allProposals
                .Where(p => p.TotalRetailTarget > 0 && p.TotalBudget > 0)
                .Select(p => new
                {
                    p.DealerName, p.State,
                    p.Eligibility, p.Type,
                    Cac = Math.Round(p.TotalBudget / p.TotalRetailTarget, 0),
                })
                .ToList();

            var withinLimit  = allWithCac.Count(x =>
                (x.Type?.ToLower() == "new" ? x.Cac <= 6000 : x.Cac <= 4000));
            var exceedsLimit = allWithCac.Count - withinLimit;

            sb.AppendLine($"  Proposals within CAC limit: {withinLimit}");
            sb.AppendLine($"  Proposals exceeding CAC limit: {exceedsLimit}");

            if (exceedsLimit > 0)
            {
                sb.AppendLine("  ⚠ High CAC proposals:");
                foreach (var x in allWithCac
                    .Where(x => (x.Type?.ToLower() == "new" ? x.Cac > 6000 : x.Cac > 4000))
                    .OrderByDescending(x => x.Cac).Take(5))
                {
                    sb.AppendLine($"    {x.DealerName} ({x.State}): CAC ₹{x.Cac:N0} [{x.Type}/{x.Eligibility}]");
                }
            }
            sb.AppendLine();

            // ── ACTIVITY TYPES ────────────────────────────────────────────
            sb.AppendLine("## ACTIVITY TYPES IN USE");
            var actGroups = allProposals
                .SelectMany(p => p.Activities)
                .GroupBy(a => a.ActivityType)
                .Select(g => new
                {
                    Type        = g.Key,
                    Count       = g.Count(),
                    TotalBudget = g.Sum(a => a.Budget + a.AdditionalBudget),
                    AvgBudget   = g.Average(a => (double)(a.Budget + a.AdditionalBudget)),
                })
                .OrderByDescending(x => x.Count);

            foreach (var a in actGroups)
                sb.AppendLine($"  {a.Type}: {a.Count} times | Total ₹{a.TotalBudget:N0} | Avg ₹{a.AvgBudget:N0}");
            sb.AppendLine();

            // ── RSM / SUBMITTER DATA ──────────────────────────────────────
            sb.AppendLine("## RSM-WISE SUBMISSION SUMMARY");
            var rsmGroups = allProposals
                .GroupBy(p => p.RsmName ?? p.SubmittedBy)
                .OrderByDescending(g => g.Sum(p => p.TotalBudget));

            foreach (var g in rsmGroups.Take(10))
            {
                var tb  = g.Sum(p => p.TotalBudget);
                var cnt = g.Count();
                sb.AppendLine($"  {g.Key}: {cnt} proposals | ₹{tb:N0} | " +
                              $"Pending: {g.Count(p => p.Status == "Pending")} | " +
                              $"Approved: {g.Count(p => p.Status == "Approved")}");
            }
            sb.AppendLine();

            // ── CALLER'S OWN DATA ─────────────────────────────────────────
            if (!string.IsNullOrWhiteSpace(userEmail))
            {
                var mine = allProposals
                    .Where(p => p.SubmittedBy.Equals(userEmail, StringComparison.OrdinalIgnoreCase))
                    .ToList();

                if (mine.Any())
                {
                    sb.AppendLine($"## YOUR DATA ({userEmail})");
                    var myBudget = mine.Sum(p => p.TotalBudget);
                    var myRetail = mine.Sum(p => p.TotalRetailTarget);
                    var myCac    = myRetail > 0 ? Math.Round(myBudget / myRetail, 0) : 0;
                    sb.AppendLine($"  Your Proposals: {mine.Count} | Budget: ₹{myBudget:N0} | " +
                                  $"CAC: ₹{myCac:N0}");
                    sb.AppendLine($"  Pending: {mine.Count(p => p.Status == "Pending")} | " +
                                  $"Approved: {mine.Count(p => p.Status == "Approved")} | " +
                                  $"Rejected: {mine.Count(p => p.Status == "Rejected")}");
                    foreach (var p in mine.OrderByDescending(p => p.CreatedAt).Take(8))
                        sb.AppendLine($"  - {p.TokenNumber} | {p.DealerName} ({p.State}) | " +
                                      $"₹{p.TotalBudget:N0} | CAC ₹{(p.TotalRetailTarget > 0 ? Math.Round(p.TotalBudget/p.TotalRetailTarget,0) : 0):N0} | {p.Status}");
                    sb.AppendLine();
                }
            }

            // ── PENDING PROPOSALS ─────────────────────────────────────────
            var pending = allProposals
                .Where(p => p.Status == "Pending")
                .OrderByDescending(p => p.CreatedAt)
                .Take(10)
                .ToList();

            if (pending.Any())
            {
                sb.AppendLine("## PENDING PROPOSALS (latest 10)");
                foreach (var p in pending)
                {
                    var cac = p.TotalRetailTarget > 0
                        ? Math.Round(p.TotalBudget / p.TotalRetailTarget, 0) : 0;
                    sb.AppendLine($"  {p.TokenNumber} | {p.DealerName} ({p.State}) | " +
                                  $"₹{p.TotalBudget:N0} | CAC ₹{cac:N0} | " +
                                  $"Submitted: {p.CreatedAt:dd-MMM-yyyy} | RSM: {p.RsmName}");
                }
            }

            return sb.ToString();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Bot] BuildDataContextAsync failed");
            return "Error loading live data from database. The bot will use general BTL knowledge.";
        }
    }

    private static void AppendSummary(StringBuilder sb, List<Backend.Models.Proposal> proposals, string label)
    {
        if (!proposals.Any()) { sb.AppendLine($"  No {label} proposals."); return; }
        var tb  = proposals.Sum(p => p.TotalBudget);
        var tr  = proposals.Sum(p => p.TotalRetailTarget);
        var tl  = proposals.Sum(p => p.TotalLeadTarget);
        var cac = tr > 0 ? Math.Round(tb / tr, 0) : 0;
        var cpl = tl > 0 ? Math.Round(tb / tl, 0) : 0;
        sb.AppendLine($"  Total Proposals: {proposals.Count} | " +
                      $"Pending: {proposals.Count(p => p.Status == "Pending")} | " +
                      $"Approved: {proposals.Count(p => p.Status == "Approved")} | " +
                      $"Rejected: {proposals.Count(p => p.Status == "Rejected")}");
        sb.AppendLine($"  Total Budget: ₹{tb:N0} | Retail Target: {tr:N0} units | Leads: {tl:N0}");
        sb.AppendLine($"  Overall CAC: ₹{cac:N0} | Overall CPL: ₹{cpl:N0}");
        sb.AppendLine($"  States: {proposals.Select(p => p.State).Distinct().Count()} | " +
                      $"Dealers: {proposals.Select(p => p.DealerName).Distinct().Count()}");
    }
}
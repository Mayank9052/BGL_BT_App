// Backend/Services/BotService.cs
// 3-layer answer engine:
// Layer 1: Knowledge Base (DB-stored Q&A, instant)
// Layer 2: Live DB Query (real proposal numbers)
// Layer 3: Claude AI (for anything not covered by layers 1-2)
// All 3 layers feed Claude so it always gets full context

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

    // Minimum keyword score to use KB answer standalone (without Claude)
    private const int KbHighConfidenceThreshold = 12;
    // Minimum score to pass KB context to Claude
    private const int KbLowConfidenceThreshold  = 4;

    public BotService(IHttpClientFactory factory, IConfiguration cfg,
        AppDbContext db, ILogger<BotService> logger)
    {
        _factory = factory; _cfg = cfg; _db = db; _logger = logger;
    }

    public async Task<string> AskAsync(
        List<(string role, string content)> history,
        string userEmail = "")
    {
        var recentHistory = FilterTo24Hours(history);
        var userQuestion  = recentHistory.LastOrDefault(h => h.role == "user").content ?? "";

        try
        {
            // ── Layer 1: Knowledge Base ───────────────────────────────────
            var (kbAnswer, kbScore) = await MatchKnowledgeBaseAsync(userQuestion);

            // High confidence KB match — return immediately + enrich with live data
            if (kbScore >= KbHighConfidenceThreshold && kbAnswer != null)
            {
                var liveSnippet = await GetLiveDataSnippetAsync(userQuestion, userEmail);
                if (!string.IsNullOrEmpty(liveSnippet))
                    return $"{kbAnswer}\n\n---\n📊 **Live data from your portal:**\n{liveSnippet}";
                return kbAnswer;
            }

            // ── Layer 2: Direct DB answer ─────────────────────────────────
            var dbAnswer = await TryDirectDataAnswerAsync(userQuestion, userEmail);

            // High confidence DB answer — return immediately
            if (dbAnswer != null && kbScore < KbLowConfidenceThreshold)
                return dbAnswer;

            // ── Layer 3: Claude AI (always called for unmatched questions) ─
            // Pass KB context + DB context to Claude so it gives a complete answer
            return await AskClaudeAsync(recentHistory, userEmail, kbAnswer, dbAnswer, kbScore);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Bot] AskAsync failed");
            return "⚠ Something went wrong. Please try again.";
        }
    }

    // ── Knowledge Base: score-based fuzzy matching ────────────────────────────
    private async Task<(string? Answer, int Score)> MatchKnowledgeBaseAsync(string question)
    {
        if (string.IsNullOrWhiteSpace(question)) return (null, 0);
        var q = question.ToLower().Trim();

        var knowledge = await _db.BotKnowledgeBase
            .Where(k => k.IsActive)
            .OrderBy(k => k.SortOrder)
            .AsNoTracking()
            .ToListAsync();

        if (!knowledge.Any()) return (null, 0);

        var best = knowledge
            .Select(k => new { k.Answer, Score = ScoreMatch(q, k.Keywords, k.Question) })
            .Where(x => x.Score >= KbLowConfidenceThreshold)
            .OrderByDescending(x => x.Score)
            .FirstOrDefault();

        return (best?.Answer, best?.Score ?? 0);
    }

    private static int ScoreMatch(string question, string keywords, string kbQuestion)
    {
        int score = 0;
        var words = question.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                            .Where(w => w.Length > 2).ToArray();

        foreach (var kw in keywords.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var keyword = kw.Trim().ToLower();
            if (string.IsNullOrEmpty(keyword)) continue;

            if (question.Contains(keyword))
                score += keyword.Contains(' ') ? 18 : 10; // phrase > single word
            else
                foreach (var word in words)
                    if (keyword.StartsWith(word) || word.StartsWith(keyword))
                        score += 3;
        }

        // Match against stored question text
        var kbQ = kbQuestion.ToLower();
        foreach (var word in words.Where(w => w.Length > 3))
            if (kbQ.Contains(word)) score += 4;

        return score;
    }

    // ── Direct DB answers for data-specific questions ─────────────────────────
    private async Task<string?> TryDirectDataAnswerAsync(string question, string userEmail)
    {
        var q = question.ToLower();

        // My proposals
        if ((q.Contains("my proposal") || q.Contains("my pending") ||
             q.Contains("my budget") || q.Contains("my approved")) &&
             !string.IsNullOrEmpty(userEmail))
        {
            var mine = await _db.Proposals
                .Where(p => p.SubmittedBy == userEmail)
                .AsNoTracking().ToListAsync();

            if (!mine.Any())
                return "You haven't submitted any proposals yet. Use **New Proposal** on the dashboard to get started.";

            var tb  = mine.Sum(p => p.TotalBudget);
            var tr  = mine.Sum(p => p.TotalRetailTarget);
            var cac = tr > 0 ? Math.Round(tb / tr, 0) : 0;
            var sb  = new StringBuilder();
            sb.AppendLine($"**Your Proposals — {mine.Count} total:**");
            sb.AppendLine($"- Total Budget: ₹{tb:N0} | Overall CAC: ₹{cac:N0}");
            sb.AppendLine($"- 🟡 Pending: {mine.Count(p => p.Status == "Pending")} | ✅ Approved: {mine.Count(p => p.Status == "Approved")} | ❌ Rejected: {mine.Count(p => p.Status == "Rejected")}");
            sb.AppendLine();
            foreach (var p in mine.OrderByDescending(p => p.CreatedAt).Take(10))
            {
                var pcac = p.TotalRetailTarget > 0 ? Math.Round(p.TotalBudget / p.TotalRetailTarget, 0) : 0;
                var icon = p.Status == "Approved" ? "✅" : p.Status == "Rejected" ? "❌" : "🟡";
                sb.AppendLine($"{icon} `{p.TokenNumber}` — **{p.DealerName}** ({p.State}) | ₹{p.TotalBudget:N0} | CAC ₹{pcac:N0}");
            }
            return sb.ToString();
        }

        // Pending proposals
        if (q.Contains("pending") && (q.Contains("proposal") || q.Contains("show") || q.Contains("list") || q.Contains("all")))
        {
            var pending = await _db.Proposals
                .Where(p => p.Status == "Pending")
                .OrderByDescending(p => p.CreatedAt)
                .Take(15).AsNoTracking().ToListAsync();

            if (!pending.Any()) return "✅ No pending proposals right now! Everything is reviewed.";

            var sb = new StringBuilder();
            sb.AppendLine($"**🟡 {pending.Count} Pending Proposals:**\n");
            foreach (var p in pending)
            {
                var cac = p.TotalRetailTarget > 0 ? Math.Round(p.TotalBudget / p.TotalRetailTarget, 0) : 0;
                sb.AppendLine($"• `{p.TokenNumber}` — **{p.DealerName}** ({p.State}) | ₹{p.TotalBudget:N0} | CAC ₹{cac:N0} | RSM: {p.RsmName} | {p.CreatedAt:dd-MMM}");
            }
            return sb.ToString();
        }

        // State-specific
        var stateMap = new Dictionary<string, string>
        {
            {"maharashtra","Maharashtra"},{"delhi","Delhi"},{"gujarat","Gujarat"},
            {"rajasthan","Rajasthan"},{"karnataka","Karnataka"},{"tamil nadu","Tamil Nadu"},
            {"andhra pradesh","Andhra Pradesh"},{"telangana","Telangana"},
            {"uttar pradesh","Uttar Pradesh"},{"madhya pradesh","Madhya Pradesh"},
            {"west bengal","West Bengal"},{"punjab","Punjab"},{"haryana","Haryana"},
            {"kerala","Kerala"},{"odisha","Odisha"},{"chhattisgarh","Chhattisgarh"},
            {"goa","Goa"},{"bihar","Bihar"},{"assam","Assam"},{"jharkhand","Jharkhand"},
            {"andhra","Andhra Pradesh"},{"mp","Madhya Pradesh"},{"up","Uttar Pradesh"},
        };

        var matchedKey = stateMap.Keys.FirstOrDefault(s => q.Contains(s));
        if (matchedKey != null)
        {
            var stateName = stateMap[matchedKey];
            var sp = await _db.Proposals
                .Include(p => p.Activities)
                .Where(p => p.State == stateName)
                .AsNoTracking().ToListAsync();

            if (!sp.Any())
                return $"No proposals found for **{stateName}** yet.";

            var tb      = sp.Sum(p => p.TotalBudget);
            var tr      = sp.Sum(p => p.TotalRetailTarget);
            var tl      = sp.Sum(p => p.TotalLeadTarget);
            var cac     = tr > 0 ? Math.Round(tb / tr, 0) : 0;
            var cpl     = tl > 0 ? Math.Round(tb / tl, 0) : 0;
            var dealers = sp.Select(p => p.DealerName).Distinct().Count();

            var cutoff  = DateTime.UtcNow.AddMonths(-3);
            var r3      = sp.Where(p => p.CreatedAt >= cutoff).ToList();
            var r3Tb    = r3.Sum(p => p.TotalBudget);
            var r3Tr    = r3.Sum(p => p.TotalRetailTarget);
            var r3Cac   = r3Tr > 0 ? Math.Round(r3Tb / r3Tr, 0) : 0;

            var cacFlag = cac <= 4000 ? "✅ Within Old limit"
                        : cac <= 6000 ? "⚠️ New dealer range"
                        : "❌ Exceeds limit";

            return $"""
**📍 {stateName} BTL Summary:**

📊 **Overall ({sp.Count} proposals, {dealers} dealers):**
- Total Budget: ₹{tb:N0}
- Retail Target: {tr:N0} units | Lead Target: {tl:N0}
- CAC: ₹{cac:N0} {cacFlag} | CPL: ₹{cpl:N0}
- 🟡 Pending: {sp.Count(p => p.Status == "Pending")} | ✅ Approved: {sp.Count(p => p.Status == "Approved")} | ❌ Rejected: {sp.Count(p => p.Status == "Rejected")}

📅 **Last 3 Months:**
- Proposals: {r3.Count} | Budget: ₹{r3Tb:N0} | Retail: {r3Tr:N0} units | CAC: ₹{r3Cac:N0}
""";
        }

        // Overall summary
        if (q.Contains("total budget") || q.Contains("overall") || q.Contains("all states") ||
            q.Contains("grand total") || q.Contains("how many proposal") ||
            (q.Contains("summary") && !q.Contains("state")))
        {
            var all = await _db.Proposals.AsNoTracking().ToListAsync();
            if (!all.Any()) return "No proposals in the system yet.";

            var tb  = all.Sum(p => p.TotalBudget);
            var tr  = all.Sum(p => p.TotalRetailTarget);
            var tl  = all.Sum(p => p.TotalLeadTarget);
            var cac = tr > 0 ? Math.Round(tb / tr, 0) : 0;
            var cpl = tl > 0 ? Math.Round(tb / tl, 0) : 0;
            var cutoff = DateTime.UtcNow.AddMonths(-3);
            var r3  = all.Where(p => p.CreatedAt >= cutoff).ToList();

            return $"""
**📊 BTL Portal — Overall Summary:**

🗂️ **All Time ({all.Count} proposals):**
- States: {all.Select(p => p.State).Distinct().Count()} | Dealers: {all.Select(p => p.DealerName).Distinct().Count()}
- Total Budget: ₹{tb:N0}
- Retail Target: {tr:N0} units | Lead Target: {tl:N0}
- Overall CAC: ₹{cac:N0} | Overall CPL: ₹{cpl:N0}
- 🟡 Pending: {all.Count(p => p.Status == "Pending")} | ✅ Approved: {all.Count(p => p.Status == "Approved")} | ❌ Rejected: {all.Count(p => p.Status == "Rejected")}

📅 **Last 3 Months ({r3.Count} proposals):**
- Budget: ₹{r3.Sum(p => p.TotalBudget):N0} | Retail: {r3.Sum(p => p.TotalRetailTarget):N0} units
""";
        }

        // High CAC analysis
        if (q.Contains("high cac") || q.Contains("exceed cac") || q.Contains("over limit") ||
            q.Contains("cac problem") || q.Contains("cac exceed") || q.Contains("above limit"))
        {
            var all = await _db.Proposals
                .Where(p => p.TotalRetailTarget > 0).AsNoTracking().ToListAsync();

            var flagged = all
                .Select(p => new {
                    p.TokenNumber, p.DealerName, p.State, p.Type, p.Status,
                    Cac = Math.Round(p.TotalBudget / p.TotalRetailTarget, 0)
                })
                .Where(x => x.Type?.ToLower() == "new" ? x.Cac > 6000 : x.Cac > 4000)
                .OrderByDescending(x => x.Cac).Take(10).ToList();

            if (!flagged.Any()) return "✅ All proposals are within CAC limits!";

            var sb = new StringBuilder();
            sb.AppendLine($"**⚠️ {flagged.Count} proposals exceed CAC limits:**\n");
            foreach (var x in flagged)
            {
                var limit = x.Type?.ToLower() == "new" ? 6000 : 4000;
                sb.AppendLine($"• `{x.TokenNumber}` — {x.DealerName} ({x.State}) | CAC: ₹{x.Cac:N0} | Limit: ₹{limit:N0} | {x.Status}");
            }
            return sb.ToString();
        }

        return null; // No direct DB answer — pass to Claude
    }

    // ── Live data snippet (brief, to enrich KB answers) ───────────────────────
    private async Task<string> GetLiveDataSnippetAsync(string question, string userEmail)
    {
        var sb = new StringBuilder();
        try
        {
            var all = await _db.Proposals.AsNoTracking().ToListAsync();
            if (!all.Any()) return "";

            var tb  = all.Sum(p => p.TotalBudget);
            var tr  = all.Sum(p => p.TotalRetailTarget);
            var cac = tr > 0 ? Math.Round(tb / tr, 0) : 0;
            sb.AppendLine($"Portal totals: {all.Count} proposals | ₹{tb:N0} budget | Overall CAC ₹{cac:N0}");
            sb.AppendLine($"Pending: {all.Count(p => p.Status == "Pending")} | Approved: {all.Count(p => p.Status == "Approved")}");

            if (!string.IsNullOrEmpty(userEmail))
            {
                var mine = all.Where(p => p.SubmittedBy == userEmail).ToList();
                if (mine.Any())
                    sb.AppendLine($"Your proposals: {mine.Count} | Pending: {mine.Count(p => p.Status == "Pending")}");
            }
        }
        catch { }
        return sb.ToString();
    }

    // ── Claude AI — receives KB + DB context + conversation history ───────────
    private async Task<string> AskClaudeAsync(
        List<(string role, string content)> history,
        string userEmail,
        string? kbContext,    // best KB match (even if low score)
        string? dbContext,    // direct DB answer if partial match
        int kbScore)
    {
        var apiKey = _cfg["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            // No API key — return best available answer from KB/DB
            if (kbContext != null) return kbContext;
            if (dbContext != null) return dbContext;
            return "I don't have a specific answer for that. Please check with your manager or the portal documentation.";
        }

        // Build live DB summary for Claude
        var liveData = await BuildCompactLiveDataAsync(userEmail);

        // Build the knowledge base context block
        var kbBlock = string.Empty;
        if (kbContext != null && kbScore >= KbLowConfidenceThreshold)
            kbBlock = $"\n\nKNOWLEDGE BASE REFERENCE (score {kbScore}):\n{kbContext}";

        var dbBlock = dbContext != null ? $"\n\nDATABASE ANSWER:\n{dbContext}" : "";

        var systemPrompt = $"""
You are BGauss AI Assistant — embedded in the BGauss BTL (Below-the-Line) marketing portal.
You help RSMs, Managers, and Admins with proposals, approvals, CAC/CPL, eligibility, and general queries.

═══════════════════════════════════════════
LIVE DATABASE DATA (real-time):
═══════════════════════════════════════════
{liveData}
{kbBlock}
{dbBlock}

═══════════════════════════════════════════
BTL BUSINESS RULES:
═══════════════════════════════════════════
ELIGIBILITY (3-month avg retail sales):
  - Eligible Old Dealer: ≥25 units/month avg → CAC limit ₹4,000
  - Eligible New Dealer: new dealership (<6 months) → CAC limit ₹6,000
  - Non-Eligible: <10 units/month → no BGauss BTL budget

CAC = Total Budget ÷ Retail Target
  - Old dealer limit: ₹4,000/unit
  - New dealer limit: ₹6,000/unit
  - Exceeding limit triggers warning → approver may reject

CPL = Total Budget ÷ Lead Target
  - No hard limit but ₹5,000+ is flagged as inefficient

BUDGET: Total = Base + Additional Budget
  - BGauss Amount = Total × BGauss Share%
  - Default BGauss Share: 100%

PROPOSAL WORKFLOW:
  RSM submits → Manager reviews → Final approver (vijay.maurya@bgauss.com) → Execution

ROLES:
  - RSM/User: submit proposals, view own data, chat, download reports
  - Manager: approve/reject all proposals, full analytics
  - Admin: user management, activity master, full access

═══════════════════════════════════════════
RESPONSE RULES:
═══════════════════════════════════════════
- For BTL questions: use the rules and live data above
- For general knowledge questions (not BTL-related): answer from your general knowledge
- For off-topic questions (weather, news, etc.): answer briefly then offer to help with BTL
- Use ₹ and Indian number format (1,00,000)
- Keep responses concise and use bullet points
- If numbers are in the live data, use them
- NEVER say "I don't know" for general knowledge — you're Claude, answer it
""";

        try
        {
            var http = _factory.CreateClient("anthropic");
            http.DefaultRequestHeaders.Clear();
            http.DefaultRequestHeaders.Add("x-api-key", apiKey);
            http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
            http.DefaultRequestHeaders.Accept.Add(
                new MediaTypeWithQualityHeaderValue("application/json"));

            var messages = history.Select(h => new { role = h.role, content = h.content }).ToList();

            var res = await http.PostAsync(
                "https://api.anthropic.com/v1/messages",
                new StringContent(JsonSerializer.Serialize(new
                {
                    model      = "claude-sonnet-4-6",
                    max_tokens = 1500,
                    system     = systemPrompt,
                    messages,
                }), Encoding.UTF8, "application/json"));

            if (!res.IsSuccessStatusCode)
            {
                _logger.LogError("[Bot] Claude error {Code}", res.StatusCode);
                // Fall back to KB/DB answer if Claude fails
                return kbContext ?? dbContext ??
                    "⚠ AI service temporarily unavailable. Please try again shortly.";
            }

            var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            return doc.RootElement
                .GetProperty("content")[0]
                .GetProperty("text")
                .GetString() ?? "No response from AI.";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Bot] Claude call failed");
            return kbContext ?? dbContext ??
                "⚠ AI service temporarily unavailable. Please try again.";
        }
    }

    // ── Compact live data for Claude context ──────────────────────────────────
    private async Task<string> BuildCompactLiveDataAsync(string userEmail)
    {
        try
        {
            var all = await _db.Proposals.AsNoTracking().ToListAsync();
            if (!all.Any()) return "No proposals in database yet.";

            var sb  = new StringBuilder();
            var tb  = all.Sum(p => p.TotalBudget);
            var tr  = all.Sum(p => p.TotalRetailTarget);
            var cac = tr > 0 ? Math.Round(tb / tr, 0) : 0;
            var cpl = all.Sum(p => p.TotalLeadTarget) is var tl && tl > 0 ? Math.Round(tb / tl, 0) : 0;
            sb.AppendLine($"TOTAL: {all.Count} proposals | Budget ₹{tb:N0} | CAC ₹{cac:N0} | CPL ₹{cpl:N0}");
            sb.AppendLine($"Status: Pending {all.Count(p => p.Status == "Pending")} | Approved {all.Count(p => p.Status == "Approved")} | Rejected {all.Count(p => p.Status == "Rejected")}");
            sb.AppendLine();

            // State breakdown
            sb.AppendLine("BY STATE:");
            foreach (var g in all.GroupBy(p => p.State).OrderBy(g => g.Key))
            {
                var stb  = g.Sum(p => p.TotalBudget);
                var str  = g.Sum(p => p.TotalRetailTarget);
                var scac = str > 0 ? Math.Round(stb / str, 0) : 0;
                sb.AppendLine($"  {g.Key}: {g.Count()} proposals | ₹{stb:N0} | CAC ₹{scac:N0} | Pending {g.Count(p => p.Status == "Pending")}");
            }

            // Caller's own data
            if (!string.IsNullOrEmpty(userEmail))
            {
                var mine = all.Where(p => p.SubmittedBy == userEmail).ToList();
                if (mine.Any())
                {
                    sb.AppendLine($"\nCALLER ({userEmail}):");
                    sb.AppendLine($"  {mine.Count} proposals | Budget ₹{mine.Sum(p => p.TotalBudget):N0} | Pending {mine.Count(p => p.Status == "Pending")} | Approved {mine.Count(p => p.Status == "Approved")}");
                }
            }

            return sb.ToString();
        }
        catch { return "Live data unavailable."; }
    }

    // ── Filter to 24-hour window ──────────────────────────────────────────────
    private static List<(string role, string content)> FilterTo24Hours(
        List<(string role, string content)> history)
    {
        // ChatHub already filters DB to 24hr when loading history
        // Here we cap at 40 messages to keep context window manageable
        return history.TakeLast(40).ToList();
    }
}
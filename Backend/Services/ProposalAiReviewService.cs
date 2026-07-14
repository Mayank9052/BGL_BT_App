using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.Hubs;
using BGL_BT_App.Backend.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

/// <summary>
/// Autonomous BTL proposal reviewer. Given a proposal, it reasons over
/// multiple turns — calling read-only tools against the real ERP and
/// proposal-history data — to flag CAC/CPL, budget, duplicate-activity,
/// date, and evidence issues before a human approver sees the proposal.
///
/// This is intentionally a standalone service: it reuses the existing
/// "anthropic" HttpClient and the existing ChatHub (via the generic
/// IHubContext&lt;ChatHub&gt;) for broadcasting, but does not modify or
/// depend on the internals of BotService/ChatHub.
///
/// The agent NEVER approves or rejects a proposal — it only flags issues.
/// A human still makes the final call via the existing /decide endpoint.
/// </summary>
public class ProposalAiReviewService : IProposalAiReviewService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IHubContext<ChatHub> _hub;
    private readonly ILogger<ProposalAiReviewService> _logger;
    private readonly string _baplConn;

    private const string AnthropicUrl     = "https://api.anthropic.com/v1/messages";
    private const int    MaxToolIterations = 6;

    public ProposalAiReviewService(
        AppDbContext db,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        IHubContext<ChatHub> hub,
        ILogger<ProposalAiReviewService> logger)
    {
        _db          = db;
        _config      = config;
        _httpFactory = httpFactory;
        _hub         = hub;
        _logger      = logger;
        _baplConn    = config.GetConnectionString("BaplConnection") ?? "";
    }

    public async Task<ProposalAiReview> ReviewAsync(Guid proposalId, CancellationToken ct = default)
    {
        var proposal = await _db.Proposals
            .Include(p => p.Activities)
                .ThenInclude(a => a.MediaFiles)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == proposalId, ct);

        if (proposal is null)
            throw new InvalidOperationException($"Proposal {proposalId} not found.");

        var review = new ProposalAiReview
        {
            ProposalId = proposalId,
            Status     = "Running",
            ModelUsed  = _config["Anthropic:Model"] ?? "claude-sonnet-5",
        };
        _db.ProposalAiReviews.Add(review);
        await _db.SaveChangesAsync(ct);

        try
        {
            var (verdict, summary, flags, toolCalls) = await RunAgentLoopAsync(proposal, ct);

            review.Status         = "Completed";
            review.OverallVerdict = verdict;
            review.Summary        = summary;
            review.ToolCallCount  = toolCalls;
            review.Flags          = flags;
            review.RunAt          = DateTimeOffset.UtcNow;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AI review failed for proposal {Id}", proposalId);
            review.Status         = "Failed";
            review.OverallVerdict = "Warning";
            review.ErrorMessage   = ex.Message;
        }

        await _db.SaveChangesAsync(ct);

        // Broadcast on the existing chat hub — the approver dashboard can
        // listen for "ProposalReviewed" the same way it already listens
        // for chat events. Works regardless of ChatHub's own method set.
        await _hub.Clients.All.SendAsync("ProposalReviewed", new
        {
            proposalId,
            status         = review.Status,
            overallVerdict = review.OverallVerdict,
            flagCount      = review.Flags.Count,
        }, ct);

        return review;
    }

    // ── Agent loop ──────────────────────────────────────────────────────────
    private async Task<(string Verdict, string Summary, List<ProposalAiFlag> Flags, int ToolCalls)>
        RunAgentLoopAsync(Proposal proposal, CancellationToken ct)
    {
        var apiKey = _config["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey) || apiKey.Contains("your-real-key"))
            throw new InvalidOperationException("Anthropic API key is not configured.");

        var model = _config["Anthropic:Model"] ?? "claude-sonnet-5";

        var systemPrompt        = BuildSystemPrompt();
        var initialUserMessage  = BuildProposalSummary(proposal);

        var messages = new JsonArray
        {
            new JsonObject { ["role"] = "user", ["content"] = initialUserMessage },
        };

        var tools   = BuildToolDefinitions();
        var client  = _httpFactory.CreateClient("anthropic");
        int toolCalls = 0;

        for (int i = 0; i < MaxToolIterations; i++)
        {
            var requestBody = new JsonObject
            {
                ["model"]      = model,
                ["max_tokens"] = 2000,
                ["system"]     = systemPrompt,
                ["tools"]      = tools.DeepClone(),
                ["messages"]   = messages.DeepClone(),
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, AnthropicUrl)
            {
                Content = new StringContent(requestBody.ToJsonString(), Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("x-api-key", apiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");

            using var response     = await client.SendAsync(request, ct);
            var responseText       = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Anthropic API error {(int)response.StatusCode}: {responseText}");

            var responseJson  = JsonNode.Parse(responseText)!.AsObject();
            var contentBlocks = responseJson["content"]!.AsArray();
            var stopReason    = responseJson["stop_reason"]?.GetValue<string>() ?? "";

            // Append this assistant turn to the running transcript.
            messages.Add(new JsonObject
            {
                ["role"]    = "assistant",
                ["content"] = contentBlocks.DeepClone(),
            });

            if (stopReason != "tool_use")
            {
                var textBlock = contentBlocks
                    .Select(b => b!.AsObject())
                    .FirstOrDefault(b => b["type"]?.GetValue<string>() == "text");

                var finalText = textBlock?["text"]?.GetValue<string>() ?? "{}";
                return ParseFinalVerdict(finalText, toolCalls);
            }

            // Execute every tool_use block in this turn, collect results.
            var toolResults = new JsonArray();
            foreach (var blockNode in contentBlocks)
            {
                var block = blockNode!.AsObject();
                if (block["type"]?.GetValue<string>() != "tool_use") continue;

                toolCalls++;
                var toolName  = block["name"]!.GetValue<string>();
                var toolUseId = block["id"]!.GetValue<string>();
                var input     = block["input"]!.AsObject();

                string resultText;
                try
                {
                    resultText = await ExecuteToolAsync(toolName, input, proposal, ct);
                }
                catch (Exception ex)
                {
                    resultText = $"Tool error: {ex.Message}";
                }

                toolResults.Add(new JsonObject
                {
                    ["type"]        = "tool_result",
                    ["tool_use_id"] = toolUseId,
                    ["content"]     = resultText,
                });
            }

            messages.Add(new JsonObject { ["role"] = "user", ["content"] = toolResults });
        }

        // Exhausted iterations without a final answer.
        return ("Warning",
            "AI review could not reach a conclusion within the allotted tool-call budget.",
            new List<ProposalAiFlag>(), toolCalls);
    }

    // ── Tool implementations (read-only) ───────────────────────────────────
    private Task<string> ExecuteToolAsync(
        string toolName, JsonObject input, Proposal proposal, CancellationToken ct) => toolName switch
    {
        "get_dealer_eligibility"      => GetDealerEligibilityAsync(proposal.DealerCode, ct),
        "get_dealer_proposal_history" => GetDealerProposalHistoryAsync(
                                              input["dealerName"]?.GetValue<string>() ?? proposal.DealerName,
                                              input["limit"]?.GetValue<int?>() ?? 5, ct),
        _ => Task.FromResult($"Unknown tool: {toolName}"),
    };

    private async Task<string> GetDealerEligibilityAsync(string? dealerCode, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dealerCode) || string.IsNullOrWhiteSpace(_baplConn))
            return JsonSerializer.Serialize(new { error = "Dealer code or ERP connection unavailable." });

        const string sql = """
            SELECT
                c.CustomerCode,
                DATEDIFF(MONTH, c.CreatedDate, GETDATE()) AS MonthsActive,
                ISNULL((
                    SELECT COUNT(*) FROM [dbo].[H_VehicleSalesMaster] v
                    WHERE v.CustomerCode = c.CustomerCode AND v.SaleType = 'Retail'
                      AND v.TransDate >= DATEADD(MONTH, -3, GETDATE())
                ), 0) AS RetailLast3Months
            FROM [dbo].[C_CustomerMaster] c
            WHERE c.CustomerCode = @CustomerCode AND c.Active = 'Y'
            """;

        await using var conn = new SqlConnection(_baplConn);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        cmd.Parameters.AddWithValue("@CustomerCode", dealerCode);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);

        if (!await rdr.ReadAsync(ct))
            return JsonSerializer.Serialize(new { error = "Dealer not found or inactive in ERP." });

        var retail3M = Convert.ToInt32(rdr["RetailLast3Months"]);
        var months   = rdr["MonthsActive"] == DBNull.Value ? 12 : Convert.ToInt32(rdr["MonthsActive"]);
        var avg      = retail3M / 3.0;
        var isNew    = months < 6;

        return JsonSerializer.Serialize(new
        {
            dealerCode,
            monthsActive         = months,
            retailLast3Months    = retail3M,
            monthlyAvgRetail     = Math.Round(avg, 1),
            isNew,
            allowedCacPerVehicle = isNew ? 6000 : 4000,
            isEligible           = isNew || avg >= 10,
        });
    }

    private async Task<string> GetDealerProposalHistoryAsync(string dealerName, int limit, CancellationToken ct)
    {
        var history = await _db.Proposals
            .Where(p => p.DealerName == dealerName && p.Status != "Rejected")
            .OrderByDescending(p => p.CreatedAt)
            .Take(Math.Clamp(limit, 1, 20))
            .Select(p => new
            {
                p.Month, p.Status, p.TotalBudget, p.TotalRetailTarget,
                p.TotalLeadTarget, p.Cac, p.Cpl, p.CreatedAt,
                ActivityTypes = p.Activities.Select(a => a.ActivityType).ToList(),
            })
            .AsNoTracking()
            .ToListAsync(ct);

        return JsonSerializer.Serialize(history);
    }

    // ── Prompt construction ─────────────────────────────────────────────────
    private static string BuildSystemPrompt() => """
        You are an autonomous compliance reviewer for BGauss's BTL (Below-The-Line)
        marketing activity proposals. You review one proposal at a time and flag
        problems before it reaches a human approver. You NEVER approve or reject —
        you only flag issues for a human to decide on.

        Use the tools available to gather real data before concluding. Check for:
        - CAC (cost per retail unit) or CPL (cost per lead) exceeding the dealer's
          allowed limit for their eligibility type (New vs Old dealer), UNLESS a
          Special Approval / additional budget has been applied (that's allowed by
          policy and should only be an Info-level note, not a Blocking flag).
        - Budget that seems disproportionate to the Lead/Retail targets requested
          (e.g. very high budget for very low targets, or vice versa).
        - Duplicate or near-duplicate activity types already used by this dealer
          this month, based on their proposal history.
        - Missing or implausible date ranges (very long or very short activity
          windows, dates far in the past or future).
        - High-budget activities (use your judgement, e.g. above roughly Rs 100,000)
          that have no supporting media/photo evidence attached.
        - Eligibility field mismatch versus what the ERP data actually shows.
        - Anything else that looks like a genuine data-quality or policy risk.

        Do not flag things that are normal and expected (e.g. a first-time dealer
        having no proposal history, or Special Approval budget being present).

        When you are done investigating, respond with ONLY a single JSON object
        (no markdown fences, no extra prose) in exactly this shape:
        {
          "overallVerdict": "Clean" | "Warning" | "Blocking",
          "summary": "one or two sentence plain-English summary",
          "flags": [
            {
              "severity": "Blocking" | "Warning" | "Info",
              "title": "short title",
              "detail": "one to two sentence explanation",
              "relatedActivityType": "activity type name or null"
            }
          ]
        }
        Use "Blocking" only for issues that clearly violate a stated policy limit
        (e.g. CAC exceeds the allowed cap with no Special Approval budget applied).
        Use "Warning" for things a human should double-check. Use "Info" for minor
        or informational notes. If nothing is wrong, return overallVerdict "Clean"
        with an empty flags array.
        """;

    private static string BuildProposalSummary(Proposal p)
    {
        var activities = p.Activities.Select(a => new
        {
            a.ActivityType, a.Category, a.Subcategory, a.Qty,
            a.LeadTarget, a.RetailTarget, a.SalesPercent,
            StartDate = a.StartDate?.ToString("yyyy-MM-dd"),
            EndDate   = a.EndDate?.ToString("yyyy-MM-dd"),
            a.Budget, a.AdditionalBudget, a.BGaussShare,
            MediaCount = a.MediaFiles.Count,
        });

        var payload = new
        {
            instruction = "Review this BTL proposal for issues before it goes to the approver.",
            proposal = new
            {
                p.DealerName, p.DealerCode, p.State, p.Location, p.Type,
                p.Month, p.Eligibility, p.TotalBudget, p.TotalLeadTarget,
                p.TotalRetailTarget, p.Cac, p.Cpl, p.AllowedCac, p.CacWarning,
                p.Remarks,
            },
            activities,
        };

        return JsonSerializer.Serialize(payload);
    }

    private static JsonArray BuildToolDefinitions() => new JsonArray
    {
        new JsonObject
        {
            ["name"] = "get_dealer_eligibility",
            ["description"] =
                "Look up this proposal's dealer directly in the ERP system to get " +
                "their current CAC eligibility limit, whether they are a New or " +
                "Old dealer, and their real retail sales average. Takes no " +
                "arguments — it always checks the dealer on the current proposal.",
            ["input_schema"] = new JsonObject
            {
                ["type"]       = "object",
                ["properties"] = new JsonObject(),
            },
        },
        new JsonObject
        {
            ["name"] = "get_dealer_proposal_history",
            ["description"] =
                "Get this dealer's recent past BTL proposals (activity types used, " +
                "CAC/CPL, budgets, status) to check for duplicate activity types " +
                "this month or unusual budget patterns.",
            ["input_schema"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["dealerName"] = new JsonObject { ["type"] = "string",  ["description"] = "Dealer name to look up." },
                    ["limit"]      = new JsonObject { ["type"] = "integer", ["description"] = "Max proposals to return (default 5)." },
                },
                ["required"] = new JsonArray("dealerName"),
            },
        },
    };

    private static (string, string, List<ProposalAiFlag>, int) ParseFinalVerdict(string json, int toolCalls)
    {
        try
        {
            using var doc  = JsonDocument.Parse(json);
            var root       = doc.RootElement;

            var verdict = root.TryGetProperty("overallVerdict", out var v) ? v.GetString() ?? "Warning" : "Warning";
            var summary = root.TryGetProperty("summary", out var s) ? s.GetString() ?? "" : "";

            var flags = new List<ProposalAiFlag>();
            if (root.TryGetProperty("flags", out var flagsEl) && flagsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var f in flagsEl.EnumerateArray())
                {
                    flags.Add(new ProposalAiFlag
                    {
                        Severity = f.TryGetProperty("severity", out var sv) ? sv.GetString() ?? "Info" : "Info",
                        Title    = f.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                        Detail   = f.TryGetProperty("detail", out var d) ? d.GetString() ?? "" : "",
                        RelatedActivityType = f.TryGetProperty("relatedActivityType", out var r)
                            && r.ValueKind != JsonValueKind.Null ? r.GetString() : null,
                    });
                }
            }

            return (verdict, summary, flags, toolCalls);
        }
        catch (JsonException)
        {
            return ("Warning",
                "AI review completed but returned an unexpected format — please check manually.",
                new List<ProposalAiFlag>(), toolCalls);
        }
    }
}

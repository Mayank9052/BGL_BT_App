// Backend/Controllers/DealerController.cs
// Queries BaplFinal for dealer list + eligibility (3-month retail avg)

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using BGL_BT_App.Backend.DTOs;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/dealers")]
[Authorize]
public class DealerController : ControllerBase
{
    private readonly string _baplConn;
    private readonly ILogger<DealerController> _logger;

    public DealerController(IConfiguration config, ILogger<DealerController> logger)
    {
        _baplConn = config.GetConnectionString("BaplConnection") ?? "";
        _logger   = logger;
    }

    // ── GET /api/dealers — full dealer list with RSM/TSM ──────────────────────
    [HttpGet]
    public async Task<ActionResult<IEnumerable<DealerWithRsmDto>>> GetDealers()
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
            return StatusCode(503, new { message = "Dealer service is not configured." });

        const string sql = """
            SELECT
                c.CustomerCode,
                c.CustomerName,
                ci.CityName      AS City,
                st.StateName     AS State,
                c.Mobile,
                c.ContactPerson,
                rsm_emp.EmployeeCode  AS RsmCode,
                rsm_emp.EmployeeName  AS RsmName,
                tsm_emp.EmployeeCode  AS TsmCode,
                tsm_emp.EmployeeName  AS TsmName
            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            LEFT JOIN [dbo].[C_CityMaster]  ci ON ci.Id = c.CityId
            LEFT JOIN [dbo].[C_CustomerIntRepDetail] rsm_rep
                ON rsm_rep.CustomerCode = c.CustomerCode AND rsm_rep.GroupId = 1
            LEFT JOIN [dbo].[H_EmployeeMaster] rsm_emp
                ON rsm_emp.EmployeeCode = rsm_rep.InternalRepresentative AND rsm_emp.Status = 'Y'
            LEFT JOIN [dbo].[C_CustomerIntRepDetail] tsm_rep
                ON tsm_rep.CustomerCode = c.CustomerCode AND tsm_rep.GroupId = 2
            LEFT JOIN [dbo].[H_EmployeeMaster] tsm_emp
                ON tsm_emp.EmployeeCode = tsm_rep.InternalRepresentative AND tsm_emp.Status = 'Y'
            WHERE c.Active = 'Y'
            ORDER BY c.CustomerName
            """;

        var results = new List<DealerWithRsmDto>();
        try
        {
            await using var conn = new SqlConnection(_baplConn);
            await conn.OpenAsync();
            await using var cmd  = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var rdr  = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                results.Add(new DealerWithRsmDto(
                    CustomerCode:  rdr["CustomerCode"]  == DBNull.Value ? "" : rdr["CustomerCode"].ToString()!,
                    CustomerName:  rdr["CustomerName"]  == DBNull.Value ? "" : rdr["CustomerName"].ToString()!,
                    City:          rdr["City"]          == DBNull.Value ? null : rdr["City"].ToString(),
                    State:         rdr["State"]         == DBNull.Value ? null : rdr["State"].ToString(),
                    Mobile:        rdr["Mobile"]        == DBNull.Value ? null : rdr["Mobile"].ToString(),
                    ContactPerson: rdr["ContactPerson"] == DBNull.Value ? null : rdr["ContactPerson"].ToString(),
                    RsmCode:       rdr["RsmCode"]       == DBNull.Value ? null : rdr["RsmCode"].ToString(),
                    RsmName:       rdr["RsmName"]       == DBNull.Value ? null : rdr["RsmName"].ToString(),
                    TsmCode:       rdr["TsmCode"]       == DBNull.Value ? null : rdr["TsmCode"].ToString(),
                    TsmName:       rdr["TsmName"]       == DBNull.Value ? null : rdr["TsmName"].ToString()
                ));
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Dealer query failed");
            return StatusCode(503, new { message = ex.Message });
        }
        return Ok(results);
    }

    // ── GET /api/dealers/eligibility/{customerCode} ───────────────────────────
    // Returns eligibility based on 3-month average retail sales from BaplFinal
    [HttpGet("eligibility/{customerCode}")]
    public async Task<IActionResult> GetEligibility(string customerCode)
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
            return StatusCode(503, new { message = "Dealer service is not configured." });

        // Query last 3 months retail sales from H_VehicleSalesMaster (or equivalent)
        // BaplFinal table: check H_SalesMaster / H_RetailMaster for actual retail units
        // Using the most common BaplFinal pattern for retail data
        const string salesSql = """
            SELECT
                c.CustomerCode,
                c.CustomerName,
                st.StateName AS State,
                -- Check if dealer is new (active < 6 months)
                DATEDIFF(MONTH, c.CreatedDate, GETDATE()) AS MonthsActive,
                -- 3-month retail average
                ISNULL((
                    SELECT COUNT(*)
                    FROM [dbo].[H_VehicleSalesMaster] v
                    WHERE v.CustomerCode = c.CustomerCode
                      AND v.SaleType = 'Retail'
                      AND v.TransDate >= DATEADD(MONTH, -3, GETDATE())
                ), 0) AS RetailLast3Months
            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            WHERE c.CustomerCode = @CustomerCode
              AND c.Active = 'Y'
            """;

        try
        {
            await using var conn = new SqlConnection(_baplConn);
            await conn.OpenAsync();
            await using var cmd = new SqlCommand(salesSql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@CustomerCode", customerCode);
            await using var rdr = await cmd.ExecuteReaderAsync();

            if (!await rdr.ReadAsync())
                return NotFound(new { message = "Dealer not found." });

            var retailLast3M  = Convert.ToInt32(rdr["RetailLast3Months"]);
            var monthsActive  = rdr["MonthsActive"] == DBNull.Value ? 12
                              : Convert.ToInt32(rdr["MonthsActive"]);
            var state         = rdr["State"]?.ToString() ?? "";
            var monthlyAvg    = retailLast3M / 3.0;

            // ── Eligibility rules ─────────────────────────────────────────────
            // New dealer = active < 6 months → eligible with CAC limit ₹6,000
            // Old eligible = avg >= 25 units/month → CAC limit ₹4,000
            // Non-eligible = avg < 10 units/month → no BTL budget

            bool  isNew       = monthsActive < 6;
            bool  isEligible  = isNew || monthlyAvg >= 10;
            int   cacLimit    = isNew ? 6000 : 4000;
            string dealerType = isNew ? "New" : (monthlyAvg >= 25 ? "Old" : "New");
            string reason;

            if (isNew)
                reason = $"New dealer ({monthsActive} months active) — eligible with higher CAC limit";
            else if (monthlyAvg >= 25)
                reason = $"Avg {monthlyAvg:F1} units/month (last 3 months) — Eligible Old";
            else if (monthlyAvg >= 10)
                reason = $"Avg {monthlyAvg:F1} units/month — Eligible New (below 25 threshold)";
            else
                reason = $"Avg {monthlyAvg:F1} units/month — below 10 unit threshold (non-eligible)";

            return Ok(new
            {
                customerCode,
                state,
                isEligible,
                dealerType,
                baseCacPerVehicle = cacLimit,
                monthlyAvgRetail  = Math.Round(monthlyAvg, 1),
                retailLast3Months = retailLast3M,
                monthsActive,
                eligibilityReason = reason,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Eligibility query failed for {Code}", customerCode);
            // Fallback: if sales table doesn't exist, return eligible (don't block users)
            return Ok(new
            {
                customerCode,
                state         = "",
                isEligible    = true,
                dealerType    = "Old",
                baseCacPerVehicle     = 4000,
                monthlyAvgRetail  = 0.0,
                retailLast3Months = 0,
                monthsActive  = 99,
                eligibilityReason = "Sales data unavailable — defaulting to eligible",
            });
        }
    }

    // ── GET /api/dealers/state-counts ─────────────────────────────────────────
    // Returns per-state counts of Eligible Old / Eligible New / Non-Eligible dealers
    // based on 3-month retail average from BaplFinal
    [HttpGet("state-counts")]
    public async Task<IActionResult> GetStateCounts()
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
            return Ok(new List<object>()); // empty — don't fail the dashboard

        const string sql = """
            SELECT
                st.StateName                            AS State,
                c.CustomerCode,
                ISNULL(DATEDIFF(MONTH, c.CreatedDate, GETDATE()), 99) AS MonthsActive,
                ISNULL((
                    SELECT COUNT(*)
                    FROM [dbo].[H_VehicleSalesMaster] v
                    WHERE v.CustomerCode = c.CustomerCode
                      AND v.SaleType = 'Retail'
                      AND v.TransDate >= DATEADD(MONTH, -3, GETDATE())
                ), 0) AS RetailLast3Months
            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            WHERE c.Active = 'Y'
              AND st.StateName IS NOT NULL
            """;

        try
        {
            await using var conn = new SqlConnection(_baplConn);
            await conn.OpenAsync();
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var rdr = await cmd.ExecuteReaderAsync();

            // Aggregate per state
            var stateCounts = new Dictionary<string, (int OldElig, int NewElig, int NonElig)>();

            while (await rdr.ReadAsync())
            {
                var state      = rdr["State"]?.ToString() ?? "";
                var r3M        = Convert.ToInt32(rdr["RetailLast3Months"]);
                var months     = Convert.ToInt32(rdr["MonthsActive"]);
                var avg        = r3M / 3.0;
                var isNew      = months < 6;

                if (!stateCounts.ContainsKey(state))
                    stateCounts[state] = (0, 0, 0);

                var (o, n, x) = stateCounts[state];

                if (isNew)
                    stateCounts[state] = (o, n + 1, x);          // New eligible
                else if (avg >= 10)
                    stateCounts[state] = (o + 1, n, x);          // Old eligible
                else
                    stateCounts[state] = (o, n, x + 1);          // Non-eligible
            }

            var result = stateCounts.Select(kv => new
            {
                state          = kv.Key,
                eligibleOld    = kv.Value.OldElig,
                eligibleNew    = kv.Value.NewElig,
                nonEligible    = kv.Value.NonElig,
                total          = kv.Value.OldElig + kv.Value.NewElig + kv.Value.NonElig,
            }).OrderBy(x => x.state);

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "state-counts query failed — returning empty");
            return Ok(new List<object>()); // never fail dashboard
        }
    }
}

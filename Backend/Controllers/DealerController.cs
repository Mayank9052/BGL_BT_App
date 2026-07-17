// Backend/Controllers/DealerController.cs
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

    // ── GET /api/dealers ──────────────────────────────────────────────────────
    // Active dealers with RSM (C_CustomerIntRepDetail GroupId=1), TSM (via the
    // dedicated H_TSMMaster hierarchy table — NOT C_CustomerIntRepDetail, per
    // schema_analysis.csv / rsm_tsm_command.csv), and a best-effort Commando
    // (DesignationId=26 reporting to the dealer's RSM via HeadEmployee).
    // Commando is NOT a true per-dealer relationship in this schema — this is
    // a reasonable auto-fill guess; RSMs can still override it manually via
    // the commandoOptions dropdown already wired up in RSMForm.tsx.
    [HttpGet]
    public async Task<ActionResult<IEnumerable<DealerWithRsmDto>>> GetDealers()
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
            return StatusCode(503, new { message = "Dealer service is not configured." });

        const string sql = """
            SELECT
                c.CustomerCode,
                c.CustomerName,
                ci.CityName          AS City,
                st.StateName         AS State,
                c.Mobile,
                c.ContactPerson,

                -- RSM: dealer's direct RSM from C_CustomerIntRepDetail GroupId=1
                rsm_emp.EmployeeCode AS RsmCode,
                rsm_emp.EmployeeName AS RsmName,
                rsm_emp.MobileNo     AS RsmMobile,

                -- TSM: via H_TSMMaster.RSMCode = dealer's RSM code
                -- (dedicated hierarchy table — matches schema_analysis.csv)
                tsm_emp.EmployeeCode AS TsmCode,
                tsm_emp.EmployeeName AS TsmName,
                tsm_emp.MobileNo     AS TsmMobile,

                -- Commando: best-effort — first active Sales Commando
                -- (DesignationId=26) whose HeadEmployee = dealer's RSM
                cmd_pick.EmployeeCode AS CommandoCode,
                cmd_pick.EmployeeName AS CommandoName

            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            LEFT JOIN [dbo].[C_CityMaster]  ci ON ci.Id = c.CityId

            -- ── RSM: dealer's direct RSM ────────────────────────────────────
            OUTER APPLY (
                SELECT TOP 1 rep.InternalRepresentative AS RepCode
                FROM [dbo].[C_CustomerIntRepDetail] rep
                WHERE rep.CustomerCode = c.CustomerCode AND rep.GroupId = 1
                ORDER BY CASE WHEN rep.Position = 'RSM' THEN 0 ELSE 1 END, rep.Id DESC
            ) rsm_pick
            LEFT JOIN [dbo].[H_EmployeeMaster] rsm_emp
                ON rsm_emp.EmployeeCode = rsm_pick.RepCode AND rsm_emp.Status = 'Y'

            -- ── TSM: from H_TSMMaster where RSMCode = dealer's RSM ──────────
            OUTER APPLY (
                SELECT TOP 1 t.TSMCode
                FROM [dbo].[H_TSMMaster] t
                WHERE t.RSMCode = rsm_pick.RepCode
                ORDER BY t.Id
            ) tsm_pick
            LEFT JOIN [dbo].[H_EmployeeMaster] tsm_emp
                ON tsm_emp.EmployeeCode = tsm_pick.TSMCode AND tsm_emp.Status = 'Y'

            -- ── Commando: best-effort, first active commando under the RSM ──
            OUTER APPLY (
                SELECT TOP 1 e.EmployeeCode, e.EmployeeName
                FROM [dbo].[H_EmployeeMaster] e
                WHERE e.HeadEmployee = rsm_pick.RepCode
                  AND e.DesignationId = 26
                  AND e.Status = 'Y'
                ORDER BY e.EmployeeName
            ) cmd_pick

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
                    RsmMobile:     rdr["RsmMobile"]     == DBNull.Value ? null : rdr["RsmMobile"].ToString(),
                    TsmCode:       rdr["TsmCode"]       == DBNull.Value ? null : rdr["TsmCode"].ToString(),
                    TsmName:       rdr["TsmName"]       == DBNull.Value ? null : rdr["TsmName"].ToString(),
                    TsmMobile:     rdr["TsmMobile"]     == DBNull.Value ? null : rdr["TsmMobile"].ToString(),
                    CommandoCode:  rdr["CommandoCode"]  == DBNull.Value ? null : rdr["CommandoCode"].ToString(),
                    CommandoName:  rdr["CommandoName"]  == DBNull.Value ? null : rdr["CommandoName"].ToString()
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

    // ── GET /api/dealers/commandos ────────────────────────────────────────────
    // All active Sales Commandos (DesignationId=26) for the manual dropdown.
    // Also returns HeadEmployee so frontend can filter commandos by the
    // selected dealer's RSM (HeadEmployee = RSM EmployeeCode).
    [HttpGet("commandos")]
    public async Task<IActionResult> GetCommandos()
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
            return Ok(new List<object>());

        const string sql = """
            SELECT
                e.EmployeeCode,
                e.EmployeeName,
                e.MobileNo,
                e.BaseLocation,
                e.ZoneCode,
                e.HeadEmployee
            FROM [dbo].[H_EmployeeMaster] e
            WHERE e.DesignationId = 26
              AND e.Status = 'Y'
            ORDER BY e.EmployeeName
            """;

        var results = new List<object>();
        try
        {
            await using var conn = new SqlConnection(_baplConn);
            await conn.OpenAsync();
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            await using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                results.Add(new
                {
                    code         = rdr["EmployeeCode"]  == DBNull.Value ? "" : rdr["EmployeeCode"].ToString()!,
                    name         = rdr["EmployeeName"]  == DBNull.Value ? "" : rdr["EmployeeName"].ToString()!,
                    mobile       = rdr["MobileNo"]      == DBNull.Value ? null : rdr["MobileNo"].ToString(),
                    location     = rdr["BaseLocation"]  == DBNull.Value ? null : rdr["BaseLocation"].ToString(),
                    zone         = rdr["ZoneCode"]      == DBNull.Value ? null : rdr["ZoneCode"].ToString(),
                    headEmployee = rdr["HeadEmployee"]  == DBNull.Value ? null : rdr["HeadEmployee"].ToString(),
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Commando query failed");
            return Ok(new List<object>());
        }
        return Ok(results);
    }

    // ── CHANGE in GetEligibility endpoint ────────────────────────────────────
    // Find:
    //   bool isNew = monthsActive < 6;
    // Replace with:
    //   bool isNew = monthsActive < 4; // ← CHANGED: new dealer = onboarded < 4 months ago

    // ── CHANGE in GetStateCounts endpoint ────────────────────────────────────
    // Find:
    //   var isNew = months < 6;
    // Replace with:
    //   var isNew = months < 4; // ← CHANGED: new dealer = onboarded < 4 months ago

    // Full corrected GetEligibility method (only changed lines highlighted):
    [HttpGet("eligibility/{customerCode}")]
    public async Task<IActionResult> GetEligibility(string customerCode)
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
            return StatusCode(503, new { message = "Dealer service is not configured." });

        const string salesSql = """
            SELECT
                c.CustomerCode,
                c.CustomerName,
                st.StateName AS State,
                DATEDIFF(MONTH, c.CreatedDate, GETDATE()) AS MonthsActive,
                ISNULL((
                    SELECT COUNT(*)
                    FROM [dbo].[H_VehicleSalesMaster] v
                    WHERE v.CustomerCode = c.CustomerCode
                    AND v.SaleType = 'Retail'
                    AND v.TransDate >= DATEADD(MONTH, -3, GETDATE())
                ), 0) AS RetailLast3Months
            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            WHERE c.CustomerCode = @CustomerCode AND c.Active = 'Y'
            """;

        try
        {
            await using var conn = new SqlConnection(_baplConn);
            await conn.OpenAsync();
            await using var cmd = new SqlCommand(salesSql, conn) { CommandTimeout = 30 };
            cmd.Parameters.AddWithValue("@CustomerCode", customerCode);
            await using var rdr = await cmd.ExecuteReaderAsync();

            if (!await rdr.ReadAsync())
                return NotFound(new { message = "Dealer not found or not active." });

            var retailLast3M = Convert.ToInt32(rdr["RetailLast3Months"]);
            var monthsActive = rdr["MonthsActive"] == DBNull.Value ? 12 : Convert.ToInt32(rdr["MonthsActive"]);
            var state        = rdr["State"]?.ToString() ?? "";
            var monthlyAvg   = retailLast3M / 3.0;
            // ← CHANGED Point #2: new dealer = onboarded within last 4 months (was 6)
            bool isNew       = monthsActive < 4;
            bool isEligible  = isNew || monthlyAvg >= 10;
            int  cacLimit    = isNew ? 6000 : 4000;
            string dealerType = isNew ? "New" : (monthlyAvg >= 25 ? "Old" : "New");
            string reason = isNew
                ? $"New dealer ({monthsActive} months active) — eligible with higher CAC limit"
                : monthlyAvg >= 25 ? $"Avg {monthlyAvg:F1} units/month — Eligible Old Dealer"
                : monthlyAvg >= 10 ? $"Avg {monthlyAvg:F1} units/month — Eligible New Dealer"
                : $"Avg {monthlyAvg:F1} units/month — Not Eligible (min 10 units/month required)";

            return Ok(new
            {
                customerCode, state, isEligible, dealerType,
                baseCacPerVehicle = cacLimit,
                monthlyAvgRetail  = Math.Round(monthlyAvg, 1),
                retailLast3Months = retailLast3M,
                monthsActive, eligibilityReason = reason,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Eligibility query failed for {Code}", customerCode);
            return Ok(new
            {
                customerCode, state = "", isEligible = false, dealerType = "Old",
                baseCacPerVehicle = 4000, monthlyAvgRetail = 0.0,
                retailLast3Months = 0, monthsActive = 99,
                eligibilityReason = "Could not verify eligibility — ERP data unavailable.",
            });
        }
    }


    [HttpGet("state-counts")]
    public async Task<IActionResult> GetStateCounts()
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
            return Ok(new List<object>());

        const string sql = """
            SELECT
                st.StateName AS State, c.CustomerCode,
                ISNULL(DATEDIFF(MONTH, c.CreatedDate, GETDATE()), 99) AS MonthsActive,
                ISNULL((
                    SELECT COUNT(*) FROM [dbo].[H_VehicleSalesMaster] v
                    WHERE v.CustomerCode = c.CustomerCode AND v.SaleType = 'Retail'
                    AND v.TransDate >= DATEADD(MONTH, -3, GETDATE())
                ), 0) AS RetailLast3Months
            FROM [dbo].[C_CustomerMaster] c
            LEFT JOIN [dbo].[C_StateMaster] st ON st.Id = c.StateId
            WHERE c.Active = 'Y' AND st.StateName IS NOT NULL
            """;

        try
        {
            await using var conn = new SqlConnection(_baplConn);
            await conn.OpenAsync();
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var rdr = await cmd.ExecuteReaderAsync();
            var stateCounts = new Dictionary<string, (int OldElig, int NewElig, int NonElig)>();
            while (await rdr.ReadAsync())
            {
                var state  = rdr["State"]?.ToString() ?? "";
                var r3M    = Convert.ToInt32(rdr["RetailLast3Months"]);
                var months = Convert.ToInt32(rdr["MonthsActive"]);
                var avg    = r3M / 3.0;
                // ← CHANGED Point #2: new dealer = onboarded within last 4 months (was 6)
                var isNew  = months < 4;
                if (!stateCounts.ContainsKey(state)) stateCounts[state] = (0, 0, 0);
                var (o, n, x) = stateCounts[state];
                if (isNew)          stateCounts[state] = (o, n + 1, x);
                else if (avg >= 10) stateCounts[state] = (o + 1, n, x);
                else                stateCounts[state] = (o, n, x + 1);
            }
            return Ok(stateCounts.Select(kv => new
            {
                state       = kv.Key, eligibleOld = kv.Value.OldElig,
                eligibleNew = kv.Value.NewElig, nonEligible = kv.Value.NonElig,
                total       = kv.Value.OldElig + kv.Value.NewElig + kv.Value.NonElig,
            }).OrderBy(x => x.state));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "state-counts failed");
            return Ok(new List<object>());
        }
    }
}
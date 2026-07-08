// ── DealerController.cs — FINAL with correct RSM/TSM JOIN ──────────────────
// Replaces the old H_TSMMaster join with C_CustomerIntRepDetail GroupId=1/2
// GroupId=1 = RSM, GroupId=2 = TSM/Commando (confirmed from DB data)

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

    [HttpGet]
    public async Task<ActionResult<IEnumerable<DealerWithRsmDto>>> GetDealers()
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
        {
            _logger.LogError("BaplConnection string is not configured.");
            return StatusCode(503, new { message = "Dealer service is not configured." });
        }

        // ── CONFIRMED JOIN PATTERN (from DB investigation) ────────────────────
        // C_CustomerIntRepDetail.GroupId = 1  →  RSM
        // C_CustomerIntRepDetail.GroupId = 2  →  TSM / Commando
        // InternalRepresentative = EmployeeCode → H_EmployeeMaster.EmployeeCode
        // C_CustomerMaster has NO RSMCode/TSMCode columns — must use IntRepDetail
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
            LEFT JOIN [dbo].[C_StateMaster] st
                ON st.Id = c.StateId
            LEFT JOIN [dbo].[C_CityMaster] ci
                ON ci.Id = c.CityId
            -- RSM (GroupId = 1)
            LEFT JOIN [dbo].[C_CustomerIntRepDetail] rsm_rep
                ON rsm_rep.CustomerCode = c.CustomerCode
                AND rsm_rep.GroupId = 1
            LEFT JOIN [dbo].[H_EmployeeMaster] rsm_emp
                ON rsm_emp.EmployeeCode = rsm_rep.InternalRepresentative
                AND rsm_emp.Status = 'Y'
            -- TSM / Commando (GroupId = 2)
            LEFT JOIN [dbo].[C_CustomerIntRepDetail] tsm_rep
                ON tsm_rep.CustomerCode = c.CustomerCode
                AND tsm_rep.GroupId = 2
            LEFT JOIN [dbo].[H_EmployeeMaster] tsm_emp
                ON tsm_emp.EmployeeCode = tsm_rep.InternalRepresentative
                AND tsm_emp.Status = 'Y'
            WHERE c.Active = 'Y'
            ORDER BY c.CustomerName
            """;

        var results = new List<DealerWithRsmDto>();

        try
        {
            await using var conn   = new SqlConnection(_baplConn);
            await conn.OpenAsync();
            await using var cmd    = new SqlCommand(sql, conn);
            cmd.CommandTimeout     = 60;
            await using var reader = await cmd.ExecuteReaderAsync();

            while (await reader.ReadAsync())
            {
                results.Add(new DealerWithRsmDto(
                    CustomerCode:  reader["CustomerCode"]  == DBNull.Value ? "" : reader["CustomerCode"].ToString()!,
                    CustomerName:  reader["CustomerName"]  == DBNull.Value ? "" : reader["CustomerName"].ToString()!,
                    City:          reader["City"]          == DBNull.Value ? null : reader["City"].ToString(),
                    State:         reader["State"]         == DBNull.Value ? null : reader["State"].ToString(),
                    Mobile:        reader["Mobile"]        == DBNull.Value ? null : reader["Mobile"].ToString(),
                    ContactPerson: reader["ContactPerson"] == DBNull.Value ? null : reader["ContactPerson"].ToString(),
                    RsmCode:       reader["RsmCode"]       == DBNull.Value ? null : reader["RsmCode"].ToString(),
                    RsmName:       reader["RsmName"]       == DBNull.Value ? null : reader["RsmName"].ToString(),
                    TsmCode:       reader["TsmCode"]       == DBNull.Value ? null : reader["TsmCode"].ToString(),
                    TsmName:       reader["TsmName"]       == DBNull.Value ? null : reader["TsmName"].ToString()
                ));
            }

            _logger.LogInformation("Loaded {Count} dealers from baplfinal", results.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Dealer query failed");
            return StatusCode(503, new { message = ex.Message });
        }

        return Ok(results);
    }
}
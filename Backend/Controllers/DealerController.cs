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
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<DealerWithRsmDto>>> GetDealers()
    {
        if (string.IsNullOrWhiteSpace(_baplConn))
        {
            _logger.LogError("BaplConnection string is not configured.");
            return StatusCode(503, new { message = "Dealer service is not configured." });
        }

        const string sql = """
            SELECT
                c.CustomerCode,
                c.CustomerName,
                cy.CityName      AS City,
                s.StateName      AS State,
                c.Mobile,
                c.ContactPerson,
                tsm.TSMCode,
                eT.EmployeeName  AS TsmName,
                tsm.RSMCode,
                eR.EmployeeName  AS RsmName
            FROM dbo.C_CustomerMaster c
            LEFT JOIN (
                SELECT cir1.*
                FROM dbo.C_CustomerIntRepDetail cir1
                INNER JOIN (
                    SELECT CustomerCode, MIN(Id) AS MinId
                    FROM dbo.C_CustomerIntRepDetail
                    GROUP BY CustomerCode
                ) cir2 ON cir1.CustomerCode = cir2.CustomerCode
                       AND cir1.Id          = cir2.MinId
            ) cir ON cir.CustomerCode = c.CustomerCode
            LEFT JOIN dbo.H_TSMMaster tsm
                ON tsm.TSMCode = cir.InternalRepresentative
            LEFT JOIN dbo.H_EmployeeMaster eT
                ON eT.EmployeeCode = tsm.TSMCode
            LEFT JOIN dbo.H_EmployeeMaster eR
                ON eR.EmployeeCode = tsm.RSMCode
            LEFT JOIN dbo.C_CityMaster  cy ON cy.Id = c.CityId
            LEFT JOIN dbo.C_StateMaster s  ON s.Id  = c.StateId
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
                    TsmCode:       reader["TSMCode"]       == DBNull.Value ? null : reader["TSMCode"].ToString(),
                    TsmName:       reader["TsmName"]       == DBNull.Value ? null : reader["TsmName"].ToString(),
                    RsmCode:       reader["RSMCode"]       == DBNull.Value ? null : reader["RSMCode"].ToString(),
                    RsmName:       reader["RsmName"]       == DBNull.Value ? null : reader["RsmName"].ToString()
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
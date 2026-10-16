// Backend/Controllers/LeadRecordsController.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/lead-records")]
public class LeadRecordsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly ILogger<LeadRecordsController> _log;

    public LeadRecordsController(AppDbContext db, IConfiguration cfg, ILogger<LeadRecordsController> log)
    {
        _db = db; _cfg = cfg; _log = log;
    }

    private bool CheckApiKey(string? apiKey)
    {
        var expected = _cfg["Lms:ApiKey"];
        return !string.IsNullOrWhiteSpace(expected) && apiKey == expected;
    }

    // ═══════════════════════════════════════════════════════════════════
    // BULK CREATE / UPSERT (JSON) — the main API ingestion endpoint
    // POST /api/lead-records/bulk
    // ═══════════════════════════════════════════════════════════════════
    [HttpPost("bulk")]
    public async Task<IActionResult> BulkUpsert(
        [FromHeader(Name = "X-Api-Key")] string? apiKey,
        [FromBody] BulkLeadPushRequestDto request)
    {
        if (!CheckApiKey(apiKey))
            return Unauthorized(new { error = "Invalid or missing X-Api-Key header." });

        if (request?.Leads == null || request.Leads.Count == 0)
            return BadRequest(new { error = "No leads provided in 'leads' array." });

        var result = await PerformBulkUpsertAsync(request.Leads);
        return Ok(result);
    }

    // ═══════════════════════════════════════════════════════════════════
    // IMPORT FROM EXCEL — upload the "Lead Data" sheet directly
    // POST /api/lead-records/import   (multipart/form-data, field name "file")
    // ═══════════════════════════════════════════════════════════════════
    [HttpPost("import")]
    [RequestSizeLimit(100_000_000)] // 100 MB — plenty for tens of thousands of rows
    public async Task<IActionResult> ImportExcel(
        [FromHeader(Name = "X-Api-Key")] string? apiKey,
        IFormFile file)
    {
        if (!CheckApiKey(apiKey))
            return Unauthorized(new { error = "Invalid or missing X-Api-Key header." });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file uploaded. Send it as multipart/form-data under the 'file' field." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".xlsx" && ext != ".xlsm")
            return BadRequest(new { error = "Only .xlsx/.xlsm files are supported." });

        List<LeadRecordDto> leads;
        List<string> parseErrors;

        try
        {
            (leads, parseErrors) = ParseWorkbook(file);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to parse uploaded Excel file {FileName}", file.FileName);
            return BadRequest(new { error = $"Could not read the Excel file: {ex.Message}" });
        }

        if (leads.Count == 0)
            return BadRequest(new { error = "No valid lead rows found in the file.", parseErrors });

        var result = await PerformBulkUpsertAsync(leads);

        return Ok(new
        {
            fileName = file.FileName,
            rowsInFile = leads.Count + parseErrors.Count,
            result.Received,
            result.Inserted,
            result.Updated,
            result.Rejected,
            errors = result.Errors,
            parseErrors, // rows skipped before even reaching the DB (e.g. missing Unique Lead Id)
        });
    }

    // ── Excel parsing — maps by HEADER NAME, not column position, and
    // tolerates the header-name variants seen across different LMS exports
    // (e.g. "DealerName" vs "Organization Name", "ZSM" vs "ZH"). ──────────
    private static (List<LeadRecordDto> leads, List<string> errors) ParseWorkbook(IFormFile file)
    {
        var leads = new List<LeadRecordDto>();
        var errors = new List<string>();

        using var stream = file.OpenReadStream();
        using var workbook = new XLWorkbook(stream);
        var ws = workbook.Worksheets.First();

        var lastCol = ws.Row(1).LastCellUsed()?.Address.ColumnNumber ?? 0;
        if (lastCol == 0)
        {
            errors.Add("Header row is empty — nothing to import.");
            return (leads, errors);
        }

        // column index → canonical property key
        var colMap = new Dictionary<int, string>();
        for (int c = 1; c <= lastCol; c++)
        {
            var header = ws.Row(1).Cell(c).GetString().Trim();
            var key = NormalizeHeader(header);
            if (key != null) colMap[c] = key;
        }

        var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
        for (int r = 2; r <= lastRow; r++)
        {
            var row = ws.Row(r);
            if (row.IsEmpty()) continue;

            try
            {
                var dto = new LeadRecordDto();
                foreach (var (col, key) in colMap)
                    SetField(dto, key, row.Cell(col));

                if (dto.UniqueLeadId <= 0)
                {
                    errors.Add($"Row {r}: missing/invalid 'Unique Lead Id' — skipped.");
                    continue;
                }
                leads.Add(dto);
            }
            catch (Exception ex)
            {
                errors.Add($"Row {r}: {ex.Message}");
            }
        }

        return (leads, errors);
    }

    private static string? NormalizeHeader(string header)
    {
        if (string.IsNullOrWhiteSpace(header)) return null;
        var h = header.Trim().ToLowerInvariant().Replace(" ", "").Replace("-", "");
        return h switch
        {
            "applicationid"              => "ApplicationId",
            "uniqueleadid"                => "UniqueLeadId",
            "dealercode"                  => "DealerCode",
            "dealername"                  => "OrganizationName",   // ← variant seen in this file
            "organizationname"            => "OrganizationName",
            "zsm"                         => "ZH",                  // ← variant seen in this file
            "zh"                          => "ZH",
            "rsm"                         => "RSM",
            "tsm"                         => "TSM",
            "commando"                    => "Commando",
            "dealerpincode"               => "DealerPinCode",
            "customername"                => "CustomerName",
            "mobile"                      => "Mobile",
            "email"                       => "Email",
            "source"                      => "Source",
            "subsource"                   => "SubSource",
            "leadorigin"                  => "LeadOrigin",
            "make"                        => "Make",
            "model"                       => "Model",
            "version"                     => "Version",
            "leaddate"                    => "LeadDate",
            "city"                        => "City",
            "state"                       => "State",
            "customerpincode"             => "CustomerPinCode",
            "user"                        => "User",
            "stage"                       => "Stage",
            "substage"                    => "SubStage",
            "qualifiedby"                 => "QualifiedBy",
            "lostclosedreason"            => "LostClosedReason",
            "lostclosedsubreason"         => "LostClosedSubReason",
            "lostclosedby"                => "LostClosedBy",
            "leadstatus"                  => "LeadStatus",
            "leadstatusupdationdate"      => "LeadStatusUpdationDate",
            "eagerness"                   => "Eagerness",
            "lastcallcomment"             => "LastCallComment",
            "followupdate"                => "FollowUpDate",
            "lastcalldate"                => "LastCallDate",
            "scheduletr"                  => "ScheduleTR",
            "numberofattempts"            => "NumberOfAttempts",
            _                             => null, // unknown column — ignored, not an error
        };
    }

    private static void SetField(LeadRecordDto dto, string key, IXLCell cell)
    {
        string? Str() => cell.IsEmpty() ? null : cell.GetString().Trim();
        DateTime? Date()
        {
            if (cell.IsEmpty()) return null;
            if (cell.DataType == XLDataType.DateTime) return cell.GetDateTime();
            var s = cell.GetString().Trim();
            if (string.IsNullOrEmpty(s)) return null;
            if (DateTime.TryParse(s, out var dt)) return dt;
            if (double.TryParse(s, out var serial)) return DateTime.FromOADate(serial);
            return null;
        }
        long Long()
        {
            if (cell.IsEmpty()) return 0;
            if (cell.TryGetValue(out double d)) return (long)d;
            var s = cell.GetString().Trim();
            return long.TryParse(s, out var v) ? v : 0;
        }
        int? Int()
        {
            if (cell.IsEmpty()) return null;
            if (cell.TryGetValue(out double d)) return (int)d;
            var s = cell.GetString().Trim();
            return int.TryParse(s, out var v) ? v : (int?)null;
        }

        switch (key)
        {
            case "ApplicationId":             dto.ApplicationId = Str(); break;
            case "UniqueLeadId":               dto.UniqueLeadId = Long(); break;
            case "ZH":                         dto.ZH = Str(); break;
            case "RSM":                        dto.RSM = Str(); break;
            case "TSM":                        dto.TSM = Str(); break;
            case "Commando":                   dto.Commando = Str(); break;
            case "DealerCode":                 dto.DealerCode = Str(); break;
            case "OrganizationName":           dto.OrganizationName = Str(); break;
            case "DealerPinCode":              dto.DealerPinCode = Str(); break;
            case "CustomerName":               dto.CustomerName = Str(); break;
            case "Mobile":                     dto.Mobile = Str(); break;
            case "Email":                      dto.Email = Str(); break;
            case "Source":                     dto.Source = Str(); break;
            case "SubSource":                  dto.SubSource = Str(); break;
            case "LeadOrigin":                 dto.LeadOrigin = Str(); break;
            case "Make":                       dto.Make = Str(); break;
            case "Model":                      dto.Model = Str(); break;
            case "Version":                    dto.Version = Str(); break;
            case "LeadDate":                   dto.LeadDate = Date(); break;
            case "City":                       dto.City = Str(); break;
            case "State":                      dto.State = Str(); break;
            case "CustomerPinCode":            dto.CustomerPinCode = Str(); break;
            case "User":                       dto.User = Str(); break;
            case "Stage":                      dto.Stage = Str(); break;
            case "SubStage":                   dto.SubStage = Str(); break;
            case "QualifiedBy":                dto.QualifiedBy = Str(); break;
            case "LostClosedReason":           dto.LostClosedReason = Str(); break;
            case "LostClosedSubReason":        dto.LostClosedSubReason = Str(); break;
            case "LostClosedBy":               dto.LostClosedBy = Str(); break;
            case "LeadStatus":                 dto.LeadStatus = Str(); break;
            case "LeadStatusUpdationDate":     dto.LeadStatusUpdationDate = Date(); break;
            case "Eagerness":                  dto.Eagerness = Str(); break;
            case "LastCallComment":            dto.LastCallComment = Str(); break;
            case "FollowUpDate":               dto.FollowUpDate = Date(); break;
            case "LastCallDate":               dto.LastCallDate = Date(); break;
            case "ScheduleTR":                 dto.ScheduleTR = Str(); break;
            case "NumberOfAttempts":           dto.NumberOfAttempts = Int(); break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Shared upsert core — used by BOTH the JSON bulk endpoint and the
    // Excel import endpoint, so they can never drift out of sync.
    // ═══════════════════════════════════════════════════════════════════
    private async Task<BulkLeadPushResponseDto> PerformBulkUpsertAsync(List<LeadRecordDto> incoming)
    {
        var result = new BulkLeadPushResponseDto { Received = incoming.Count };

        var incomingIds = incoming.Select(l => l.UniqueLeadId).Distinct().ToList();
        var existingMap = await _db.LmsLeadRecords
            .Where(r => incomingIds.Contains(r.UniqueLeadId))
            .ToDictionaryAsync(r => r.UniqueLeadId);

        foreach (var lead in incoming)
        {
            try
            {
                if (lead.UniqueLeadId <= 0)
                {
                    result.Rejected++;
                    result.Errors.Add(new LeadPushErrorDto { UniqueLeadId = lead.UniqueLeadId, Reason = "Missing/invalid Unique Lead Id." });
                    continue;
                }

                if (existingMap.TryGetValue(lead.UniqueLeadId, out var existing))
                {
                    Map(lead, existing);
                    existing.UpdatedAt = DateTime.UtcNow;
                    result.Updated++;
                }
                else
                {
                    var entity = new LmsLeadRecord { UniqueLeadId = lead.UniqueLeadId };
                    Map(lead, entity);
                    _db.LmsLeadRecords.Add(entity);
                    result.Inserted++;
                }
            }
            catch (Exception ex)
            {
                result.Rejected++;
                result.Errors.Add(new LeadPushErrorDto { UniqueLeadId = lead.UniqueLeadId, Reason = ex.Message });
                _log.LogError(ex, "Failed to upsert lead {LeadId}", lead.UniqueLeadId);
            }
        }

        await _db.SaveChangesAsync();
        _log.LogInformation("Lead bulk upsert: received={R} inserted={I} updated={U} rejected={X}",
            result.Received, result.Inserted, result.Updated, result.Rejected);

        return result;
    }

    // NOTE: SrNo intentionally not mapped — removed from LeadRecordDto per
    // your latest schema. The LmsLeadRecords.SrNo column (if still present
    // in the DB) is simply left null/untouched going forward.
    private static void Map(LeadRecordDto src, LmsLeadRecord dst)
    {
        dst.ApplicationId          = src.ApplicationId;
        dst.ZH                     = src.ZH;
        dst.RSM                    = src.RSM;
        dst.TSM                    = src.TSM;
        dst.Commando               = src.Commando;
        dst.DealerCode             = src.DealerCode;
        dst.OrganizationName       = src.OrganizationName;
        dst.DealerPinCode          = src.DealerPinCode;
        dst.CustomerName           = src.CustomerName;
        dst.Mobile                 = src.Mobile;
        dst.Email                  = src.Email;
        dst.Source                 = src.Source;
        dst.SubSource              = src.SubSource;
        dst.LeadOrigin             = src.LeadOrigin;
        dst.Make                   = src.Make;
        dst.Model                  = src.Model;
        dst.Version                = src.Version;
        dst.LeadDate               = src.LeadDate;
        dst.City                   = src.City;
        dst.State                  = src.State;
        dst.CustomerPinCode        = src.CustomerPinCode;
        dst.User                   = src.User;
        dst.Stage                  = src.Stage;
        dst.SubStage               = src.SubStage;
        dst.QualifiedBy            = src.QualifiedBy;
        dst.LostClosedReason       = src.LostClosedReason;
        dst.LostClosedSubReason    = src.LostClosedSubReason;
        dst.LostClosedBy           = src.LostClosedBy;
        dst.LeadStatus             = src.LeadStatus;
        dst.LeadStatusUpdationDate = src.LeadStatusUpdationDate;
        dst.Eagerness              = src.Eagerness;
        dst.LastCallComment        = src.LastCallComment;
        dst.FollowUpDate           = src.FollowUpDate;
        dst.LastCallDate           = src.LastCallDate;
        dst.ScheduleTR             = src.ScheduleTR;
        dst.NumberOfAttempts       = src.NumberOfAttempts;
    }

    // ═══════════════════════════════════════════════════════════════════
    // READ — list with filters + pagination
    // GET /api/lead-records?state=Rajasthan&source=Digital Marketing&page=1&pageSize=50
    // ═══════════════════════════════════════════════════════════════════
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? state, [FromQuery] string? source, [FromQuery] string? subSource,
        [FromQuery] string? dealerCode, [FromQuery] DateTime? fromDate, [FromQuery] DateTime? toDate,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var q = _db.LmsLeadRecords.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(state))      q = q.Where(r => r.State == state);
        if (!string.IsNullOrWhiteSpace(source))     q = q.Where(r => r.Source == source);
        if (!string.IsNullOrWhiteSpace(subSource))  q = q.Where(r => r.SubSource == subSource);
        if (!string.IsNullOrWhiteSpace(dealerCode)) q = q.Where(r => r.DealerCode == dealerCode);
        if (fromDate.HasValue) q = q.Where(r => r.LeadDate >= fromDate.Value);
        if (toDate.HasValue)   q = q.Where(r => r.LeadDate <= toDate.Value);

        var total = await q.CountAsync();
        var items = await q.OrderByDescending(r => r.LeadDate)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return Ok(new { total, page, pageSize, items });
    }

    // GET /api/lead-records/{uniqueLeadId}
    [HttpGet("{uniqueLeadId:long}")]
    public async Task<IActionResult> GetOne(long uniqueLeadId)
    {
        var rec = await _db.LmsLeadRecords.AsNoTracking()
            .FirstOrDefaultAsync(r => r.UniqueLeadId == uniqueLeadId);
        return rec == null ? NotFound() : Ok(rec);
    }

    // ═══════════════════════════════════════════════════════════════════
    // UPDATE — single record
    // PUT /api/lead-records/{uniqueLeadId}
    // ═══════════════════════════════════════════════════════════════════
    [HttpPut("{uniqueLeadId:long}")]
    public async Task<IActionResult> Update(long uniqueLeadId, [FromBody] LeadRecordDto dto)
    {
        var rec = await _db.LmsLeadRecords.FirstOrDefaultAsync(r => r.UniqueLeadId == uniqueLeadId);
        if (rec == null) return NotFound();
        Map(dto, rec);
        rec.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(rec);
    }

    // ═══════════════════════════════════════════════════════════════════
    // DELETE — single + bulk
    // ═══════════════════════════════════════════════════════════════════
    [HttpDelete("{uniqueLeadId:long}")]
    public async Task<IActionResult> Delete(long uniqueLeadId)
    {
        var rec = await _db.LmsLeadRecords.FirstOrDefaultAsync(r => r.UniqueLeadId == uniqueLeadId);
        if (rec == null) return NotFound();
        _db.LmsLeadRecords.Remove(rec);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // DELETE /api/lead-records/bulk   body: [1045823, 1045824, ...]
    [HttpDelete("bulk")]
    public async Task<IActionResult> BulkDelete([FromBody] List<long> uniqueLeadIds)
    {
        if (uniqueLeadIds == null || uniqueLeadIds.Count == 0)
            return BadRequest(new { error = "No IDs supplied." });

        var toDelete = await _db.LmsLeadRecords
            .Where(r => uniqueLeadIds.Contains(r.UniqueLeadId)).ToListAsync();
        _db.LmsLeadRecords.RemoveRange(toDelete);
        await _db.SaveChangesAsync();
        return Ok(new { deleted = toDelete.Count });
    }
}
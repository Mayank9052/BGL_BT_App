using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BGL_BT_App.Backend.Controllers;

[ApiController]
[Route("api/media")]
[Authorize]
public class MediaController : ControllerBase
{
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<MediaController> _logger;

    public MediaController(IWebHostEnvironment env, ILogger<MediaController> logger)
    {
        _env    = env;
        _logger = logger;
    }

    [HttpPost("upload")]
    [DisableRequestSizeLimit]                    // overrides Kestrel per-endpoint
    [RequestFormLimits(MultipartBodyLengthLimit = 1_073_741_824L)]  // 1 GB
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "No file provided." });

        if (file.Length > 1_073_741_824L)
            return BadRequest(new { message = "File exceeds the 1 GB limit." });

        var allowed = new[]
        {
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm",
            "video/avi", "video/mpeg",
            "application/pdf",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };

        if (!allowed.Contains(file.ContentType.ToLower()))
            return BadRequest(new { message = $"File type '{file.ContentType}' is not allowed." });

        var uploadsDir = Path.Combine(_env.WebRootPath, "uploads", "activities");
        Directory.CreateDirectory(uploadsDir);

        var ext      = Path.GetExtension(file.FileName);
        var fileName = $"{Guid.NewGuid()}{ext}";
        var filePath = Path.Combine(uploadsDir, fileName);

        await using var stream = System.IO.File.Create(filePath);
        await file.CopyToAsync(stream);

        _logger.LogInformation(
            "Uploaded {FileName} ({Size:N0} bytes) → {Path}",
            file.FileName, file.Length, filePath);

        return Ok(new
        {
            url      = $"/uploads/activities/{fileName}",
            fileName = file.FileName,
            fileType = file.ContentType,
            size     = file.Length,
        });
    }
}
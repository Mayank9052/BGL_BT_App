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

    // POST /api/media/upload
    [HttpPost("upload")]
    [RequestSizeLimit(1_073_741_824)]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "No file provided." });

        // Allowed types
        var allowed = new[]
        {
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "application/pdf",
            "video/mp4", "video/quicktime", "video/x-msvideo"
        };

        if (!allowed.Contains(file.ContentType.ToLower()))
            return BadRequest(new { message = $"File type '{file.ContentType}' not allowed." });

        // Save to wwwroot/uploads/activities/
        var uploadsDir = Path.Combine(_env.WebRootPath, "uploads", "activities");
        Directory.CreateDirectory(uploadsDir);

        var ext      = Path.GetExtension(file.FileName);
        var fileName = $"{Guid.NewGuid()}{ext}";
        var filePath = Path.Combine(uploadsDir, fileName);

        await using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        var url = $"/uploads/activities/{fileName}";

        _logger.LogInformation("File uploaded: {FileName} ({Size} bytes)", fileName, file.Length);

        return Ok(new
        {
            url,
            fileName = file.FileName,
            fileType = file.ContentType,
        });
    }
}

namespace BGL_BT_App.Backend.DTOs;

public record MediaFileDto(
    string FileUrl,
    string FileName,
    string FileType,
    string? DailyData = null
);
namespace BGL_BT_App.Backend.DTOs;

public record UpdateActivityActualsDto(
    Guid    ActivityId,
    string? ActualStartDate,
    string? ActualEndDate,
    string? MediaFileUrl,
    string? MediaFileName,
    string? MediaFileType,
    List<MediaFileDto>? MediaFiles
);
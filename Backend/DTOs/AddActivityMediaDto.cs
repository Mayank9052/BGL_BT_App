namespace BGL_BT_App.Backend.DTOs;

public record AddActivityMediaDto(
    string FileUrl,
    string FileName,
    string FileType,
    DateTimeOffset? CapturedAt = null,
    double? Latitude = null,
    double? Longitude = null,
    double? LocationAccuracyMeters = null
);
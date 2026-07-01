namespace BGL_BT_App.Backend.DTOs;

public record ActivityMediaDto(
    Guid   Id,
    string FileUrl,
    string FileName,
    string FileType
);
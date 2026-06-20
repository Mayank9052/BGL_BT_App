namespace BGL_BT_App.Backend.DTOs;

public record DealerWithRsmDto(
    string CustomerCode,
    string CustomerName,
    string? City,
    string? State,
    string? Mobile,
    string? ContactPerson,
    string? TsmCode,
    string? TsmName,
    string? RsmCode,
    string? RsmName
);
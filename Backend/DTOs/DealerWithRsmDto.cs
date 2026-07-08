namespace BGL_BT_App.Backend.DTOs;

public record DealerWithRsmDto(
    string  CustomerCode,
    string  CustomerName,
    string? City,
    string? State,
    string? Mobile,
    string? ContactPerson,
    string? RsmCode,
    string? RsmName,
    string? TsmCode,
    string? TsmName
);
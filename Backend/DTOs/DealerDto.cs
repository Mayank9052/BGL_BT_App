namespace BGL_BT_App.Backend.DTOs;

public record DealerDto(
    string CustomerCode,
    string CustomerName,
    string? City,
    string? State,
    string? Mobile,
    string? ContactPerson
);
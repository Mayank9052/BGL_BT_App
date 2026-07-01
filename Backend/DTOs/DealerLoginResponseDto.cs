namespace BGL_BT_App.Backend.DTOs;

public record DealerLoginResponseDto(
    string Token,
    int UserId,
    string Email,
    string DisplayName,
    string Role,
    string? DealerCode,
    string? DealerName
);
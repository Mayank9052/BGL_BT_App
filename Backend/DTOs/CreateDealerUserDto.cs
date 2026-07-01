namespace BGL_BT_App.Backend.DTOs;

public record CreateDealerUserDto(
    string Email,
    string Password,
    string DisplayName,
    string DealerCode,
    string DealerName,
    string? PhoneNumber
);
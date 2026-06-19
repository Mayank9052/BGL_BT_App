namespace BGL_BT_App.Backend.DTOs;

public record UserResponseDto(
    int Id,
    string Email,
    string DisplayName,
    string? FirstName,
    string? LastName,
    string? JobTitle,
    string? Department,
    string? PhoneNumber,
    string Role,
    bool IsActive,
    DateTime? LastLoginAt);
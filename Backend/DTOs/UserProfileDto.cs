namespace BGL_BT_App.Backend.DTOs;

public record UserProfileDto(
    int Id,
    string AzureObjectId,
    string Email,
    string DisplayName,
    string? FirstName,
    string? LastName,
    string? JobTitle,
    string? Department,
    string Role,
    bool IsActive,
    DateTime? LastLoginAt
);
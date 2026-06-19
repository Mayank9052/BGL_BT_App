namespace BGL_BT_App.Backend.DTOs;

public record UpdateUserDto(
    string? FirstName,
    string? LastName,
    string? Department,
    string? JobTitle,
    string? PhoneNumber,
    string? Role,
    bool? IsActive);
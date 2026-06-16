namespace BGL_BT_App.Backend.DTOs;
public record LoginSyncRequest(
    string AzureObjectId,
    string Email,
    string DisplayName,
    string? FirstName,
    string? LastName,
    string? JobTitle,
    string? Department
);
using BGL_BT_App.Backend.DTOs;

namespace BGL_BT_App.Backend.Services;

public interface IUserService
{
    Task<UserProfileDto> UpsertFromAzureAsync(
        LoginSyncRequest request,
        string? ipAddress,
        string? userAgent
    );
    Task<UserProfileDto?> GetByAzureIdAsync(string azureObjectId);
    Task<List<UserProfileDto>> GetAllUsersAsync();
    Task<UserResponseDto?> GetByEmailAsync(string email);
    Task<UserResponseDto?> GetUserByIdAsync(int id);
    Task<UserResponseDto?> UpdateUserAsync(int id, UpdateUserDto dto, string actingUserEmail);
}
using BGL_BT_App.Backend.DTOs;
namespace BGL_BT_App.Backend.Services;

public interface IUserService
{
    Task<UserProfileDto> UpsertFromAzureAsync(LoginSyncRequest request);
    Task<UserProfileDto?> GetByAzureIdAsync(string azureObjectId);
    Task<List<UserProfileDto>> GetAllUsersAsync();
}
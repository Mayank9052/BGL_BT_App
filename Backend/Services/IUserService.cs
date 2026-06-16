using BGL_BT_App.Backend.DTOs;

public interface IUserService
{
    Task<UserProfileDto> UpsertFromAzureAsync(LoginSyncRequest request);
    Task<UserProfileDto?> GetByAzureIdAsync(string azureObjectId);
    Task<List<UserProfileDto>> GetAllUsersAsync();
}
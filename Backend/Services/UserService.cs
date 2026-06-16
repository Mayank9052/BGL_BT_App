using BGL_BT_App.Backend.Models;
using BGL_BT_App.Backend.Data;
using Microsoft.EntityFrameworkCore;
using BGL_BT_App.Backend.DTOs;

public class UserService : IUserService
{
    private readonly AppDbContext _db;

    public UserService(AppDbContext db) => _db = db;

    public async Task<UserProfileDto> UpsertFromAzureAsync(LoginSyncRequest req)
    {
        var user = await _db.Users
            .FirstOrDefaultAsync(u => u.AzureObjectId == req.AzureObjectId);

        if (user is null)
        {
            user = new User
            {
                AzureObjectId = req.AzureObjectId,
                Email         = req.Email,
                DisplayName   = req.DisplayName,
                FirstName     = req.FirstName,
                LastName      = req.LastName,
                JobTitle      = req.JobTitle,
                Department    = req.Department,
                LastLoginAt   = DateTime.UtcNow
            };
            _db.Users.Add(user);
        }
        else
        {
            user.Email       = req.Email;
            user.DisplayName = req.DisplayName;
            user.FirstName   = req.FirstName;
            user.LastName    = req.LastName;
            user.JobTitle    = req.JobTitle;
            user.Department  = req.Department;
            user.LastLoginAt = DateTime.UtcNow;
            user.UpdatedAt   = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return ToDto(user);
    }

    public async Task<UserProfileDto?> GetByAzureIdAsync(string azureObjectId)
    {
        var user = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.AzureObjectId == azureObjectId);
        return user is null ? null : ToDto(user);
    }

    public async Task<List<UserProfileDto>> GetAllUsersAsync()
    {
        return await _db.Users
            .AsNoTracking()
            .OrderBy(u => u.DisplayName)
            .Select(u => ToDto(u))
            .ToListAsync();
    }

    private static UserProfileDto ToDto(User u) => new(
        u.Id, u.AzureObjectId, u.Email, u.DisplayName,
        u.FirstName, u.LastName, u.JobTitle, u.Department,
        u.Role, u.IsActive, u.LastLoginAt
    );
}
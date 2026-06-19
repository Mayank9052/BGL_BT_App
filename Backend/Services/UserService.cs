using BGL_BT_App.Backend.Data;
using BGL_BT_App.Backend.DTOs;
using BGL_BT_App.Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace BGL_BT_App.Backend.Services;

public class UserService : IUserService
{
    private readonly AppDbContext _db;

    public UserService(AppDbContext db) => _db = db;

    public async Task<UserProfileDto> UpsertFromAzureAsync(
            LoginSyncRequest req,
            string? ipAddress,
            string? userAgent
        )
    {
        var user = await _db.Users
            .FirstOrDefaultAsync(u => u.AzureObjectId == req.AzureObjectId);

        if (user is null)
        {
            // The very first account to ever sign in becomes Admin so there's
            // always someone who can promote other users afterward.
            var isFirstUser = !await _db.Users.AnyAsync();

            user = new User
            {
                AzureObjectId = req.AzureObjectId,
                Email         = req.Email,
                DisplayName   = req.DisplayName,
                FirstName     = req.FirstName,
                LastName      = req.LastName,
                JobTitle      = req.JobTitle,
                Department    = req.Department,
                Role          = isFirstUser ? "Admin" : "User",
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
        var users = await _db.Users
            .AsNoTracking()
            .OrderBy(u => u.DisplayName)
            .ToListAsync();

        return users.Select(ToDto).ToList();
    }

    private static UserProfileDto ToDto(User u) => new(
        u.Id, u.AzureObjectId, u.Email, u.DisplayName,
        u.FirstName, u.LastName, u.JobTitle, u.Department,
        u.Role, u.IsActive, u.LastLoginAt
    );

    public async Task<UserResponseDto?> GetByEmailAsync(string email)
    {
        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Email.ToLower() == email.ToLower());
        return user is null ? null : ToResponseDto(user);
    }

    public async Task<UserResponseDto?> GetUserByIdAsync(int id)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
        return user is null ? null : ToResponseDto(user);
    }

    public async Task<UserResponseDto?> UpdateUserAsync(int id, UpdateUserDto dto, string actingUserEmail)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return null;

        if (dto.FirstName is not null) user.FirstName = dto.FirstName;
        if (dto.LastName is not null) user.LastName = dto.LastName;
        if (dto.Department is not null) user.Department = dto.Department;
        if (dto.JobTitle is not null) user.JobTitle = dto.JobTitle;
        if (dto.PhoneNumber is not null) user.PhoneNumber = dto.PhoneNumber;

        if (dto.Role is not null)
        {
            var allowedRoles = new[] { "Admin", "Manager", "User" };
            if (!allowedRoles.Contains(dto.Role))
                throw new ArgumentException($"'{dto.Role}' is not a valid role.");

            if (user.Email.Equals(actingUserEmail, StringComparison.OrdinalIgnoreCase) && dto.Role != "Admin")
                throw new InvalidOperationException("You cannot remove your own Admin role.");

            user.Role = dto.Role;
        }

        if (dto.IsActive is not null)
        {
            if (user.Email.Equals(actingUserEmail, StringComparison.OrdinalIgnoreCase) && dto.IsActive == false)
                throw new InvalidOperationException("You cannot deactivate your own account.");

            user.IsActive = dto.IsActive.Value;
        }

        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ToResponseDto(user);
    }

    private static UserResponseDto ToResponseDto(User u) => new(
        u.Id, u.Email, u.DisplayName, u.FirstName, u.LastName,
        u.JobTitle, u.Department, u.PhoneNumber, u.Role, u.IsActive, u.LastLoginAt);
}
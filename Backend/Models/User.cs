namespace BGL_BT_App.Backend.Models;

public class User
{
    public int Id { get; set; }
    public string? AzureObjectId { get; set; }
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? JobTitle { get; set; }
    public string? Department { get; set; }
    public string? PhoneNumber { get; set; }
    public string? ProfilePicUrl { get; set; }
    public string Role { get; set; } = "User";
    public bool IsActive { get; set; } = true;
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public string? PasswordHash   { get; set; }
    public string  AuthType       { get; set; } = "AzureAD";
    public string? DealerCode     { get; set; }
    public string? DealerName     { get; set; }
    public string? CreatedByEmail { get; set; }

    // ── Password reset ────────────────────────────────────
    public string?    ResetToken       { get; set; }
    public DateTime?  ResetTokenExpiry { get; set; }

    public ICollection<UserSession> Sessions { get; set; } = new List<UserSession>();
}
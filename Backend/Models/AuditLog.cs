// Backend/Models/AuditLog.cs
namespace BGL_BT_App.Backend.Models;

public class AuditLog
{
    public int Id { get; set; }

    // Who did it
    public string ActorEmail   { get; set; } = "";
    public string ActorName    { get; set; } = "";
    public string ActorRole    { get; set; } = ""; // Admin, Dealer, RSM, TSM, ZSM, Commando, User
    public string AuthType     { get; set; } = ""; // AzureAD | Local

    // What happened — keep this list closed/known so filtering stays useful.
    // Login, LoginFailed, Logout,
    // PasswordForgotRequested, PasswordReset, PasswordChanged, PasswordAdminReset,
    // AccountCreated, AccountActivated, AccountDeactivated,
    // ProposalSubmitted, ProposalApproved, ProposalRejected, ProposalSentBack,
    // DealerNotified, BulkImport
    public string Action       { get; set; } = "";

    // Optional context — never put secret values here (no passwords, no tokens)
    public string? TargetEmail { get; set; }  // e.g. whose password was reset, by an admin
    public string? Details     { get; set; }  // short human-readable note, e.g. "Bulk import: 12 created"
    public string? IpAddress   { get; set; }
    public bool    Success     { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
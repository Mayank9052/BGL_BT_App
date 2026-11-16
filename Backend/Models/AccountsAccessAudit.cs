using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;
public class AccountsAccessAudit
{
    public long Id { get; set; }
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
    [MaxLength(200)] public string ActorEmail  { get; set; } = "";
    [MaxLength(200)] public string ActorName   { get; set; } = "";
    [MaxLength(200)] public string TargetEmail { get; set; } = "";
    [MaxLength(60)]  public string PageKey     { get; set; } = "";
    [MaxLength(120)] public string PageName    { get; set; } = "";
    [MaxLength(20)]  public string PermissionType { get; set; } = "";   // View | Download | Full | —
    [MaxLength(20)]  public string Action      { get; set; } = "";      // Granted | Revoked | UserAdded | Denied
    [MaxLength(20)]  public string Result      { get; set; } = "Success";
    [MaxLength(500)] public string? Note       { get; set; }
}
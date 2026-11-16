using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class AccountsPagePermission
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(200)] public string UserEmail { get; set; } = "";   // always lower-case
    [MaxLength(60)]  public string PageKey   { get; set; } = "";
    public bool CanView     { get; set; }
    public bool CanDownload { get; set; }
    public bool CanFull     { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    [MaxLength(200)] public string UpdatedBy { get; set; } = "";
}
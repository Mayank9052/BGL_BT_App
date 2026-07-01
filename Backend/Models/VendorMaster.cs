using System.ComponentModel.DataAnnotations;

namespace BGL_BT_App.Backend.Models;

public class VendorMaster
{
    public int Id { get; set; }
    [MaxLength(200)] public string VendorName { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
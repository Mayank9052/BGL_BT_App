using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace BGL_BT_App.Backend.Models;

// ── Maps to dealer master table in baplfinal ──────────────────────────────
// Adjust [Table] and [Column] names to match your actual baplfinal schema
[Table("CustomerMaster")]
public class ErpDealerMaster
{
    [Key]
    [Column("CustomerCode")]
    [MaxLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    [Column("CustomerName")]
    [MaxLength(200)]
    public string CustomerName { get; set; } = string.Empty;

    // Date the dealer was first activated / onboarded in DMS
    [Column("CreatedDate")]
    public DateTime? OnboardedDate { get; set; }

    [Column("State")]
    [MaxLength(100)]
    public string? State { get; set; }

    [Column("City")]
    [MaxLength(100)]
    public string? City { get; set; }
}
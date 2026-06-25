using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace BGL_BT_App.Backend.Models;

// ── Maps to dealer master table in baplfinal ──────────────────────────────
// Adjust [Table] and [Column] names to match your actual baplfinal schema
[Table("C_CustomerMaster")]
public class ErpDealerMaster
{
    [Key]
    [Column("CustomerCode")]
    [MaxLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    [Column("CustomerName")]
    [MaxLength(200)]
    public string CustomerName { get; set; } = string.Empty;

    // Dealer inauguration/onboarding date — used for new dealer check
    [Column("InaugurationDate")]
    public DateTime? OnboardedDate { get; set; }

    [Column("Mobile")]
    [MaxLength(20)]
    public string? Mobile { get; set; }

    [Column("ContactPerson")]
    [MaxLength(200)]
    public string? ContactPerson { get; set; }

    // Active = 'Y' means active dealer
    [Column("Active")]
    [MaxLength(1)]
    public string? Active { get; set; }
}
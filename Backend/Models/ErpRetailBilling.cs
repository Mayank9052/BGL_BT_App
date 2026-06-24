using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace BGL_BT_App.Backend.Models;

[Table("RetailBilling")]
public class ErpRetailBilling
{
    [Key]
    [Column("BillingId")]
    public int BillingId { get; set; }

    [Column("DealerCode")]
    [MaxLength(50)]
    public string DealerCode { get; set; } = string.Empty;

    [Column("BillingDate")]
    public DateTime BillingDate { get; set; }

    [Column("ChassisNo")]
    [MaxLength(50)]
    public string? ChassisNo { get; set; }

    [Column("CustomerName")]
    [MaxLength(200)]
    public string? CustomerName { get; set; }

    [Column("ContactNo")]
    [MaxLength(20)]
    public string? ContactNo { get; set; }

    [Column("Model")]
    [MaxLength(100)]
    public string? Model { get; set; }
}
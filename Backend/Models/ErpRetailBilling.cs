using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace BGL_BT_App.Backend.Models;

[Table("DMS_SaleBill")]
public class ErpRetailBilling
{
    [Key]
    [Column("Id")]
    public int BillingId { get; set; }

    [Column("dealer_code")]
    [MaxLength(50)]
    public string DealerCode { get; set; } = string.Empty;

    // salebill_date is nvarchar "dd-MM-yyyy" — converted via raw SQL TRY_CONVERT
    [Column("salebill_date")]
    [MaxLength(50)]
    public string? SaleBillDate { get; set; }

    // InvoiceDate is always NULL in this dataset — do not use
    [Column("InvoiceDate")]
    public DateTime? InvoiceDate { get; set; }

    [Column("chassis_no")]
    [MaxLength(100)]
    public string? ChassisNo { get; set; }

    [Column("Item_Modl")]
    [MaxLength(200)]
    public string? Model { get; set; }

    // IsDelete = 0 means active record
    [Column("IsDelete")]
    public int IsDelete { get; set; }
}

// Helper class for raw SQL monthly count result
public class MonthlyCount
{
    public int Year        { get; set; }
    public int Month       { get; set; }
    public int RetailCount { get; set; }
}
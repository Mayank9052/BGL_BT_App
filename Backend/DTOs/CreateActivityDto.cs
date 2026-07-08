namespace BGL_BT_App.Backend.DTOs;

public class CreateActivityDto
{
    public string  ActivityType     { get; set; } = string.Empty;
    public string? Category         { get; set; }
    public string? Subcategory      { get; set; }   // ← FIXED (was missing)
    public int     Qty              { get; set; } = 1; // ← FIXED (was missing)
    public decimal? SalesPercent    { get; set; }   // ← NEW

    public int     LeadTarget       { get; set; }
    public int     RetailTarget     { get; set; }
    public string? StartDate        { get; set; }
    public string? EndDate          { get; set; }
    public decimal Budget           { get; set; }
    public decimal AdditionalBudget { get; set; }
    public decimal BGaussShare      { get; set; } = 100m;
    public int?    VendorId         { get; set; }
    public string? Remarks          { get; set; }
    public List<MediaFileDto> MediaFiles { get; set; } = new();
}

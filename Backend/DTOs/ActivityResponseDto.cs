// Backend/DTOs/ActivityResponseDto.cs
// FIX: Added [property: JsonPropertyName] on ALL properties to guarantee
// the correct camelCase JSON keys are sent to the frontend.
// Root cause: positional records serialize "BGaussShare" as "bGaussShare"
// but the frontend expects "bgaussShare" — mismatch → undefined → 0 → shows 100%.

using System.Text.Json.Serialization;

namespace BGL_BT_App.Backend.DTOs;

public record ActivityResponseDto(
    [property: JsonPropertyName("id")]               Guid      Id,
    [property: JsonPropertyName("activityType")]     string    ActivityType,
    [property: JsonPropertyName("category")]         string?   Category,
    [property: JsonPropertyName("subcategory")]      string?   Subcategory,
    [property: JsonPropertyName("qty")]              int       Qty,
    [property: JsonPropertyName("salesPercent")]     decimal?  SalesPercent,     // ← NEW
    [property: JsonPropertyName("leadTarget")]       int       LeadTarget,
    [property: JsonPropertyName("retailTarget")]     int       RetailTarget,
    [property: JsonPropertyName("startDate")]        DateOnly? StartDate,
    [property: JsonPropertyName("endDate")]          DateOnly? EndDate,
    [property: JsonPropertyName("budget")]           decimal   Budget,
    [property: JsonPropertyName("additionalBudget")] decimal   AdditionalBudget,
    [property: JsonPropertyName("bgaussShare")]      decimal   BGaussShare,
    [property: JsonPropertyName("vendorId")]         int?      VendorId,
    [property: JsonPropertyName("remarks")]          string?   Remarks,
    [property: JsonPropertyName("actualStartDate")]  DateOnly? ActualStartDate,
    [property: JsonPropertyName("actualEndDate")]    DateOnly? ActualEndDate,
    [property: JsonPropertyName("mediaFileUrl")]     string?   MediaFileUrl,
    [property: JsonPropertyName("mediaFileName")]    string?   MediaFileName,
    [property: JsonPropertyName("mediaFileType")]    string?   MediaFileType,
    [property: JsonPropertyName("mediaFiles")]       List<ActivityMediaDto> MediaFiles
);
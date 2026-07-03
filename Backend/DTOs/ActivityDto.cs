// Backend/DTOs/ActivityDto.cs
// ONLY CHANGE: added [property: JsonPropertyName("bgaussShare")] on BGaussShare
// Root cause: positional records bind JSON by constructor param name.
// "BGaussShare" param → expected JSON key "bGaussShare" (not "bgaussShare").
// Frontend sends "bgaussShare" → no match → stays 0 → controller saves 100 as fallback.

using System.Text.Json.Serialization;

namespace BGL_BT_App.Backend.DTOs;

public record ActivityDto(
    [property: JsonPropertyName("activityType")]     string              ActivityType,
    [property: JsonPropertyName("category")]         string?             Category,
    [property: JsonPropertyName("leadTarget")]       int                 LeadTarget,
    [property: JsonPropertyName("retailTarget")]     int                 RetailTarget,
    [property: JsonPropertyName("startDate")]        string?             StartDate,
    [property: JsonPropertyName("endDate")]          string?             EndDate,
    [property: JsonPropertyName("budget")]           decimal             Budget,
    [property: JsonPropertyName("additionalBudget")] decimal             AdditionalBudget,
    [property: JsonPropertyName("bgaussShare")]      decimal             BGaussShare,      // ← THE FIX
    [property: JsonPropertyName("vendorId")]         int?                VendorId,
    [property: JsonPropertyName("remarks")]          string?             Remarks,
    [property: JsonPropertyName("mediaFiles")]       List<MediaFileDto>? MediaFiles
);
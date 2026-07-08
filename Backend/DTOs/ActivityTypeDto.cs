using System.Text.Json.Serialization;
namespace BGL_BT_App.Backend.DTOs;

public record ActivityTypeDto(
    [property: JsonPropertyName("id")]           int     Id,
    [property: JsonPropertyName("activityName")] string  ActivityName,
    [property: JsonPropertyName("activityType")] string  ActivityType,
    [property: JsonPropertyName("isActive")]     bool    IsActive,
    [property: JsonPropertyName("subcategory")]  string? Subcategory = null,
    [property: JsonPropertyName("maxQty")]       int     MaxQty = 5
);
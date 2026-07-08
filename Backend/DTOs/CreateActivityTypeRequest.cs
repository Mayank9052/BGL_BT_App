namespace BGL_BT_App.Backend.DTOs;

public record CreateActivityTypeRequest(
    string  ActivityName,
    string? ActivityType,
    string? Subcategory = null,
    int     MaxQty      = 5
);
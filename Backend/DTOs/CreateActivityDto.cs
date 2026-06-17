namespace BGL_BT_App.Backend.DTOs;

public record CreateActivityDto(
    string ActivityType,
    int Target,
    string? StartDate,
    string? EndDate,
    decimal Budget,
    decimal Incentive
);
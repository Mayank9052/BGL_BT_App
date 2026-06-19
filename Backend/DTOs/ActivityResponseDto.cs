namespace BGL_BT_App.Backend.DTOs;

public record ActivityResponseDto(
    Guid     Id,
    string   ActivityType,
    int      Target,
    DateOnly? StartDate,
    DateOnly? EndDate,
    decimal  Budget,
    decimal  Incentive,
    string?  Remarks);

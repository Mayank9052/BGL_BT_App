namespace BGL_BT_App.Backend.DTOs;

public record ActivityResponseDto(
    Guid     Id,
    string   ActivityType,
    string?  Category,
    int      LeadTarget,
    int      RetailTarget,
    DateOnly? StartDate,
    DateOnly? EndDate,
    decimal  Budget,
    decimal  AdditionalBudget,
    decimal  BGaussShare,
    int?     VendorId,
    string?  Remarks,
    DateOnly? ActualStartDate,
    DateOnly? ActualEndDate,
    string?  MediaFileUrl,
    string?  MediaFileName,
    string?  MediaFileType,
    List<ActivityMediaDto> MediaFiles
);
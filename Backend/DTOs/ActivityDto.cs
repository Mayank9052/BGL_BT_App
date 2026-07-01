namespace BGL_BT_App.Backend.DTOs;

public record ActivityDto(
    string   ActivityType,
    string?  Category,
    int      LeadTarget,
    int      RetailTarget,
    string?  StartDate,
    string?  EndDate,
    decimal  Budget,
    decimal  AdditionalBudget,   // was Incentive
    decimal  BGaussShare,        // default 100
    int?     VendorId,
    string?  Remarks
);
namespace BGL_BT_App.Backend.DTOs;

public record UpdateProposalDto(
    string        DealerName,
    int?          VendorId,
    string?       VendorName,
    string        Location,
    string        State,
    string        Type,
    string        RsmName,
    string        CommandoName,
    string        Month,
    string        Eligibility,
    string        Remarks,
    decimal  BGaussShare,  
    List<ActivityDto> Activities,
    decimal       TotalBudget,
    int           TotalLeadTarget,
    int           TotalRetailTarget,
    decimal       Cac,
    decimal       Cpl
);
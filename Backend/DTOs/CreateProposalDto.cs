namespace BGL_BT_App.Backend.DTOs;
public record CreateProposalDto(
    string        State,
    string        Location,
    string        Type,
    string        DealerName,
    int?          VendorId,
    string?       VendorName,
    string        RsmName,
    string        CommandoName,
    string        Month,
    string        Eligibility,
    string        Remarks,
    string?       SubmittedBy,
    string        DocNumber,
    List<ActivityDto> Activities,
    decimal       TotalBudget,
    int           TotalLeadTarget,
    int           TotalRetailTarget,
    decimal       Cac,
    decimal       Cpl
);
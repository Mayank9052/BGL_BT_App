namespace BGL_BT_App.Backend.DTOs;

public record UpdateProposalDto(
    string   DealerName,
    string   Location,
    string   State,
    string   Type,
    string   RsmName,
    string   CommandoName,
    string   Month,
    string   Eligibility,
    string?  Remarks,
    List<CreateActivityDto> Activities,
    decimal  TotalBudget,
    decimal  TotalTarget,
    decimal  Cac
);
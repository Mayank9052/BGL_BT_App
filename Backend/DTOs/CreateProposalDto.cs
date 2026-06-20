namespace BGL_BT_App.Backend.DTOs;
public record CreateProposalDto(
    string          State,
    string          Location,
    string          Type,
    string          DealerName,
    string          RsmName,
    string          CommandoName,
    string          Month,
    string          Eligibility,
    string?         Remarks,
    string?         SubmittedBy,
    decimal         TotalBudget,
    int             TotalTarget,
    decimal         Cac,
    string?  DocNumber, 
    List<ActivityDto> Activities
);
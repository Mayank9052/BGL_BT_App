namespace BGL_BT_App.Backend.DTOs;

public record ProposalResponseDto(
    Guid Id,
    string State,
    string Location,
    string Type,
    string DealerName,
    string RsmName,
    string CommandoName,
    string Month,
    string Eligibility,
    string? Remarks,
    decimal TotalBudget,
    int TotalTarget,
    decimal Cac,
    string SubmittedBy,
    DateTimeOffset CreatedAt,
    List<ActivityResponseDto> Activities);

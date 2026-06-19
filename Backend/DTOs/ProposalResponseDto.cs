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
    string Status,
    string? ApproverNote,
    string? ApprovedBy,
    DateTimeOffset? DecidedAt,
    string? TokenNumber,
    List<ActivityResponseDto> Activities);
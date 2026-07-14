namespace BGL_BT_App.Backend.DTOs;
public record ProposalAiReviewDto(
    Guid    Id,
    Guid    ProposalId,
    string  Status,
    string  OverallVerdict,
    string? Summary,
    string  ModelUsed,
    int     ToolCallCount,
    DateTimeOffset RunAt,
    string? ErrorMessage,
    List<ProposalAiFlagDto> Flags
);

namespace BGL_BT_App.Backend.DTOs;

public record ProposalAiFlagDto(
    Guid    Id,
    string  Severity,
    string  Title,
    string  Detail,
    string? RelatedActivityType
);
namespace BGL_BT_App.Backend.DTOs;

public record DecideProposalDto(
    string  Status,        // "Approved" | "Rejected"
    string? ApproverNote,
    string? ApprovedBy);
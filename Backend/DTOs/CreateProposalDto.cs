namespace BGL_BT_App.Backend.Dtos;
public record CreateProposalDto(
    string State,
    string Location,
    string Type,
    string DealerName,
    string RsmName,
    string CommandoName,
    string Month,
    string Eligibility,
    string? Remarks,
    List<CreateActivityDto> Activities);

/* ── Outgoing (back to the client) ──────────────────────────── */



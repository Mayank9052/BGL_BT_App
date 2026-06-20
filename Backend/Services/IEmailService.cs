using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public interface IEmailService
{
    /// Sent the moment an RSM submits a proposal — goes to the fixed
    /// approver mailbox (Smtp:ApproverEmail), "from" the submitting user.
    Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal proposal);
    Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(Proposal proposal, string? note);

    /// Sent after an Admin/Approver approves or rejects — goes back to
    /// the RSM who submitted the proposal, includes the token number.
    Task<(bool Sent, string? Error)> SendDecisionMailAsync(Proposal proposal, ApprovalDecision decision);
}
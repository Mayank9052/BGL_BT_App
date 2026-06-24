using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public interface IEmailService
{
    Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal proposal, string graphToken);
    Task<(bool Sent, string? Error)> SendResubmissionMailAsync(Proposal p, string graphToken);
    Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(Proposal proposal, string? note, string graphToken);
    Task<(bool Sent, string? Error)> SendDecisionMailAsync(Proposal proposal, ApprovalDecision decision, string graphToken);
}
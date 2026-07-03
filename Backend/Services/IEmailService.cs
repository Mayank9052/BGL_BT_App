// Backend/Services/IEmailService.cs
using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public interface IEmailService
{
    Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal p, string graphToken);
    Task<(bool Sent, string? Error)> SendCheckerForwardMailAsync(Proposal p, string graphToken);
    Task<(bool Sent, string? Error)> SendDecisionMailAsync(Proposal p, ApprovalDecision decision, string graphToken);
    Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(Proposal p, string? note, string graphToken);
    Task<(bool Sent, string? Error)> SendResubmissionMailAsync(Proposal p, string graphToken);
    Task<(bool Sent, string? Error)> SendDealerNotificationMailAsync(Proposal p, string dealerEmail, string graphToken);
    // NEW — dealer sends budget add-on request back to Mayank
    Task<(bool Sent, string? Error)> SendDealerSendBackMailAsync(Proposal p, string dealerEmail, string requestNote, string graphToken);
}
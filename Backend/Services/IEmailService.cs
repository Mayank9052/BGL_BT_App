// Backend/Services/IEmailService.cs
using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public interface IEmailService
{
    Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal p, string graphToken);
    Task<(bool Sent, string? Error)> SendCheckerForwardMailAsync(Proposal p, string graphToken);
    Task<(bool Sent, string? Error)> SendDecisionMailAsync(
        Proposal p, ApprovalDecision decision, string graphToken, IEnumerable<string>? teamCc = null);
    Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(Proposal p, string? note, string graphToken);
    Task<(bool Sent, string? Error)> SendResubmissionMailAsync(Proposal p, string graphToken);
    Task<(bool Sent, string? Error)> SendDealerNotificationMailAsync(
        Proposal p, string dealerEmail, string? rsmEmail, string? tsmEmail, string? commandoEmail, string graphToken);
    Task<(bool Sent, string? Error)> SendDealerSendBackMailAsync(Proposal p, string dealerEmail, string requestNote, string graphToken);
    Task<(bool Sent, string? Error)> SendActivitySheetSubmittedMailAsync(
        Proposal p, string? dealerEmail, string? rsmEmail, string? commandoEmail, string graphToken);
    Task<(bool Sent, string? Error)> SendTeamNotificationMailAsync(
        Proposal p, string? rsmEmail, string? tsmEmail, string? commandoEmail, string graphToken);

    // ── NEW: used for public/unauthenticated flows (dealer + staff forgot-password)
    // where there is NO signed-in user and therefore NO interactive Graph token
    // available. GraphEmailService implements this via an app-only token instead
    // of the X-Graph-Token header the other methods rely on.
    Task<(bool Sent, string? Error)> SendPasswordResetEmailAsync(
        string toEmail, string displayName, string resetLink);
}
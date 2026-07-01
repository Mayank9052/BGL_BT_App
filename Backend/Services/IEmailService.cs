// Backend/Services/IEmailService.cs
using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public interface IEmailService
{
    // Step 1: RSM submits → Mayank only
    Task<(bool Sent, string? Error)> SendSubmissionMailAsync(Proposal proposal, string graphToken);

    // Step 2: Mayank forwards to Vijay (final approver) after checking
    // RSM email is passed so Vijay's mail can reference it
    Task<(bool Sent, string? Error)> SendCheckerForwardMailAsync(Proposal proposal, string graphToken);

    // Step 3a: Vijay approves/rejects → Mayank + CC RSM
    Task<(bool Sent, string? Error)> SendDecisionMailAsync(Proposal proposal, ApprovalDecision decision, string graphToken);

    // Step 3b: Vijay sends back for revision → Mayank + CC RSM
    Task<(bool Sent, string? Error)> SendRevisionRequestMailAsync(Proposal proposal, string? note, string graphToken);

    // Step 3c: RSM resubmits after revision → Mayank
    Task<(bool Sent, string? Error)> SendResubmissionMailAsync(Proposal proposal, string graphToken);

    // Step 4: After Vijay approves, Mayank sends activity summary to Dealer
    Task<(bool Sent, string? Error)> SendDealerNotificationMailAsync(Proposal proposal, string dealerEmail, string graphToken);
}
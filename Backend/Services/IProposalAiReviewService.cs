using BGL_BT_App.Backend.Models;

namespace BGL_BT_App.Backend.Services;

public interface IProposalAiReviewService
{
    /// <summary>
    /// Runs the autonomous review agent against a proposal, persists the
    /// result, broadcasts it over SignalR, and returns the saved review.
    /// </summary>
    Task<ProposalAiReview> ReviewAsync(Guid proposalId, CancellationToken ct = default);
}

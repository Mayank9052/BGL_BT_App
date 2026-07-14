// src/components/ProposalAiReviewPanel.tsx
import { useState, useEffect, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import {
  fetchAiReview, rerunAiReview, type ProposalAiReview,
} from "../services/proposalAiReviewService";
import "./ProposalAiReviewPanel.css";

interface Props {
  proposalId: string;
}

const SEVERITY_STYLE: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  Blocking: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", icon: "🚫" },
  Warning:  { bg: "#fefce8", border: "#fde68a", text: "#92400e", icon: "⚠" },
  Info:     { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", icon: "ℹ" },
};

export default function ProposalAiReviewPanel({ proposalId }: Props) {
  const { instance } = useMsal();
  const [review,    setReview]    = useState<ProposalAiReview | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchAiReview(proposalId, instance)
      .then(setReview)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load AI review."))
      .finally(() => setLoading(false));
  }, [proposalId, instance]);

  useEffect(() => { load(); }, [load]);

  // Poll while a review is actively running (e.g. one was just triggered on submit)
  useEffect(() => {
    if (review?.status !== "Running") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [review?.status, load]);

  const handleRerun = async () => {
    setRerunning(true);
    setError(null);
    try {
      const r = await rerunAiReview(proposalId, instance);
      setReview(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-run failed.");
    } finally {
      setRerunning(false);
    }
  };

  if (loading) {
    return (
      <div className="ai-review-panel ai-review-panel--loading">
        <div className="ai-review-spinner" /><span>Checking AI review…</span>
      </div>
    );
  }

  const verdict = review?.overallVerdict ?? null;
  const verdictStyle =
    verdict === "Blocking" ? SEVERITY_STYLE.Blocking :
    verdict === "Warning"  ? SEVERITY_STYLE.Warning  :
    { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", icon: "✓" };

  return (
    <div className="ai-review-panel">
      <div className="ai-review-header">
        <div>
          <h3 className="ai-review-title">🤖 AI Proposal Review</h3>
          {review && (
            <p className="ai-review-meta">
              {new Date(review.runAt).toLocaleString("en-IN")} · {review.modelUsed || "—"}
            </p>
          )}
        </div>
        <button className="ai-review-rerun-btn" onClick={handleRerun} disabled={rerunning}>
          {rerunning ? "Reviewing…" : "↻ Re-run"}
        </button>
      </div>

      {error && <div className="ai-review-error">⚠ {error}</div>}

      {!review && !error && (
        <p className="ai-review-empty">No AI review has run yet for this proposal.</p>
      )}

      {review && (
        <>
          <div
            className="ai-review-verdict"
            style={{ background: verdictStyle.bg, border: `1px solid ${verdictStyle.border}`, color: verdictStyle.text }}
          >
            <span className="ai-review-verdict-icon">{verdictStyle.icon}</span>
            <div>
              <strong>{verdict === "Clean" ? "No issues found" : `${verdict} issues found`}</strong>
              {review.summary && <p className="ai-review-summary">{review.summary}</p>}
            </div>
          </div>

          {review.flags.length > 0 && (
            <div className="ai-review-flags">
              {review.flags.map((f) => {
                const s = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.Info;
                return (
                  <div
                    key={f.id}
                    className="ai-review-flag"
                    style={{ background: s.bg, border: `1px solid ${s.border}` }}
                  >
                    <span className="ai-review-flag-icon">{s.icon}</span>
                    <div>
                      <strong style={{ color: s.text }}>{f.title}</strong>
                      {f.relatedActivityType && (
                        <span className="ai-review-flag-activity"> · {f.relatedActivityType}</span>
                      )}
                      <p className="ai-review-flag-detail">{f.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {review.status === "Failed" && review.errorMessage && (
            <div className="ai-review-error">⚠ Review failed: {review.errorMessage}</div>
          )}
        </>
      )}
    </div>
  );
}
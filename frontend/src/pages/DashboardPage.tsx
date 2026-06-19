import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import { fetchMyProposals, type ProposalResponse } from "../services/proposalService";
import "./DashboardPage.css";

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
};

const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");

const statusClass = (s: string) =>
  s === "Approved" ? "dash-status-badge dash-status-approved"
  : s === "Rejected" ? "dash-status-badge dash-status-rejected"
  : "dash-status-badge dash-status-pending";

export default function DashboardPage() {
  const { user, loading } = useAuthStore();
  const { instance } = useMsal();
  const navigate = useNavigate();

  const [proposals, setProposals] = useState<ProposalResponse[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);
  const [proposalsError, setProposalsError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    setProposalsLoading(true);
    fetchMyProposals(instance)
      .then(setProposals)
      .catch((e) => setProposalsError(e instanceof Error ? e.message : "Failed to load proposals."))
      .finally(() => setProposalsLoading(false));
  }, [loading, instance]);

  const recent = proposals.slice(0, 6);

  return (
    <div className="dash-root">
      {loading ? (
        <div className="dash-loading">
          <div className="spinner" />
          <p>Loading your profile...</p>
        </div>
      ) : (
        <>
          <div className="quick-actions">
            <button className="action-card" onClick={() => navigate("/rsm-form")}>
              <span className="action-icon">📋</span>
              <span className="action-title">RSM Proposal Form</span>
              <span className="action-desc">
                Submit a new marketing / sales activity proposal
              </span>
            </button>

            {user?.role === "Admin" && (
              <button className="action-card" onClick={() => navigate("/admin/users")}>
                <span className="action-icon">👥</span>
                <span className="action-title">Manage Users</span>
                <span className="action-desc">
                  Edit team member details, roles, and active status
                </span>
              </button>
            )}
          </div>

          {/* ── My Proposals ── */}
          <div className="dash-section-head">
            <h2 className="dash-section-title">My Proposals</h2>
            {proposals.length > 0 && (
              <button className="dash-view-all-btn" onClick={() => navigate("/approver")}>
                View all →
              </button>
            )}
          </div>

          {proposalsLoading ? (
            <div className="dash-proposals-loading">
              <div className="spinner spinner-sm" />
              <p>Loading your proposals…</p>
            </div>
          ) : proposalsError ? (
            <div className="dash-proposals-error">⚠ {proposalsError}</div>
          ) : recent.length === 0 ? (
            <div className="dash-proposals-empty">
              <span className="dash-empty-icon">📋</span>
              <p>You haven't submitted any proposals yet.</p>
              <button className="dash-empty-btn" onClick={() => navigate("/rsm-form")}>
                Submit your first proposal
              </button>
            </div>
          ) : (
            <div className="dash-proposals-list">
              {recent.map((p) => (
                <div key={p.id} className="dash-proposal-card">
                  <div className="dash-proposal-top">
                    <div className="dash-proposal-main">
                      <span className="dash-proposal-token">{p.tokenNumber ?? p.id.split("-").slice(-1)[0]}</span>
                      <h3 className="dash-proposal-dealer">{p.dealerName}</h3>
                      <p className="dash-proposal-meta">
                        {p.location}, {p.state} &middot; {p.month}
                      </p>
                    </div>
                    <span className={statusClass(p.status)}>{p.status}</span>
                  </div>

                  <div className="dash-proposal-bottom">
                    <span className="dash-proposal-budget">{inr(p.totalBudget)}</span>
                    <span className="dash-proposal-date">Submitted {fmtDate(p.createdAt)}</span>
                  </div>

                  {p.status !== "Pending" && (
                    <div className={`dash-proposal-decision ${p.status === "Approved" ? "dash-decision-approved" : "dash-decision-rejected"}`}>
                      <div className="dash-decision-row">
                        <strong>{p.status}</strong>
                        {p.decidedAt && (
                          <span className="dash-decision-meta">
                            {fmtDate(p.decidedAt)}{p.approvedBy ? ` · ${p.approvedBy}` : ""}
                          </span>
                        )}
                      </div>
                      {p.approverNote && (
                        <p className="dash-decision-note">"{p.approverNote}"</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
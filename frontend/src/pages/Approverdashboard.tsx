import { useState, useMemo, useEffect, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate } from "react-router-dom";
import {
  fetchProposals,
  decideProposal,
  type ProposalResponse,
} from "../services/proposalService";
import "./ApproverDashboard.css";

/* ── Helpers ─────────────────────────────────────────────── */
const inr = (v: number) =>
  "₹ " + Math.round(v).toLocaleString("en-IN");

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
};

const eligClass = (e: string) =>
  e === "Eligible" ? "ap-elig-yes"
  : e === "Not Eligible" ? "ap-elig-no"
  : "ap-elig-pend";

const statusClass = (s: string) =>
  s === "Approved" ? "ap-badge ap-badge-approved"
  : s === "Rejected" ? "ap-badge ap-badge-rejected"
  : "ap-badge ap-badge-pending";

/* ════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════ */
export default function ApproverDashboard() {
  const { instance, accounts } = useMsal();
  const navigate = useNavigate();
  const account = accounts[0];

  /* ── State ── */
  const [proposals, setProposals]         = useState<ProposalResponse[]>([]);
  const [selected, setSelected]           = useState<ProposalResponse | null>(null);
  const [note, setNote]                   = useState("");
  const [filterStatus, setFilterStatus]   = useState<"All" | ProposalResponse["status"]>("All");
  const [filterMonth, setFilterMonth]     = useState("All");
  const [search, setSearch]               = useState("");
  const [loading, setLoading]             = useState(true);
  const [fetchError, setFetchError]       = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast]                 = useState<{ msg: string; ok: boolean } | null>(null);

  /* ── Load proposals ── */
  const loadProposals = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await fetchProposals(instance);
      setProposals(data);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load proposals.");
    } finally {
      setLoading(false);
    }
  }, [instance]);

  useEffect(() => { loadProposals(); }, [loadProposals]);

  /* ── Derived ── */
  const months = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.month)))],
    [proposals]
  );

  const filtered = useMemo(() =>
    proposals.filter((p) => {
      if (filterStatus !== "All" && p.status !== filterStatus) return false;
      if (filterMonth !== "All" && p.month !== filterMonth) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          p.dealerName.toLowerCase().includes(q) ||
          p.rsmName.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
        );
      }
      return true;
    }), [proposals, filterStatus, filterMonth, search]
  );

  const stats = useMemo(() => {
    const approved = proposals.filter((p) => p.status === "Approved");
    return {
      total:       proposals.length,
      pending:     proposals.filter((p) => p.status === "Pending").length,
      approved:    approved.length,
      rejected:    proposals.filter((p) => p.status === "Rejected").length,
      totalBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
    };
  }, [proposals]);

  /* ── Toast ── */
  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  /* ── Approve / Reject ── */
  const decide = async (action: "Approved" | "Rejected") => {
    if (!selected) return;
    setActionLoading(true);
    try {
      const updated = await decideProposal(
        selected.id,
        { status: action, approverNote: note.trim() || null, approvedBy: account?.username ?? null },
        instance
      );
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setSelected(updated);
      showToast(
        action === "Approved" ? "Proposal approved successfully." : "Proposal rejected.",
        action === "Approved"
      );
      setNote("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed. Please retry.", false);
    } finally {
      setActionLoading(false);
    }
  };

  const openDrawer = (p: ProposalResponse) => {
    setSelected(p);
    setNote(p.approverNote ?? "");
  };

  /* ════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════ */
  return (
    <div className="ap-page">

      {/* ── Top bar ── */}
      <header className="ap-topbar">
        <div className="ap-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="ap-brand-logo" />
          <span className="ap-brand-text">BGauss</span>
          <span className="ap-brand-div" />
          <span className="ap-brand-sub">Approver portal</span>
        </div>
        <div className="ap-topbar-right">
          {account?.name && <span className="ap-user">{account.name}</span>}
          <button className="ap-topbar-btn" onClick={() => navigate("/dashboard")}>
            ← Dashboard
          </button>
          <button
            className="ap-topbar-btn"
            onClick={() => instance.logoutRedirect().catch(console.error)}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="ap-main">

        {/* ── Loading ── */}
        {loading && (
          <div className="ap-loading">
            <div className="ap-spinner" />
            <p>Loading proposals…</p>
          </div>
        )}

        {/* ── Error ── */}
        {!loading && fetchError && (
          <div className="ap-error-state">
            <p className="ap-error-msg">⚠ {fetchError}</p>
            <button className="ap-retry-btn" onClick={loadProposals}>Retry</button>
          </div>
        )}

        {/* ── Content ── */}
        {!loading && !fetchError && (
          <>
            {/* Stats */}
            <div className="ap-stats">
              <div className="ap-stat">
                <span className="ap-stat-val ap-navy">{stats.total}</span>
                <span className="ap-stat-lbl">Total proposals</span>
              </div>
              <div className="ap-stat">
                <span className="ap-stat-val ap-amber">{stats.pending}</span>
                <span className="ap-stat-lbl">Pending review</span>
              </div>
              <div className="ap-stat">
                <span className="ap-stat-val ap-green">{stats.approved}</span>
                <span className="ap-stat-lbl">Approved</span>
              </div>
              <div className="ap-stat">
                <span className="ap-stat-val ap-red">{stats.rejected}</span>
                <span className="ap-stat-lbl">Rejected</span>
              </div>
              <div className="ap-stat">
                <span className="ap-stat-val ap-navy">{inr(stats.totalBudget)}</span>
                <span className="ap-stat-lbl">Approved budget</span>
              </div>
            </div>

            {/* Filters */}
            <div className="ap-filters">
              <input
                className="ap-search"
                placeholder="Search dealer, RSM, location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="ap-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
              >
                {["All", "Pending", "Approved", "Rejected"].map((s) => (
                  <option key={s} value={s}>{s === "All" ? "All statuses" : s}</option>
                ))}
              </select>
              <select
                className="ap-select"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
              >
                {months.map((m) => (
                  <option key={m} value={m}>{m === "All" ? "All months" : m}</option>
                ))}
              </select>
              <button className="ap-refresh-btn" onClick={loadProposals}>
                ↻ Refresh
              </button>
            </div>

            {/* Table */}
            <div className="ap-table-wrap">
              <table className="ap-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Submitted</th>
                    <th>RSM / TSM</th>
                    <th>Dealer &amp; location</th>
                    <th>Month</th>
                    <th>Activities</th>
                    <th className="ap-num">Budget</th>
                    <th className="ap-num">Target</th>
                    <th className="ap-num">CAC</th>
                    <th>Eligibility</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} className="ap-empty">
                        {proposals.length === 0
                          ? "No proposals submitted yet."
                          : "No proposals match the current filters."}
                      </td>
                    </tr>
                  )}
                  {filtered.map((p) => (
                    <tr key={p.id} className="ap-row" onClick={() => openDrawer(p)}>
                      <td>
                        <span className="ap-id-chip">
                          {p.id.split("-").slice(-1)[0]}
                        </span>
                      </td>
                      <td>
                        <span className="ap-cell-p">{fmtDate(p.createdAt)}</span>
                        <span className="ap-cell-m">{p.submittedBy}</span>
                      </td>
                      <td>
                        <span className="ap-cell-p">{p.rsmName}</span>
                        <span className="ap-cell-m">{p.commandoName}</span>
                      </td>
                      <td>
                        <span className="ap-cell-p">{p.dealerName}</span>
                        <span className="ap-cell-m">{p.location}, {p.state}</span>
                      </td>
                      <td>{p.month}</td>
                      <td>
                        {p.activities.map((a, i) => (
                          <span key={i} className="ap-act-chip">{a.activityType}</span>
                        ))}
                      </td>
                      <td className="ap-num ap-bold">{inr(p.totalBudget)}</td>
                      <td className="ap-num">{p.totalTarget}</td>
                      <td className="ap-num">{inr(p.cac)}</td>
                      <td>
                        <span className={`ap-elig ${eligClass(p.eligibility)}`}>
                          {p.eligibility}
                        </span>
                      </td>
                      <td>
                        <span className={statusClass(p.status)}>{p.status}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="ap-review-btn"
                          onClick={() => openDrawer(p)}
                        >
                          {p.status === "Pending" ? "Review" : "View"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* ── Side drawer ── */}
      {selected && (
        <div className="ap-overlay" onClick={() => setSelected(null)}>
          <div className="ap-drawer" onClick={(e) => e.stopPropagation()}>

            {/* Drawer header */}
            <div className="ap-drawer-head">
              <div>
                <span className="ap-drawer-id">
                  {selected.id.split("-").slice(-1)[0]}
                </span>
                <h2 className="ap-drawer-title">{selected.dealerName}</h2>
                <p className="ap-drawer-sub">
                  {selected.location}, {selected.state} &middot; {selected.month}
                  &middot; Submitted by <strong>{selected.submittedBy}</strong>
                  {" "}on {fmtDate(selected.createdAt)}
                </p>
              </div>
              <button className="ap-close-btn" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>

            {/* Meta grid */}
            <div className="ap-meta-grid">
              {([
                ["RSM / TSM",   selected.rsmName],
                ["Commando",    selected.commandoName],
                ["Type",        selected.type],
                ["Eligibility", selected.eligibility],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="ap-meta-cell">
                  <span className="ap-meta-lbl">{label}</span>
                  <span className="ap-meta-val">{value || "—"}</span>
                </div>
              ))}
            </div>

            {/* Remarks */}
            {selected.remarks && (
              <div className="ap-remarks">
                <span className="ap-remarks-lbl">RSM remarks</span>
                <p className="ap-remarks-text">{selected.remarks}</p>
              </div>
            )}

            {/* Activities */}
            <p className="ap-sec-head">Activities</p>
            <div className="ap-itbl-wrap">
              <table className="ap-itbl">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th className="ap-num">Target</th>
                    <th>Dates</th>
                    <th className="ap-num">Budget</th>
                    <th className="ap-num">Incentive</th>
                    <th className="ap-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.activities.map((a, i) => (
                    <tr key={i}>
                      <td>{a.activityType}</td>
                      <td className="ap-num">{a.target}</td>
                      <td>
                        {fmtDate(a.startDate)}
                        {a.startDate !== a.endDate && (
                          <> &rarr; {fmtDate(a.endDate)}</>
                        )}
                      </td>
                      <td className="ap-num">{inr(a.budget)}</td>
                      <td className="ap-num">{inr(a.incentive)}</td>
                      <td className="ap-num ap-bold">{inr(a.budget + a.incentive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary strip */}
            <div className="ap-summary">
              <div className="ap-sum-cell">
                <span className="ap-sum-lbl">Total target</span>
                <span className="ap-sum-val">{selected.totalTarget}</span>
              </div>
              <div className="ap-sum-cell">
                <span className="ap-sum-lbl">Total budget</span>
                <span className="ap-sum-val ap-navy">{inr(selected.totalBudget)}</span>
              </div>
              <div className="ap-sum-cell ap-sum-last">
                <span className="ap-sum-lbl">CAC (auto)</span>
                <span className="ap-sum-val ap-amber">{inr(selected.cac)}</span>
              </div>
            </div>

            {/* Decision panel */}
            {selected.status === "Pending" ? (
              <div className="ap-action-box">
                <p className="ap-sec-head" style={{ marginBottom: 10 }}>Decision</p>
                <textarea
                  className="ap-note-input"
                  rows={3}
                  placeholder="Add a note for the RSM (optional)…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="ap-btn-row">
                  <button
                    className="ap-approve-btn"
                    disabled={actionLoading}
                    onClick={() => decide("Approved")}
                  >
                    {actionLoading ? "Processing…" : "✓  Approve"}
                  </button>
                  <button
                    className="ap-reject-btn"
                    disabled={actionLoading}
                    onClick={() => decide("Rejected")}
                  >
                    {actionLoading ? "Processing…" : "✕  Reject"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`ap-decision-banner ${
                selected.status === "Approved"
                  ? "ap-decision-approved"
                  : "ap-decision-rejected"
              }`}>
                <div className="ap-decision-head">
                  <strong>{selected.status}</strong>
                  {selected.decidedAt && (
                    <span className="ap-decision-date">
                      {fmtDate(selected.decidedAt)}
                      {selected.approvedBy && ` · ${selected.approvedBy}`}
                    </span>
                  )}
                </div>
                {selected.approverNote && (
                  <p className="ap-decision-note">{selected.approverNote}</p>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`ap-toast ${toast.ok ? "ap-toast-ok" : "ap-toast-err"}`}>
          {toast.ok ? "✓" : "✕"}&nbsp;{toast.msg}
        </div>
      )}
    </div>
  );
}
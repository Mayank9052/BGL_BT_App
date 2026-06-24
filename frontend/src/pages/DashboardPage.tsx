// DashboardPage.tsx
// Admin: sees ALL proposals (state-wise + dealer-wise)
// RSM: sees only their own proposals
// KPI cards are clickable — filter the tables below by status
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import {
  fetchMyProposals,
  fetchProposals,
  type ProposalResponse,
} from "../services/proposalService";
import "./DashboardPage.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
};

const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");

const inrCompact = (v: number): string => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};

const statusCls = (s: string) =>
  s === "Approved" ? "dash-badge dash-badge--approved"
  : s === "Rejected" ? "dash-badge dash-badge--rejected"
  : "dash-badge dash-badge--pending";

// ─── Types ────────────────────────────────────────────────────────────────────
type ActiveFilter = "All" | "Pending" | "Approved" | "Rejected";

interface SummaryStats {
  totalProposals: number;
  pendingCount:   number;
  approvedCount:  number;
  rejectedCount:  number;
  totalBudget:    number;
  approvedBudget: number;
  pendingBudget:  number;
  totalTarget:    number;
  avgCac:         number;
  stateCount:     number;
  dealerCount:    number;
}

function computeStats(proposals: ProposalResponse[]): SummaryStats {
  const approved = proposals.filter((p) => p.status === "Approved");
  const pending  = proposals.filter((p) => p.status === "Pending");
  const rejected = proposals.filter((p) => p.status === "Rejected");
  const cacList  = proposals.filter((p) => p.cac > 0).map((p) => p.cac);
  return {
    totalProposals: proposals.length,
    pendingCount:   pending.length,
    approvedCount:  approved.length,
    rejectedCount:  rejected.length,
    totalBudget:    proposals.reduce((s, p) => s + p.totalBudget, 0),
    approvedBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
    pendingBudget:  pending.reduce((s, p)  => s + p.totalBudget, 0),
    totalTarget:    proposals.reduce((s, p) => s + p.totalTarget, 0),
    avgCac:         cacList.length > 0 ? cacList.reduce((a, b) => a + b, 0) / cacList.length : 0,
    stateCount:     new Set(proposals.map((p) => p.state)).size,
    dealerCount:    new Set(proposals.map((p) => p.dealerName)).size,
  };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, loading } = useAuthStore();
  const { instance }      = useMsal();
  const navigate          = useNavigate();
  const isAdmin           = user?.role === "Admin" || user?.role === "Manager";

  const [proposals,    setProposals]    = useState<ProposalResponse[]>([]);
  const [loadingData,  setLoadingData]  = useState(true);
  const [dataError,    setDataError]    = useState<string | null>(null);

  // Filter state — driven by clicking KPI cards or dropdowns
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("All");
  const [search,       setSearch]       = useState("");
  const [stateFilter,  setStateFilter]  = useState("All");

  // Load proposals — Admin/Manager sees ALL; RSM sees own
  useEffect(() => {
    if (loading) return;
    setLoadingData(true);
    const loader = isAdmin ? fetchProposals(instance) : fetchMyProposals(instance);
    loader
      .then(setProposals)
      .catch((e) => setDataError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoadingData(false));
  }, [loading, instance, isAdmin]);

  const stats = useMemo(() => computeStats(proposals), [proposals]);

  const states = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.state))).sort()],
    [proposals],
  );

  // Toggle KPI card filter — clicking same card resets to All
  const handleKpiClick = (filter: ActiveFilter) =>
    setActiveFilter((prev) => (prev === filter ? "All" : filter));

  // ── State-wise breakdown ──────────────────────────────────────────────────
  const stateBreakdown = useMemo(() => {
    interface StateRow {
      oldDealers: Set<string>; oldTarget: number; oldBudget: number;
      newDealers: Set<string>; newTarget: number; newBudget: number;
      nonDealers: Set<string>; nonTarget: number; nonBudget: number;
      pending: number; approved: number; rejected: number;
      remarks: string;
    }
    const map: Record<string, StateRow> = {};
    const ensure = (state: string) => {
      if (!map[state]) map[state] = {
        oldDealers: new Set(), oldTarget: 0, oldBudget: 0,
        newDealers: new Set(), newTarget: 0, newBudget: 0,
        nonDealers: new Set(), nonTarget: 0, nonBudget: 0,
        pending: 0, approved: 0, rejected: 0, remarks: "",
      };
    };

    // Apply active status filter to state breakdown
    const source = activeFilter === "All"
      ? proposals
      : proposals.filter((p) => p.status === activeFilter);

    for (const p of source) {
      ensure(p.state);
      const r  = map[p.state];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      if (el.includes("not") || el.includes("non")) {
        r.nonDealers.add(p.dealerName); r.nonTarget += p.totalTarget; r.nonBudget += p.totalBudget;
      } else if (ty === "new") {
        r.newDealers.add(p.dealerName); r.newTarget += p.totalTarget; r.newBudget += p.totalBudget;
      } else {
        r.oldDealers.add(p.dealerName); r.oldTarget += p.totalTarget; r.oldBudget += p.totalBudget;
      }
      if (p.status === "Pending")  r.pending++;
      if (p.status === "Approved") r.approved++;
      if (p.status === "Rejected") r.rejected++;
      if (p.remarks) r.remarks = p.remarks;
    }

    return Object.entries(map).map(([state, d]) => {
      const totalDealers = d.oldDealers.size + d.newDealers.size + d.nonDealers.size;
      const totalBudget  = d.oldBudget + d.newBudget;
      const totalRetail  = d.oldTarget + d.newTarget + d.nonTarget;
      return {
        state,
        oldRetail: d.oldTarget,  oldCount: d.oldDealers.size, oldBudget: d.oldBudget,
        oldCac: d.oldTarget > 0 ? d.oldBudget / d.oldTarget : 0,
        newRetail: d.newTarget,  newCount: d.newDealers.size, newBudget: d.newBudget,
        newCac: d.newTarget > 0 ? d.newBudget / d.newTarget : 0,
        nonRetail: d.nonTarget,  nonCount: d.nonDealers.size, nonBudget: d.nonBudget,
        nonCac: d.nonTarget > 0 ? d.nonBudget / d.nonTarget : 0,
        totalDealers, totalBudget, totalRetail,
        overallCac: totalRetail > 0 ? totalBudget / totalRetail : 0,
        pending: d.pending, approved: d.approved, rejected: d.rejected,
        remarks: d.remarks,
      };
    }).sort((a, b) => a.state.localeCompare(b.state));
  }, [proposals, activeFilter]);

  const stateGrandTotal = useMemo(() => {
    if (!stateBreakdown.length) return null;
    return {
      oldRetail:    stateBreakdown.reduce((s, r) => s + r.oldRetail,    0),
      oldCount:     stateBreakdown.reduce((s, r) => s + r.oldCount,     0),
      oldBudget:    stateBreakdown.reduce((s, r) => s + r.oldBudget,    0),
      newRetail:    stateBreakdown.reduce((s, r) => s + r.newRetail,    0),
      newCount:     stateBreakdown.reduce((s, r) => s + r.newCount,     0),
      newBudget:    stateBreakdown.reduce((s, r) => s + r.newBudget,    0),
      nonRetail:    stateBreakdown.reduce((s, r) => s + r.nonRetail,    0),
      nonCount:     stateBreakdown.reduce((s, r) => s + r.nonCount,     0),
      nonBudget:    stateBreakdown.reduce((s, r) => s + r.nonBudget,    0),
      totalDealers: stateBreakdown.reduce((s, r) => s + r.totalDealers, 0),
      totalBudget:  stateBreakdown.reduce((s, r) => s + r.totalBudget,  0),
      totalRetail:  stateBreakdown.reduce((s, r) => s + r.totalRetail,  0),
    };
  }, [stateBreakdown]);

  // ── Dealer-wise list ──────────────────────────────────────────────────────
  const dealerRows = useMemo(() => {
    // Apply status + state + search filters
    const source = proposals.filter((p) => {
      if (activeFilter !== "All" && p.status !== activeFilter) return false;
      if (stateFilter  !== "All" && p.state  !== stateFilter)  return false;
      const q = search.toLowerCase().trim();
      if (q && ![p.dealerName, p.state].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });

    const map: Record<string, {
      state: string; dealerName: string; monthTarget: number;
      eligibleOldBudget: number; eligibleNewBudget: number; nonBudget: number;
      retailTarget: number; activities: number;
      eligibility: string; type: string;
      pending: number; approved: number; rejected: number;
    }> = {};

    for (const p of source) {
      const key = `${p.dealerName}__${p.state}`;
      if (!map[key]) map[key] = {
        state: p.state, dealerName: p.dealerName,
        monthTarget: 0, eligibleOldBudget: 0, eligibleNewBudget: 0, nonBudget: 0,
        retailTarget: 0, activities: 0,
        eligibility: p.eligibility ?? "", type: p.type ?? "",
        pending: 0, approved: 0, rejected: 0,
      };
      const d  = map[key];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      d.monthTarget  += p.totalTarget;
      d.retailTarget += p.totalTarget;
      d.activities   += p.activities.length;
      if (el.includes("not") || el.includes("non")) d.nonBudget         += p.totalBudget;
      else if (ty === "new")                         d.eligibleNewBudget += p.totalBudget;
      else                                           d.eligibleOldBudget += p.totalBudget;
      if (p.status === "Pending")  d.pending++;
      if (p.status === "Approved") d.approved++;
      if (p.status === "Rejected") d.rejected++;
      d.eligibility = p.eligibility ?? d.eligibility;
      d.type        = p.type        ?? d.type;
    }
    return Object.values(map).sort(
      (a, b) => a.state.localeCompare(b.state) || a.dealerName.localeCompare(b.dealerName)
    );
  }, [proposals, activeFilter, stateFilter, search]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="dash-loading-screen">
        <div className="dash-spinner" /><p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="dash-root">

      {/* ── Quick actions ── */}
      <div className="dash-quick-actions">
        <button className="dash-action-card" onClick={() => navigate("/rsm-form")}>
          <span className="dash-action-icon">📋</span>
          <div>
            <div className="dash-action-title">New Proposal</div>
            <div className="dash-action-desc">Submit a BTL activity plan</div>
          </div>
        </button>
        {isAdmin && (
          <button className="dash-action-card" onClick={() => navigate("/approver")}>
            <span className="dash-action-icon">✅</span>
            <div>
              <div className="dash-action-title">Review Proposals</div>
              <div className="dash-action-desc">Approve or reject pending plans</div>
            </div>
          </button>
        )}
        {user?.role === "Admin" && (
          <button className="dash-action-card" onClick={() => navigate("/admin/users")}>
            <span className="dash-action-icon">👥</span>
            <div>
              <div className="dash-action-title">Manage Users & Activity</div>
              <div className="dash-action-desc">Add Activity, Edit roles and active status</div>
            </div>
          </button>
        )}
      </div>

      {loadingData ? (
        <div className="dash-loading-inline">
          <div className="dash-spinner dash-spinner--sm" /><span>Loading proposals…</span>
        </div>
      ) : dataError ? (
        <div className="dash-error-banner">⚠ {dataError}</div>
      ) : proposals.length === 0 ? (
        <div className="dash-empty">
          <span className="dash-empty-icon">📋</span>
          <p>No proposals yet.</p>
          <button className="dash-empty-btn" onClick={() => navigate("/rsm-form")}>
            Submit your first proposal
          </button>
        </div>
      ) : (
        <>
          {/* ══ KPI Cards — CLICKABLE to filter tables below ═══════════════════ */}
          {activeFilter !== "All" && (
            <div className="dash-filter-banner">
              Showing <strong>{activeFilter}</strong> proposals
              <button className="dash-filter-clear" onClick={() => setActiveFilter("All")}>
                ✕ Clear filter
              </button>
            </div>
          )}

          <div className="dash-kpi-grid">
            <KpiCard
              icon="📄"
              label="Total Proposals"
              value={String(stats.totalProposals)}
              sub={`${stats.dealerCount} dealers · ${stats.stateCount} states`}
              accent="blue"
              active={activeFilter === "All"}
              onClick={() => {
                handleKpiClick("All");
              }}
            />
            <KpiCard
              icon="⏳"
              label="Pending Approval"
              value={String(stats.pendingCount)}
              sub={`Budget: ${inrCompact(stats.pendingBudget)}`}
              accent="amber"
              active={activeFilter === "Pending"}
              badge={stats.pendingCount > 0 ? "action needed" : undefined}
              onClick={() => {
                handleKpiClick("Pending");
                // Admin/Manager: also navigate to approver queue
                if (isAdmin) navigate("/approver");
              }}
            />
            <KpiCard
              icon="✅"
              label="Approved"
              value={String(stats.approvedCount)}
              sub={`Budget: ${inrCompact(stats.approvedBudget)}`}
              accent="green"
              active={activeFilter === "Approved"}
              onClick={() => {
                handleKpiClick("Approved");
              }}
            />
            <KpiCard
              icon="❌"
              label="Rejected"
              value={String(stats.rejectedCount)}
              sub={`${Math.round(stats.totalTarget).toLocaleString("en-IN")} total units`}
              accent="red"
              active={activeFilter === "Rejected"}
              onClick={() => {
                handleKpiClick("Rejected");
              }}
            />
            <KpiCard
              icon="💰"
              label="Total Budget"
              value={inrCompact(stats.totalBudget)}
              sub={`Avg CAC ₹${Math.round(stats.avgCac).toLocaleString("en-IN")}`}
              accent="purple"
              onClick={() => {
                // Reset to show all regardless of role
                setActiveFilter("All");
              }}
            />
          </div>

          {/* ══ State-wise Summary ═══════════════════════════════════════════ */}
          {stateBreakdown.length > 0 && (
            <section className="dash-section">
              <div className="dash-section-head">
                <h2 className="dash-section-title">
                  State-wise Summary
                  {activeFilter !== "All" && (
                    <span className={`dash-filter-pill dash-filter-pill--${activeFilter.toLowerCase()}`}>
                      {activeFilter}
                    </span>
                  )}
                </h2>
              </div>
              <div className="dash-table-wrap dash-table-wrap--wide">
                <table className="dash-table dash-table--summary">
                  <thead>
                    <tr className="dash-thead-group">
                      <th className="dash-th dash-th--state" rowSpan={2}>States</th>
                      <th className="dash-th dash-th--group dash-th--old" colSpan={4}>Eligible Old Dealer</th>
                      <th className="dash-th dash-th--group dash-th--new" colSpan={4}>Eligible New Dealer</th>
                      <th className="dash-th dash-th--group dash-th--non" colSpan={4}>Non Eligible Dealer</th>
                      <th className="dash-th dash-th--group dash-th--tot" colSpan={4}>Totals</th>
                      <th className="dash-th dash-th--group" colSpan={3}>Status</th>
                      <th className="dash-th" rowSpan={2}>Remarks</th>
                    </tr>
                    <tr className="dash-thead-sub">
                      <th className="dash-th dash-th--old dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--old dash-th--right">Count</th>
                      <th className="dash-th dash-th--old dash-th--right">Budget (₹)</th>
                      <th className="dash-th dash-th--old dash-th--right">CAC (₹)</th>
                      <th className="dash-th dash-th--new dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--new dash-th--right">Count</th>
                      <th className="dash-th dash-th--new dash-th--right">Budget (₹)</th>
                      <th className="dash-th dash-th--new dash-th--right">CAC (₹)</th>
                      <th className="dash-th dash-th--non dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--non dash-th--right">Count</th>
                      <th className="dash-th dash-th--non dash-th--right">Budget (₹)</th>
                      <th className="dash-th dash-th--non dash-th--right">CAC (₹)</th>
                      <th className="dash-th dash-th--tot dash-th--right">Dealers for BTL</th>
                      <th className="dash-th dash-th--tot dash-th--right">Total Budget (₹)</th>
                      <th className="dash-th dash-th--tot dash-th--right">Total Retail</th>
                      <th className="dash-th dash-th--tot dash-th--right">Overall CAC</th>
                      <th className="dash-th dash-th--right" style={{ background: "#f59e0b22", color: "#92400e" }}>Pending</th>
                      <th className="dash-th dash-th--right" style={{ background: "#16a34a22", color: "#14532d" }}>Approved</th>
                      <th className="dash-th dash-th--right" style={{ background: "#dc262622", color: "#7f1d1d" }}>Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stateBreakdown.map((row, i) => (
                      <tr key={row.state} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                        <td className="dash-td"><span className="dash-state-tag">{row.state}</span></td>
                        <td className="dash-td dash-td--right">{row.oldRetail > 0 ? row.oldRetail : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.oldCount  > 0 ? row.oldCount  : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.oldBudget > 0 ? inr(row.oldBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.oldCac    > 0 ? `₹${Math.round(row.oldCac).toLocaleString("en-IN")}` : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.newRetail > 0 ? row.newRetail : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.newCount  > 0 ? row.newCount  : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.newBudget > 0 ? inr(row.newBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.newCac    > 0 ? `₹${Math.round(row.newCac).toLocaleString("en-IN")}` : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.nonRetail > 0 ? row.nonRetail : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.nonCount  > 0 ? row.nonCount  : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.nonBudget > 0 ? inr(row.nonBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.nonCac    > 0 ? `₹${Math.round(row.nonCac).toLocaleString("en-IN")}` : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--bold">{row.totalDealers}</td>
                        <td className="dash-td dash-td--right dash-td--mono dash-td--bold">{inr(row.totalBudget)}</td>
                        <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalRetail).toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                          {row.overallCac > 0 ? `₹${Math.round(row.overallCac).toLocaleString("en-IN")}` : <Dash />}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.pending  > 0 ? <span className="dash-badge dash-badge--pending">{row.pending}</span>  : <span className="dash-muted">—</span>}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.approved > 0 ? <span className="dash-badge dash-badge--approved">{row.approved}</span> : <span className="dash-muted">—</span>}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.rejected > 0 ? <span className="dash-badge dash-badge--rejected">{row.rejected}</span> : <span className="dash-muted">—</span>}
                        </td>
                        <td className="dash-td dash-td--remarks">{row.remarks || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  {stateGrandTotal && (
                    <tfoot>
                      <tr className="dash-grand-total">
                        <td className="dash-td dash-td--grand-label">Grand Totals</td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.oldRetail.toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.oldCount}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.oldBudget)}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                          {stateGrandTotal.oldRetail > 0 ? `₹${Math.round(stateGrandTotal.oldBudget / stateGrandTotal.oldRetail).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.newRetail.toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.newCount}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.newBudget)}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                          {stateGrandTotal.newRetail > 0 ? `₹${Math.round(stateGrandTotal.newBudget / stateGrandTotal.newRetail).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.nonRetail.toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.nonCount}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.nonBudget)}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                          {stateGrandTotal.nonRetail > 0 ? `₹${Math.round(stateGrandTotal.nonBudget / stateGrandTotal.nonRetail).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.totalDealers}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">{inr(stateGrandTotal.totalBudget)}</td>
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.totalRetail.toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                          {stateGrandTotal.totalRetail > 0 ? `₹${Math.round(stateGrandTotal.totalBudget / stateGrandTotal.totalRetail).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="dash-td" colSpan={4} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          )}

          {/* ══ Dealer-wise ══════════════════════════════════════════════════ */}
          <section className="dash-section">
            <div className="dash-section-head">
              <h2 className="dash-section-title">
                Dealer-wise Data
                <span className="dash-count-chip">{dealerRows.length}</span>
                {activeFilter !== "All" && (
                  <span className={`dash-filter-pill dash-filter-pill--${activeFilter.toLowerCase()}`}>
                    {activeFilter}
                  </span>
                )}
              </h2>
            </div>

            <div className="dash-toolbar">
              <input
                className="dash-search"
                type="search"
                placeholder="Search dealer name or state…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="dash-filter-row">
                <FilterSelect
                  value={stateFilter}
                  onChange={setStateFilter}
                  options={states}
                  label="State"
                />
                <FilterSelect
                  value={activeFilter}
                  onChange={(v) => setActiveFilter(v as ActiveFilter)}
                  options={["All", "Pending", "Approved", "Rejected"]}
                  label="Status"
                />
              </div>
            </div>

            {dealerRows.length === 0 ? (
              <div className="dash-no-results">No dealers match your filters.</div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table dash-table--dealer">
                  <thead>
                    <tr>
                      <th className="dash-th">State</th>
                      <th className="dash-th">Dealer Name</th>
                      <th className="dash-th dash-th--right">Month Target</th>
                      <th className="dash-th">Category (Mar–May)</th>
                      <th className="dash-th">BTL Category</th>
                      <th className="dash-th dash-th--right">Activities</th>
                      <th className="dash-th dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--right">Budget for BTL (₹)</th>
                      <th className="dash-th dash-th--right">Pending</th>
                      <th className="dash-th dash-th--right">Approved</th>
                      <th className="dash-th dash-th--right">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealerRows.map((row, i) => {
                      const el     = (row.eligibility ?? "").toLowerCase();
                      const isNon  = el.includes("not") || el.includes("non");
                      const isNew  = row.type?.toLowerCase() === "new";
                      const catBase = isNon ? "Non Eligible" : "BTL Budget Eligible";
                      const cat     = isNon
                        ? "Dealers Non Eligible for BTL"
                        : isNew
                        ? "Budget taken for BTL (New)"
                        : "Budget taken for BTL (Old+New+Special Approval)";
                      const btlBudget = row.eligibleOldBudget + row.eligibleNewBudget;

                      return (
                        <tr key={`${row.dealerName}__${row.state}`}
                          className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                          <td className="dash-td"><span className="dash-state-tag">{row.state}</span></td>
                          <td className="dash-td"><span className="dash-dealer-name">{row.dealerName}</span></td>
                          <td className="dash-td dash-td--right">{Math.round(row.monthTarget).toLocaleString("en-IN")}</td>
                          <td className="dash-td">
                            <span className={`dash-cat-tag dash-cat-tag--${isNon ? "non" : "eligible"}`}>
                              {catBase}
                            </span>
                          </td>
                          <td className="dash-td dash-td--category">{cat}</td>
                          <td className="dash-td dash-td--right">{row.activities}</td>
                          <td className="dash-td dash-td--right">{Math.round(row.retailTarget).toLocaleString("en-IN")}</td>
                          <td className="dash-td dash-td--right dash-td--mono">
                            {btlBudget > 0 ? inr(btlBudget) : <Dash />}
                          </td>
                          <td className="dash-td dash-td--right">
                            {row.pending  > 0 ? <span className="dash-badge dash-badge--pending">{row.pending}</span>  : <span className="dash-muted">—</span>}
                          </td>
                          <td className="dash-td dash-td--right">
                            {row.approved > 0 ? <span className="dash-badge dash-badge--approved">{row.approved}</span> : <span className="dash-muted">—</span>}
                          </td>
                          <td className="dash-td dash-td--right">
                            {row.rejected > 0 ? <span className="dash-badge dash-badge--rejected">{row.rejected}</span> : <span className="dash-muted">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, accent, active, onClick, badge,
}: {
  icon: string; label: string; value: string; sub: string;
  accent: "blue" | "amber" | "green" | "red" | "purple";
  active?: boolean; onClick: () => void; badge?: string;
}) {
  return (
    <button
      type="button"
      className={[
        "dash-kpi-card",
        "dash-kpi-card--clickable",
        `dash-kpi-card--${accent}`,
        active ? "dash-kpi-card--active" : "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      {badge && <span className="dash-kpi-badge">{badge}</span>}
      <div className="dash-kpi-icon">{icon}</div>
      <div className="dash-kpi-body">
        <div className="dash-kpi-label">{label}</div>
        <div className="dash-kpi-value">{value}</div>
        <div className="dash-kpi-sub">{sub}</div>
      </div>
      {active && <div className="dash-kpi-active-dot" />}
    </button>
  );
}

function FilterSelect({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string;
}) {
  return (
    <select className="dash-filter-select" value={value}
      onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o} value={o}>{o === "All" ? `All ${label}s` : o}</option>
      ))}
    </select>
  );
}

function Dash() {
  return <span className="dash-muted">0</span>;
}
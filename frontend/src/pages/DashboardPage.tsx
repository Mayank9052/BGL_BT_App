// DashboardPage.tsx
// Summary KPI cards + state-wise breakdown + dealer-wise sortable/filterable proposal table
// Data sourced from ProposalResponse[] (fetchMyProposals for RSMs, fetchProposals for Admins)
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
  s === "Approved"
    ? "dash-badge dash-badge--approved"
    : s === "Rejected"
    ? "dash-badge dash-badge--rejected"
    : "dash-badge dash-badge--pending";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryStats {
  totalProposals: number;
  pendingCount:   number;
  approvedCount:  number;
  rejectedCount:  number;
  totalBudget:    number;
  approvedBudget: number;
  totalTarget:    number;
  avgCac:         number;
  stateCount:     number;
  dealerCount:    number;
}

function computeStats(proposals: ProposalResponse[]): SummaryStats {
  const approved  = proposals.filter((p) => p.status === "Approved");
  const pending   = proposals.filter((p) => p.status === "Pending");
  const rejected  = proposals.filter((p) => p.status === "Rejected");
  const cacList   = proposals.filter((p) => p.cac > 0).map((p) => p.cac);
  return {
    totalProposals: proposals.length,
    pendingCount:   pending.length,
    approvedCount:  approved.length,
    rejectedCount:  rejected.length,
    totalBudget:    proposals.reduce((s, p) => s + p.totalBudget, 0),
    approvedBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
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

  const [proposals,   setProposals]   = useState<ProposalResponse[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError,   setDataError]   = useState<string | null>(null);

  // Table state
  const [search,       setSearch]       = useState("");
  const [stateFilter,  setStateFilter]  = useState("All");
  const [monthFilter,  setMonthFilter]  = useState("All");
  const [page,         setPage]         = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    if (loading) return;
    setLoadingData(true);
    const loader = isAdmin ? fetchProposals(instance) : fetchMyProposals(instance);
    loader
      .then(setProposals)
      .catch((e) => setDataError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoadingData(false));
  }, [loading, instance, isAdmin]);

  useEffect(() => { setPage(1); }, [search, stateFilter, monthFilter]);

  const stats = useMemo(() => computeStats(proposals), [proposals]);

  const states = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.state))).sort()],
    [proposals],
  );
  const months = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.month))).sort()],
    [proposals],
  );

  // ── State-wise breakdown — mirrors Excel "Summary" sheet columns exactly ──
  // Eligible Old | Eligible New | Non Eligible → per state row + Grand Total
  const stateBreakdown = useMemo(() => {
    interface StateRow {
      // Eligible Old
      oldDealers:  Set<string>; oldTarget:  number; oldBudget:  number;
      // Eligible New
      newDealers:  Set<string>; newTarget:  number; newBudget:  number;
      // Non Eligible
      nonDealers:  Set<string>; nonTarget:  number; nonBudget:  number;
      remarks: string;
    }
    const map: Record<string, StateRow> = {};
    const ensure = (state: string) => {
      if (!map[state]) map[state] = {
        oldDealers: new Set(), oldTarget: 0, oldBudget: 0,
        newDealers: new Set(), newTarget: 0, newBudget: 0,
        nonDealers: new Set(), nonTarget: 0, nonBudget: 0,
        remarks: "",
      };
    };
    for (const p of proposals) {
      ensure(p.state);
      const r  = map[p.state];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      if (el.includes("not") || el.includes("non")) {
        // Non Eligible
        r.nonDealers.add(p.dealerName);
        r.nonTarget += p.totalTarget;
        r.nonBudget += p.totalBudget;
      } else if (ty === "new") {
        // Eligible New
        r.newDealers.add(p.dealerName);
        r.newTarget += p.totalTarget;
        r.newBudget += p.totalBudget;
      } else {
        // Eligible Old (default)
        r.oldDealers.add(p.dealerName);
        r.oldTarget += p.totalTarget;
        r.oldBudget += p.totalBudget;
      }
      if (p.remarks) r.remarks = p.remarks;
    }
    const rows = Object.entries(map).map(([state, d]) => {
      const totalDealers = d.oldDealers.size + d.newDealers.size + d.nonDealers.size;
      const totalBudget  = d.oldBudget  + d.newBudget;  // non-eligible excluded from BTL budget total per Excel
      const totalRetail  = d.oldTarget  + d.newTarget  + d.nonTarget;
      const overallCac   = totalRetail > 0 ? totalBudget / totalRetail : 0;
      return {
        state,
        // Old
        oldRetail:   d.oldTarget,
        oldCount:    d.oldDealers.size,
        oldBudget:   d.oldBudget,
        oldCac:      d.oldTarget  > 0 ? d.oldBudget  / d.oldTarget  : 0,
        // New
        newRetail:   d.newTarget,
        newCount:    d.newDealers.size,
        newBudget:   d.newBudget,
        newCac:      d.newTarget  > 0 ? d.newBudget  / d.newTarget  : 0,
        // Non Eligible
        nonRetail:   d.nonTarget,
        nonCount:    d.nonDealers.size,
        nonBudget:   d.nonBudget,
        nonCac:      d.nonTarget  > 0 ? d.nonBudget  / d.nonTarget  : 0,
        // Totals
        totalDealers,
        totalBudget,
        totalRetail,
        overallCac,
        remarks: d.remarks,
      };
    }).sort((a, b) => a.state.localeCompare(b.state));
    return rows;
  }, [proposals]);

  // Grand Total row
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

  // ── Dealer-wise list — mirrors Excel "Dealerwise" sheet ───────────────────
  // State | Dealer Name | Month Target | Category (Eligible/Non-Eligible) | Count | Retail Targets
  const dealerRows = useMemo(() => {
    // One row per dealer — aggregate across all their proposals
    const map: Record<string, {
      state: string; dealerName: string;
      monthTarget: number;
      eligibleOldBudget: number; eligibleNewBudget: number; nonBudget: number;
      totalCount: number; retailTarget: number;
      eligibility: string; type: string;
      activities: number;
    }> = {};
    for (const p of proposals) {
      const key = `${p.dealerName}__${p.state}`;
      if (!map[key]) map[key] = {
        state: p.state, dealerName: p.dealerName,
        monthTarget: 0, eligibleOldBudget: 0, eligibleNewBudget: 0, nonBudget: 0,
        totalCount: 0, retailTarget: 0,
        eligibility: p.eligibility ?? "", type: p.type ?? "",
        activities: 0,
      };
      const d  = map[key];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      d.monthTarget  += p.totalTarget;
      d.retailTarget += p.totalTarget;
      d.activities   += p.activities.length;
      if (el.includes("not") || el.includes("non")) d.nonBudget        += p.totalBudget;
      else if (ty === "new")                         d.eligibleNewBudget += p.totalBudget;
      else                                           d.eligibleOldBudget += p.totalBudget;
      // Use latest eligibility/type for display
      d.eligibility = p.eligibility ?? d.eligibility;
      d.type        = p.type        ?? d.type;
    }
    return Object.values(map).sort((a, b) => a.state.localeCompare(b.state) || a.dealerName.localeCompare(b.dealerName));
  }, [proposals]);

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

      {/* Quick actions */}
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
              <div className="dash-action-title">Manage Users</div>
              <div className="dash-action-desc">Edit roles and active status</div>
            </div>
          </button>
        )}
      </div>

      {loadingData ? (
        <div className="dash-loading-inline"><div className="dash-spinner dash-spinner--sm" /><span>Loading proposals…</span></div>
      ) : dataError ? (
        <div className="dash-error-banner">⚠ {dataError}</div>
      ) : proposals.length === 0 ? (
        <div className="dash-empty">
          <span className="dash-empty-icon">📋</span>
          <p>No proposals yet.</p>
          <button className="dash-empty-btn" onClick={() => navigate("/rsm-form")}>Submit your first proposal</button>
        </div>
      ) : (
        <>
          {/* ══ KPI Cards ════════════════════════════════════════════════════ */}
          <div className="dash-kpi-grid">
            <KpiCard icon="📄" label="Total Proposals" value={String(stats.totalProposals)}
              sub={`${stats.dealerCount} dealers · ${stats.stateCount} states`} accent="blue" />
            <KpiCard icon="⏳" label="Pending Approval" value={String(stats.pendingCount)}
              sub={`${stats.approvedCount} approved · ${stats.rejectedCount} rejected`} accent="amber" />
            <KpiCard icon="💰" label="Total Budget" value={inrCompact(stats.totalBudget)}
              sub={`${inrCompact(stats.approvedBudget)} approved`} accent="green" />
            <KpiCard icon="🎯" label="Total Target" value={`${Math.round(stats.totalTarget).toLocaleString("en-IN")} units`}
              sub={`Avg CAC ₹${Math.round(stats.avgCac).toLocaleString("en-IN")}`} accent="purple" />
          </div>

          {/* ══ State-wise Summary — mirrors Excel "Summary" sheet ═══════════ */}
          {stateBreakdown.length > 0 && (
            <section className="dash-section">
              <h2 className="dash-section-title">State-wise Summary</h2>
              <div className="dash-table-wrap dash-table-wrap--wide">
                <table className="dash-table dash-table--summary">
                  <thead>
                    {/* Group header row */}
                    <tr className="dash-thead-group">
                      <th className="dash-th dash-th--state" rowSpan={2}>States</th>
                      <th className="dash-th dash-th--group dash-th--old"  colSpan={4}>Eligible Old Dealer</th>
                      <th className="dash-th dash-th--group dash-th--new"  colSpan={4}>Eligible New Dealer</th>
                      <th className="dash-th dash-th--group dash-th--non"  colSpan={4}>Non Eligible Dealer</th>
                      <th className="dash-th dash-th--group dash-th--tot"  colSpan={4}>Totals</th>
                      <th className="dash-th" rowSpan={2}>Remarks</th>
                    </tr>
                    {/* Sub-header row */}
                    <tr className="dash-thead-sub">
                      {/* Old */}
                      <th className="dash-th dash-th--old dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--old dash-th--right">Count</th>
                      <th className="dash-th dash-th--old dash-th--right">Budget (₹)</th>
                      <th className="dash-th dash-th--old dash-th--right">CAC (₹)</th>
                      {/* New */}
                      <th className="dash-th dash-th--new dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--new dash-th--right">Count</th>
                      <th className="dash-th dash-th--new dash-th--right">Budget (₹)</th>
                      <th className="dash-th dash-th--new dash-th--right">CAC (₹)</th>
                      {/* Non Eligible */}
                      <th className="dash-th dash-th--non dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--non dash-th--right">Count</th>
                      <th className="dash-th dash-th--non dash-th--right">Budget (₹)</th>
                      <th className="dash-th dash-th--non dash-th--right">CAC (₹)</th>
                      {/* Totals */}
                      <th className="dash-th dash-th--tot dash-th--right">Dealers for BTL</th>
                      <th className="dash-th dash-th--tot dash-th--right">Total Budget (₹)</th>
                      <th className="dash-th dash-th--tot dash-th--right">Total Retail</th>
                      <th className="dash-th dash-th--tot dash-th--right">Overall CAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stateBreakdown.map((row, i) => (
                      <tr key={row.state} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                        <td className="dash-td"><span className="dash-state-tag">{row.state}</span></td>
                        {/* Old */}
                        <td className="dash-td dash-td--right">{row.oldRetail > 0  ? row.oldRetail  : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.oldCount  > 0  ? row.oldCount   : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.oldBudget > 0  ? inr(row.oldBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.oldCac    > 0  ? `₹${Math.round(row.oldCac).toLocaleString("en-IN")}`   : <Dash />}</td>
                        {/* New */}
                        <td className="dash-td dash-td--right">{row.newRetail > 0  ? row.newRetail  : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.newCount  > 0  ? row.newCount   : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.newBudget > 0  ? inr(row.newBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.newCac    > 0  ? `₹${Math.round(row.newCac).toLocaleString("en-IN")}`   : <Dash />}</td>
                        {/* Non Eligible */}
                        <td className="dash-td dash-td--right">{row.nonRetail > 0  ? row.nonRetail  : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.nonCount  > 0  ? row.nonCount   : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.nonBudget > 0  ? inr(row.nonBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.nonCac    > 0  ? `₹${Math.round(row.nonCac).toLocaleString("en-IN")}`   : <Dash />}</td>
                        {/* Totals */}
                        <td className="dash-td dash-td--right dash-td--bold">{row.totalDealers}</td>
                        <td className="dash-td dash-td--right dash-td--mono dash-td--bold">{inr(row.totalBudget)}</td>
                        <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalRetail).toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                          {row.overallCac > 0 ? `₹${Math.round(row.overallCac).toLocaleString("en-IN")}` : <Dash />}
                        </td>
                        <td className="dash-td dash-td--remarks">{row.remarks || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Grand Total row */}
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
                        <td className="dash-td" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          )}

          {/* ══ Dealer-wise — mirrors Excel "Dealerwise" sheet ════════════════ */}
          <section className="dash-section">
            <div className="dash-section-head">
              <h2 className="dash-section-title">
                Dealer-wise Data
                <span className="dash-count-chip">{dealerRows.length}</span>
              </h2>
            </div>

            {/* Toolbar */}
            <div className="dash-toolbar">
              <input className="dash-search" type="search"
                placeholder="Search dealer name or state…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="dash-filter-row">
                <FilterSelect value={stateFilter} onChange={setStateFilter} options={states} label="State" />
              </div>
            </div>

            {(() => {
              const q = search.toLowerCase().trim();
              const rows = dealerRows.filter((r) => {
                if (stateFilter !== "All" && r.state !== stateFilter) return false;
                if (q && ![r.dealerName, r.state].join(" ").toLowerCase().includes(q)) return false;
                return true;
              });
              return rows.length === 0 ? (
                <div className="dash-no-results">No dealers match your filters.</div>
              ) : (
                <div className="dash-table-wrap">
                  <table className="dash-table dash-table--dealer">
                    <thead>
                      <tr>
                        <th className="dash-th">State</th>
                        <th className="dash-th">Dealer Name</th>
                        <th className="dash-th dash-th--right">May Month Target</th>
                        <th className="dash-th">Category based on Mar, Apr, May</th>
                        <th className="dash-th">Category</th>
                        <th className="dash-th dash-th--right">Count</th>
                        <th className="dash-th dash-th--right">Retail Targets</th>
                        <th className="dash-th dash-th--right">Budget Taken for BTL (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        const el  = (row.eligibility ?? "").toLowerCase();
                        const isNon = el.includes("not") || el.includes("non");
                        const categoryBased = isNon ? "Non Eligible" : "BTL Budget Eligible";
                        const category = isNon
                          ? "Dealers Non Eligible for BTL"
                          : row.type?.toLowerCase() === "new"
                          ? "Budget taken for BTL (New)"
                          : "Budget taken for BTL (Old+New+Special Approval)";
                        const btlBudget = row.eligibleOldBudget + row.eligibleNewBudget;

                        return (
                          <tr key={`${row.dealerName}__${row.state}`} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                            <td className="dash-td"><span className="dash-state-tag">{row.state}</span></td>
                            <td className="dash-td"><span className="dash-dealer-name">{row.dealerName}</span></td>
                            <td className="dash-td dash-td--right">{Math.round(row.monthTarget).toLocaleString("en-IN")}</td>
                            <td className="dash-td">
                              <span className={`dash-cat-tag dash-cat-tag--${isNon ? "non" : "eligible"}`}>
                                {categoryBased}
                              </span>
                            </td>
                            <td className="dash-td dash-td--category">{category}</td>
                            <td className="dash-td dash-td--right">{row.activities}</td>
                            <td className="dash-td dash-td--right">{Math.round(row.retailTarget).toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--mono">
                              {btlBudget > 0 ? inr(btlBudget) : <Dash />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, accent }: {
  icon: string; label: string; value: string; sub: string;
  accent: "blue" | "amber" | "green" | "purple";
}) {
  return (
    <div className={`dash-kpi-card dash-kpi-card--${accent}`}>
      <div className="dash-kpi-icon">{icon}</div>
      <div className="dash-kpi-body">
        <div className="dash-kpi-label">{label}</div>
        <div className="dash-kpi-value">{value}</div>
        <div className="dash-kpi-sub">{sub}</div>
      </div>
    </div>
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

function MetaChip({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`dash-meta-chip${wide ? " dash-meta-chip--wide" : ""}`}>
      <span className="dash-meta-key">{label}</span>
      <span className="dash-meta-val">{value}</span>
    </div>
  );
}

function Dash() {
  return <span className="dash-muted">0</span>;
}
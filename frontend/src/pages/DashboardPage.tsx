// src/pages/DashboardPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import {
  fetchMyProposals,
  fetchProposals,
  type ProposalResponse,
} from "../services/proposalService";
import { fetchDealerStateCounts, type DealerStateCount } from "../services/dealerService";
import {
  downloadExcelReport,
  downloadPdfReport,
  type ReportFilters,
} from "../services/reportService";
import "./DashboardPage.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");

const inrCompact = (v: number): string => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};

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
  totalRetailTarget: number;
  totalLeadTarget:   number;
  avgCac:         number;
  avgCpl:         number;
  stateCount:     number;
  dealerCount:    number;
}

function computeStats(proposals: ProposalResponse[]): SummaryStats {
  const approved = proposals.filter((p) => p.status === "Approved");
  const pending  = proposals.filter((p) => p.status === "Pending");
  const cacList  = proposals.filter((p) => p.cac > 0).map((p) => p.cac);
  const cplList  = proposals.filter((p) => p.cpl > 0).map((p) => p.cpl);
  return {
    totalProposals: proposals.length,
    pendingCount:   pending.length,
    approvedCount:  approved.length,
    rejectedCount:  proposals.filter((p) => p.status === "Rejected").length,
    totalBudget:    proposals.reduce((s, p) => s + p.totalBudget, 0),
    approvedBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
    pendingBudget:  pending.reduce((s, p)  => s + p.totalBudget, 0),
    totalRetailTarget: proposals.reduce((s, p) => s + p.totalRetailTarget, 0),
    totalLeadTarget:   proposals.reduce((s, p) => s + p.totalLeadTarget, 0),
    avgCac:         cacList.length > 0 ? cacList.reduce((a, b) => a + b, 0) / cacList.length : 0,
    avgCpl:         cplList.length > 0 ? cplList.reduce((a, b) => a + b, 0) / cplList.length : 0,
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
  // BaplFinal dealer counts per state (eligible old / new / non-eligible)
  const [baplCounts,  setBaplCounts]  = useState<DealerStateCount[]>([]);

  // ── Download state ────────────────────────────────────────────────────────
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);
  const [dlError,     setDlError]     = useState<string | null>(null);

  // ── Shared filters ────────────────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("All");
  const [stateFilter,  setStateFilter]  = useState("All");
  const [monthFilter,  setMonthFilter]  = useState("All");

  // ── Single shared search ──────────────────────────────────────────────────
  const [sharedSearch, setSharedSearch] = useState("");

  useEffect(() => {
    if (loading) return;
    setLoadingData(true);
    const loader = isAdmin ? fetchProposals(instance) : fetchMyProposals(instance);
    // Fetch proposals and BaplFinal state counts in parallel
    Promise.all([
      loader,
      fetchDealerStateCounts(instance).catch(() => [] as DealerStateCount[]),
    ])
      .then(([props, counts]) => {
        setProposals(props);
        setBaplCounts(counts);
      })
      .catch((e) => setDataError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoadingData(false));
  }, [loading, instance, isAdmin]);

  const stats = useMemo(() => computeStats(proposals), [proposals]);

  const states = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.state))).sort()],
    [proposals],
  );
  const months = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.month)))],
    [proposals],
  );

  const handleKpiClick = (filter: ActiveFilter) =>
    setActiveFilter((prev) => (prev === filter ? "All" : filter));

  // ── Base filtered proposals ───────────────────────────────────────────────
  const baseFiltered = useMemo(() =>
    proposals.filter((p) => {
      if (activeFilter !== "All" && p.status !== activeFilter) return false;
      if (stateFilter  !== "All" && p.state  !== stateFilter)  return false;
      if (monthFilter  !== "All" && p.month  !== monthFilter)   return false;
      return true;
    }),
  [proposals, activeFilter, stateFilter, monthFilter]);

  // ── Text-search filtered ──────────────────────────────────────────────────
  const searchFiltered = useMemo(() => {
    const q = sharedSearch.toLowerCase().trim();
    if (!q) return baseFiltered;
    return baseFiltered.filter((p) =>
      [p.state, p.dealerName, p.rsmName, p.location, p.month]
        .join(" ").toLowerCase().includes(q)
    );
  }, [baseFiltered, sharedSearch]);

  // ── Build report filters matching current dashboard filters ───────────────
  const currentReportFilters = useMemo((): ReportFilters => ({
    period: "monthly",
    state:  stateFilter  !== "All" ? stateFilter  : undefined,
    // month filter maps to period — pass as custom range if specific month selected
  }), [stateFilter]);

  // ── Download handlers — pre-filled with current filters ───────────────────
  const handleDownload = async (type: "excel" | "pdf") => {
    setDownloading(type);
    setDlError(null);
    try {
      if (type === "excel") await downloadExcelReport(currentReportFilters, instance);
      else                  await downloadPdfReport(currentReportFilters, instance);
    } catch (e) {
      setDlError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };

  // ── State-wise breakdown ──────────────────────────────────────────────────
  const stateBreakdown = useMemo(() => {
    interface StateRow {
      oldDealers: Set<string>; oldRetail: number; oldLead: number; oldBudget: number;
      newDealers: Set<string>; newRetail: number; newLead: number; newBudget: number;
      nonDealers: Set<string>; nonRetail: number; nonLead: number; nonBudget: number;
      pending: number; approved: number; rejected: number;
      remarks: string;
    }
    const map: Record<string, StateRow> = {};
    const ensure = (state: string) => {
      if (!map[state]) map[state] = {
        oldDealers: new Set(), oldRetail: 0, oldLead: 0, oldBudget: 0,
        newDealers: new Set(), newRetail: 0, newLead: 0, newBudget: 0,
        nonDealers: new Set(), nonRetail: 0, nonLead: 0, nonBudget: 0,
        pending: 0, approved: 0, rejected: 0, remarks: "",
      };
    };

    for (const p of searchFiltered) {
      ensure(p.state);
      const r  = map[p.state];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      if (el.includes("not") || el.includes("non")) {
        r.nonDealers.add(p.dealerName);
        r.nonRetail += p.totalRetailTarget;
        r.nonLead   += p.totalLeadTarget;
        r.nonBudget += p.totalBudget;
      } else if (ty === "new") {
        r.newDealers.add(p.dealerName);
        r.newRetail += p.totalRetailTarget;
        r.newLead   += p.totalLeadTarget;
        r.newBudget += p.totalBudget;
      } else {
        r.oldDealers.add(p.dealerName);
        r.oldRetail += p.totalRetailTarget;
        r.oldLead   += p.totalLeadTarget;
        r.oldBudget += p.totalBudget;
      }
      if (p.status === "Pending")  r.pending++;
      if (p.status === "Approved") r.approved++;
      if (p.status === "Rejected") r.rejected++;
      if (p.remarks) r.remarks = p.remarks;
    }

    // Build a lookup for BaplFinal counts by state name
    const baplByState = Object.fromEntries(
      baplCounts.map(c => [c.state.toLowerCase(), c])
    );

    // Also add states that exist in BaplFinal but have NO proposals yet
    for (const bc of baplCounts) {
      const key = bc.state;
      if (!map[key]) {
        map[key] = {
          oldDealers: new Set(), oldRetail: 0, oldLead: 0, oldBudget: 0,
          newDealers: new Set(), newRetail: 0, newLead: 0, newBudget: 0,
          nonDealers: new Set(), nonRetail: 0, nonLead: 0, nonBudget: 0,
          pending: 0, approved: 0, rejected: 0, remarks: "",
        };
      }
    }

    return Object.entries(map).map(([state, d]) => {
      // Merge BaplFinal non-eligible count (actual DB count, not just from proposals)
      const bapl = baplByState[state.toLowerCase()];
      // Use the HIGHER of: proposal-derived count OR BaplFinal count
      const nonCountFromBapl = bapl?.nonEligible ?? 0;
      const nonCountFinal    = Math.max(d.nonDealers.size, nonCountFromBapl);
      // For old/new eligible - use BaplFinal if larger (covers dealers who haven't submitted yet)
      const oldCountFinal    = Math.max(d.oldDealers.size, bapl?.eligibleOld ?? 0);
      const newCountFinal    = Math.max(d.newDealers.size, bapl?.eligibleNew ?? 0);

      const totalDealers = oldCountFinal + newCountFinal + nonCountFinal;
      const totalBudget  = d.oldBudget + d.newBudget;
      const totalRetail  = d.oldRetail + d.newRetail + d.nonRetail;
      const totalLead    = d.oldLead + d.newLead + d.nonLead;
      return {
        state,
        oldRetail: d.oldRetail, oldCount: oldCountFinal, oldBudget: d.oldBudget,
        oldCac: d.oldRetail > 0 ? d.oldBudget / d.oldRetail : 0,
        newRetail: d.newRetail, newCount: newCountFinal, newBudget: d.newBudget,
        newCac: d.newRetail > 0 ? d.newBudget / d.newRetail : 0,
        nonRetail: d.nonRetail, nonCount: nonCountFinal, nonBudget: d.nonBudget,
        nonCac: d.nonRetail > 0 ? d.nonBudget / d.nonRetail : 0,
        totalDealers, totalBudget, totalRetail, totalLead,
        overallCac: totalRetail > 0 ? totalBudget / totalRetail : 0,
        overallCpl: totalLead   > 0 ? totalBudget / totalLead   : 0,
        pending: d.pending, approved: d.approved, rejected: d.rejected,
        remarks: d.remarks,
        // BaplFinal raw counts for tooltip
        baplEligibleOld: bapl?.eligibleOld ?? 0,
        baplEligibleNew: bapl?.eligibleNew ?? 0,
        baplNonEligible: nonCountFromBapl,
      };
    }).sort((a, b) => a.state.localeCompare(b.state));
  }, [searchFiltered, baplCounts]);

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
      totalLead:    stateBreakdown.reduce((s, r) => s + r.totalLead,    0),
    };
  }, [stateBreakdown]);

  // ── Dealer-wise list ──────────────────────────────────────────────────────
  const dealerRows = useMemo(() => {
    const map: Record<string, {
      state: string; dealerName: string; monthTarget: number;
      eligibleOldBudget: number; eligibleNewBudget: number; nonBudget: number;
      retailTarget: number; leadTarget: number; activities: number;
      eligibility: string; type: string;
      pending: number; approved: number; rejected: number;
      activityNames: Set<string>;
    }> = {};

    for (const p of searchFiltered) {
      const key = `${p.dealerName}__${p.state}`;
      if (!map[key]) map[key] = {
        state: p.state, dealerName: p.dealerName,
        monthTarget: 0, eligibleOldBudget: 0, eligibleNewBudget: 0, nonBudget: 0,
        retailTarget: 0, leadTarget: 0, activities: 0,
        eligibility: p.eligibility ?? "", type: p.type ?? "",
        pending: 0, approved: 0, rejected: 0,
        activityNames: new Set<string>(),   // collect unique activity names
      };
      const d  = map[key];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      d.monthTarget  += p.totalRetailTarget;
      d.retailTarget += p.totalRetailTarget;
      d.leadTarget   += p.totalLeadTarget;
      d.activities   += p.activities.length;
      // Collect actual activity type names
      p.activities.forEach(a => {
        if (a.activityType) (d.activityNames as Set<string>).add(a.activityType);
      });
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
  }, [searchFiltered]);

  const searchResultLabel = useMemo(() => {
    if (!sharedSearch.trim()) return null;
    return `${stateBreakdown.length} state${stateBreakdown.length !== 1 ? "s" : ""} · ${dealerRows.length} dealer${dealerRows.length !== 1 ? "s" : ""} matching "${sharedSearch}"`;
  }, [sharedSearch, stateBreakdown.length, dealerRows.length]);

  const activeFilterCount = [
    activeFilter !== "All",
    stateFilter  !== "All",
    monthFilter  !== "All",
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setActiveFilter("All");
    setStateFilter("All");
    setMonthFilter("All");
    setSharedSearch("");
  };

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
        <button className="dash-action-card dash-action-card--report" onClick={() => navigate("/reports")}>
          <span className="dash-action-icon">📊</span>
          <div>
            <div className="dash-action-title">Download Report</div>
            <div className="dash-action-desc">Excel &amp; PDF · by period, state, dealer</div>
          </div>
        </button>
        {user?.role === "Admin" && (
          <button className="dash-action-card" onClick={() => navigate("/admin/users")}>
            <span className="dash-action-icon">👥</span>
            <div>
              <div className="dash-action-title">Manage Users &amp; Activity</div>
              <div className="dash-action-desc">Add Activity, edit roles and status</div>
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
          {/* ══ KPI Cards ═══════════════════════════════════════════════════ */}
          <div className="dash-kpi-grid">
            <KpiCard icon="📄" label="Total Proposals"
              value={String(stats.totalProposals)}
              sub={`${stats.dealerCount} dealers · ${stats.stateCount} states`}
              accent="blue" active={activeFilter === "All"}
              onClick={() => handleKpiClick("All")} />
            <KpiCard icon="⏳" label="Pending Approval"
              value={String(stats.pendingCount)}
              sub={`Budget: ${inrCompact(stats.pendingBudget)}`}
              accent="amber" active={activeFilter === "Pending"}
              badge={stats.pendingCount > 0 ? "action needed" : undefined}
              onClick={() => { handleKpiClick("Pending"); if (isAdmin) navigate("/approver"); }} />
            <KpiCard icon="✅" label="Approved"
              value={String(stats.approvedCount)}
              sub={`Budget: ${inrCompact(stats.approvedBudget)}`}
              accent="green" active={activeFilter === "Approved"}
              onClick={() => handleKpiClick("Approved")} />
            <KpiCard icon="❌" label="Rejected"
              value={String(stats.rejectedCount)}
              sub={`${Math.round(stats.totalRetailTarget).toLocaleString("en-IN")} total units`}
              accent="red" active={activeFilter === "Rejected"}
              onClick={() => handleKpiClick("Rejected")} />
            <KpiCard icon="💰" label="Total Budget"
              value={inrCompact(stats.totalBudget)}
              sub={`Avg CAC ₹${Math.round(stats.avgCac).toLocaleString("en-IN")}`}
              accent="purple"
              onClick={clearAllFilters} />
            <KpiCard icon="📊" label="Avg CPL"
              value={`₹${Math.round(stats.avgCpl).toLocaleString("en-IN")}`}
              sub={`${stats.totalLeadTarget.toLocaleString("en-IN")} total leads`}
              accent="blue"
              onClick={clearAllFilters} />
          </div>

          {/* ══ Global filter bar ═══════════════════════════════════════════ */}
          <div className="dash-global-filter-bar">
            <div className="dash-global-filter-left">
              <span className="dash-filter-label">Filters:</span>
              <select className="dash-filter-select dash-filter-select--inline"
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
                {["All","Pending","Approved","Rejected"].map((s) => (
                  <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
                ))}
              </select>
              <select className="dash-filter-select dash-filter-select--inline"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}>
                {states.map((s) => (
                  <option key={s} value={s}>{s === "All" ? "All States" : s}</option>
                ))}
              </select>
              <select className="dash-filter-select dash-filter-select--inline"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>{m === "All" ? "All Months" : m}</option>
                ))}
              </select>
              {activeFilterCount > 0 && (
                <span className="dash-active-filter-count">{activeFilterCount} active</span>
              )}
            </div>
            {(activeFilterCount > 0 || sharedSearch) && (
              <button className="dash-filter-clear-all" onClick={clearAllFilters}>
                ✕ Clear all
              </button>
            )}
          </div>

          {/* ── Active filter pills ── */}
          {activeFilterCount > 0 && (
            <div className="dash-active-pills">
              {activeFilter !== "All" && (
                <span className={`dash-pill dash-pill--${activeFilter.toLowerCase()}`}>
                  Status: {activeFilter}
                  <button onClick={() => setActiveFilter("All")}>✕</button>
                </span>
              )}
              {stateFilter !== "All" && (
                <span className="dash-pill dash-pill--state">
                  State: {stateFilter}
                  <button onClick={() => setStateFilter("All")}>✕</button>
                </span>
              )}
              {monthFilter !== "All" && (
                <span className="dash-pill dash-pill--month">
                  Month: {monthFilter}
                  <button onClick={() => setMonthFilter("All")}>✕</button>
                </span>
              )}
            </div>
          )}

          {/* ══ Shared Search Bar ════════════════════════════════════════════ */}
          <div className="dash-shared-search-bar">
            <div className="dash-search-wrap dash-search-wrap--shared">
              <span className="dash-search-icon">🔍</span>
              <input
                className="dash-search-input"
                type="search"
                placeholder="Search state, dealer, RSM, city… filters both tables"
                value={sharedSearch}
                onChange={(e) => setSharedSearch(e.target.value)}
              />
              {sharedSearch && (
                <button className="dash-search-clear" onClick={() => setSharedSearch("")}>✕</button>
              )}
            </div>
            {searchResultLabel && (
              <span className="dash-search-results-info">{searchResultLabel}</span>
            )}
          </div>

          {/* ── Download error ── */}
          {dlError && (
            <div className="dash-dl-error">
              ⚠ {dlError}
              <button onClick={() => setDlError(null)}>✕</button>
            </div>
          )}

          {/* ══ State-wise Summary ══════════════════════════════════════════ */}
          {stateBreakdown.length > 0 && (
            <section className="dash-section">
              <div className="dash-section-head">
                <h2 className="dash-section-title">
                  State-wise Summary
                  <span className="dash-count-chip">{stateBreakdown.length}</span>
                </h2>
                {/* ── Inline download buttons ─────────────────────────────── */}
                <div className="dash-section-dl-group">
                  {stateFilter !== "All" && (
                    <span className="dash-section-filter-hint">
                      {stateFilter}
                      {monthFilter !== "All" ? ` · ${monthFilter}` : ""}
                    </span>
                  )}
                  <button
                    className="dash-dl-btn dash-dl-btn--excel"
                    onClick={() => handleDownload("excel")}
                    disabled={downloading !== null}
                    title="Download Excel with current filters">
                    {downloading === "excel"
                      ? <><span className="dash-dl-spinner"/>Generating…</>
                      : <>⬇ Excel</>}
                  </button>
                  <button
                    className="dash-dl-btn dash-dl-btn--pdf"
                    onClick={() => handleDownload("pdf")}
                    disabled={downloading !== null}
                    title="Download PDF with current filters">
                    {downloading === "pdf"
                      ? <><span className="dash-dl-spinner"/>Generating…</>
                      : <>⬇ PDF</>}
                  </button>
                  <button
                    className="dash-dl-btn dash-dl-btn--full"
                    onClick={() => navigate("/reports")}
                    title="Open full report page with more options">
                    Full Report ↗
                  </button>
                </div>
              </div>

              <div className="dash-table-wrap dash-table-wrap--wide">
                <table className="dash-table dash-table--summary">
                  <thead>
                    <tr className="dash-thead-group">
                      <th className="dash-th dash-th--state" rowSpan={2}>States</th>
                      <th className="dash-th dash-th--group dash-th--old" colSpan={4}>Eligible Old Dealer</th>
                      <th className="dash-th dash-th--group dash-th--new" colSpan={4}>Eligible New Dealer</th>
                      <th className="dash-th dash-th--group dash-th--non" colSpan={4}>Non Eligible Dealer</th>
                      <th className="dash-th dash-th--group dash-th--tot" colSpan={6}>Totals</th>
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
                      <th className="dash-th dash-th--tot dash-th--right">Total Lead</th>
                      <th className="dash-th dash-th--tot dash-th--right">Overall CAC</th>
                      <th className="dash-th dash-th--tot dash-th--right">Overall CPL</th>
                      <th className="dash-th dash-th--right" style={{ background:"#f59e0b22", color:"#92400e" }}>Pending</th>
                      <th className="dash-th dash-th--right" style={{ background:"#16a34a22", color:"#14532d" }}>Approved</th>
                      <th className="dash-th dash-th--right" style={{ background:"#dc262622", color:"#7f1d1d" }}>Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stateBreakdown.map((row, i) => (
                      <tr key={row.state} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                        <td className="dash-td">
                          <span className={`dash-state-tag${sharedSearch && row.state.toLowerCase().includes(sharedSearch.toLowerCase()) ? " dash-state-tag--match" : ""}`}>
                            {row.state}
                          </span>
                        </td>
                        <td className="dash-td dash-td--right">{row.oldRetail > 0 ? row.oldRetail : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.oldCount  > 0 ? row.oldCount  : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.oldBudget > 0 ? inr(row.oldBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.oldCac > 0 ? `₹${Math.round(row.oldCac).toLocaleString("en-IN")}` : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.newRetail > 0 ? row.newRetail : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.newCount  > 0 ? row.newCount  : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.newBudget > 0 ? inr(row.newBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.newCac > 0 ? `₹${Math.round(row.newCac).toLocaleString("en-IN")}` : <Dash />}</td>
                        <td className="dash-td dash-td--right">{row.nonRetail > 0 ? row.nonRetail : <Dash />}</td>
                        <td className="dash-td dash-td--right"
                          title={row.baplNonEligible > 0
                            ? `${row.baplNonEligible} non-eligible dealers from BaplFinal DB`
                            : "Count from submitted proposals"}>
                          {row.nonCount > 0
                            ? <span className="dash-non-count">{row.nonCount}</span>
                            : <Dash />}
                        </td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.nonBudget > 0 ? inr(row.nonBudget) : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{row.nonCac > 0 ? `₹${Math.round(row.nonCac).toLocaleString("en-IN")}` : <Dash />}</td>
                        <td className="dash-td dash-td--right dash-td--bold">{row.totalDealers}</td>
                        <td className="dash-td dash-td--right dash-td--mono dash-td--bold">{inr(row.totalBudget)}</td>
                        <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalRetail).toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalLead).toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                          {row.overallCac > 0 ? `₹${Math.round(row.overallCac).toLocaleString("en-IN")}` : <Dash />}
                        </td>
                        <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                          {row.overallCpl > 0 ? `₹${Math.round(row.overallCpl).toLocaleString("en-IN")}` : <Dash />}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.pending  > 0 ? <span className="dash-badge dash-badge--pending">{row.pending}</span>   : <span className="dash-muted">—</span>}
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
                        <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.totalLead.toLocaleString("en-IN")}</td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                          {stateGrandTotal.totalRetail > 0 ? `₹${Math.round(stateGrandTotal.totalBudget / stateGrandTotal.totalRetail).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="dash-td dash-td--right dash-td--grand dash-td--mono">
                          {stateGrandTotal.totalLead > 0 ? `₹${Math.round(stateGrandTotal.totalBudget / stateGrandTotal.totalLead).toLocaleString("en-IN")}` : "—"}
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
              </h2>
              <div className="dash-section-dl-group">
                <button
                  className="dash-dl-btn dash-dl-btn--excel"
                  onClick={() => handleDownload("excel")}
                  disabled={downloading !== null}
                  title="Download Excel">
                  {downloading === "excel" ? <><span className="dash-dl-spinner"/>Generating…</> : <>⬇ Excel</>}
                </button>
                <button
                  className="dash-dl-btn dash-dl-btn--pdf"
                  onClick={() => handleDownload("pdf")}
                  disabled={downloading !== null}
                  title="Download PDF">
                  {downloading === "pdf" ? <><span className="dash-dl-spinner"/>Generating…</> : <>⬇ PDF</>}
                </button>
              </div>
            </div>

            {dealerRows.length === 0 ? (
              <div className="dash-no-results">
                <span>🔍</span>
                <p>No dealers match your filters.</p>
                <button className="dash-filter-clear-all" onClick={clearAllFilters}>Clear all filters</button>
              </div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table dash-table--dealer">
                  <thead>
                    <tr>
                      <th className="dash-th" style={{ textAlign:"left" }}>State</th>
                      <th className="dash-th" style={{ textAlign:"left" }}>Dealer Name</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Month Target</th>
                      <th className="dash-th" style={{ textAlign:"left" }}>Category (Mar–May)</th>
                      <th className="dash-th" style={{ textAlign:"left" }}>BTL Category</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Activities</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Retail Target</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Lead Target</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Budget for BTL (₹)</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Pending</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Approved</th>
                      <th className="dash-th" style={{ textAlign:"center" }}>Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealerRows.map((row, i) => {
                      const el      = (row.eligibility ?? "").toLowerCase();
                      const isNon   = el.includes("not") || el.includes("non");
                      const isNew   = row.type?.toLowerCase() === "new";
                      const catBase = isNon ? "Non Eligible" : "BTL Budget Eligible";
                      const cat     = isNon
                        ? "Dealers Non Eligible for BTL"
                        : isNew
                        ? "Budget taken for BTL (New)"
                        : "Budget taken for BTL (Old+New+Special Approval)";
                      const btlBudget    = row.eligibleOldBudget + row.eligibleNewBudget;
                      const q            = sharedSearch.toLowerCase().trim();
                      const dealerMatch  = q && row.dealerName.toLowerCase().includes(q);
                      return (
                        <tr key={`${row.dealerName}__${row.state}`}
                          className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                          <td className="dash-td"><span className="dash-state-tag">{row.state}</span></td>
                          <td className="dash-td">
                            <span className={`dash-dealer-name${dealerMatch ? " dash-dealer-name--match" : ""}`}>
                              {row.dealerName}
                            </span>
                          </td>
                          <td className="dash-td" style={{ textAlign:"center" }}>{Math.round(row.monthTarget).toLocaleString("en-IN")}</td>
                          <td className="dash-td">
                            <span className={`dash-cat-tag dash-cat-tag--${isNon ? "non" : "eligible"}`}>{catBase}</span>
                          </td>
                          <td className="dash-td dash-td--category">
                            {/* Show actual activity names if available, else fallback text */}
                            {row.activityNames && row.activityNames.size > 0
                              ? Array.from(row.activityNames).join(", ")
                              : cat}
                          </td>
                          <td className="dash-td" style={{ textAlign:"center" }}>{row.activities}</td>
                          <td className="dash-td" style={{ textAlign:"center" }}>{Math.round(row.retailTarget).toLocaleString("en-IN")}</td>
                          <td className="dash-td" style={{ textAlign:"center" }}>{Math.round(row.leadTarget).toLocaleString("en-IN")}</td>
                          <td className="dash-td dash-td--mono" style={{ textAlign:"center" }}>
                            {btlBudget > 0 ? inr(btlBudget) : <Dash />}
                          </td>
                          <td className="dash-td" style={{ textAlign:"center" }}>
                            {row.pending  > 0 ? <span className="dash-badge dash-badge--pending">{row.pending}</span>   : <span className="dash-muted">—</span>}
                          </td>
                          <td className="dash-td" style={{ textAlign:"center" }}>
                            {row.approved > 0 ? <span className="dash-badge dash-badge--approved">{row.approved}</span> : <span className="dash-muted">—</span>}
                          </td>
                          <td className="dash-td" style={{ textAlign:"center" }}>
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
    <button type="button"
      className={[
        "dash-kpi-card", "dash-kpi-card--clickable",
        `dash-kpi-card--${accent}`,
        active ? "dash-kpi-card--active" : "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}>
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

function Dash() {
  return <span className="dash-muted">0</span>;
}
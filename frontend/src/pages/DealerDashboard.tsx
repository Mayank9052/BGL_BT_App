// src/pages/DealerDashboard.tsx
// Mirrors DashboardPage.tsx — same KPI cards, state/dealer tables, filters, year filter.
// Dealer-specific: uses JWT auth, shows only their own proposals, adds Post-Activity + Revision edit.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyDealerProposals, type ProposalResponse } from "../services/proposalService";
import "./DealerDashboard.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const inrCompact = (v: number): string => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—";

type ActiveFilter = "All" | "Pending" | "Approved" | "Rejected" | "NeedsRevision";
interface SummaryStats {
  totalProposals: number; pendingCount: number; approvedCount: number;
  rejectedCount: number; needsRevision: number;
  totalBudget: number; approvedBudget: number; pendingBudget: number;
  totalRetailTarget: number; totalLeadTarget: number;
  avgCac: number; avgCpl: number;
}
function computeStats(proposals: ProposalResponse[]): SummaryStats {
  const approved = proposals.filter(p => p.status === "Approved");
  const pending  = proposals.filter(p => p.status === "Pending");
  const cacList  = proposals.filter(p => p.cac > 0).map(p => p.cac);
  const cplList  = proposals.filter(p => p.cpl > 0).map(p => p.cpl);
  return {
    totalProposals: proposals.length,
    pendingCount:   pending.length,
    approvedCount:  approved.length,
    rejectedCount:  proposals.filter(p => p.status === "Rejected").length,
    needsRevision:  proposals.filter(p => p.status === "NeedsRevision").length,
    totalBudget:    proposals.reduce((s, p) => s + p.totalBudget, 0),
    approvedBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
    pendingBudget:  pending.reduce((s, p) => s + p.totalBudget, 0),
    totalRetailTarget: proposals.reduce((s, p) => s + p.totalRetailTarget, 0),
    totalLeadTarget:   proposals.reduce((s, p) => s + p.totalLeadTarget, 0),
    avgCac: cacList.length > 0 ? cacList.reduce((a, b) => a + b, 0) / cacList.length : 0,
    avgCpl: cplList.length > 0 ? cplList.reduce((a, b) => a + b, 0) / cplList.length : 0,
  };
}

interface DailyEntry {
  date: string; enquiryPlanned: number; enquiryActual: number;
  testDrivePlanned: number; testDriveActual: number;
  bookingActual: number; retailActual: number; leadsPunched: number;
}
function buildDailyEntries(start: string, end: string): DailyEntry[] {
  const entries: DailyEntry[] = [];
  const s = new Date(start), e = new Date(end), today = new Date();
  const cap = e < today ? e : today;
  for (const d = new Date(s); d <= cap; d.setDate(d.getDate() + 1)) {
    entries.push({ date: d.toISOString().split("T")[0],
      enquiryPlanned:0, enquiryActual:0, testDrivePlanned:0, testDriveActual:0,
      bookingActual:0, retailActual:0, leadsPunched:0 });
  }
  return entries;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Pending:       { bg: "#fef3c7", color: "#92400e" },
  Approved:      { bg: "#dcfce7", color: "#166534" },
  Rejected:      { bg: "#fee2e2", color: "#991b1b" },
  NeedsRevision: { bg: "#fef9c3", color: "#713f12" },
};
const StatusPill = ({ status }: { status: string }) => {
  const c = STATUS_COLORS[status] ?? { bg: "#f1f5f9", color: "#374151" };
  const labels: Record<string, string> = { NeedsRevision: "↩ Needs Revision" };
  return (
    <span style={{ background: c.bg, color: c.color, borderRadius: 12,
      padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {labels[status] ?? status}
    </span>
  );
};

// ── KPI Card ─────────────────────────────────────────────────────────────────
const KpiCard = ({ label, value, sub, color, active, onClick, hint }: {
  label: string; value: string; sub?: string; color: string;
  active?: boolean; onClick?: () => void; hint?: string;
}) => (
  <div className="dash-kpi-card" onClick={onClick}
    style={{ borderTop: `4px solid ${color}`, cursor: onClick ? "pointer" : "default",
      outline: active ? `2px solid ${color}` : "none", background: active ? "#f0f9ff" : "#fff" }}
    title={hint}>
    <div className="dash-kpi-label">{label}</div>
    <div className="dash-kpi-value" style={{ color }}>{value}</div>
    {sub && <div className="dash-kpi-sub">{sub}</div>}
  </div>
);

// ── Post-Activity state per activity ─────────────────────────────────────────
interface PostActState {
  actualStartDate: string;
  actualEndDate: string;
  entries: DailyEntry[];
  saving: boolean;
  saved: boolean;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

// ═══════════════════════════════════════════════════════════════════════════════
export default function DealerDashboard() {
  const navigate = useNavigate();

  const [proposals,    setProposals]    = useState<ProposalResponse[]>([]);
  const [loadingData,  setLoadingData]  = useState(true);
  const [dataError,    setDataError]    = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("All");
  const [monthFilter,  setMonthFilter]  = useState("All");
  const [yearFilter,   setYearFilter]   = useState("All");
  const [sharedSearch, setSharedSearch] = useState("");
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Detail modal ──────────────────────────────────────────────────────────
  const [selected,     setSelected]     = useState<ProposalResponse | null>(null);
  const [openPostAct,  setOpenPostAct]  = useState<Record<string, boolean>>({});
  const [postAct,      setPostAct]      = useState<Record<string, PostActState>>({});

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load proposals ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingData(true);
    fetchMyDealerProposals()
      .then(setProposals)
      .catch(e => setDataError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoadingData(false));
  }, []);

  // ── Derived filter options ────────────────────────────────────────────────
  const months = useMemo(() =>
    ["All", ...Array.from(new Set(proposals.map(p => p.month))).sort()], [proposals]);
  const years = useMemo(() =>
    ["All", ...Array.from(new Set(proposals.map(p => (p as any).year).filter(Boolean))).sort()], [proposals]);

  const handleKpiClick = (f: ActiveFilter) =>
    setActiveFilter(prev => prev === f ? "All" : f);

  // ── Filter pipeline ───────────────────────────────────────────────────────
  const baseFiltered = useMemo(() => proposals.filter(p => {
    if (activeFilter !== "All" && p.status !== activeFilter) return false;
    if (monthFilter  !== "All" && p.month  !== monthFilter)  return false;
    if (yearFilter   !== "All" && (p as any).year !== yearFilter) return false;
    return true;
  }), [proposals, activeFilter, monthFilter, yearFilter]);

  const hasActiveFilter = activeFilter !== "All" || monthFilter !== "All" || yearFilter !== "All";

  const stats = useMemo(
    () => computeStats(hasActiveFilter ? baseFiltered : proposals),
    [baseFiltered, proposals, hasActiveFilter]);

  const searchFiltered = useMemo(() => {
    const q = sharedSearch.toLowerCase().trim();
    if (!q) return baseFiltered;
    return baseFiltered.filter(p =>
      [p.dealerName, p.month, p.location, p.status, p.tokenNumber]
        .join(" ").toLowerCase().includes(q));
  }, [baseFiltered, sharedSearch]);

  const clearAllFilters = () => {
    setActiveFilter("All"); setMonthFilter("All"); setYearFilter("All"); setSharedSearch("");
  };

  // ── Activity breakdown per proposal (for table) ───────────────────────────
  const proposalRows = useMemo(() =>
    searchFiltered.slice().sort((a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()),
    [searchFiltered]);

  // ── Activity-wise summary ─────────────────────────────────────────────────
  const activitySummary = useMemo(() => {
    const map: Record<string, { count: number; budget: number; retail: number; lead: number }> = {};
    for (const p of searchFiltered) {
      for (const a of p.activities) {
        const key = a.activityType ?? "—";
        if (!map[key]) map[key] = { count: 0, budget: 0, retail: 0, lead: 0 };
        map[key].count++;
        map[key].budget += a.budget ?? 0;
        map[key].retail += a.retailTarget ?? 0;
        map[key].lead   += a.leadTarget   ?? 0;
      }
    }
    return Object.entries(map).sort((a, b) => b[1].budget - a[1].budget);
  }, [searchFiltered]);

  // ── Post-Activity helpers ─────────────────────────────────────────────────
  const initPostAct = (activityId: string) => {
    if (postAct[activityId]) return;
    setPostAct(prev => ({
      ...prev,
      [activityId]: { actualStartDate: "", actualEndDate: "", entries: [], saving: false, saved: false },
    }));
  };
  const setPA = (actId: string, patch: Partial<PostActState>) =>
    setPostAct(prev => ({ ...prev, [actId]: { ...prev[actId], ...patch } }));

  const savePostActivity = async (proposalId: string, activityId: string) => {
    const pa = postAct[activityId];
    if (!pa?.actualStartDate || !pa?.actualEndDate) {
      showToast("Set both actual start and end dates first.", false); return;
    }
    setPA(activityId, { saving: true });
    try {
      const jwt = localStorage.getItem("bgauss_dealer_token");
      const payload = [{ activityId, actualStartDate: pa.actualStartDate,
        actualEndDate: pa.actualEndDate, mediaFileUrl: null, mediaFileName: null,
        mediaFileType: null, dailyData: pa.entries.length ? JSON.stringify(pa.entries) : null }];
      const resp = await fetch(`${API_BASE}/api/proposals/${proposalId}/actuals`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setPA(activityId, { saving: false, saved: true });
      showToast("Post-activity data saved.", true);
    } catch (e) {
      setPA(activityId, { saving: false });
      showToast(e instanceof Error ? e.message : "Save failed.", false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadingData) return (
    <div className="dash-loading">
      <div className="dash-spinner" />
      <p>Loading your proposals…</p>
    </div>
  );
  if (dataError) return (
    <div className="dash-error">
      <h3>Failed to load proposals</h3>
      <p>{dataError}</p>
      <button className="dash-retry-btn" onClick={() => window.location.reload()}>Retry</button>
    </div>
  );

  return (
    <div className="dash-root">
      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed",bottom:24,right:24,zIndex:9999,
          background: toast.ok ? "#166534" : "#991b1b",
          color:"#fff",borderRadius:10,padding:"12px 20px",
          fontSize:13,fontWeight:600,boxShadow:"0 4px 20px rgba(0,0,0,0.25)",
          display:"flex",alignItems:"center",gap:8 }}>
          {toast.ok ? "✓" : "✕"} {toast.msg}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="dash-header">
        <div>
          <h1 className="dash-title">My Proposals</h1>
          <p className="dash-subtitle">
            {proposals.length} proposal{proposals.length !== 1 ? "s" : ""} ·{" "}
            {proposals.filter(p => p.status === "Approved").length} approved ·{" "}
            {proposals.filter(p => p.status === "Pending").length} pending
            {proposals.filter(p => p.status === "NeedsRevision").length > 0 && (
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                {" "}· {proposals.filter(p => p.status === "NeedsRevision").length} need revision
              </span>
            )}
          </p>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <button className="dash-add-btn" onClick={() => navigate("/dealer-proposal")}>
            + New Proposal
          </button>
        </div>
      </div>

      {/* ── Needs Revision banner ──────────────────────────────────────────── */}
      {proposals.filter(p => p.status === "NeedsRevision").length > 0 && (
        <div style={{ background:"#fef9c3", border:"1px solid #fde68a",
          borderLeft:"4px solid #f59e0b", borderRadius:8,
          padding:"12px 18px", marginBottom:16, display:"flex",
          alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <span style={{ fontSize:22 }}>↩</span>
          <div>
            <div style={{ fontWeight:700, color:"#92400e", fontSize:13 }}>
              {proposals.filter(p => p.status === "NeedsRevision").length} proposal(s) sent back for revision
            </div>
            <div style={{ fontSize:12, color:"#78350f" }}>
              The checker has requested changes. Click ✏ Edit on each proposal below.
            </div>
          </div>
          <button onClick={() => setActiveFilter("NeedsRevision")}
            style={{ marginLeft:"auto", background:"#f59e0b", color:"#fff",
              border:"none", padding:"7px 16px", borderRadius:7,
              fontWeight:700, fontSize:12, cursor:"pointer" }}>
            View Revision Requests
          </button>
        </div>
      )}

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="dash-filter-bar" style={{ marginBottom:16 }}>
        {/* Status filter */}
        <select className="dash-filter-select" value={activeFilter}
          onChange={e => setActiveFilter(e.target.value as ActiveFilter)}>
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
          <option value="NeedsRevision">Needs Revision</option>
        </select>
        {/* Month filter */}
        <select className="dash-filter-select" value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}>
          {months.map(m => <option key={m} value={m}>{m === "All" ? "All Months" : m}</option>)}
        </select>
        {/* Year filter */}
        <select className="dash-filter-select" value={yearFilter}
          onChange={e => setYearFilter(e.target.value)}>
          {years.map(y => <option key={y} value={y}>{y === "All" ? "All Years" : y}</option>)}
        </select>
        {/* Search */}
        <div style={{ position:"relative", flex:"1 1 200px" }}>
          <input className="dash-search" value={sharedSearch}
            onChange={e => setSharedSearch(e.target.value)}
            placeholder="Search proposals…" />
          {sharedSearch && (
            <button onClick={() => setSharedSearch("")}
              style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                background:"none", border:"none", cursor:"pointer", color:"#94a3b8", fontSize:14 }}>✕</button>
          )}
        </div>
        {hasActiveFilter && (
          <button className="dash-clear-btn" onClick={clearAllFilters}>Clear all ✕</button>
        )}
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="dash-kpi-grid">
        <KpiCard label="Total Proposals" value={String(stats.totalProposals)}
          sub={inrCompact(stats.totalBudget) + " total budget"} color="#0a2540"
          active={activeFilter === "All"} onClick={() => handleKpiClick("All")} />
        <KpiCard label="⏳ Pending" value={String(stats.pendingCount)}
          sub={inrCompact(stats.pendingBudget)} color="#f59e0b"
          active={activeFilter === "Pending"} onClick={() => handleKpiClick("Pending")} />
        <KpiCard label="✓ Approved" value={String(stats.approvedCount)}
          sub={inrCompact(stats.approvedBudget)} color="#16a34a"
          active={activeFilter === "Approved"} onClick={() => handleKpiClick("Approved")} />
        <KpiCard label="✕ Rejected" value={String(stats.rejectedCount)}
          color="#dc2626" active={activeFilter === "Rejected"}
          onClick={() => handleKpiClick("Rejected")} />
        <KpiCard label="↩ Needs Revision" value={String(stats.needsRevision)}
          color="#f59e0b" active={activeFilter === "NeedsRevision"}
          onClick={() => handleKpiClick("NeedsRevision")}
          hint="Checker sent these back — edit and resubmit" />
        <KpiCard label="🎯 Retail Target" value={String(stats.totalRetailTarget)}
          sub={`${stats.totalLeadTarget} lead target`} color="#7c3aed" />
        <KpiCard label="₹ Total Budget" value={inrCompact(stats.totalBudget)}
          sub={`Avg CAC: ${inrCompact(stats.avgCac)}`} color="#0369a1" />
      </div>

      {hasActiveFilter && (
        <div className="dash-filter-hint">
          <strong>KPI counts filtered:</strong>
          {monthFilter !== "All" && <span>Month: <b>{monthFilter}</b></span>}
          {yearFilter  !== "All" && <span>Year: <b>{yearFilter}</b></span>}
          {activeFilter !== "All" && <span>Status: <b>{activeFilter}</b></span>}
        </div>
      )}

      {/* ── Proposals Table ─────────────────────────────────────────────────── */}
      <div className="dash-section">
        <div className="dash-section-head">
          <h2 className="dash-section-title" style={{ fontSize:16 }}>
            📋 My Proposals
            <span style={{ fontSize:12, fontWeight:400, color:"#64748b", marginLeft:10 }}>
              {searchFiltered.length} of {proposals.length}
            </span>
          </h2>
        </div>

        {proposalRows.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px", color:"#94a3b8" }}>
            <div style={{ fontSize:40, marginBottom:10 }}>📭</div>
            <div style={{ fontWeight:700, fontSize:15, color:"#0a2540", marginBottom:6 }}>
              {proposals.length === 0 ? "No proposals yet" : "No proposals match your filters"}
            </div>
            <div style={{ fontSize:13 }}>
              {proposals.length === 0
                ? "Click '+ New Proposal' to create your first BTL activity proposal."
                : "Try clearing filters above."}
            </div>
            {proposals.length === 0 && (
              <button className="dash-add-btn" style={{ marginTop:16 }}
                onClick={() => navigate("/dealer-proposal")}>
                + Create Proposal
              </button>
            )}
          </div>
        ) : (
          <div className="dash-table-wrap" style={{ overflowX:"auto" }}>
            <table className="dash-table">
              <thead><tr>
                <th>Token</th>
                <th>Month</th>
                <th>Year</th>
                <th>Activities</th>
                <th>Budget</th>
                <th>Retail Target</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Action</th>
              </tr></thead>
              <tbody>
                {proposalRows.map(p => (
                  <tr key={p.id} style={{ cursor:"pointer",
                    background: p.status === "NeedsRevision" ? "#fffbeb" : undefined }}
                    onClick={() => setSelected(p)}>
                    <td style={{ fontFamily:"monospace", fontSize:11, color:"#1e3a5f", fontWeight:600 }}>
                      {p.tokenNumber ?? "—"}
                    </td>
                    <td>{p.month}</td>
                    <td>{(p as any).year ?? "—"}</td>
                    <td style={{ fontSize:11 }}>
                      {p.activities.slice(0, 2).map(a => a.activityType).join(", ")}
                      {p.activities.length > 2 && <span style={{ color:"#94a3b8" }}> +{p.activities.length - 2}</span>}
                    </td>
                    <td style={{ fontWeight:600 }}>{inrCompact(p.totalBudget)}</td>
                    <td>{p.totalRetailTarget}</td>
                    <td>
                      <StatusPill status={p.status} />
                      {p.status === "NeedsRevision" && (
                        <button onClick={e => { e.stopPropagation(); navigate(`/dealer-proposal?edit=${p.id}`); }}
                          style={{ display:"block", marginTop:4, background:"#f59e0b", color:"#fff",
                            border:"none", borderRadius:5, padding:"2px 8px",
                            fontSize:10, fontWeight:700, cursor:"pointer" }}>
                          ✏ Edit
                        </button>
                      )}
                    </td>
                    <td style={{ fontSize:11, color:"#6b7280" }}>
                      {p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN", { day:"2-digit", month:"short" }) : "—"}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button onClick={() => setSelected(p)}
                        style={{ background:"#eff6ff", color:"#1e40af", border:"1px solid #bfdbfe",
                          borderRadius:6, padding:"4px 10px", fontSize:11, fontWeight:600, cursor:"pointer" }}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Activity-wise Summary ───────────────────────────────────────────── */}
      {activitySummary.length > 0 && (
        <div className="dash-section" style={{ marginTop:20 }}>
          <div className="dash-section-head">
            <h2 className="dash-section-title" style={{ fontSize:16 }}>📊 Activity Breakdown</h2>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table className="dash-table">
              <thead><tr>
                <th>Activity Type</th>
                <th style={{ textAlign:"center" }}>Count</th>
                <th style={{ textAlign:"right" }}>Budget</th>
                <th style={{ textAlign:"center" }}>Retail Target</th>
                <th style={{ textAlign:"center" }}>Lead Target</th>
                <th style={{ textAlign:"right" }}>CAC</th>
              </tr></thead>
              <tbody>
                {activitySummary.map(([name, d]) => (
                  <tr key={name}>
                    <td style={{ fontWeight:600, color:"#0a2540" }}>{name}</td>
                    <td style={{ textAlign:"center" }}>{d.count}</td>
                    <td style={{ textAlign:"right", fontWeight:600 }}>{inrCompact(d.budget)}</td>
                    <td style={{ textAlign:"center" }}>{d.retail}</td>
                    <td style={{ textAlign:"center" }}>{d.lead}</td>
                    <td style={{ textAlign:"right", fontSize:11, color:"#6b7280" }}>
                      {d.retail > 0 ? inrCompact(d.budget / d.retail) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          PROPOSAL DETAIL MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {selected && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          zIndex:1000, overflowY:"auto", padding:"20px 0" }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div style={{ background:"#fff", borderRadius:12, maxWidth:900, margin:"0 auto",
            padding:"0 0 24px", boxShadow:"0 20px 60px rgba(0,0,0,0.3)", position:"relative" }}>

            {/* Modal header */}
            <div style={{ background:"#0a2540", borderRadius:"12px 12px 0 0", padding:"16px 24px",
              display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ flex:1 }}>
                <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginBottom:2 }}>
                  {selected.tokenNumber}
                </div>
                <div style={{ color:"#fff", fontWeight:700, fontSize:16 }}>
                  {selected.dealerName} · {selected.month} {(selected as any).year ?? ""}
                </div>
              </div>
              <StatusPill status={selected.status} />
              <button onClick={() => setSelected(null)}
                style={{ background:"rgba(255,255,255,0.1)", border:"none", color:"#fff",
                  borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:14 }}>✕</button>
            </div>

            <div style={{ padding:"20px 24px 0" }}>

              {/* ── Revision banner ──────────────────────────────────────── */}
              {selected.status === "NeedsRevision" && (
                <div style={{ background:"#fef9c3", border:"1px solid #fde68a",
                  borderLeft:"4px solid #f59e0b", borderRadius:8,
                  padding:"14px 18px", marginBottom:16 }}>
                  <div style={{ fontWeight:700, color:"#92400e", fontSize:14, marginBottom:6 }}>
                    ↩ Revision Requested — Please edit and resubmit
                  </div>
                  {selected.approverNote && (
                    <p style={{ margin:"0 0 12px", color:"#78350f", fontSize:13,
                      background:"#fffbeb", borderRadius:6, padding:"8px 12px" }}>
                      <strong>Changes required:</strong> {selected.approverNote}
                    </p>
                  )}
                  {(selected as any).checkerRemarks && (
                    <p style={{ margin:"0 0 12px", color:"#78350f", fontSize:13,
                      background:"#fffbeb", borderRadius:6, padding:"8px 12px" }}>
                      <strong>Checker note:</strong> {(selected as any).checkerRemarks}
                    </p>
                  )}
                  <button onClick={() => navigate(`/dealer-proposal?edit=${selected.id}`)}
                    style={{ background:"#f59e0b", color:"#fff", border:"none",
                      padding:"10px 22px", borderRadius:8, fontWeight:700,
                      fontSize:14, cursor:"pointer" }}>
                    ✏ Edit &amp; Resubmit Proposal →
                  </button>
                </div>
              )}

              {/* ── Proposal info grid ──────────────────────────────────── */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
                {[
                  ["Location",    selected.location],
                  ["State",       selected.state],
                  ["Month",       selected.month],
                  ["Year",        (selected as any).year ?? "—"],
                  ["RSM",         selected.rsmName],
                  ["TSM",         selected.tsmName ?? "—"],
                  ["Eligibility", selected.eligibility],
                  ["Type",        selected.type],
                  ["Total Budget", inr(selected.totalBudget)],
                  ["Retail Target", String(selected.totalRetailTarget)],
                ].map(([label, value]) => (
                  <div key={label} style={{ background:"#f8fafc", borderRadius:6,
                    padding:"8px 12px", border:"1px solid #e2e8f0" }}>
                    <div style={{ fontSize:10, color:"#6b7280", fontWeight:700,
                      textTransform:"uppercase", letterSpacing:"0.04em" }}>{label}</div>
                    <div style={{ fontSize:13, color:"#0a2540", fontWeight:600 }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* ── Checker remarks ─────────────────────────────────────── */}
              {(selected as any).checkerRemarks && selected.status !== "NeedsRevision" && (
                <div style={{ background:"#fef9c3", border:"1px solid #fde68a",
                  borderRadius:8, padding:"10px 14px", marginBottom:12, fontSize:13 }}>
                  <strong>Checker note:</strong> {(selected as any).checkerRemarks}
                </div>
              )}

              {/* ── Activities list ─────────────────────────────────────── */}
              <div style={{ fontWeight:700, fontSize:13, color:"#0a2540", marginBottom:8 }}>
                Activities ({selected.activities.length})
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
                {selected.activities.map((a, ai) => (
                  <div key={a.id} style={{ border:"1px solid #e2e8f0", borderRadius:8, overflow:"hidden" }}>
                    {/* Activity header */}
                    <div style={{ background:"#f8fafc", padding:"10px 14px",
                      display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, color:"#0a2540", fontSize:13 }}>
                        {String.fromCharCode(65 + ai)}) {a.activityType}
                      </span>
                      {a.category && (
                        <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px",
                          borderRadius:3, background: a.category === "ATL" ? "#eff6ff" : "#dcfce7",
                          color: a.category === "ATL" ? "#1e40af" : "#166534" }}>
                          {a.category}
                        </span>
                      )}
                      <span style={{ fontSize:11, color:"#6b7280" }}>
                        {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                      </span>
                      <span style={{ fontSize:12, fontWeight:700, color:"#0a2540", marginLeft:"auto" }}>
                        {inrCompact(a.budget)}
                      </span>
                      <span style={{ fontSize:11, color:"#6b7280" }}>
                        Retail: {a.retailTarget} | Lead: {a.leadTarget}
                      </span>
                    </div>

                    {/* ── Post-Activity panel (Approved proposals only) ── */}
                    {selected.status === "Approved" && (
                      <div style={{ borderTop:"1px solid #e2e8f0" }}>
                        {/* Toggle button */}
                        <button
                          onClick={() => {
                            initPostAct(a.id);
                            setOpenPostAct(prev => ({ ...prev, [a.id]: !prev[a.id] }));
                          }}
                          style={{ width:"100%", background: openPostAct[a.id] ? "#0a2540" : "#f0fdf4",
                            color: openPostAct[a.id] ? "#fff" : "#166534",
                            border:"none", padding:"8px 14px", fontSize:12, fontWeight:700,
                            cursor:"pointer", display:"flex", alignItems:"center", gap:8,
                            justifyContent:"space-between" }}>
                          <span>
                            📊 Post-Activity Data
                            {postAct[a.id]?.saved && <span style={{ marginLeft:8, fontSize:10, background:"#dcfce7", color:"#166534", borderRadius:10, padding:"1px 8px" }}>✓ Saved</span>}
                          </span>
                          <span style={{ fontSize:10 }}>{openPostAct[a.id] ? "▲ Close" : "▼ Enter Data"}</span>
                        </button>

                        {openPostAct[a.id] && (
                          <div style={{ padding:"14px 16px", background:"#f8fafc" }}>
                            {/* Dates */}
                            <div style={{ display:"flex", gap:14, marginBottom:12, flexWrap:"wrap", alignItems:"flex-end" }}>
                              <div>
                                <label style={{ fontSize:10, fontWeight:700, color:"#374151",
                                  textTransform:"uppercase", letterSpacing:"0.04em",
                                  display:"block", marginBottom:4 }}>Actual Start Date</label>
                                <input type="date"
                                  value={postAct[a.id]?.actualStartDate ?? ""}
                                  style={{ border:"1px solid #bbf7d0", borderRadius:6, padding:"6px 9px", fontSize:12, outline:"none" }}
                                  onChange={e => {
                                    const start = e.target.value;
                                    const end   = postAct[a.id]?.actualEndDate ?? "";
                                    setPA(a.id, { actualStartDate: start,
                                      entries: start && end ? buildDailyEntries(start, end) : [] });
                                  }} />
                              </div>
                              <div>
                                <label style={{ fontSize:10, fontWeight:700, color:"#374151",
                                  textTransform:"uppercase", letterSpacing:"0.04em",
                                  display:"block", marginBottom:4 }}>Actual End Date</label>
                                <input type="date"
                                  value={postAct[a.id]?.actualEndDate ?? ""}
                                  min={postAct[a.id]?.actualStartDate ?? undefined}
                                  style={{ border:"1px solid #bbf7d0", borderRadius:6, padding:"6px 9px", fontSize:12, outline:"none" }}
                                  onChange={e => {
                                    const end   = e.target.value;
                                    const start = postAct[a.id]?.actualStartDate ?? "";
                                    setPA(a.id, { actualEndDate: end,
                                      entries: start && end ? buildDailyEntries(start, end) : [] });
                                  }} />
                              </div>
                              {postAct[a.id]?.entries.length > 0 && (
                                <span style={{ fontSize:11, color:"#166534", fontWeight:600 }}>
                                  {postAct[a.id].entries.length} day(s) to fill
                                </span>
                              )}
                            </div>

                            {/* Daily data table */}
                            {(postAct[a.id]?.entries?.length ?? 0) > 0 && (
                              <div style={{ overflowX:"auto", border:"1px solid #e2e8f0", borderRadius:8, marginBottom:12 }}>
                                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, minWidth:600 }}>
                                  <thead>
                                    <tr style={{ background:"#0a2540" }}>
                                      <th style={{ padding:"7px 10px", textAlign:"left", color:"#e2e8f0", fontSize:10, width:95 }}>Date</th>
                                      <th style={{ padding:"7px 8px", textAlign:"center", color:"#93c5fd", fontSize:10 }}>Enq Plan</th>
                                      <th style={{ padding:"7px 8px", textAlign:"center", color:"#6ee7b7", fontSize:10 }}>Enq Actual</th>
                                      <th style={{ padding:"7px 8px", textAlign:"center", color:"#93c5fd", fontSize:10 }}>TD Plan</th>
                                      <th style={{ padding:"7px 8px", textAlign:"center", color:"#6ee7b7", fontSize:10 }}>TD Actual</th>
                                      <th style={{ padding:"7px 8px", textAlign:"center", color:"#c4b5fd", fontSize:10 }}>Booking</th>
                                      <th style={{ padding:"7px 8px", textAlign:"center", color:"#fbbf24", fontSize:10 }}>Retail</th>
                                      <th style={{ padding:"7px 8px", textAlign:"center", color:"#a5b4fc", fontSize:10 }}>LMS Punched</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {postAct[a.id].entries.map((entry, ei) => (
                                      <tr key={entry.date} style={{ background: ei % 2 === 0 ? "#fff" : "#f8fafc", borderBottom:"1px solid #f1f5f9" }}>
                                        <td style={{ padding:"5px 10px", fontWeight:600, color:"#374151", fontSize:11 }}>{entry.date}</td>
                                        {(["enquiryPlanned","enquiryActual","testDrivePlanned","testDriveActual","bookingActual","retailActual","leadsPunched"] as (keyof DailyEntry)[]).map(key => (
                                          <td key={key} style={{ padding:"4px 5px", textAlign:"center" }}>
                                            <input type="number" min={0}
                                              style={{ width:48, textAlign:"center", border:"1px solid #e2e8f0", borderRadius:4, padding:"3px", fontSize:11, outline:"none" }}
                                              value={(entry[key] as number) || ""}
                                              placeholder="0"
                                              onChange={ev => setPA(a.id, {
                                                entries: postAct[a.id].entries.map(en =>
                                                  en.date === entry.date
                                                    ? { ...en, [key]: parseInt(ev.target.value) || 0 }
                                                    : en
                                                )
                                              })} />
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr style={{ background:"#0a2540" }}>
                                      <td style={{ padding:"6px 10px", color:"#fbbf24", fontWeight:700, fontSize:11 }}>TOTAL</td>
                                      {(["enquiryPlanned","enquiryActual","testDrivePlanned","testDriveActual","bookingActual","retailActual","leadsPunched"] as (keyof DailyEntry)[]).map((key, ki) => (
                                        <td key={key} style={{ padding:"6px 6px", textAlign:"center", fontWeight:700, fontSize:12,
                                          color: [0,2].includes(ki) ? "#93c5fd" : [1,3].includes(ki) ? "#6ee7b7" : ki===4 ? "#c4b5fd" : ki===5 ? "#fbbf24" : "#a5b4fc" }}>
                                          {postAct[a.id].entries.reduce((s, en) => s + ((en[key] as number) || 0), 0)}
                                        </td>
                                      ))}
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            )}

                            <button
                              disabled={postAct[a.id]?.saving || !postAct[a.id]?.actualStartDate || !postAct[a.id]?.actualEndDate}
                              onClick={() => savePostActivity(selected.id, a.id)}
                              style={{ background: (!postAct[a.id]?.actualStartDate || !postAct[a.id]?.actualEndDate) ? "#9ca3af" : "#16a34a",
                                color:"#fff", border:"none", padding:"8px 20px", borderRadius:7,
                                fontWeight:700, fontSize:13, cursor:"pointer" }}>
                              {postAct[a.id]?.saving ? "Saving…" : "💾 Save Post-Activity Data"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Budget add-on request (for approved proposals) ────────── */}
              {selected.status === "Approved" && (
                <div style={{ background:"#f8fafc", border:"1px solid #e2e8f0",
                  borderRadius:8, padding:"12px 16px", marginTop:4 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:"#0a2540", marginBottom:4 }}>
                    Need additional budget?
                  </div>
                  <p style={{ fontSize:12, color:"#6b7280", margin:"0 0 8px" }}>
                    If you need more budget than approved, you can request an addition from the Checker.
                  </p>
                  <button
                    onClick={() => navigate(`/dealer-proposal?budget=${selected.id}`)}
                    style={{ background:"#1e3a5f", color:"#fff", border:"none",
                      padding:"8px 18px", borderRadius:7, fontWeight:700,
                      fontSize:12, cursor:"pointer" }}>
                    Request Budget Addition
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// src/pages/AnalyticsDashboard.tsx
// Full analytics dashboard — region/state/activity/budget/lead/daily data insights
import { useState, useMemo, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchProposals, type ProposalResponse } from "../services/proposalService";
import { useAuthStore } from "../store/authStore";
import "./AnalyticsDashboard.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");
const inrL = (v: number) => {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)       return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${Math.round(v)}`;
};
const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 100) : 0;
const clamp = (v: number, max = 100) => Math.min(v, max);

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CURRENT_YEAR = new Date().getFullYear();

// ─── Bar component ────────────────────────────────────────────────────────────
const Bar = ({ value, max, color, height = 8 }: { value: number; max: number; color: string; height?: number }) => (
  <div style={{ background:"#f1f5f9", borderRadius:99, height, overflow:"hidden", flex:1 }}>
    <div style={{ background:color, height:"100%", width:`${clamp(pct(value,max))}%`,
      borderRadius:99, transition:"width 0.6s cubic-bezier(.4,0,.2,1)" }}/>
  </div>
);

// ─── Mini sparkline ────────────────────────────────────────────────────────────
const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const w = 80, h = 28, pad = 2;
  const pts = data.map((v, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((v / max) * (h - pad * 2));
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display:"block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// ─── KPI Card ──────────────────────────────────────────────────────────────────
const KPI = ({ label, value, sub, color, trend, spark, onClick, active }: {
  label: string; value: string; sub?: string; color: string;
  trend?: { val: number; label: string }; spark?: number[];
  onClick?: () => void; active?: boolean;
}) => (
  <div
    className={`an-kpi${onClick ? " an-kpi--clickable" : ""}${active ? " an-kpi--active" : ""}`}
    onClick={onClick}
    style={{ borderTop:`3px solid ${color}`, outline: active ? `2px solid ${color}` : "none" }}
    title={onClick ? `Filter by ${label}` : undefined}
  >
    <div className="an-kpi-top">
      <div>
        <div className="an-kpi-label">{label}</div>
        <div className="an-kpi-value" style={{ color }}>{value}</div>
        {sub && <div className="an-kpi-sub">{sub}</div>}
      </div>
      {spark && <Sparkline data={spark} color={color}/>}
    </div>
    {trend && (
      <div className="an-kpi-trend" style={{ color: trend.val >= 0 ? "#16a34a" : "#dc2626" }}>
        {trend.val >= 0 ? "▲" : "▼"} {Math.abs(trend.val)}% {trend.label}
      </div>
    )}
    <div className="an-kpi-bar" style={{ background:`${color}22` }}>
      <div style={{ background:color, height:"3px", width:"60%", borderRadius:2 }}/>
    </div>
  </div>
);

// ─── Section Card ──────────────────────────────────────────────────────────────
const Section = ({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode;
}) => (
  <div className="an-card">
    <div className="an-card-head">
      <div>
        <div className="an-card-title">{title}</div>
        {subtitle && <div className="an-card-sub">{subtitle}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
    {children}
  </div>
);

// ─── Types ─────────────────────────────────────────────────────────────────────
type DailyEntry = {
  date: string; enquiryPlanned: number; enquiryActual: number;
  testDrivePlanned: number; testDriveActual: number;
  bookingActual: number; retailActual: number; leadsPunched: number;
};

interface StateRow { state:string; proposals:number; budget:number; approved:number; lead:number; retail:number; cac:number; }
interface ActivityRow { name:string; count:number; budget:number; lead:number; retail:number; atl:number; btl:number; }
interface MonthRow { month:string; proposals:number; budget:number; lead:number; retail:number; }

// ═══════════════════════════════════════════════════════════════════════════════
export default function AnalyticsDashboard() {
  const { instance } = useMsal();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "Admin" || user?.role === "Manager";
  const currentUserEmail = user?.email?.toLowerCase() ?? "";

  const [proposals, setProposals] = useState<ProposalResponse[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string|null>(null);
  const [yearFilter, setYearFilter] = useState(String(CURRENT_YEAR));
  const [monthFilter, setMonthFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [activeTab,   setActiveTab]   = useState<"overview"|"region"|"activity"|"daily"|"budget"|"daily-activity"|"lead-report">("overview");
  const [activeKpi,    setActiveKpi]    = useState<string|null>(null);
  const [stateFilter,  setStateFilter]  = useState<string|null>(null);
  const [actFilter,    setActFilter]    = useState<string|null>(null);
  const [rsmFilter,    setRsmFilter]    = useState<string|null>(null);
  const [dealerFilter, setDealerFilter] = useState<string|null>(null);
  const [highlightDay, setHighlightDay] = useState<string|null>(null);
  const [selectedDealerDaily, setSelectedDealerDaily] = useState<DailySummaryRow|null>(null);
  const [reportSubTab, setReportSubTab] = useState<"summary"|"dealer-daily">("summary");
  const [dailySearch, setDailySearch] = useState("");
  const [dailyStateFilter, setDailyStateFilter] = useState("All");

  const toggleKpi = (key: string, filter: () => void, reset: () => void) => {
    if (activeKpi === key) { setActiveKpi(null); reset(); }
    else { setActiveKpi(key); filter(); }
  };
  const toggleFilter = <T extends string>(
    current: T | null, value: T, setter: (v: T | null) => void
  ) => setter(current === value ? null : value);

  useEffect(() => {
    fetchProposals(instance)
      .then(data => {
        // Role-based filter: Admin/Manager sees ALL proposals;
        // RSM/other users see only proposals they submitted
        if (isAdmin) {
          setProposals(data);
        } else {
          setProposals(data.filter(p =>
            (p.submittedBy ?? "").toLowerCase() === currentUserEmail ||
            (p.rsmName ?? "").toLowerCase().includes(currentUserEmail.split("@")[0].toLowerCase())
          ));
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [instance]);

  // ── Filtered proposals ──────────────────────────────────────────────────────
  const filtered = useMemo(() => proposals.filter(p => {
    if (yearFilter   !== "All"  && (p as any).year !== yearFilter)   return false;
    if (monthFilter  !== "All"  && p.month  !== monthFilter)          return false;
    if (statusFilter !== "All"  && p.status !== statusFilter)         return false;
    if (stateFilter  !== null   && p.state  !== stateFilter)          return false;
    if (rsmFilter    !== null   && p.rsmName !== rsmFilter)           return false;
    if (dealerFilter !== null   && p.dealerName !== dealerFilter)     return false;
    if (actFilter !== null) {
      if (actFilter === "ATL_FILTER") { if (!p.activities.some(a => (a as any).category === "ATL")) return false; }
      else if (actFilter === "BTL_FILTER") { if (!p.activities.some(a => (a as any).category !== "ATL")) return false; }
      else { if (!p.activities.some(a => a.activityType === actFilter)) return false; }
    }
    return true;
  }), [proposals, yearFilter, monthFilter, statusFilter, stateFilter, rsmFilter, dealerFilter, actFilter]);

  const approved  = useMemo(() => filtered.filter(p => p.status === "Approved"),  [filtered]);
  const pending   = useMemo(() => filtered.filter(p => p.status === "Pending"),   [filtered]);
  const rejected  = useMemo(() => filtered.filter(p => p.status === "Rejected"),  [filtered]);
  const revision  = useMemo(() => filtered.filter(p => p.status === "NeedsRevision"), [filtered]);

  const years = useMemo(() =>
    ["All", ...Array.from(new Set(proposals.map(p => (p as any).year).filter(Boolean))).sort()],
    [proposals]);

  // ── KPI numbers ──────────────────────────────────────────────────────────────
  const totalBudget   = useMemo(() => filtered.reduce((s,p) => s + p.totalBudget, 0), [filtered]);
  const approvedBudget = useMemo(() => approved.reduce((s,p) => s + p.totalBudget, 0), [approved]);
  const totalLead     = useMemo(() => filtered.reduce((s,p) => s + p.totalLeadTarget, 0), [filtered]);
  const totalRetail   = useMemo(() => filtered.reduce((s,p) => s + p.totalRetailTarget, 0), [filtered]);
  const avgCac        = useMemo(() => {
    const list = filtered.filter(p => p.cac > 0).map(p => p.cac);
    return list.length ? list.reduce((a,b) => a+b,0)/list.length : 0;
  }, [filtered]);

  // ── All daily data aggregated ─────────────────────────────────────────────────
  const dailyAgg = useMemo(() => {
    const map: Record<string, DailyEntry> = {};
    for (const p of approved) {
      for (const a of p.activities) {
        const raw = (a as any).dailyData;
        if (!raw) continue;
        try {
          const entries: DailyEntry[] = JSON.parse(raw);
          for (const e of entries) {
            if (!map[e.date]) map[e.date] = { date:e.date, enquiryPlanned:0, enquiryActual:0,
              testDrivePlanned:0, testDriveActual:0, bookingActual:0, retailActual:0, leadsPunched:0 };
            const d = map[e.date];
            d.enquiryPlanned  += e.enquiryPlanned  || 0;
            d.enquiryActual   += e.enquiryActual   || 0;
            d.testDrivePlanned += e.testDrivePlanned || 0;
            d.testDriveActual += e.testDriveActual || 0;
            d.bookingActual   += e.bookingActual   || 0;
            d.retailActual    += e.retailActual    || 0;
            d.leadsPunched    += e.leadsPunched    || 0;
          }
        } catch {}
      }
    }
    return Object.values(map).sort((a,b) => a.date.localeCompare(b.date));
  }, [approved]);

  const dailyTotals = useMemo(() => ({
    enquiryActual:  dailyAgg.reduce((s,d) => s + d.enquiryActual, 0),
    testDriveActual: dailyAgg.reduce((s,d) => s + d.testDriveActual, 0),
    bookingActual:  dailyAgg.reduce((s,d) => s + d.bookingActual, 0),
    retailActual:   dailyAgg.reduce((s,d) => s + d.retailActual, 0),
    leadsPunched:   dailyAgg.reduce((s,d) => s + d.leadsPunched, 0),
  }), [dailyAgg]);

  // ── State-wise aggregation ───────────────────────────────────────────────────
  const stateRows: StateRow[] = useMemo(() => {
    const map: Record<string,StateRow> = {};
    for (const p of filtered) {
      const s = p.state || "Unknown";
      if (!map[s]) map[s] = { state:s, proposals:0, budget:0, approved:0, lead:0, retail:0, cac:0 };
      map[s].proposals++;
      map[s].budget += p.totalBudget;
      if (p.status === "Approved") map[s].approved++;
      map[s].lead   += p.totalLeadTarget;
      map[s].retail += p.totalRetailTarget;
    }
    for (const r of Object.values(map)) {
      r.cac = r.retail > 0 ? Math.round(r.budget / r.retail) : 0;
    }
    return Object.values(map).sort((a,b) => b.budget - a.budget);
  }, [filtered]);

  // ── Activity-wise aggregation ─────────────────────────────────────────────────
  const activityRows: ActivityRow[] = useMemo(() => {
    const map: Record<string,ActivityRow> = {};
    for (const p of filtered) {
      for (const a of p.activities) {
        const n = a.activityType || "Unknown";
        if (!map[n]) map[n] = { name:n, count:0, budget:0, lead:0, retail:0, atl:0, btl:0 };
        map[n].count++;
        map[n].budget += a.budget || 0;
        map[n].lead   += a.leadTarget   || 0;
        map[n].retail += a.retailTarget || 0;
        if ((a as any).category === "ATL") map[n].atl++;
        else map[n].btl++;
      }
    }
    return Object.values(map).sort((a,b) => b.budget - a.budget);
  }, [filtered]);

  const maxActBudget = Math.max(...activityRows.map(r => r.budget), 1);

  // ── Month-wise aggregation ────────────────────────────────────────────────────
  const monthRows: MonthRow[] = useMemo(() => {
    const map: Record<string,MonthRow> = {};
    for (const p of filtered) {
      const m = p.month || "Unknown";
      if (!map[m]) map[m] = { month:m, proposals:0, budget:0, lead:0, retail:0 };
      map[m].proposals++;
      map[m].budget += p.totalBudget;
      map[m].lead   += p.totalLeadTarget;
      map[m].retail += p.totalRetailTarget;
    }
    return MONTHS.map(m => map[m] || { month:m, proposals:0, budget:0, lead:0, retail:0 });
  }, [filtered]);

  const maxMonthBudget = Math.max(...monthRows.map(r => r.budget), 1);
  const monthSparkBudget = monthRows.map(r => r.budget);
  const monthSparkLead   = monthRows.map(r => r.lead);

  // ── Daily Activity Summary (same as DashboardPage) ─────────────────────────
  const liveDailySummary = useMemo((): DailySummaryRow[] => {
    const approvedProposals = approved; // use filtered approved proposals
    const rows: DailySummaryRow[] = [];
    let sr = 1;
    for (const p of approvedProposals) {
      for (const a of p.activities) {
        const dailyData = (a as any).dailyData;
        let totalEnqPlanned = 0, totalEnqActual = 0, totalTrPlanned = 0, totalTrActual = 0;
        let totalBookToday = 0, totalRetail = 0, totalPunched = 0;
        if (dailyData) {
          try {
            const entries = JSON.parse(dailyData) as any[];
            for (const e of entries) {
              totalEnqPlanned  += e.enquiryPlanned  || 0;
              totalEnqActual   += e.enquiryActual   || 0;
              totalTrPlanned   += e.testDrivePlanned || 0;
              totalTrActual    += e.testDriveActual  || 0;
              totalBookToday   += e.bookingActual    || 0;
              totalRetail      += e.retailActual     || 0;
              totalPunched     += e.leadsPunched     || 0;
            }
          } catch {}
        }
        const mediaFiles = (a as any).mediaFiles ?? [];
        const totalPhotos = mediaFiles.length;
        const canopy = (a as any).qty || 1;
        rows.push({
          sr, dealer: p.dealerName||"", location: p.location||"",
          state: p.state||"", zone: (p as any).zone||"", bgMember: p.rsmName||"",
          canopy, enquiryPlanned: totalEnqPlanned, enquiryActual: totalEnqActual,
          perCanopy: canopy>0?Math.round(totalEnqActual/canopy):0,
          hot: 0, trPlanned: totalTrPlanned, trActual: totalTrActual,
          trPerCanopy: canopy>0?Math.round(totalTrActual/canopy):0,
          bookToday: totalBookToday, bookInHand: totalBookToday,
          retailToday: totalRetail, retailMtdAct: totalRetail, retailMtd: totalRetail,
          leads: totalPunched, punched: totalPunched,
          gap: Math.max(0,(a.leadTarget||0)-totalPunched),
          convPct: totalEnqActual>0?Math.round(totalRetail/totalEnqActual*100):0,
          photos: totalPhotos,
        } as DailySummaryRow & { photos: number });
        sr++;
      }
    }
    return rows;
  }, [approved]);

  const dsTotals = useMemo(() => {
    const src = liveDailySummary;
    const totalCanopy  = src.reduce((s, r) => s + r.canopy, 0);
    const totalEnqAct  = src.reduce((s, r) => s + r.enquiryActual, 0);
    const totalTrAct   = src.reduce((s, r) => s + r.trActual, 0);
    const totalRetail  = src.reduce((s, r) => s + r.retailMtd, 0);
    const totalLeads   = src.reduce((s, r) => s + r.leads, 0);
    return {
      canopy:         totalCanopy,
      enquiryPlanned: src.reduce((s, r) => s + r.enquiryPlanned, 0),
      enquiryActual:  totalEnqAct,
      perCanopy:      totalCanopy > 0 ? Math.round(totalEnqAct / totalCanopy) : 0,
      hot:            src.reduce((s, r) => s + r.hot, 0),
      trPlanned:      src.reduce((s, r) => s + r.trPlanned, 0),
      trActual:       totalTrAct,
      trPerCanopy:    totalCanopy > 0 ? Math.round(totalTrAct / totalCanopy) : 0,
      bookToday:      src.reduce((s, r) => s + r.bookToday, 0),
      bookInHand:     src.reduce((s, r) => s + r.bookInHand, 0),
      retailToday:    src.reduce((s, r) => s + r.retailToday, 0),
      retailMtdAct:   src.reduce((s, r) => s + r.retailMtdAct, 0),
      retailMtd:      totalRetail,
      leads:          totalLeads,
      punched:        src.reduce((s, r) => s + r.punched, 0),
      gap:            src.reduce((s, r) => s + r.gap, 0),
    };
  }, [liveDailySummary]);
  // ── RSM-wise aggregation ─────────────────────────────────────────────────────
  const rsmRows = useMemo(() => {
    const map: Record<string,{ rsm:string; proposals:number; budget:number; approved:number; lead:number; }> = {};
    for (const p of filtered) {
      const r = p.rsmName || "Unknown";
      if (!map[r]) map[r] = { rsm:r, proposals:0, budget:0, approved:0, lead:0 };
      map[r].proposals++;
      map[r].budget   += p.totalBudget;
      map[r].lead     += p.totalLeadTarget;
      if (p.status === "Approved") map[r].approved++;
    }
    return Object.values(map).sort((a,b) => b.budget - a.budget).slice(0,12);
  }, [filtered]);

  const maxRsmBudget = Math.max(...rsmRows.map(r => r.budget), 1);

  // ── Top dealers by budget ─────────────────────────────────────────────────────
  const dealerRows = useMemo(() => {
    const map: Record<string,{ dealer:string; proposals:number; budget:number; retail:number; }> = {};
    for (const p of filtered) {
      const d = p.dealerName || "Unknown";
      if (!map[d]) map[d] = { dealer:d, proposals:0, budget:0, retail:0 };
      map[d].proposals++;
      map[d].budget += p.totalBudget;
      map[d].retail += p.totalRetailTarget;
    }
    return Object.values(map).sort((a,b) => b.budget - a.budget).slice(0,10);
  }, [filtered]);

  const filteredDailySummary = useMemo(() => liveDailySummary.filter(row => {
    if (dailyStateFilter !== "All" && row.state !== dailyStateFilter) return false;
    if (dailySearch) {
      const q = dailySearch.toLowerCase();
      return (row.dealer+row.location+row.state+row.bgMember).toLowerCase().includes(q);
    }
    return true;
  }), [liveDailySummary, dailySearch, dailyStateFilter]);

  const maxDealerBudget = Math.max(...dealerRows.map(r => r.budget), 1);

interface DailySummaryRow {
  sr: number; dealer: string; location: string; state: string;
  zone: string; bgMember: string; canopy: number;
  enquiryPlanned: number; enquiryActual: number; perCanopy: number; hot: number;
  trPlanned: number; trActual: number; trPerCanopy: number;
  bookToday: number; bookInHand: number;
  retailToday: number; retailMtdAct: number; retailMtd: number; retailRatePerCanopy: number;
  activityDay: number; closingStock: number;
  leads: number; punched: number; gap: number; convPct: number;
}

interface LeadReportRow {
  state: string; expectedLeads: number;
  walkinTarget: number; walkinMtdT: number; walkinMtdA: number;
  btlTarget: number; btlMtdT: number; btlMtdA: number;
  referralTarget: number; referralMtdT: number; referralMtdA: number;
  atlTarget: number; atlMtdT: number; atlMtdA: number;
  digitalTarget: number; digitalMtdT: number; digitalMtdA: number;
  totalReceived: number; variance: number; achPct: number;
  jul26RetailTarget: number; mtdRetailTarget: number; mtdRetailAch: number;
  mtdRetailAchPct: number; retailEnqPct: number;
}


  if (loading) return (
    <div className="an-loading">
      <div className="an-spinner"/>
      <p>Loading analytics…</p>
    </div>
  );

  if (error) return (
    <div className="an-error">
      <h3>Failed to load data</h3>
      <p>{error}</p>
      <button onClick={() => window.location.reload()}>Retry</button>
    </div>
  );

  const approvalRate = pct(approved.length, filtered.length);

  return (
    <div className="an-root">

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="an-header">
        <div>
          <h1 className="an-title">Analytics Dashboard</h1>
          <p className="an-subtitle">
            {filtered.length} proposals · {stateRows.length} states ·{" "}
            {activityRows.length} activity types · {approved.length} approved
          </p>
          <div style={{ marginTop:6, display:"flex", gap:8, flexWrap:"wrap" }}>
            {isAdmin ? (
              <span style={{ background:"#0a2540", color:"#fff", borderRadius:12,
                padding:"2px 10px", fontSize:11, fontWeight:700 }}>
                👑 Admin — All proposals visible
              </span>
            ) : (
              <span style={{ background:"#eff6ff", color:"#1e40af", borderRadius:12,
                border:"1px solid #bfdbfe", padding:"2px 10px", fontSize:11, fontWeight:700 }}>
                👤 {user?.displayName ?? "My"} — Your proposals only
              </span>
            )}
          </div>
        </div>
        <div className="an-filters">
          <select className="an-select" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y === "All" ? "All Years" : y}</option>)}
          </select>
          <select className="an-select" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
            <option value="All">All Months</option>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="an-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            <option value="Approved">Approved</option>
            <option value="Pending">Pending</option>
            <option value="Rejected">Rejected</option>
            <option value="NeedsRevision">Needs Revision</option>
          </select>
          {(yearFilter !== "All" || monthFilter !== "All" || statusFilter !== "All" || stateFilter || rsmFilter || dealerFilter || actFilter) && (
            <button className="an-clear" onClick={() => {
              setYearFilter(String(CURRENT_YEAR)); setMonthFilter("All"); setStatusFilter("All");
              setStateFilter(null); setRsmFilter(null); setDealerFilter(null); setActFilter(null);
            }}>
              Clear all ✕
            </button>
          )}
          {stateFilter   && <span className="an-active-pill">📍 {stateFilter}   <button onClick={() => setStateFilter(null)}>✕</button></span>}
          {rsmFilter     && <span className="an-active-pill">👤 {rsmFilter}     <button onClick={() => setRsmFilter(null)}>✕</button></span>}
          {dealerFilter  && <span className="an-active-pill">🏪 {dealerFilter}  <button onClick={() => setDealerFilter(null)}>✕</button></span>}
          {actFilter     && <span className="an-active-pill">🎯 {actFilter}     <button onClick={() => setActFilter(null)}>✕</button></span>}
        </div>
      </div>

      {/* ── Tab Nav ──────────────────────────────────────────────────────────── */}
      <div className="an-tabs">
        {([
          ["overview",      "📊 Overview"],
          ["region",        "🗺 Region"],
          ["activity",      "🎯 Activities"],
          ["daily",         "📅 Daily Data"],
          ["budget",        "💰 Budget"],
          ["daily-activity","📅 Daily Activity Report"],
          ["lead-report",   "🎯 Lead Report"],
        ] as [typeof activeTab, string][]).map(([tab, label]) => (
          <button key={tab} className={`an-tab ${activeTab === tab ? "an-tab--active" : ""}`}
            onClick={() => setActiveTab(tab)}>{label}</button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          OVERVIEW TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <>
          {/* KPI row */}
          <div className="an-kpi-grid">
            <KPI label="Total Proposals"    value={String(filtered.length)}    color="#0a2540" sub={`${stateRows.length} states`} spark={monthSparkBudget} active={activeKpi==="total"} onClick={()=>toggleKpi("total",()=>setStatusFilter("All"),()=>setStatusFilter("All"))}/>
            <KPI label="Total Budget"        value={inrL(totalBudget)}          color="#2563eb" sub={`Approved: ${inrL(approvedBudget)}`} active={activeKpi==="budget_kpi"} onClick={()=>toggleKpi("budget_kpi",()=>setActiveTab("budget"),()=>setActiveTab("overview"))}/>
            <KPI label="Approval Rate"       value={`${approvalRate}%`}         color="#16a34a" sub={`${approved.length} of ${filtered.length}`} active={activeKpi==="approved"} onClick={()=>toggleKpi("approved",()=>setStatusFilter("Approved"),()=>setStatusFilter("All"))}/>
            <KPI label="Lead Target"         value={String(totalLead)}          color="#7c3aed" sub={`Retail: ${totalRetail}`} spark={monthSparkLead} active={activeKpi==="lead"} onClick={()=>toggleKpi("lead",()=>setActiveTab("activity"),()=>setActiveTab("overview"))}/>
            <KPI label="Avg CAC"             value={inrL(avgCac)}               color="#f59e0b" sub="per retail" active={activeKpi==="cac"} onClick={()=>toggleKpi("cac",()=>setActiveTab("budget"),()=>setActiveTab("overview"))}/>
            <KPI label="Pending"             value={String(pending.length)}     color="#f59e0b" sub={inrL(pending.reduce((s,p)=>s+p.totalBudget,0))} active={activeKpi==="pending"} onClick={()=>toggleKpi("pending",()=>setStatusFilter("Pending"),()=>setStatusFilter("All"))}/>
            <KPI label="Enquiries (Actual)"  value={String(dailyTotals.enquiryActual)}  color="#0891b2" sub="from post-activity" active={activeKpi==="enq_ov"} onClick={()=>toggleKpi("enq_ov",()=>setActiveTab("daily"),()=>setActiveTab("overview"))}/>
            <KPI label="LMS Leads Punched"   value={String(dailyTotals.leadsPunched)}   color="#6366f1" sub="from post-activity" active={activeKpi==="lms_ov"} onClick={()=>toggleKpi("lms_ov",()=>setActiveTab("daily"),()=>setActiveTab("overview"))}/>
          </div>

          {/* Status donut + month trend side by side */}
          <div className="an-row-2">
            {/* Status breakdown */}
            <Section title="Proposal Status Breakdown" subtitle="All filtered proposals">
              {[
                { label:"Approved",       count:approved.length,  color:"#16a34a", bg:"#f0fdf4", status:"Approved"      },
                  { label:"Pending",        count:pending.length,   color:"#f59e0b", bg:"#fefce8", status:"Pending"       },
                  { label:"Rejected",       count:rejected.length,  color:"#dc2626", bg:"#fef2f2", status:"Rejected"      },
                  { label:"Needs Revision", count:revision.length,  color:"#f97316", bg:"#fff7ed", status:"NeedsRevision" },
              ].map(s => { const isS = statusFilter===s.status; return (
                <div key={s.label}
                  className={`an-status-row an-clickable${isS?" an-active-row":""}`}
                  style={{ background:s.bg, cursor:"pointer", outline:isS?`2px solid ${s.color}`:"none", borderRadius:8 }}
                  onClick={() => setStatusFilter(isS?"All":s.status)}
                  title={`Filter: ${s.label}`}>
                  <div className="an-status-dot" style={{ background:s.color }}/>
                  <span className="an-status-label">{s.label}</span>
                  <Bar value={s.count} max={filtered.length} color={s.color}/>
                  <span className="an-status-count" style={{ color:s.color }}>{s.count}</span>
                  <span className="an-status-pct">{pct(s.count, filtered.length)}%</span>
                </div>
              );})}
              <div className="an-status-total">
                <span>Total</span>
                <span style={{ fontWeight:800 }}>{filtered.length}</span>
              </div>
            </Section>

            {/* Month trend bars */}
            <Section title="Monthly Budget Trend" subtitle="Total budget per month">
              <div className="an-month-bars">
                {monthRows.map((m, i) => { const isMon = monthFilter===m.month; return (
                  <div key={m.month}
                    className={`an-month-col an-clickable${m.proposals===0?" an-month-empty":""}`}
                    onClick={() => m.proposals>0 && setMonthFilter(isMon?"All":m.month)}
                    style={{ cursor:m.proposals>0?"pointer":"default" }}
                    title={m.proposals>0?`${m.month}: ${inrL(m.budget)} · ${m.proposals} proposals`:m.month}>
                    <div className="an-month-bar-wrap">
                      <div className="an-month-bar"
                        style={{ height:`${clamp(pct(m.budget, maxMonthBudget), 100)}%`,
                          background:isMon?"#16a34a":"#2563eb",
                          boxShadow:isMon?"0 0 0 2px #16a34a":"none" }}/>
                    </div>
                    <div className="an-month-lbl" style={{ color:isMon?"#16a34a":"#94a3b8",fontWeight:isMon?800:600 }}>{MONTH_SHORT[i]}</div>
                    {m.proposals>0&&<div className="an-month-count" style={{ color:isMon?"#16a34a":"#64748b" }}>{m.proposals}</div>}
                  </div>
                );})}
              </div>
            </Section>
          </div>

          {/* Top states + top activities */}
          <div className="an-row-2">
            <Section title="Top States by Budget" subtitle={`${stateRows.length} total states`}>
              <table className="an-table">
                <thead><tr>
                  <th>State</th><th>Proposals</th><th>Approved</th>
                  <th>Budget</th><th>Lead</th><th>Retail</th><th>CAC</th>
                </tr></thead>
                <tbody>
                  {stateRows.slice(0,8).map(r => { const isSt=stateFilter===r.state; return (
                    <tr key={r.state} onClick={()=>toggleFilter(stateFilter,r.state,setStateFilter)} className="an-tr-click" style={{ background:isSt?"#eff6ff":undefined,outline:isSt?"2px solid #2563eb":"none" }} title={`Drill into ${r.state}`}>
                      <td className="an-td-bold">{r.state}</td>
                      <td className="an-td-center">{r.proposals}</td>
                      <td className="an-td-center">
                        <span style={{ color:"#16a34a",fontWeight:700 }}>{r.approved}</span>
                      </td>
                      <td className="an-td-right an-td-bold">{inrL(r.budget)}</td>
                      <td className="an-td-center">{r.lead}</td>
                      <td className="an-td-center">{r.retail}</td>
                      <td className="an-td-right" style={{ color: r.cac > 4000 ? "#dc2626" : "#374151", fontWeight: r.cac > 4000 ? 700 : 400 }}>
                        {inrL(r.cac)}
                        {r.cac > 4000 && " ⚠"}
                      </td>
                    </tr>
                  );})
                }
                </tbody>
              </table>
            </Section>

            <Section title="Top Activities by Budget" subtitle={`${activityRows.length} activity types`}>
              <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                {activityRows.slice(0,8).map(r => { const isAct=actFilter===r.name; return (
                  <div key={r.name}
                    className={`an-act-row an-clickable${isAct?" an-active-row":""}`}
                    onClick={()=>toggleFilter(actFilter,r.name,setActFilter)}
                    style={{ outline:isAct?"2px solid #2563eb":"none",borderRadius:8,cursor:"pointer" }}
                    title={`Filter by ${r.name}`}>
                    <div className="an-act-name">{r.name}</div>
                    <div style={{ display:"flex",flexDirection:"column",gap:2,flex:1 }}>
                      <Bar value={r.budget} max={maxActBudget} color="#2563eb" height={6}/>
                      <div className="an-act-meta">
                        <span>{inrL(r.budget)}</span>
                        <span>×{r.count}</span>
                        <span style={{ color:"#7c3aed" }}>Lead:{r.lead}</span>
                        <span style={{ color:"#16a34a" }}>Retail:{r.retail}</span>
                      </div>
                    </div>
                    <div className="an-act-badges">
                      {r.atl > 0 && <span className="an-badge-atl">ATL×{r.atl}</span>}
                      {r.btl > 0 && <span className="an-badge-btl">BTL×{r.btl}</span>}
                    </div>
                  </div>
                );})
              }
              </div>
            </Section>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          REGION TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "region" && (
        <>
          <Section title="State-wise Performance" subtitle={`${stateRows.length} states · all metrics`}>
            <div className="an-table-wrap">
              <table className="an-table an-table-full">
                <thead><tr>
                  <th>#</th><th>State</th><th>Proposals</th><th>Approved</th>
                  <th>Pending</th><th>Budget</th><th>Approved Budget</th>
                  <th>Lead Target</th><th>Retail Target</th><th>CAC</th>
                  <th>Approval Rate</th>
                </tr></thead>
                <tbody>
                  {stateRows.map((r,i) => { const isSt2=stateFilter===r.state; const approvedBudget = filtered.filter(p => p.state===r.state && p.status==="Approved").reduce((s,p) => s+p.totalBudget,0);
                    const statePending   = filtered.filter(p => p.state===r.state && p.status==="Pending").length;
                    const rate = pct(r.approved, r.proposals);
                    return (
                      <tr key={r.state} onClick={()=>toggleFilter(stateFilter,r.state,setStateFilter)} className="an-tr-click" style={{ background:isSt2?"#eff6ff":undefined }} title={`Drill: ${r.state}`}>
                        <td className="an-td-muted">{i+1}</td>
                        <td className="an-td-bold">{r.state}</td>
                        <td className="an-td-center">{r.proposals}</td>
                        <td className="an-td-center" style={{ color:"#16a34a",fontWeight:700 }}>{r.approved}</td>
                        <td className="an-td-center" style={{ color:"#f59e0b" }}>{statePending}</td>
                        <td className="an-td-right an-td-bold">{inrL(r.budget)}</td>
                        <td className="an-td-right" style={{ color:"#16a34a" }}>{inrL(approvedBudget)}</td>
                        <td className="an-td-center">{r.lead}</td>
                        <td className="an-td-center">{r.retail}</td>
                        <td className="an-td-right" style={{ color:r.cac>4000?"#dc2626":"#374151", fontWeight:r.cac>4000?700:400 }}>
                          {inrL(r.cac)}{r.cac>4000?" ⚠":""}
                        </td>
                        <td>
                          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                            <Bar value={rate} max={100} color={rate>=70?"#16a34a":rate>=40?"#f59e0b":"#dc2626"} height={6}/>
                            <span style={{ fontSize:11,fontWeight:700,color:rate>=70?"#16a34a":rate>=40?"#f59e0b":"#dc2626",minWidth:32 }}>{rate}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ fontWeight:800,color:"#0a2540",padding:"8px 12px" }}>TOTAL</td>
                    <td className="an-td-center" style={{ fontWeight:700 }}>{filtered.length}</td>
                    <td className="an-td-center" style={{ fontWeight:700,color:"#16a34a" }}>{approved.length}</td>
                    <td className="an-td-center" style={{ fontWeight:700,color:"#f59e0b" }}>{pending.length}</td>
                    <td className="an-td-right" style={{ fontWeight:700 }}>{inrL(totalBudget)}</td>
                    <td className="an-td-right" style={{ fontWeight:700,color:"#16a34a" }}>{inrL(approvedBudget)}</td>
                    <td className="an-td-center" style={{ fontWeight:700 }}>{totalLead}</td>
                    <td className="an-td-center" style={{ fontWeight:700 }}>{totalRetail}</td>
                    <td className="an-td-right" style={{ fontWeight:700 }}>{inrL(avgCac)}</td>
                    <td style={{ fontWeight:700,color:"#16a34a" }}>{approvalRate}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>

          {/* RSM-wise */}
          <Section title="RSM-wise Performance" subtitle="Top 12 RSMs by budget">
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {rsmRows.map((r,i) => { const isRsm=rsmFilter===r.rsm; return (
                <div key={r.rsm}
                  className={`an-rsm-row an-clickable${isRsm?" an-active-row":""}`}
                  onClick={()=>toggleFilter(rsmFilter,r.rsm,setRsmFilter)}
                  style={{ outline:isRsm?"2px solid #2563eb":"none",cursor:"pointer" }}
                  title={`Filter by ${r.rsm}`}>
                  <div className="an-rsm-rank">{i+1}</div>
                  <div className="an-rsm-name">{r.rsm}</div>
                  <div style={{ flex:1 }}>
                    <Bar value={r.budget} max={maxRsmBudget} color="#2563eb"/>
                  </div>
                  <div className="an-rsm-stats">
                    <span className="an-rsm-budget">{inrL(r.budget)}</span>
                    <span className="an-rsm-meta">{r.proposals} props</span>
                    <span style={{ color:"#16a34a",fontSize:11,fontWeight:700 }}>{r.approved} approved</span>
                  </div>
                </div>
              );})
              }
            </div>
          </Section>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          ACTIVITY TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "activity" && (
        <>
          {/* ATL vs BTL summary */}
          <div className="an-kpi-grid" style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
            {(() => {
              const allActs = filtered.flatMap(p => p.activities);
              const atl = allActs.filter(a => (a as any).category === "ATL");
              const btl = allActs.filter(a => (a as any).category !== "ATL");
              const atlBudget = atl.reduce((s,a) => s+(a.budget||0),0);
              const btlBudget = btl.reduce((s,a) => s+(a.budget||0),0);
              return [
                <KPI key="tot" label="Total Activities"  value={String(allActs.length)} color="#0a2540" sub={`${activityRows.length} types`} active={activeKpi==="act_tot"} onClick={()=>toggleKpi("act_tot",()=>{},()=>{})}/>,
                <KPI key="atl" label="ATL Activities" value={String(atl.length)} color="#1e40af" sub={inrL(atlBudget)} active={activeKpi==="atl"} onClick={()=>toggleKpi("atl",()=>setActFilter("ATL_FILTER"),()=>setActFilter(null))}/>,
                <KPI key="btl" label="BTL Activities" value={String(btl.length)} color="#166534" sub={inrL(btlBudget)} active={activeKpi==="btl"} onClick={()=>toggleKpi("btl",()=>setActFilter("BTL_FILTER"),()=>setActFilter(null))}/>,
                <KPI key="cac" label="Overall CAC"       value={inrL(avgCac)}          color="#f59e0b" sub="avg per retail" active={activeKpi==="cac_act"} onClick={()=>toggleKpi("cac_act",()=>setActiveTab("budget"),()=>setActiveTab("activity"))}/>,
              ];
            })()}
          </div>

          <Section title="Activity Type Breakdown" subtitle="Budget, count and lead/retail by activity">
            <div className="an-table-wrap">
              <table className="an-table an-table-full">
                <thead><tr>
                  <th>#</th><th>Activity Name</th><th>Count</th>
                  <th>ATL</th><th>BTL</th>
                  <th>Budget Share</th><th>Total Budget</th>
                  <th>Lead Target</th><th>Retail Target</th><th>CAC</th>
                </tr></thead>
                <tbody>
                  {activityRows.map((r,i) => { const isAct2=actFilter===r.name; const totalAllBudget = activityRows.reduce((s,a) => s+a.budget,0);
                    const cac = r.retail > 0 ? Math.round(r.budget / r.retail) : 0;
                    return (
                      <tr key={r.name} onClick={()=>toggleFilter(actFilter,r.name,setActFilter)} className="an-tr-click" style={{ background:isAct2?"#eff6ff":undefined }} title={`Drill: ${r.name}`}>
                        <td className="an-td-muted">{i+1}</td>
                        <td className="an-td-bold">{r.name}</td>
                        <td className="an-td-center">{r.count}</td>
                        <td className="an-td-center">
                          {r.atl > 0 && <span className="an-badge-atl">ATL×{r.atl}</span>}
                        </td>
                        <td className="an-td-center">
                          {r.btl > 0 && <span className="an-badge-btl">BTL×{r.btl}</span>}
                        </td>
                        <td>
                          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                            <Bar value={r.budget} max={totalAllBudget} color="#2563eb" height={6}/>
                            <span style={{ fontSize:11,color:"#64748b",minWidth:30 }}>{pct(r.budget,totalAllBudget)}%</span>
                          </div>
                        </td>
                        <td className="an-td-right an-td-bold">{inrL(r.budget)}</td>
                        <td className="an-td-center">{r.lead}</td>
                        <td className="an-td-center">{r.retail}</td>
                        <td className="an-td-right" style={{ color:cac>4000?"#dc2626":"#374151",fontWeight:cac>4000?700:400 }}>
                          {inrL(cac)}{cac>4000?" ⚠":""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Top dealers */}
          <Section title="Top Dealers by Budget" subtitle="Top 10 dealers">
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {dealerRows.map((d,i) => { const isDlr=dealerFilter===d.dealer; return (
                <div key={d.dealer}
                  className={`an-rsm-row an-clickable${isDlr?" an-active-row":""}`}
                  onClick={()=>toggleFilter(dealerFilter,d.dealer,setDealerFilter)}
                  style={{ outline:isDlr?"2px solid #7c3aed":"none",cursor:"pointer" }}
                  title={`Filter by ${d.dealer}`}>
                  <div className="an-rsm-rank">{i+1}</div>
                  <div className="an-rsm-name" style={{ flex:2 }}>{d.dealer}</div>
                  <div style={{ flex:2 }}>
                    <Bar value={d.budget} max={maxDealerBudget} color="#7c3aed"/>
                  </div>
                  <div className="an-rsm-stats">
                    <span className="an-rsm-budget">{inrL(d.budget)}</span>
                    <span className="an-rsm-meta">{d.proposals} props</span>
                    <span style={{ color:"#7c3aed",fontSize:11 }}>Retail:{d.retail}</span>
                  </div>
                </div>
              );})}
            </div>
          </Section>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          DAILY DATA TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "daily" && (
        <>
          {/* Daily totals KPIs */}
          <div className="an-kpi-grid" style={{ gridTemplateColumns:"repeat(5,1fr)" }}>
            <KPI label="Enquiries (Actual)"  value={String(dailyTotals.enquiryActual)}  color="#0891b2" sub="from post-activity entries" active={activeKpi==="d_enq"} onClick={()=>toggleKpi("d_enq",()=>{},()=>{})}/>
            <KPI label="Test Drives (Actual)" value={String(dailyTotals.testDriveActual)} color="#7c3aed" sub="from post-activity entries" active={activeKpi==="d_td"} onClick={()=>toggleKpi("d_td",()=>{},()=>{})}/>
            <KPI label="Bookings"            value={String(dailyTotals.bookingActual)}  color="#f59e0b" sub="total booked" active={activeKpi==="d_book"} onClick={()=>toggleKpi("d_book",()=>{},()=>{})}/>
            <KPI label="Retail (Actual)"     value={String(dailyTotals.retailActual)}   color="#16a34a" sub={`vs target: ${totalRetail} (${pct(dailyTotals.retailActual,totalRetail)}%)`} active={activeKpi==="d_retail"} onClick={()=>toggleKpi("d_retail",()=>{},()=>{})}/>
            <KPI label="LMS Leads Punched"   value={String(dailyTotals.leadsPunched)}   color="#6366f1" sub={`vs target: ${totalLead} (${pct(dailyTotals.leadsPunched,totalLead)}%)`} active={activeKpi==="d_lms"} onClick={()=>toggleKpi("d_lms",()=>{},()=>{})}/>
          </div>

          {dailyAgg.length === 0 ? (
            <Section title="Daily Activity Data" subtitle="Post-activity entries from approved proposals">
              <div style={{ textAlign:"center",padding:"60px 24px",color:"#9ca3af" }}>
                <div style={{ fontSize:40,marginBottom:12 }}>📅</div>
                <div style={{ fontWeight:700,fontSize:15,color:"#0a2540",marginBottom:6 }}>No post-activity data yet</div>
                <div style={{ fontSize:13 }}>
                  Once RSMs fill post-activity data in approved proposals, daily metrics will appear here.
                </div>
              </div>
            </Section>
          ) : (
            <Section title={`Daily Activity Log — ${dailyAgg.length} days`}
              subtitle="Aggregated from all approved proposals' post-activity entries">
              <div className="an-table-wrap">
                <table className="an-table an-table-full">
                  <thead>
                    <tr style={{ background:"#0a2540" }}>
                      <th style={{ color:"#e2e8f0",textAlign:"left" }}>Date</th>
                      <th style={{ color:"#93c5fd",textAlign:"center" }}>Enq Plan</th>
                      <th style={{ color:"#6ee7b7",textAlign:"center" }}>Enq Actual</th>
                      <th style={{ color:"#93c5fd",textAlign:"center" }}>TD Plan</th>
                      <th style={{ color:"#6ee7b7",textAlign:"center" }}>TD Actual</th>
                      <th style={{ color:"#c4b5fd",textAlign:"center" }}>Booking</th>
                      <th style={{ color:"#fbbf24",textAlign:"center" }}>Retail</th>
                      <th style={{ color:"#a5b4fc",textAlign:"center" }}>LMS Punched</th>
                      <th style={{ color:"#e2e8f0",textAlign:"center" }}>Enq Conv%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyAgg.map((d,i) => {
                      const enqConv = pct(d.enquiryActual, d.enquiryPlanned);
                      const isDayActive = highlightDay===d.date;
                      const hasData = d.enquiryActual>0||d.testDriveActual>0||d.bookingActual>0||d.retailActual>0;
                      return (
                        <tr key={d.date} className="an-tr-click" onClick={()=>setHighlightDay(isDayActive?null:d.date)} style={{ background:isDayActive?"#eff6ff":i%2===0?"#fff":"#f8fafc", opacity:hasData?1:0.5, outline:isDayActive?"2px solid #0891b2":"none", cursor:"pointer" }}>
                          <td style={{ padding:"6px 12px",fontWeight:600,fontSize:12,color:"#374151",whiteSpace:"nowrap" }}>{d.date}</td>
                          <td className="an-td-center" style={{ fontSize:12 }}>{d.enquiryPlanned||"—"}</td>
                          <td className="an-td-center" style={{ fontSize:12,fontWeight:d.enquiryActual>0?700:400,color:d.enquiryActual>0?"#0891b2":"#94a3b8" }}>{d.enquiryActual||"—"}</td>
                          <td className="an-td-center" style={{ fontSize:12 }}>{d.testDrivePlanned||"—"}</td>
                          <td className="an-td-center" style={{ fontSize:12,fontWeight:d.testDriveActual>0?700:400,color:d.testDriveActual>0?"#7c3aed":"#94a3b8" }}>{d.testDriveActual||"—"}</td>
                          <td className="an-td-center" style={{ fontSize:12,fontWeight:d.bookingActual>0?700:400,color:d.bookingActual>0?"#f59e0b":"#94a3b8" }}>{d.bookingActual||"—"}</td>
                          <td className="an-td-center" style={{ fontSize:12,fontWeight:d.retailActual>0?700:400,color:d.retailActual>0?"#16a34a":"#94a3b8" }}>{d.retailActual||"—"}</td>
                          <td className="an-td-center" style={{ fontSize:12,fontWeight:d.leadsPunched>0?700:400,color:d.leadsPunched>0?"#6366f1":"#94a3b8" }}>{d.leadsPunched||"—"}</td>
                          <td className="an-td-center">
                            {d.enquiryPlanned > 0 ? (
                              <span style={{ fontSize:11,fontWeight:700,
                                color:enqConv>=90?"#16a34a":enqConv>=60?"#f59e0b":"#dc2626" }}>
                                {enqConv}%
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:"#0a2540" }}>
                      <td style={{ padding:"8px 12px",fontWeight:800,color:"#fbbf24" }}>TOTAL</td>
                      <td className="an-td-center" style={{ color:"#93c5fd",fontWeight:700 }}>{dailyAgg.reduce((s,d)=>s+d.enquiryPlanned,0)}</td>
                      <td className="an-td-center" style={{ color:"#6ee7b7",fontWeight:700 }}>{dailyTotals.enquiryActual}</td>
                      <td className="an-td-center" style={{ color:"#93c5fd",fontWeight:700 }}>{dailyAgg.reduce((s,d)=>s+d.testDrivePlanned,0)}</td>
                      <td className="an-td-center" style={{ color:"#6ee7b7",fontWeight:700 }}>{dailyTotals.testDriveActual}</td>
                      <td className="an-td-center" style={{ color:"#c4b5fd",fontWeight:700 }}>{dailyTotals.bookingActual}</td>
                      <td className="an-td-center" style={{ color:"#fbbf24",fontWeight:700 }}>{dailyTotals.retailActual}</td>
                      <td className="an-td-center" style={{ color:"#a5b4fc",fontWeight:700 }}>{dailyTotals.leadsPunched}</td>
                      <td className="an-td-center" style={{ color:"#e2e8f0",fontWeight:700 }}>
                        {pct(dailyTotals.enquiryActual, dailyAgg.reduce((s,d)=>s+d.enquiryPlanned,0))}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Section>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          BUDGET TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "budget" && (
        <>
          <div className="an-kpi-grid" style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
            <KPI label="Total Budget"     value={inrL(totalBudget)}   color="#2563eb" sub="all proposals" active={activeKpi==="b_total"} onClick={()=>toggleKpi("b_total",()=>setStatusFilter("All"),()=>setStatusFilter("All"))}/>
            <KPI label="Approved Budget"  value={inrL(approvedBudget)} color="#16a34a" sub={pct(approvedBudget,totalBudget)+"% of total"} active={activeKpi==="b_approved"} onClick={()=>toggleKpi("b_approved",()=>setStatusFilter("Approved"),()=>setStatusFilter("All"))}/>
            <KPI label="Pending Budget"   value={inrL(pending.reduce((s,p)=>s+p.totalBudget,0))} color="#f59e0b" sub="awaiting approval" active={activeKpi==="b_pending"} onClick={()=>toggleKpi("b_pending",()=>setStatusFilter("Pending"),()=>setStatusFilter("All"))}/>
            <KPI label="Average CAC"      value={inrL(avgCac)}        color="#7c3aed" sub="per retail unit" active={activeKpi==="b_cac"} onClick={()=>toggleKpi("b_cac",()=>{},()=>{})}/>
          </div>

          {/* Month budget table */}
          <Section title="Month-wise Budget Analysis" subtitle="Budget and lead breakdown per month">
            <div className="an-table-wrap">
              <table className="an-table an-table-full">
                <thead><tr>
                  <th>Month</th><th>Proposals</th><th>Budget Share</th>
                  <th>Total Budget</th><th>Lead Target</th><th>Retail Target</th><th>CPL</th><th>CAC</th>
                </tr></thead>
                <tbody>
                  {monthRows.filter(r => r.proposals > 0).map(r => { const isMon2=monthFilter===r.month;
                    const cpl = r.lead > 0 ? Math.round(r.budget / r.lead) : 0;
                    const cac = r.retail > 0 ? Math.round(r.budget / r.retail) : 0;
                    return (
                      <tr key={r.month} onClick={()=>setMonthFilter(isMon2?"All":r.month)} className="an-tr-click" style={{ background:isMon2?"#eff6ff":undefined }} title={`Drill: ${r.month}`}>
                        <td className="an-td-bold">{r.month}</td>
                        <td className="an-td-center">{r.proposals}</td>
                        <td>
                          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                            <Bar value={r.budget} max={maxMonthBudget} color="#2563eb" height={6}/>
                            <span style={{ fontSize:11,color:"#64748b",minWidth:30 }}>{pct(r.budget,totalBudget)}%</span>
                          </div>
                        </td>
                        <td className="an-td-right an-td-bold">{inrL(r.budget)}</td>
                        <td className="an-td-center">{r.lead}</td>
                        <td className="an-td-center">{r.retail}</td>
                        <td className="an-td-right" style={{ color:"#7c3aed" }}>{inrL(cpl)}</td>
                        <td className="an-td-right" style={{ color:cac>4000?"#dc2626":"#374151",fontWeight:cac>4000?700:400 }}>
                          {inrL(cac)}{cac>4000?" ⚠":""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ fontWeight:800,padding:"8px 12px" }}>TOTAL</td>
                    <td className="an-td-center" style={{ fontWeight:700 }}>{filtered.length}</td>
                    <td/>
                    <td className="an-td-right" style={{ fontWeight:700 }}>{inrL(totalBudget)}</td>
                    <td className="an-td-center" style={{ fontWeight:700 }}>{totalLead}</td>
                    <td className="an-td-center" style={{ fontWeight:700 }}>{totalRetail}</td>
                    <td className="an-td-right" style={{ fontWeight:700,color:"#7c3aed" }}>
                      {inrL(totalLead>0?Math.round(totalBudget/totalLead):0)}
                    </td>
                    <td className="an-td-right" style={{ fontWeight:700 }}>{inrL(avgCac)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>

          {/* CAC by state */}
          <Section title="CAC Analysis by State" subtitle="Cost per acquisition — flag >₹4,000">
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {stateRows.filter(r => r.cac > 0).sort((a,b) => a.cac-b.cac).map((r,i) => { const isSt3=stateFilter===r.state; return (
                <div key={r.state} className={`an-rsm-row an-clickable${isSt3?" an-active-row":""}`} onClick={()=>toggleFilter(stateFilter,r.state,setStateFilter)} style={{ outline:isSt3?"2px solid #2563eb":"none",cursor:"pointer" }} title={`Drill: ${r.state}`}>
                  <div className="an-rsm-rank" style={{ color:r.cac>4000?"#dc2626":"#16a34a" }}>
                    {r.cac>4000?"⚠":i+1}
                  </div>
                  <div className="an-rsm-name">{r.state}</div>
                  <div style={{ flex:1 }}>
                    <Bar value={r.cac} max={Math.max(...stateRows.map(s=>s.cac),1)}
                      color={r.cac>4000?"#dc2626":"#16a34a"}/>
                  </div>
                  <div className="an-rsm-stats">
                    <span style={{ fontWeight:700,color:r.cac>4000?"#dc2626":"#16a34a" }}>{inrL(r.cac)}</span>
                    <span className="an-rsm-meta">Retail:{r.retail}</span>
                  </div>
                </div>
              );})}
            </div>
          </Section>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          DAILY ACTIVITY REPORT TAB  (mirrors DashboardPage daily-summary tab)
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "daily-activity" && (
        <>
        {/* Search + filter bar for daily activity */}
        <div style={{ display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center" }}>
          <input value={dailySearch} onChange={e=>setDailySearch(e.target.value)}
            placeholder="🔍 Search dealer, location, state…"
            style={{ flex:"1 1 220px",height:36,padding:"0 12px",border:"1.5px solid #e2e8f0",
              borderRadius:8,fontSize:13,outline:"none",fontFamily:"inherit" }}/>
          <select value={dailyStateFilter} onChange={e=>setDailyStateFilter(e.target.value)}
            style={{ height:36,padding:"0 10px",border:"1.5px solid #e2e8f0",borderRadius:8,
              fontSize:12,fontFamily:"inherit",outline:"none" }}>
            <option value="All">All States</option>
            {stateRows.map(s=><option key={s.state} value={s.state}>{s.state}</option>)}
          </select>
          {(dailySearch||dailyStateFilter!=="All")&&(
            <button onClick={()=>{setDailySearch("");setDailyStateFilter("All");}}
              style={{ height:36,padding:"0 14px",background:"none",border:"1.5px solid #e2e8f0",
                borderRadius:8,fontSize:12,cursor:"pointer",color:"#64748b" }}>Clear ✕</button>
          )}
          <span style={{ fontSize:12,color:"#64748b" }}>
            {filteredDailySummary.length} of {liveDailySummary.length} entries
          </span>
        </div>
        <Section title="Daily Activity Sheet Summary"
          subtitle={`Live · ${filteredDailySummary.length} activities · ${approved.length} approved proposals`}>
          {liveDailySummary.length === 0 ? (
            <div style={{ textAlign:"center",padding:"60px 24px",color:"#9ca3af" }}>
              <div style={{ fontSize:40,marginBottom:12 }}>📅</div>
              <div style={{ fontWeight:700,fontSize:15,color:"#0a2540",marginBottom:6 }}>No post-activity data yet</div>
              <div style={{ fontSize:13 }}>Daily data appears here once RSMs fill post-activity entries for approved proposals.</div>
            </div>
          ) : (
            <>
              {/* Summary KPIs */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16 }}>
                {[
                  {label:"Total Canopy",  value:String(dsTotals.canopy),      color:"#0a2540"},
                  {label:"Enq Planned",   value:String(dsTotals.enquiryPlanned),color:"#2563eb"},
                  {label:"Enq Actual",    value:String(dsTotals.enquiryActual), color:"#16a34a"},
                  {label:"TD Actual",     value:String(dsTotals.trActual),      color:"#7c3aed"},
                  {label:"Retail MTD",    value:String(dsTotals.retailMtd),        color:"#f59e0b"},
                ].map(k=>(
                  <div key={k.label} className="an-kpi" style={{ borderTop:`3px solid ${k.color}` }}>
                    <div className="an-kpi-label">{k.label}</div>
                    <div className="an-kpi-value" style={{ color:k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>
              <div className="an-table-wrap">
                <table className="an-table an-table-full">
                  <thead><tr>
                    <th>#</th><th>Dealer</th><th>Location</th><th>State</th>
                    <th>Canopy</th><th>Enq Plan</th><th>Enq Actual</th><th>/Canopy</th>
                    <th>TD Plan</th><th>TD Actual</th><th>Booking</th>
                    <th>Retail Today</th><th>Retail MTD</th><th>Leads</th><th>Photos</th>
                  </tr></thead>
                  <tbody>
                    {filteredDailySummary.map((row,i)=>(
                      <tr key={i} className="an-tr-click"
                        onClick={()=>{ setSelectedDealerDaily(row); setReportSubTab("dealer-daily"); }}
                        style={{ background:i%2===0?"#fff":"#f8fafc" }}
                        title={`View ${row.dealer} daily sheet`}>
                        <td className="an-td-muted">{row.sr}</td>
                        <td className="an-td-bold">{row.dealer}</td>
                        <td style={{ fontSize:11,color:"#6b7280" }}>{row.location}</td>
                        <td style={{ fontSize:11 }}>{row.state}</td>
                        <td className="an-td-center">{row.canopy}</td>
                        <td className="an-td-center" style={{ color:"#2563eb" }}>{row.enquiryPlanned||"—"}</td>
                        <td className="an-td-center" style={{ fontWeight:row.enquiryActual>0?700:400,color:row.enquiryActual>0?"#16a34a":"#94a3b8" }}>{row.enquiryActual||"—"}</td>
                        <td className="an-td-center" style={{ fontSize:11,color:"#6b7280" }}>{row.perCanopy>0?row.perCanopy.toFixed(1):"—"}</td>
                        <td className="an-td-center" style={{ color:"#7c3aed" }}>{row.trPlanned||"—"}</td>
                        <td className="an-td-center" style={{ fontWeight:row.trActual>0?700:400,color:row.trActual>0?"#7c3aed":"#94a3b8" }}>{row.trActual||"—"}</td>
                        <td className="an-td-center" style={{ color:"#f59e0b",fontWeight:row.bookToday>0?700:400 }}>{row.bookToday||"—"}</td>
                        <td className="an-td-center" style={{ color:"#f59e0b",fontWeight:700 }}>{row.retailToday||"—"}</td>
                        <td className="an-td-center" style={{ color:"#16a34a",fontWeight:700 }}>{row.retailMtd||"—"}</td>
                        <td className="an-td-center">{row.leads||"—"}</td>
                        <td className="an-td-center">
                          {(row as any).photos>0?<span style={{ color:"#16a34a",fontWeight:700,fontSize:11 }}>📸 {(row as any).photos}</span>:<span style={{ color:"#e2e8f0",fontSize:11 }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ padding:"8px 12px",fontWeight:800,color:"#0a2540" }}>TOTALS</td>
                      <td className="an-td-center" style={{ fontWeight:700 }}>{dsTotals.canopy}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#2563eb" }}>{dsTotals.enquiryPlanned}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#16a34a" }}>{dsTotals.enquiryActual}</td>
                      <td/>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#7c3aed" }}>{dsTotals.trPlanned}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#7c3aed" }}>{dsTotals.trActual}</td>
                      <td/>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#f59e0b" }}>{liveDailySummary.reduce((s,r)=>s+r.retailToday,0)}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#16a34a" }}>{dsTotals.retailMtd}</td>
                      <td className="an-td-center" style={{ fontWeight:700 }}>{dsTotals.leads}</td>
                      <td/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </Section>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          LEAD REPORT TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "lead-report" && (
        <Section title="Lead Report — State-wise" subtitle="Planned vs Actual leads by source">
          <div className="an-table-wrap">
            <table className="an-table an-table-full">
              <thead>
                <tr style={{ background:"#0a2540" }}>
                  <th rowSpan={2} style={{ padding:"8px 10px",color:"#e2e8f0",textAlign:"left",verticalAlign:"middle" }}>State</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#e2e8f0",textAlign:"center",verticalAlign:"middle" }}>Expected Leads</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#93c5fd",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>Walk-in</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#6ee7b7",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>BTL</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#c4b5fd",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>Referral</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#fbbf24",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>Digital</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#e2e8f0",textAlign:"center",verticalAlign:"middle" }}>Total Actual</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#e2e8f0",textAlign:"center",verticalAlign:"middle" }}>Conv%</th>
                </tr>
                <tr style={{ background:"#0f172a" }}>
                  {["Tgt","MTD-T","MTD-A","Tgt","MTD-T","MTD-A","Tgt","MTD-T","MTD-A","Tgt","MTD-T","MTD-A"].map((h,i)=>(
                    <th key={i} style={{ padding:"5px 6px",fontSize:9,textAlign:"center",color:"#94a3b8" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(()=>{
                const leadRows = stateRows.map(sr => ({
                  state: sr.state,
                  expectedLeads: sr.lead,
                  walkinTarget: 0, walkinMtdT: 0, walkinMtdA: 0,
                  btlTarget: sr.lead, btlMtdT: sr.lead,
                  btlMtdA: dailyAgg.reduce((s,d)=>s+d.leadsPunched,0) > 0
                    ? Math.round(dailyAgg.reduce((s,d)=>s+d.leadsPunched,0) * (sr.lead / Math.max(totalLead,1)))
                    : 0,
                  referralTarget: 0, referralMtdT: 0, referralMtdA: 0,
                  digitalTarget: 0, digitalMtdT: 0, digitalMtdA: 0,
                }));
                return (<>{leadRows.map((r, i: number)=>{
                  const totalActual=r.walkinMtdA+r.btlMtdA+r.referralMtdA+r.digitalMtdA;
                  const conv=r.expectedLeads>0?Math.round(totalActual/r.expectedLeads*100):0;
                  return (
                    <tr key={r.state} style={{ background:i%2===0?"#fff":"#f8fafc" }}>
                      <td className="an-td-bold">{r.state}</td>
                      <td className="an-td-center">{r.expectedLeads}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.walkinTarget}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.walkinMtdT}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#2563eb" }}>{r.walkinMtdA}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.btlTarget}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.btlMtdT}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#16a34a" }}>{r.btlMtdA}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.referralTarget}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.referralMtdT}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#7c3aed" }}>{r.referralMtdA}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.digitalTarget}</td>
                      <td className="an-td-center" style={{ fontSize:11 }}>{r.digitalMtdT}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:"#f59e0b" }}>{r.digitalMtdA}</td>
                      <td className="an-td-center" style={{ fontWeight:800,color:"#0a2540" }}>{totalActual}</td>
                      <td className="an-td-center" style={{ fontWeight:700,color:conv>=80?"#16a34a":conv>=50?"#f59e0b":"#dc2626" }}>{conv}%</td>
                    </tr>
                        );
                    })}
                  </>
                );
                })()}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Bottom padding */}
      <div style={{ height:40 }}/>
    </div>
  );
}
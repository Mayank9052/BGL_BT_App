// src/pages/AnalyticsDashboard.tsx
// Full analytics dashboard — region/state/activity/budget/lead/daily data insights
import { useState, useMemo, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchProposals, type ProposalResponse } from "../services/proposalService";
import { useAuthStore } from "../store/authStore";
import DownloadReportButton from "../components/DownloadReportButton";
import type { ExportColumn } from "../utils/exportReport";
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

const dailySummaryExportColumns: ExportColumn[] = [
  { header: "Sr.No", key: "sr" },
  { header: "Dealer", key: "dealer" },
  { header: "Activity Type", key: "activityType" },
  { header: "Location", key: "location" },
  { header: "State", key: "state" },
  { header: "Setup Count", key: "setupCount" },
  { header: "Enquiry Planned", key: "enquiryPlanned" },
  { header: "Enquiry Actual", key: "enquiryActual" },
  { header: "Enquiry Per Canopy", key: "perCanopy" },
  { header: "Hot", key: "hot" },
  { header: "Test Rides Planned", key: "trPlanned" },
  { header: "Test Rides Actual", key: "trActual" },
  { header: "Test Rides Per Canopy", key: "trPerCanopy" },
  { header: "Booking Today", key: "bookToday" },
  { header: "Booking In Hand", key: "bookInHand" },
  { header: "Retail Today", key: "retailToday" },
  { header: "MTD Retail (Activity)", key: "retailMtdAct" },
  { header: "Retail MTD", key: "retailMtd" },
  { header: "Retail Rate/Canopy", key: "retailRatePerCanopy" },
  { header: "Activity Day", key: "activityDay" },
  { header: "Closing Stock", key: "closingStock" },
  { header: "LMS Leads", key: "leads" },
  { header: "LMS Punched", key: "punched" },
  { header: "LMS Gap", key: "gap" },
  { header: "Conv%", key: "convPct" },
];

const dealerDailyExportColumns: ExportColumn[] = [
  { header: "Date", key: "date" },
  { header: "Opening Stock", key: "openingStock" },
  { header: "Canopy", key: "setupCount" },
  { header: "Enquiry Planned", key: "enquiryPlanned" },
  { header: "Enquiry Actual", key: "enquiryActual" },
  { header: "Walk in", key: "walkIn" },
  { header: "In LMS", key: "inLms" },
  { header: "Gap", key: "enquiryGap" },
  { header: "Hot", key: "enquiryHot" },
  { header: "Revised Hot", key: "revisedHot" },
  { header: "TD Planned", key: "testDrivePlanned" },
  { header: "TD Actual", key: "testDriveActual" },
  { header: "Booking Today", key: "bookingActual" },
  { header: "Booking In Hand", key: "bookingInHand" },
  { header: "Retail", key: "retailMtdActivity" },
  { header: "MTD Retail", key: "retailMtd" },
];
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
// type DailyEntry = {
//   date: string; enquiryPlanned: number; enquiryActual: number;
//   testDrivePlanned: number; testDriveActual: number;
//   bookingActual: number; retailActual: number; leadsPunched: number;
// };
// ─── Daily entry / media types (same shape ApproverDashboard writes) ────────
interface DailyEntry {
  date: string; setupCount?: number; openingStock?: number;
  enquiryPlanned: number; enquiryActual: number; enquiryHot?: number; revisedHot?: number;
  walkIn?: number; inLms?: number; enquiryGap?: number;
  testDrivePlanned: number; testDriveActual: number; testDrivePerCanopy?: number;
  bookingActual: number; bookingInHand?: number;
  retailActual: number; retailMtdActivity?: number; closingStock?: number;
  retailMtd?: number; retailRatePerCanopy?: number;
  lmsLeads?: number;
  leadsPunched: number;
}
interface ProofMedia {
  id: string; fileUrl: string; fileName: string; fileType: string | null;
  capturedAt: string; latitude?: number | null; longitude?: number | null;
}
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const resolveMediaUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
};
const mediaIconFor = (t: string | null) =>
  !t ? "📎" : t.startsWith("image/") ? "🖼" : t.includes("pdf") ? "📄" : t.startsWith("video/") ? "🎬" : "📎";
const isImageType = (t: string | null) => !!t?.startsWith("image/");
const isVideoType = (t: string | null) => !!t?.startsWith("video/");

interface StateRow { state:string; proposals:number; budget:number; approved:number; lead:number; retail:number; cac:number; }
interface ActivityRow { name:string; count:number; budget:number; lead:number; retail:number; atl:number; btl:number; }
interface MonthRow { month:string; proposals:number; budget:number; lead:number; retail:number; }

interface DailySummaryRow {
  sr: number; dealer: string; location: string; state: string;
  zone: string; bgMember: string; canopy: number; setupCount: number,
  enquiryPlanned: number; enquiryActual: number; perCanopy: number; hot: number;
  trPlanned: number; trActual: number; trPerCanopy: number;
  bookToday: number; bookInHand: number;
  retailToday: number; retailMtdAct: number; retailMtd: number; retailRatePerCanopy: number;
  activityDay: number; closingStock: number;
  leads: number; punched: number; gap: number; convPct: number;
  proposalId: string; activityId: string; activityType: string;
  dailyEntries: DailyEntry[]; media: ProofMedia[];
}

interface LeadReportRow {
  state: string;
  // Per-channel: Target (month), MTD Target, MTD Achieved
  walkinTarget: number; walkinMtdT: number; walkinMtdA: number;
  btlTarget: number; btlMtdT: number; btlMtdA: number;
  referralTarget: number; referralMtdT: number; referralMtdA: number;
  atlTarget: number; atlMtdT: number; atlMtdA: number;
  digitalTarget: number; digitalMtdT: number; digitalMtdA: number;
  // Rollups
  leadsMonthTarget: number;   // sum of 5 channel Targets
  leadsMtdTarget: number;     // sum of 5 channel MTD Targets
  totalReceived: number;      // sum of 5 channel MTD Ach.
  variance: number;           // totalReceived - leadsMonthTarget
  achPct: number;             // totalReceived / leadsMonthTarget * 100
  achPctMtd: number;          // totalReceived / leadsMtdTarget * 100
  // Retail
  retailTarget: number;       // manual open field
  mtdRetailTarget: number;    // pro-rated till-date target
  mtdRetailAchieved: number;  // actual achieved to date (from BTL data)
  mtdRetailAchPct: number;    // mtdRetailAchieved / mtdRetailTarget * 100
  retailEnqPct: number;       // mtdRetailAchieved / totalReceived * 100
}

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
  const [dailyActivityTypeFilter, setDailyActivityTypeFilter] = useState("All");
  const [anMediaViewer, setAnMediaViewer] = useState<{url:string;name:string;type:string|null}|null>(null);
  // ── FIX: moved above the early loading/error returns below — this hook
  // was previously declared AFTER `if (loading) return...` / `if (error) return...`,
  // which violates React's Rules of Hooks (a hook must be called on every render,
  // in the same order). That caused "Rendered more hooks than during the previous
  // render" once loading flipped from true → false. ──
  const [manualRetailTargets, setManualRetailTargets] = useState<Record<string,string>>({});

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
            d.setupCount       = (d.setupCount||0) + ((e as any).setupCount || 0);
            d.enquiryPlanned  += e.enquiryPlanned  || 0;
            d.enquiryActual   += e.enquiryActual   || 0;
            d.testDrivePlanned += e.testDrivePlanned || 0;
            d.testDriveActual += e.testDriveActual || 0;
            d.bookingActual   += e.bookingActual   || 0;
            d.retailActual    += e.retailActual    || 0;
            d.lmsLeads         = (d.lmsLeads||0) + ((e as any).lmsLeads || 0);
            d.leadsPunched    += e.leadsPunched    || 0;
          }
        } catch {}
      }
    }
    return Object.values(map).sort((a,b) => a.date.localeCompare(b.date));
  }, [approved]);

  const dailyTotals = useMemo(() => ({
    setupCount:      dailyAgg.reduce((s,d) => s + (d.setupCount||0), 0),
    enquiryActual:  dailyAgg.reduce((s,d) => s + d.enquiryActual, 0),
    testDriveActual: dailyAgg.reduce((s,d) => s + d.testDriveActual, 0),
    bookingActual:  dailyAgg.reduce((s,d) => s + d.bookingActual, 0),
    retailActual:   dailyAgg.reduce((s,d) => s + d.retailActual, 0),
    lmsLeads:       dailyAgg.reduce((s,d) => s + ((d as any).lmsLeads||0), 0),
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
        // ── FIX: when ATL/BTL KPI filter is active, only include activities
        // matching that category — previously the whole proposal was kept
        // if ANY activity matched, letting the other category leak through. ──
        if (actFilter === "ATL_FILTER" && (a as any).category !== "ATL") continue;
        if (actFilter === "BTL_FILTER" && (a as any).category === "ATL") continue;

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
  }, [filtered, actFilter]);

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
    const approvedProposals = approved;
    const rows: DailySummaryRow[] = [];
    let sr = 1;
    for (const p of approvedProposals) {
      for (const a of p.activities) {
        const dailyData = (a as any).dailyData;
        let entries: DailyEntry[] = [];
        if (dailyData) { try { entries = JSON.parse(dailyData); } catch {} }

        const totalEnqPlanned = entries.reduce((s,e)=>s+(e.enquiryPlanned||0),0);
        const totalEnqActual  = entries.reduce((s,e)=>s+(e.enquiryActual||0),0);
        const totalTrPlanned  = entries.reduce((s,e)=>s+(e.testDrivePlanned||0),0);
        const totalTrActual   = entries.reduce((s,e)=>s+(e.testDriveActual||0),0);
        const totalBookToday  = entries.reduce((s,e)=>s+(e.bookingActual||0),0);
        const totalRetail     = entries.reduce((s,e)=>s+(e.retailActual||0),0);
        const totalPunched    = entries.reduce((s,e)=>s+(e.leadsPunched||0),0);
        const totalLmsLeads   = entries.reduce((s,e)=>s+((e as any).lmsLeads||0),0);

        const rawMedia = (a as any).mediaFiles ?? [];
        const media: ProofMedia[] = rawMedia.map((m: any) => ({
          id: m.id, fileUrl: m.fileUrl, fileName: m.fileName, fileType: m.fileType ?? null,
          capturedAt: m.capturedAt ?? new Date().toISOString(),
          latitude: m.latitude ?? null, longitude: m.longitude ?? null,
        }));

        const canopy = (a as any).qty || 1;
        const totalSetupCount = entries.reduce((s,e)=>s+((e as any).setupCount||0),0);
        const totalHot        = entries.reduce((s,e)=>s+((e as any).enquiryHot||0),0);
        const lastBookInHand = [...entries].reverse().find(e=>((e as any).bookingInHand||0)>0) as any;
        const bookInHandVal = lastBookInHand?.bookingInHand ?? 0;
        const lastMtdActivity = [...entries].reverse().find(e=>((e as any).retailMtdActivity||0)>0) as any;
        const retailMtdActivityVal = lastMtdActivity?.retailMtdActivity ?? 0;
        const lastClosingStock = [...entries].reverse().find(e=>((e as any).closingStock||0)>0) as any;
        const closingStockVal = lastClosingStock?.closingStock ?? 0;
        // ── Retail MTD and Retail Rate/Canopy are MANUAL, per-day open input
        // fields in ApproverDashboard (entry.retailMtd / entry.retailRatePerCanopy)
        // — not computed from retailActual or setupCount. Read the latest
        // non-zero manually-entered value, matching ApproverDashboard's own
        // footer logic. ──
        const lastRetailMtd = [...entries].reverse().find(e=>((e as any).retailMtd||0)>0) as any;
        const retailMtdVal = lastRetailMtd?.retailMtd ?? 0;
        const lastRetailRate = [...entries].reverse().find(e=>((e as any).retailRatePerCanopy||0)>0) as any;
        const retailRatePerCanopyVal = lastRetailRate?.retailRatePerCanopy ?? 0;
        const activityDayCount = entries.filter(e =>
          (e.enquiryActual||0) > 0 || (e.testDriveActual||0) > 0 ||
          (e.bookingActual||0) > 0 || (e.retailActual||0) > 0 ||
          (e.leadsPunched||0) > 0 || ((e as any).setupCount||0) > 0
        ).length;

        rows.push({
          sr, dealer: p.dealerName||"", location: p.location||"",
          state: p.state||"", zone: (p as any).zone||"", bgMember: p.commandoName||"",
          canopy, setupCount: totalSetupCount,
          enquiryPlanned: totalEnqPlanned, enquiryActual: totalEnqActual,
          perCanopy: totalSetupCount>0?Math.round(totalEnqActual/totalSetupCount):0,
          hot: totalHot,
          trPlanned: totalTrPlanned, trActual: totalTrActual,
          trPerCanopy: totalSetupCount>0?Math.round(totalTrActual/totalSetupCount):0,
          bookToday: totalBookToday, bookInHand: bookInHandVal,
          retailToday: totalRetail, retailMtdAct: retailMtdActivityVal, retailMtd: retailMtdVal,
          retailRatePerCanopy: retailRatePerCanopyVal,
          activityDay: activityDayCount, closingStock: closingStockVal,
          leads: totalLmsLeads, punched: totalPunched,
          gap: totalLmsLeads - totalPunched,
          convPct: totalLmsLeads > 0 ? Math.round((retailMtdActivityVal/totalLmsLeads)*100) : 0,
          photos: media.length,
          proposalId: p.id, activityId: a.id, activityType: a.activityType,
          dailyEntries: entries, media,
        } as DailySummaryRow & { photos: number });
        sr++;
      }
    }
    return rows;
  }, [approved]);

  const dsTotals = useMemo(() => {
    const src = liveDailySummary;
    const totalCanopy  = src.reduce((s, r) => s + r.canopy, 0);
    const totalSetupCount = src.reduce((s, r) => s + (r.setupCount||0), 0);
    const totalEnqAct  = src.reduce((s, r) => s + r.enquiryActual, 0);
    const totalTrAct   = src.reduce((s, r) => s + r.trActual, 0);
    const totalRetail  = src.reduce((s, r) => s + r.retailMtd, 0);
    const totalLeads   = src.reduce((s, r) => s + r.leads, 0);
    return {
      canopy:         totalCanopy,
      setupCount:     totalSetupCount,
      enquiryPlanned: src.reduce((s, r) => s + r.enquiryPlanned, 0),
      enquiryActual:  totalEnqAct,
      // ── Sum each dealer row's own Per Canopy / Conv% value,
      // not a single ratio recomputed from combined totals. ──
      perCanopy:      src.reduce((s, r) => s + (r.perCanopy||0), 0),
      hot:            src.reduce((s, r) => s + r.hot, 0),
      trPlanned:      src.reduce((s, r) => s + r.trPlanned, 0),
      trActual:       totalTrAct,
      trPerCanopy:    src.reduce((s, r) => s + (r.trPerCanopy||0), 0),
      bookToday:      src.reduce((s, r) => s + r.bookToday, 0),
      bookInHand:     src.reduce((s, r) => s + r.bookInHand, 0),
      retailToday:    src.reduce((s, r) => s + r.retailToday, 0),
      retailMtdAct:   src.reduce((s, r) => s + r.retailMtdAct, 0),
      retailMtd:      totalRetail,
      leads:          totalLeads,
      punched:        src.reduce((s, r) => s + r.punched, 0),
      gap:            src.reduce((s, r) => s + r.gap, 0),
      convPct:        src.reduce((s, r) => s + (r.convPct||0), 0),
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

  const dailyActivityTypes = useMemo(() => {
    const types = Array.from(new Set(liveDailySummary.map(r => r.activityType).filter(Boolean))).sort();
    return ["All", ...types];
  }, [liveDailySummary]);

  const filteredDailySummary = useMemo(() => liveDailySummary.filter(row => {
    if (dailyStateFilter !== "All" && row.state !== dailyStateFilter) return false;
    if (dailyActivityTypeFilter !== "All" && row.activityType !== dailyActivityTypeFilter) return false;
    if (dailySearch) {
      const q = dailySearch.toLowerCase();
      return (row.dealer+row.location+row.state+row.bgMember).toLowerCase().includes(q);
    }
    return true;
  }), [liveDailySummary, dailySearch, dailyStateFilter, dailyActivityTypeFilter]);

  const maxDealerBudget = Math.max(...dealerRows.map(r => r.budget), 1);

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
            <KPI label="Enquiries (Actual)"  value={String(dailyTotals.enquiryActual)}  color="#0891b2" sub="from post-activity" active={activeKpi==="enq_ov"} onClick={()=>toggleKpi("enq_ov",()=>setActiveTab("daily-activity"),()=>setActiveTab("overview"))}/>
            <KPI label="LMS Leads Punched"   value={String(dailyTotals.leadsPunched)}   color="#6366f1" sub="from post-activity" active={activeKpi==="lms_ov"} onClick={()=>toggleKpi("lms_ov",()=>setActiveTab("daily-activity"),()=>setActiveTab("overview"))}/>
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
                <KPI key="tot" label="Total Activities"  value={String(allActs.length)} color="#0a2540" sub={`${activityRows.length} types`} active={activeKpi==="act_tot"} onClick={()=>toggleKpi("act_tot",()=>setActFilter(null),()=>setActFilter(null))}/>,
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
        {reportSubTab === "summary" ? (
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
          <select value={dailyActivityTypeFilter} onChange={e=>setDailyActivityTypeFilter(e.target.value)}
            style={{ height:36,padding:"0 10px",border:"1.5px solid #e2e8f0",borderRadius:8,
              fontSize:12,fontFamily:"inherit",outline:"none" }}>
            {dailyActivityTypes.map(t=><option key={t} value={t}>{t==="All"?"All Activity Types":t}</option>)}
          </select>
          {(dailySearch||dailyStateFilter!=="All"||dailyActivityTypeFilter!=="All")&&(
            <button onClick={()=>{setDailySearch("");setDailyStateFilter("All");setDailyActivityTypeFilter("All");}}
              style={{ height:36,padding:"0 14px",background:"none",border:"1.5px solid #e2e8f0",
                borderRadius:8,fontSize:12,cursor:"pointer",color:"#64748b" }}>Clear ✕</button>
          )}
          <span style={{ fontSize:12,color:"#64748b" }}>
            {filteredDailySummary.length} of {liveDailySummary.length} entries
          </span>
          <div style={{ marginLeft:"auto" }}>
            <DownloadReportButton
              filename="Daily_Activity_Sheet_Summary"
              title="Daily Activity Sheet Summary"
              columns={dailySummaryExportColumns}
              rows={filteredDailySummary as any}
            />
          </div>
        </div>
        <Section title="Daily Activity Sheet Summary"
          subtitle={`Live · ${filteredDailySummary.length} activities · ${approved.length} approved proposals`}>{liveDailySummary.length === 0 ? (
            <div style={{ textAlign:"center",padding:"60px 24px",color:"#9ca3af" }}>
              <div style={{ fontSize:40,marginBottom:12 }}>📅</div>
              <div style={{ fontWeight:700,fontSize:15,color:"#0a2540",marginBottom:6 }}>No post-activity data yet</div>
              <div style={{ fontSize:13 }}>Daily data appears here once RSMs fill post-activity entries for approved proposals.</div>
            </div>
          ) : (
            <>
              {/* Summary KPIs */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:10,marginBottom:16 }}>
                {[
                  {label:"Total Canopy",  value:String(dsTotals.canopy),      color:"#0a2540"},
                  {label:"Setup Count",   value:String(dsTotals.setupCount),  color:"#92400e"},
                  {label:"Enq Actual",    value:String(dsTotals.enquiryActual), color:"#16a34a"},
                  {label:"Hot",           value:String(dsTotals.hot),         color:"#dc2626"},
                  {label:"TD Actual",     value:String(dsTotals.trActual),      color:"#7c3aed"},
                  {label:"Retail MTD",    value:String(dsTotals.retailMtd),        color:"#f59e0b"},
                  // ── NEW: Retail Rate/Canopy = Σ Retail (daily) ÷ Σ Setup Count (Canopy)
                  // e.g. Canopy total 33, Retail total 27 → 27/33 = 0.818 → 0.8
                  {label:"Retail Rate/Canopy", value: dsTotals.setupCount>0
                    ? (Math.round((dsTotals.retailToday/dsTotals.setupCount)*10)/10).toFixed(1)
                    : "0.0", color:"#c2410c"},
                ].map(k=>(
                  <div key={k.label} className="an-kpi" style={{ borderTop:`3px solid ${k.color}` }}>
                    <div className="an-kpi-label">{k.label}</div>
                    <div className="an-kpi-value" style={{ color:k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {(()=>{
                // ── Excel-style banded colors (mirrors "Daily Summary Sheet" layout) ──
                const bandEnquiry = "#0e5f7a";   // dark teal
                const bandTestRide = "#0369a1";  // cyan-blue
                const bandBooking  = "#1d4ed8";  // blue
                const bandRetail   = "#c2410c";  // orange
                const bandLms      = "#be123c";  // rose
                const bandConv     = "#0891b2";  // cyan

                const perCanopyColor = (v:number) => v>=25?"#16a34a":v>=15?"#ca8a04":v>0?"#dc2626":"#94a3b8";
                const perCanopyBg    = (v:number) => v>=25?"#dcfce7":v>=15?"#fef9c3":v>0?"#fee2e2":"transparent";
                const convBg = (v:number) => v>=10?"#dcfce7":v>=5?"#fef9c3":"#fee2e2";
                const convColor = (v:number) => v>=10?"#166534":v>=5?"#854d0e":"#991b1b";

                return (
                  <div className="an-table-wrap">
                    <table className="an-table an-table-full" style={{ minWidth:2000, borderCollapse:"separate", borderSpacing:0 }}>
                      <thead>
                        {/* Row 1 — grouped section bands */}
                        <tr>
                          <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 8px",textAlign:"center",verticalAlign:"middle" }}>Sr.No</th>
                          <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>Dealer</th>
                          <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>Activity Type</th>
                          <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>Location</th>
                          <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>State</th>
                          <th colSpan={5} style={{ background:bandEnquiry,color:"#fff",padding:"6px 8px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.2)" }}>Enquiry</th>
                          <th colSpan={3} style={{ background:bandTestRide,color:"#fff",padding:"6px 8px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.2)" }}>Test Rides</th>
                          <th colSpan={2} style={{ background:bandBooking,color:"#fff",padding:"6px 8px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.2)" }}>Bookings</th>
                          <th colSpan={4} style={{ background:bandRetail,color:"#fff",padding:"6px 8px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.2)" }}>Retail</th>
                          <th rowSpan={2} style={{ background:"#334155",color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Activity<br/>Day</th>
                          <th rowSpan={2} style={{ background:"#334155",color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Closing<br/>Stock</th>
                          <th colSpan={3} style={{ background:bandLms,color:"#fff",padding:"6px 8px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.2)" }}>LMS</th>
                          <th rowSpan={2} style={{ background:bandConv,color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle" }}>Conv%</th>
                          <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle" }}>Photos</th>
                        </tr>
                        {/* Row 2 — individual column labels within each band */}
                        <tr>
                          <th style={{ background:bandEnquiry,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Setup<br/>Count</th>
                          <th style={{ background:bandEnquiry,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Planned</th>
                          <th style={{ background:bandEnquiry,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Actual</th>
                          <th style={{ background:bandEnquiry,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Per<br/>Canopy</th>
                          <th style={{ background:bandEnquiry,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Hot</th>
                          <th style={{ background:bandTestRide,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Planned</th>
                          <th style={{ background:bandTestRide,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Actual</th>
                          <th style={{ background:bandTestRide,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Per<br/>Canopy</th>
                          <th style={{ background:bandBooking,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Today</th>
                          <th style={{ background:bandBooking,color:"#e0f2fe",padding:"5px 6px",fontSize:11,textAlign:"center" }}>In Hand</th>
                          <th style={{ background:bandRetail,color:"#ffedd5",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Today</th>
                          <th style={{ background:bandRetail,color:"#ffedd5",padding:"5px 6px",fontSize:11,textAlign:"center" }}>MTD Retail<br/>(Activity)</th>
                          <th style={{ background:bandRetail,color:"#ffedd5",padding:"5px 6px",fontSize:11,textAlign:"center" }}>MTD</th>
                          <th style={{ background:bandRetail,color:"#ffedd5",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Rate/<br/>Canopy</th>
                          <th style={{ background:bandLms,color:"#ffe4e6",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Leads</th>
                          <th style={{ background:bandLms,color:"#ffe4e6",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Punched</th>
                          <th style={{ background:bandLms,color:"#ffe4e6",padding:"5px 6px",fontSize:11,textAlign:"center" }}>Gap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDailySummary.map((row,i)=>(
                          <tr key={i} className="an-tr-click"
                            onClick={()=>{ setSelectedDealerDaily(row); setReportSubTab("dealer-daily"); }}
                            style={{ background:i%2===0?"#fff":"#f8fafc" }}
                            title={`View ${row.dealer} daily sheet`}>
                            <td className="an-td-muted">{row.sr}</td>
                            <td className="an-td-bold">{row.dealer}</td>
                            <td className="an-td-bold">{row.activityType}</td>
                            <td style={{ fontSize:11,color:"#6b7280" }}>{row.location}</td>
                            <td style={{ fontSize:11 }}>{row.state}</td>
                            {/* Enquiry */}
                            <td className="an-td-center" style={{ fontWeight:700,background:"#fefce8" }}>{row.setupCount||"—"}</td>
                            <td className="an-td-center" style={{ color:"#0369a1" }}>{row.enquiryPlanned||"—"}</td>
                            <td className="an-td-center" style={{ fontWeight:700,color:"#0e7490" }}>{row.enquiryActual||"—"}</td>
                            <td className="an-td-center" style={{ fontWeight:700,background:perCanopyBg(row.perCanopy),color:perCanopyColor(row.perCanopy) }}>{row.perCanopy||"—"}</td>
                            <td className="an-td-center" style={{ color:row.hot>0?"#dc2626":"#94a3b8",fontWeight:row.hot>0?700:400 }}>{row.hot||"—"}</td>
                            {/* Test Rides */}
                            <td className="an-td-center" style={{ color:"#0369a1" }}>{row.trPlanned||"—"}</td>
                            <td className="an-td-center" style={{ fontWeight:700,color:"#0369a1" }}>{row.trActual||"—"}</td>
                            <td className="an-td-center" style={{ fontWeight:700,background:perCanopyBg(row.trPerCanopy),color:perCanopyColor(row.trPerCanopy) }}>{row.trPerCanopy||"—"}</td>
                            {/* Bookings */}
                            <td className="an-td-center" style={{ color:"#1d4ed8",fontWeight:row.bookToday>0?700:400 }}>{row.bookToday||"—"}</td>
                            <td className="an-td-center" style={{ color:"#1d4ed8" }}>{row.bookInHand||"—"}</td>
                            {/* Retail */}
                            <td className="an-td-center" style={{ color:"#c2410c",fontWeight:700 }}>{row.retailToday||"—"}</td>
                            <td className="an-td-center" style={{ color:"#c2410c" }}>{row.retailMtdAct||"—"}</td>
                            <td className="an-td-center" style={{ color:"#c2410c",fontWeight:700 }}>{row.retailMtd||"—"}</td>
                            <td className="an-td-center" style={{ fontWeight:700,background:row.retailRatePerCanopy>=1?"#dcfce7":row.retailRatePerCanopy>0?"#fef9c3":"#fee2e2",color:row.retailRatePerCanopy>=1?"#166534":row.retailRatePerCanopy>0?"#854d0e":"#991b1b" }}>{row.retailRatePerCanopy||"0.0"}</td>
                            {/* Activity Day / Closing Stock */}
                            <td className="an-td-center" style={{ color:"#64748b" }}>{row.activityDay||"—"}</td>
                            <td className="an-td-center" style={{ color:"#64748b" }}>{row.closingStock||"—"}</td>
                            {/* LMS */}
                            <td className="an-td-center" style={{ color:"#be123c" }}>{row.leads||"—"}</td>
                            <td className="an-td-center" style={{ color:"#be123c",fontWeight:700 }}>{row.punched||"—"}</td>
                            <td className="an-td-center" style={{ color:"#be123c" }}>{row.gap||"0"}</td>
                            {/* Conv% */}
                            <td className="an-td-center" style={{ fontWeight:700,background:convBg(row.convPct),color:convColor(row.convPct) }}>{row.convPct}%</td>
                            {/* Photos */}
                            <td className="an-td-center">
                              {(row as any).photos>0?<span style={{ color:"#16a34a",fontWeight:700,fontSize:11 }}>📸 {(row as any).photos}</span>:<span style={{ color:"#e2e8f0",fontSize:11 }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5} style={{ padding:"8px 12px",fontWeight:800,color:"#0a2540",background:"#fce7d6" }}>Total ({filteredDailySummary.length})</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.setupCount}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.enquiryPlanned}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.enquiryActual}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.perCanopy}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.hot}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.trPlanned}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.trActual}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.trPerCanopy}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.bookToday}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.bookInHand}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.retailToday}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.retailMtdAct}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.retailMtd}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>
                            {dsTotals.setupCount>0?(Math.round((dsTotals.retailMtd/dsTotals.setupCount)*10)/10):"0.0"}
                          </td>
                          <td style={{ background:"#fce7d6" }}/>
                          <td style={{ background:"#fce7d6" }}/>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.leads}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.punched}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>{dsTotals.gap}</td>
                          <td className="an-td-center" style={{ fontWeight:700,color:"#0a2540",background:"#fce7d6" }}>
                            {dsTotals.convPct}%
                          </td>
                          <td style={{ background:"#fce7d6" }}/>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })()}
            </>
          )}
        </Section>
        </>
        ) : (
      // ── dealer detail view, shown when reportSubTab === "dealer-daily" ──
      selectedDealerDaily && (
        <>
          {anMediaViewer && (
            <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:10000,
              display:"flex",alignItems:"center",justifyContent:"center" }} onClick={()=>setAnMediaViewer(null)}>
              <div style={{ maxWidth:"92vw",maxHeight:"92vh" }} onClick={(e)=>e.stopPropagation()}>
                {isImageType(anMediaViewer.type)
                  ? <img src={anMediaViewer.url} alt={anMediaViewer.name} style={{ maxWidth:"88vw",maxHeight:"82vh",borderRadius:8 }}/>
                  : isVideoType(anMediaViewer.type)
                    ? <video src={anMediaViewer.url} controls autoPlay style={{ maxWidth:"88vw",maxHeight:"82vh",borderRadius:8 }}/>
                    : <a href={anMediaViewer.url} target="_blank" rel="noopener noreferrer" style={{ color:"#fff" }}>Open {anMediaViewer.name} ↗</a>}
              </div>
            </div>
          )}

          <div style={{ marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
             <button
              onClick={() => { setReportSubTab("summary"); setSelectedDealerDaily(null); }}
              style={{ background:"#f1f5f9", border:"1px solid #e2e8f0", borderRadius:7,
                padding:"6px 14px", fontSize:12, fontWeight:600, cursor:"pointer", color:"#374151" }}>
              ← Back to summary
            </button>
            <span style={{ fontSize:12, color:"#64748b" }}>
              {selectedDealerDaily.state} · {selectedDealerDaily.activityType} · Live daily history
            </span>
            <div style={{ marginLeft:"auto" }}>
              <DownloadReportButton
                filename={`${selectedDealerDaily.dealer.replace(/[^a-z0-9]/gi,"_")}_Daily_Activity`}
                title={`${selectedDealerDaily.dealer}, ${selectedDealerDaily.location} — Daily Activity`}
                columns={dealerDailyExportColumns}
                rows={selectedDealerDaily.dailyEntries.map((entry) => ({
                  date: entry.date,
                  openingStock: entry.openingStock || 0,
                  setupCount: entry.setupCount || 0,
                  enquiryPlanned: entry.enquiryPlanned || 0,
                  enquiryActual: entry.enquiryActual || 0,
                  walkIn: entry.walkIn || 0,
                  inLms: entry.inLms || 0,
                  enquiryGap: entry.enquiryGap || 0,
                  enquiryHot: entry.enquiryHot || 0,
                  revisedHot: entry.revisedHot || 0,
                  testDrivePlanned: entry.testDrivePlanned || 0,
                  testDriveActual: entry.testDriveActual || 0,
                  bookingActual: entry.bookingActual || 0,
                  bookingInHand: entry.bookingInHand || 0,
                  retailMtdActivity: entry.retailMtdActivity || 0,
                  retailMtd: entry.retailMtd || 0,
                }))}
              />
            </div>
          </div>

          {/* ── Everything below (banner, KPI cards, table) is computed from
              ONE shared `totals` object so the KPI cards, the Total row, and
              the Avg row can never drift apart from each other again. ── */}
          {(() => {
            const entries = selectedDealerDaily.dailyEntries;
            const dayCount = entries.length || 1;
            const sum = (fn: (e: DailyEntry) => number) => entries.reduce((s,e)=>s+(fn(e)||0),0);
            const lastNonZero = (fn: (e: DailyEntry) => number) => {
              const found = [...entries].reverse().find(e => (fn(e)||0) > 0);
              return found ? fn(found) : 0;
            };

            // ── Same field set + same totals logic as ApproverDashboard's
            // Post-Activity History table. ──
            const totals = {
              openingStock: lastNonZero(e => e.openingStock || 0),
              canopy:       sum(e => e.setupCount || 0),
              planned:      sum(e => e.enquiryPlanned),
              actual:       sum(e => e.enquiryActual),
              walkIn:       sum(e => e.walkIn || 0),
              inLms:        sum(e => e.inLms || 0),
              gap:          sum(e => e.enquiryGap || 0),
              hot:          sum(e => e.enquiryHot || 0),
              revisedHot:   sum(e => e.revisedHot || 0),
              tdPlanned:    sum(e => e.testDrivePlanned),
              tdActual:     sum(e => e.testDriveActual),
              bookToday:    sum(e => e.bookingActual),
              bookInHand:   sum(e => e.bookingInHand || 0),
              retail:       sum(e => e.retailMtdActivity || 0),
              retailMtd:    sum(e => e.retailMtd || 0),
            };

            const avgRow = {
              canopy:     Math.round((totals.canopy / dayCount) * 10) / 10,
              planned:    Math.round(totals.planned / dayCount),
              actual:     Math.round(totals.actual / dayCount),
              walkIn:     Math.round((totals.walkIn / dayCount) * 10) / 10,
              inLms:      Math.round((totals.inLms / dayCount) * 10) / 10,
              gap:        Math.round((totals.gap / dayCount) * 10) / 10,
              hot:        Math.round((totals.hot / dayCount) * 10) / 10,
              revisedHot: Math.round((totals.revisedHot / dayCount) * 10) / 10,
              tdPlanned:  Math.round(totals.tdPlanned / dayCount),
              tdActual:   Math.round(totals.tdActual / dayCount),
              bookToday:  Math.round((totals.bookToday / dayCount) * 10) / 10,
              bookInHand: Math.round((totals.bookInHand / dayCount) * 10) / 10,
              retail:     Math.round((totals.retail / dayCount) * 10) / 10,
              retailMtd:  Math.round((totals.retailMtd / dayCount) * 10) / 10,
            };

            const th = (label:React.ReactNode, extra:React.CSSProperties = {}) => (
              <th style={{ padding:"6px 8px", fontSize:11, fontWeight:700, textAlign:"center",
                border:"1px solid #cbd5e1", background:"#bfdbfe", color:"#0a2540", ...extra }}>{label}</th>
            );
            const td = (val: React.ReactNode, extra:React.CSSProperties = {}) => (
              <td style={{ padding:"5px 8px", fontSize:12, textAlign:"center",
                border:"1px solid #e2e8f0", ...extra }}>{val ?? ""}</td>
            );

            return (
              <>
                {/* ── Title banner ── */}
                <div style={{
                  background:"#0a2540", borderRadius:8,
                  padding:"14px 28px", textAlign:"center", marginBottom:16,
                  boxShadow:"0 4px 10px rgba(22,163,74,0.25)"
                }}>
                  <span style={{ color:"#fff", fontWeight:800, fontSize:20, letterSpacing:"0.02em" }}>
                    {selectedDealerDaily.dealer}, {selectedDealerDaily.location}
                  </span>
                </div>

                {/* ── KPI summary cards — same fields as ApproverDashboard's post-activity totals ── */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10, marginBottom:16 }}>
                  {[
                    { label:"Canopy", value: totals.canopy },
                    { label:"Opening Stock", value: totals.openingStock },
                    { label:"Enq Actual", value: totals.actual },
                    { label:"Walk In", value: totals.walkIn },
                    { label:"In LMS", value: totals.inLms },
                    { label:"Gap", value: totals.gap },
                    { label:"Hot", value: totals.hot },
                    { label:"Revised Hot", value: totals.revisedHot },
                    { label:"TD Actual", value: totals.tdActual },
                    { label:"Booking In Hand", value: totals.bookInHand },
                    { label:"Retail", value: totals.retail },
                    { label:"MTD Retail", value: totals.retailMtd },
                    { label:"Retail Rate/Canopy", value: totals.canopy > 0
                          ? (Math.round((totals.retail / totals.canopy) * 10) / 10).toFixed(1)
                          : "0.0" },
                    { label:"Activity Days", value: entries.length },
                  ].map((f) => (
                    <div key={f.label} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:"#6b7280", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>{f.label}</div>
                      <div style={{ fontSize:18, fontWeight:700, color:"#0a2540", marginTop:4 }}>{f.value}</div>
                    </div>
                  ))}
                </div>

                {entries.length === 0 ? (
                  <div className="an-card" style={{ textAlign:"center",padding:"40px 20px",color:"#9ca3af" }}>
                    <div style={{ fontSize:32,marginBottom:10 }}>📋</div>
                    <div style={{ fontWeight:700,fontSize:14,color:"#0a2540" }}>No daily entries yet for this activity</div>
                  </div>
                ) : (
              <div className="an-table-wrap">
                <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1700, background:"#fff" }}>
                  <thead>
                    {/* Row 0 — dealer / BG member strip */}
                    <tr>
                      <th colSpan={2} style={{ background:"#e5e7eb", padding:"6px 8px", fontWeight:700,
                        fontSize:13, textAlign:"left", border:"1px solid #cbd5e1" }}>
                        {selectedDealerDaily.dealer}, {selectedDealerDaily.location}
                      </th>
                      <th colSpan={13} style={{ background:"#e5e7eb", border:"1px solid #cbd5e1" }}/>
                      <th colSpan={2} style={{ background:"#e5e7eb", padding:"6px 8px", fontWeight:700,
                        fontSize:13, textAlign:"center", border:"1px solid #cbd5e1" }}>
                        BG- {selectedDealerDaily.bgMember || "—"}
                      </th>
                    </tr>
                    {/* Row 1 — grouped bands */}
                    <tr>
                      <th rowSpan={2} style={{ background:"#93c5fd", padding:"6px 8px", fontSize:11,
                        fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Date</th>
                      <th rowSpan={2} style={{ background:"#e2e8f0", padding:"6px 8px", fontSize:11,
                        fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Opening<br/>Stock</th>
                      <th colSpan={8} style={{ background:"#93c5fd", padding:"5px 8px", fontSize:12,
                        fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Enquiry</th>
                      <th colSpan={2} style={{ background:"#fbbf24", padding:"5px 8px", fontSize:12,
                        fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Test Drive</th>
                      <th colSpan={2} style={{ background:"#93c5fd", padding:"5px 8px", fontSize:12,
                        fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Booking</th>
                      <th colSpan={2} style={{ background:"#fbbf24", padding:"5px 8px", fontSize:12,
                        fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Retail</th>
                      <th rowSpan={2} style={{ background:"#c4b5fd", padding:"6px 8px", fontSize:11,
                        fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Media</th>
                    </tr>
                    <tr>
                      {th("Canopy")}{th("Planned")}{th("Actual")}{th("Walk in")}{th("In LMS")}{th("Gap")}{th("Hot")}{th("Revised Hot")}
                      {th("Planned")}{th("Actual")}
                      {th("Today")}{th("In hand")}
                      {th("Retail")}{th("MTD Retail")}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, i) => {
                      const photosOnDay = selectedDealerDaily.media.filter(m =>
                        m.capturedAt.startsWith(entry.date) && (isImageType(m.fileType) || isVideoType(m.fileType)));
                      const invoicesOnDay = selectedDealerDaily.media.filter(m =>
                        m.capturedAt.startsWith(entry.date) && !isImageType(m.fileType) && !isVideoType(m.fileType));
                      const hasData = entry.enquiryActual>0||entry.testDriveActual>0||entry.bookingActual>0||(entry.retailMtdActivity||0)>0||photosOnDay.length>0||invoicesOnDay.length>0;
                      const gapColor = (entry.enquiryGap||0) < 0 ? "#dc2626" : (entry.enquiryGap||0) > 0 ? "#16a34a" : "#64748b";
                      return (
                        <tr key={entry.date} style={{ background:i%2===0?"#fff":"#f8fafc", opacity:hasData?1:0.6 }}>
                          {td(entry.date, { textAlign:"left", fontWeight:600, color:"#374151" })}
                          {td(entry.openingStock || "", { color:"#374151" })}
                          {td(entry.setupCount || "", { fontWeight:700, background:"#fefce8" })}
                          {td(entry.enquiryPlanned || 0)}
                          {td(entry.enquiryActual || "", { fontWeight:700 })}
                          {td(entry.walkIn || "", { color:"#166534" })}
                          {td(entry.inLms || "", { color:"#166534", fontWeight:700 })}
                          {td(entry.enquiryGap ?? 0, { color:gapColor, fontWeight:700 })}
                          {td(entry.enquiryHot || "", { color:(entry.enquiryHot||0)>0?"#b91c1c":undefined, fontWeight:(entry.enquiryHot||0)>0?700:400 })}
                          {td(entry.revisedHot || "", { color:(entry.revisedHot||0)>0?"#b91c1c":undefined, fontWeight:(entry.revisedHot||0)>0?700:400 })}
                          {td(entry.testDrivePlanned || 0)}
                          {td(entry.testDriveActual || "", { fontWeight:700 })}
                          {td(entry.bookingActual || "", { color:"#1d4ed8", fontWeight:(entry.bookingActual||0)>0?700:400 })}
                          {td(entry.bookingInHand || "", { color:"#7c3aed", fontWeight:700 })}
                          {td(entry.retailMtdActivity || "", { color:"#c2410c", fontWeight:700 })}
                          {td(entry.retailMtd || "", { color:"#92400e", fontWeight:700 })}
                          {td(
                            <div style={{ display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center",alignItems:"center" }}>
                              {photosOnDay.slice(0,3).map(m => {
                                const url = resolveMediaUrl(m.fileUrl);
                                return (
                                  <div key={m.id} style={{ width:24,height:24,borderRadius:3,overflow:"hidden",cursor:"pointer",border:"1px solid #bbf7d0" }}
                                    onClick={() => setAnMediaViewer({ url, name: m.fileName, type: m.fileType })}>
                                    {isImageType(m.fileType)
                                      ? <img src={url} alt={m.fileName} style={{ width:"100%",height:"100%",objectFit:"cover" }}/>
                                      : <span style={{ fontSize:13,lineHeight:"24px",display:"block",textAlign:"center" }}>{mediaIconFor(m.fileType)}</span>}
                                  </div>
                                );
                              })}
                              {photosOnDay.length > 3 && <span style={{ fontSize:9,color:"#16a34a",fontWeight:700 }}>+{photosOnDay.length-3}</span>}
                              {invoicesOnDay.length > 0 && <span style={{ fontSize:10,color:"#64748b" }}>🧾{invoicesOnDay.length}</span>}
                              {photosOnDay.length===0 && invoicesOnDay.length===0 && <span style={{ color:"#e2e8f0",fontSize:10 }}>—</span>}
                            </div>
                          )}
                        </tr>
                      );
                    })}

                    {/* ── Total row ── */}
                    <tr style={{ background:"#93c5fd", fontWeight:800 }}>
                      {td("Total", { textAlign:"left", background:"#93c5fd" })}
                      {td(totals.openingStock, { background:"#93c5fd" })}
                      {td(totals.canopy, { background:"#93c5fd" })}
                      {td(totals.planned, { background:"#93c5fd" })}
                      {td(totals.actual, { background:"#93c5fd" })}
                      {td(totals.walkIn, { background:"#93c5fd" })}
                      {td(totals.inLms, { background:"#93c5fd" })}
                      {td(totals.gap, { background:"#93c5fd" })}
                      {td(totals.hot, { background:"#93c5fd" })}
                      {td(totals.revisedHot, { background:"#93c5fd" })}
                      {td(totals.tdPlanned, { background:"#93c5fd" })}
                      {td(totals.tdActual, { background:"#93c5fd" })}
                      {td(totals.bookToday, { background:"#93c5fd" })}
                      {td(totals.bookInHand, { background:"#93c5fd" })}
                      {td(totals.retail, { background:"#93c5fd" })}
                      {td(totals.retailMtd, { background:"#93c5fd" })}
                      {td("📸"+selectedDealerDaily.media.filter(m=>isImageType(m.fileType)||isVideoType(m.fileType)).length, { background:"#93c5fd", fontSize:10 })}
                    </tr>

                    {/* ── Average row ── */}
                    <tr style={{ fontWeight:700 }}>
                      {td("Average", { textAlign:"left" })}
                      {td("—", { fontSize:10, color:"#94a3b8" })}
                      {td(avgRow.canopy, { background:"#fef9c3" })}
                      {td(avgRow.planned, { background:"#fef9c3" })}
                      {td(avgRow.actual, { background:"#fef9c3" })}
                      {td(avgRow.walkIn, { background:"#fef9c3" })}
                      {td(avgRow.inLms, { background:"#fef9c3" })}
                      {td(avgRow.gap, { background:"#fef9c3" })}
                      {td(avgRow.hot, { background:"#fef9c3" })}
                      {td(avgRow.revisedHot, { background:"#fef9c3" })}
                      {td(avgRow.tdPlanned, { background:"#fef9c3" })}
                      {td(avgRow.tdActual, { background:"#fef9c3" })}
                      {td(avgRow.bookToday, { background:"#fef9c3" })}
                      {td(avgRow.bookInHand, { background:"#fef9c3" })}
                      {td(avgRow.retail, { background:"#fef9c3" })}
                      {td(avgRow.retailMtd, { background:"#fef9c3" })}
                      {td("—", { fontSize:10, color:"#94a3b8" })}
                    </tr>
                  </tbody>
                </table>
              </div>
                )}
              </>
            );
          })()}
        </>
      )
    )}
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
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#fde68a",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Leads Month<br/>Target</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#fde68a",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Leads MTD<br/>Target</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#93c5fd",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>Walk-in</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#6ee7b7",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>BTL</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#c4b5fd",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>Referral</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#f472b6",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>ATL</th>
                  <th colSpan={3} style={{ padding:"6px 8px",color:"#fbbf24",textAlign:"center",borderBottom:"1px solid #1e3a5f" }}>Digital</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#e2e8f0",textAlign:"center",verticalAlign:"middle" }}>Total Leads<br/>Received</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#e2e8f0",textAlign:"center",verticalAlign:"middle" }}>Leads<br/>Variance</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#67e8f9",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Leads<br/>Ach%</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#67e8f9",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Leads<br/>Ach% MTD</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#fca5a5",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Retail<br/>Target</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#e2e8f0",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>MTD Retail<br/>Target</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#e2e8f0",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>MTD Retail<br/>Achieved</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#86efac",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>MTD Retail<br/>Ach%</th>
                  <th rowSpan={2} style={{ padding:"8px 8px",color:"#86efac",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Retails/<br/>Enquiries%</th>
                </tr>
                <tr style={{ background:"#0f172a" }}>
                  {["Tgt","MTD-T","MTD-A","Tgt","MTD-T","MTD-A","Tgt","MTD-T","MTD-A","Tgt","MTD-T","MTD-A","Tgt","MTD-T","MTD-A"].map((h,i)=>(
                    <th key={i} style={{ padding:"5px 6px",fontSize:9,textAlign:"center",color:"#94a3b8" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(()=>{
                  const now = new Date();
                  const daysElapsed = now.getDate();
                  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
                  const monthFrac = daysElapsed / daysInMonth;

                  // ── State-wise actual retail achieved from approved proposals' daily data ──
                  const stateRetailAchieved: Record<string, number> = {};
                  for (const p of approved) {
                    const st = p.state || "Unknown";
                    for (const a of p.activities) {
                      const raw = (a as any).dailyData;
                      if (!raw) continue;
                      try {
                        const entries: DailyEntry[] = JSON.parse(raw);
                        const sum = entries.reduce((s,e)=>s+(e.retailActual||0),0);
                        stateRetailAchieved[st] = (stateRetailAchieved[st]||0) + sum;
                      } catch {}
                    }
                  }

                  const leadRows: LeadReportRow[] = stateRows.map(sr => {
                    // NOTE: per-channel Walkin/BTL/Referral/ATL/Digital data will come from
                    // the LMS API once integrated. Until then, these default to 0/placeholder
                    // and only BTL-sourced totals (from dailyAgg) populate the BTL channel.
                    const walkinTarget=0, walkinMtdT=0, walkinMtdA=0;
                    const btlTarget = sr.lead;
                    const btlMtdT   = Math.round(sr.lead * monthFrac);
                    const btlMtdA   = dailyAgg.reduce((s,d)=>s+d.leadsPunched,0) > 0
                      ? Math.round(dailyAgg.reduce((s,d)=>s+d.leadsPunched,0) * (sr.lead / Math.max(totalLead,1)))
                      : 0;
                    const referralTarget=0, referralMtdT=0, referralMtdA=0;
                    const atlTarget=0, atlMtdT=0, atlMtdA=0;
                    const digitalTarget=0, digitalMtdT=0, digitalMtdA=0;

                    // 1. Leads Month Target = sum of all 5 channel Targets
                    const leadsMonthTarget = walkinTarget+btlTarget+referralTarget+atlTarget+digitalTarget;
                    // Leads MTD Target = sum of all 5 channel MTD Targets
                    const leadsMtdTarget = walkinMtdT+btlMtdT+referralMtdT+atlMtdT+digitalMtdT;
                    // 2. Total Leads Received = sum of all 5 channel MTD Achieved
                    const totalReceived = walkinMtdA+btlMtdA+referralMtdA+atlMtdA+digitalMtdA;
                    // 3. Variance = Received - Month Target (negative = shortfall, positive = over-target)
                    const variance = totalReceived - leadsMonthTarget;
                    // 4/5. Achievement %
                    const achPct    = leadsMonthTarget>0 ? Math.round((totalReceived/leadsMonthTarget)*100) : 0;
                    const achPctMtd = leadsMtdTarget>0   ? Math.round((totalReceived/leadsMtdTarget)*100)   : 0;

                    // 6. Retail Target — manual open field
                    const retailTarget = parseFloat(manualRetailTargets[sr.state] ?? "0") || 0;
                    // 7. MTD Retail Target — pro-rated to elapsed days in month
                    const mtdRetailTarget = Math.round(retailTarget * monthFrac);
                    // 8. MTD Retail Achieved — actual achieved-to-date from BTL data
                    const mtdRetailAchieved = stateRetailAchieved[sr.state] || 0;
                    // 9. MTD Retail Achievement %
                    const mtdRetailAchPct = mtdRetailTarget>0 ? Math.round((mtdRetailAchieved/mtdRetailTarget)*100) : 0;
                    // 10. Retails/Enquiries %
                    const retailEnqPct = totalReceived>0 ? Math.round((mtdRetailAchieved/totalReceived)*100) : 0;

                    return {
                      state: sr.state,
                      walkinTarget, walkinMtdT, walkinMtdA,
                      btlTarget, btlMtdT, btlMtdA,
                      referralTarget, referralMtdT, referralMtdA,
                      atlTarget, atlMtdT, atlMtdA,
                      digitalTarget, digitalMtdT, digitalMtdA,
                      leadsMonthTarget, leadsMtdTarget, totalReceived, variance, achPct, achPctMtd,
                      retailTarget, mtdRetailTarget, mtdRetailAchieved, mtdRetailAchPct, retailEnqPct,
                    };
                  });

                  const totals = {
                    leadsMonthTarget: leadRows.reduce((s,r)=>s+r.leadsMonthTarget,0),
                    leadsMtdTarget:   leadRows.reduce((s,r)=>s+r.leadsMtdTarget,0),
                    walkinTarget: leadRows.reduce((s,r)=>s+r.walkinTarget,0),
                    walkinMtdT:   leadRows.reduce((s,r)=>s+r.walkinMtdT,0),
                    walkinMtdA:   leadRows.reduce((s,r)=>s+r.walkinMtdA,0),
                    btlTarget: leadRows.reduce((s,r)=>s+r.btlTarget,0),
                    btlMtdT:   leadRows.reduce((s,r)=>s+r.btlMtdT,0),
                    btlMtdA:   leadRows.reduce((s,r)=>s+r.btlMtdA,0),
                    referralTarget: leadRows.reduce((s,r)=>s+r.referralTarget,0),
                    referralMtdT:   leadRows.reduce((s,r)=>s+r.referralMtdT,0),
                    referralMtdA:   leadRows.reduce((s,r)=>s+r.referralMtdA,0),
                    atlTarget: leadRows.reduce((s,r)=>s+r.atlTarget,0),
                    atlMtdT:   leadRows.reduce((s,r)=>s+r.atlMtdT,0),
                    atlMtdA:   leadRows.reduce((s,r)=>s+r.atlMtdA,0),
                    digitalTarget: leadRows.reduce((s,r)=>s+r.digitalTarget,0),
                    digitalMtdT:   leadRows.reduce((s,r)=>s+r.digitalMtdT,0),
                    digitalMtdA:   leadRows.reduce((s,r)=>s+r.digitalMtdA,0),
                    totalReceived: leadRows.reduce((s,r)=>s+r.totalReceived,0),
                    retailTarget: leadRows.reduce((s,r)=>s+r.retailTarget,0),
                    mtdRetailTarget: leadRows.reduce((s,r)=>s+r.mtdRetailTarget,0),
                    mtdRetailAchieved: leadRows.reduce((s,r)=>s+r.mtdRetailAchieved,0),
                  };
                  const totalVariance   = totals.totalReceived - totals.leadsMonthTarget;
                  const totalAchPct     = totals.leadsMonthTarget>0 ? Math.round((totals.totalReceived/totals.leadsMonthTarget)*100) : 0;
                  const totalAchPctMtd  = totals.leadsMtdTarget>0   ? Math.round((totals.totalReceived/totals.leadsMtdTarget)*100)   : 0;
                  const totalRetailAchPct = totals.mtdRetailTarget>0 ? Math.round((totals.mtdRetailAchieved/totals.mtdRetailTarget)*100) : 0;
                  const totalRetailEnqPct = totals.totalReceived>0   ? Math.round((totals.mtdRetailAchieved/totals.totalReceived)*100)   : 0;
                  // Row-average versions (for an "Avg" row, matching per-row % averages rather than portfolio ratios)
                  const rowCount = leadRows.length || 1;
                  const avgAchPct       = Math.round(leadRows.reduce((s,r)=>s+r.achPct,0)/rowCount);
                  const avgAchPctMtd    = Math.round(leadRows.reduce((s,r)=>s+r.achPctMtd,0)/rowCount);
                  const avgRetailAchPct = Math.round(leadRows.reduce((s,r)=>s+r.mtdRetailAchPct,0)/rowCount);
                  const avgRetailEnqPct = Math.round(leadRows.reduce((s,r)=>s+r.retailEnqPct,0)/rowCount);

                  return (<>{leadRows.map((r, i: number)=>(
                      <tr key={r.state} style={{ background:i%2===0?"#fff":"#f8fafc" }}>
                        <td className="an-td-bold">{r.state}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:"#92400e" }}>{r.leadsMonthTarget}</td>
                        <td className="an-td-center" style={{ fontSize:11,color:"#92400e" }}>{r.leadsMtdTarget}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.walkinTarget}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.walkinMtdT}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:"#2563eb" }}>{r.walkinMtdA}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.btlTarget}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.btlMtdT}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:"#16a34a" }}>{r.btlMtdA}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.referralTarget}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.referralMtdT}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:"#7c3aed" }}>{r.referralMtdA}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.atlTarget}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.atlMtdT}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:"#db2777" }}>{r.atlMtdA}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.digitalTarget}</td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.digitalMtdT}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:"#f59e0b" }}>{r.digitalMtdA}</td>
                        <td className="an-td-center" style={{ fontWeight:800,color:"#0a2540" }}>{r.totalReceived}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:r.variance<0?"#dc2626":"#16a34a" }}>{r.variance<0?r.variance:`+${r.variance}`}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:r.achPct>=80?"#16a34a":r.achPct>=50?"#f59e0b":"#dc2626" }}>{r.achPct}%</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:r.achPctMtd>=80?"#16a34a":r.achPctMtd>=50?"#f59e0b":"#dc2626" }}>{r.achPctMtd}%</td>
                        <td className="an-td-center">
                          <input type="number" min={0} value={manualRetailTargets[r.state] ?? ""} placeholder="0"
                            style={{ width:60,textAlign:"center",border:"1px solid #fecaca",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:"#fef2f2" }}
                            onChange={(e)=>setManualRetailTargets(prev=>({...prev,[r.state]:e.target.value}))}/>
                        </td>
                        <td className="an-td-center" style={{ fontSize:11 }}>{r.mtdRetailTarget}</td>
                        <td className="an-td-center" style={{ fontWeight:700 }}>{r.mtdRetailAchieved}</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:r.mtdRetailAchPct>=80?"#16a34a":r.mtdRetailAchPct>=50?"#f59e0b":"#dc2626" }}>{r.mtdRetailAchPct}%</td>
                        <td className="an-td-center" style={{ fontWeight:700,color:r.retailEnqPct>=10?"#16a34a":r.retailEnqPct>=5?"#f59e0b":"#dc2626" }}>{r.retailEnqPct}%</td>
                      </tr>
                    ))}
                    <tr style={{ background:"#0a2540", fontWeight:800 }}>
                      <td style={{ padding:"8px 10px",color:"#fbbf24" }}>Grand Total</td>
                      <td className="an-td-center" style={{ color:"#fde68a" }}>{totals.leadsMonthTarget}</td>
                      <td className="an-td-center" style={{ color:"#fde68a" }}>{totals.leadsMtdTarget}</td>
                      <td className="an-td-center" style={{ color:"#93c5fd" }}>{totals.walkinTarget}</td>
                      <td className="an-td-center" style={{ color:"#93c5fd" }}>{totals.walkinMtdT}</td>
                      <td className="an-td-center" style={{ color:"#93c5fd" }}>{totals.walkinMtdA}</td>
                      <td className="an-td-center" style={{ color:"#6ee7b7" }}>{totals.btlTarget}</td>
                      <td className="an-td-center" style={{ color:"#6ee7b7" }}>{totals.btlMtdT}</td>
                      <td className="an-td-center" style={{ color:"#6ee7b7" }}>{totals.btlMtdA}</td>
                      <td className="an-td-center" style={{ color:"#c4b5fd" }}>{totals.referralTarget}</td>
                      <td className="an-td-center" style={{ color:"#c4b5fd" }}>{totals.referralMtdT}</td>
                      <td className="an-td-center" style={{ color:"#c4b5fd" }}>{totals.referralMtdA}</td>
                      <td className="an-td-center" style={{ color:"#f472b6" }}>{totals.atlTarget}</td>
                      <td className="an-td-center" style={{ color:"#f472b6" }}>{totals.atlMtdT}</td>
                      <td className="an-td-center" style={{ color:"#f472b6" }}>{totals.atlMtdA}</td>
                      <td className="an-td-center" style={{ color:"#fbbf24" }}>{totals.digitalTarget}</td>
                      <td className="an-td-center" style={{ color:"#fbbf24" }}>{totals.digitalMtdT}</td>
                      <td className="an-td-center" style={{ color:"#fbbf24" }}>{totals.digitalMtdA}</td>
                      <td className="an-td-center" style={{ color:"#e2e8f0" }}>{totals.totalReceived}</td>
                      <td className="an-td-center" style={{ color:totalVariance<0?"#fca5a5":"#86efac" }}>{totalVariance<0?totalVariance:`+${totalVariance}`}</td>
                      <td className="an-td-center" style={{ color:"#67e8f9" }}>{totalAchPct}%</td>
                      <td className="an-td-center" style={{ color:"#67e8f9" }}>{totalAchPctMtd}%</td>
                      <td className="an-td-center" style={{ color:"#fca5a5" }}>{totals.retailTarget}</td>
                      <td className="an-td-center" style={{ color:"#e2e8f0" }}>{totals.mtdRetailTarget}</td>
                      <td className="an-td-center" style={{ color:"#e2e8f0" }}>{totals.mtdRetailAchieved}</td>
                      <td className="an-td-center" style={{ color:"#86efac" }}>{totalRetailAchPct}%</td>
                      <td className="an-td-center" style={{ color:"#86efac" }}>{totalRetailEnqPct}%</td>
                    </tr>
                    <tr style={{ background:"#1e293b", fontWeight:700 }}>
                      <td style={{ padding:"7px 10px",color:"#94a3b8" }}>Avg</td>
                      <td colSpan={18}/>
                      <td/>
                      <td className="an-td-center" style={{ color:"#67e8f9",fontSize:11 }}>{avgAchPct}%</td>
                      <td className="an-td-center" style={{ color:"#67e8f9",fontSize:11 }}>{avgAchPctMtd}%</td>
                      <td colSpan={2}/>
                      <td/>
                      <td className="an-td-center" style={{ color:"#86efac",fontSize:11 }}>{avgRetailAchPct}%</td>
                      <td className="an-td-center" style={{ color:"#86efac",fontSize:11 }}>{avgRetailEnqPct}%</td>
                    </tr>
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
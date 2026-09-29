// src/pages/DashboardPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import * as XLSX from "xlsx";
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

// ─── Report tab type ───────────────────────────────────────────────────────────
type ReportTab = "overview" | "daily-summary" | "lead-report" | "dealer-daily";

// ─── Daily entry / media types (same shape ApproverDashboard writes) ──────────
interface DailyEntry {
  date: string; setupCount?: number;
  enquiryPlanned: number; enquiryActual: number; enquiryHot?: number;
  testDrivePlanned: number; testDriveActual: number; testDrivePerCanopy?: number;
  bookingActual: number; bookingInHand?: number;
  retailActual: number; retailMtdActivity?: number; closingStock?: number;
  retailMtd?: number; retailRatePerCanopy?: number;   // ← manual fields (open in ApproverDashboard)
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

// ─── Daily Summary row — full shape, matches AnalyticsDashboard exactly ───────
interface DailySummaryRow {
  sr: number; dealer: string; location: string; state: string;
  zone: string; bgMember: string; canopy: number; setupCount: number;
  enquiryPlanned: number; enquiryActual: number; perCanopy: number; hot: number;
  trPlanned: number; trActual: number; trPerCanopy: number;
  bookToday: number; bookInHand: number;
  retailToday: number; retailMtdAct: number; retailMtd: number; retailRatePerCanopy: number;
  activityDay: number; closingStock: number;
  leads: number; punched: number; gap: number; convPct: number;
  proposalId: string; activityId: string; activityType: string;
  dailyEntries: DailyEntry[]; media: ProofMedia[]; photos: number;
}

// ─── Lead Report row — full 10-point formula shape, matches AnalyticsDashboard ─
interface LeadReportRow {
  state: string;
  walkinTarget: number; walkinMtdT: number; walkinMtdA: number;
  btlTarget: number; btlMtdT: number; btlMtdA: number;
  referralTarget: number; referralMtdT: number; referralMtdA: number;
  atlTarget: number; atlMtdT: number; atlMtdA: number;
  digitalTarget: number; digitalMtdT: number; digitalMtdA: number;
  leadsMonthTarget: number; leadsMtdTarget: number;
  totalReceived: number; variance: number; achPct: number; achPctMtd: number;
  retailTarget: number; mtdRetailTarget: number; mtdRetailAchieved: number;
  mtdRetailAchPct: number; retailEnqPct: number;
}

// ─── Types ─────────────────────────────────────────────────────────────────────
type ActiveFilter = "All" | "Pending" | "Approved" | "Rejected" | "NeedsRevision";

interface SummaryStats {
  totalProposals: number; pendingCount: number; approvedCount: number;
  rejectedCount: number; needsRevision: number; totalBudget: number; approvedBudget: number;
  pendingBudget: number; totalRetailTarget: number; totalLeadTarget: number;
  avgCac: number; avgCpl: number; stateCount: number; dealerCount: number;
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
    needsRevision:  proposals.filter((p) => p.status === "NeedsRevision").length,
    totalBudget:    proposals.reduce((s, p) => s + p.totalBudget, 0),
    approvedBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
    pendingBudget:  pending.reduce((s, p)  => s + p.totalBudget, 0),
    totalRetailTarget: proposals.reduce((s, p) => s + p.totalRetailTarget, 0),
    totalLeadTarget:   proposals.reduce((s, p) => s + p.totalLeadTarget, 0),
    avgCac: cacList.length > 0 ? cacList.reduce((a, b) => a + b, 0) / cacList.length : 0,
    avgCpl: cplList.length > 0 ? cplList.reduce((a, b) => a + b, 0) / cplList.length : 0,
    stateCount:  new Set(proposals.map((p) => p.state)).size,
    dealerCount: new Set(proposals.map((p) => p.dealerName)).size,
  };
}

// ─── Color helpers ────────────────────────────────────────────────────────────
function cellColor(actual: number, planned: number): string {
  if (!planned || !actual) return "";
  const r = actual / planned;
  if (r >= 0.9) return "#d1fae5";
  if (r >= 0.6) return "#fef3c7";
  return "#fee2e2";
}
function achColor(p: number): string {
  if (p >= 100) return "#bbf7d0";
  if (p >= 50)  return "#fef3c7";
  return "#fecaca";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
// ── Print/PDF helper — prints the target table in a clean PDF-ready view ────
function printSection(sectionId: string, title: string) {
  const el = document.getElementById(sectionId);
  if (!el) return;

  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) { alert("Allow pop-ups to download PDF."); return; }

  const styles = Array.from(document.styleSheets)
    .flatMap((ss) => {
      try { return Array.from(ss.cssRules).map((r) => r.cssText); }
      catch { return []; }
    })
    .join("\n");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <meta charset="UTF-8"/>
      <style>
        ${styles}
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; margin: 0; background: #fff; }
        .print-header { background: #0a2540; color: #fff; padding: 14px 20px; margin-bottom: 16px; border-radius: 6px; }
        .print-header h1 { margin: 0; font-size: 16px; font-weight: 700; }
        .print-header p  { margin: 4px 0 0; font-size: 11px; opacity: 0.75; }
        table { border-collapse: collapse; width: 100%; font-size: 10px; }
        th, td { border: 1px solid #e2e8f0; padding: 4px 6px; }
        th { background: #0a2540 !important; color: #fff !important; font-size: 9px; }
        tr:nth-child(even) { background: #f8fafc; }
        @page { size: A3 landscape; margin: 1cm; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <div class="print-header">
        <h1>BGauss BTL — ${title}</h1>
        <p>Generated: ${new Date().toLocaleString("en-IN")}</p>
      </div>
      ${el.outerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
}

export default function DashboardPage() {
  const { user, loading } = useAuthStore();
  const { instance }      = useMsal();
  const navigate          = useNavigate();
  const isAdmin           = user?.role === "Admin" || user?.role === "Manager";

  const [proposals,    setProposals]    = useState<ProposalResponse[]>([]);
  const [loadingData,  setLoadingData]  = useState(true);
  const [dataError,    setDataError]    = useState<string | null>(null);
  const [baplCounts,   setBaplCounts]   = useState<DealerStateCount[]>([]);
  const [downloading,  setDownloading]  = useState<"excel" | "pdf" | null>(null);
  const [dlError,      setDlError]      = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("All");
  const [stateFilter,  setStateFilter]  = useState("All");
  const [monthFilter,  setMonthFilter]  = useState("All");
  const [yearFilter,   setYearFilter]   = useState("All");
  const [sharedSearch, setSharedSearch] = useState("");

  // ── Report tab state (Admin only) ──────────────────────────────────────────
  const [reportTab,           setReportTab]           = useState<ReportTab>("overview");
  const [selectedDealerDaily, setSelectedDealerDaily] = useState<DailySummaryRow | null>(null);
  const [manualRetailTargets, setManualRetailTargets] = useState<Record<string,string>>({});
  const [dailySearch,         setDailySearch]         = useState("");
  const [dailyStateFilter,    setDailyStateFilter]    = useState("All");
  const [dailyActivityTypeFilter, setDailyActivityTypeFilter] = useState("All");
  const [mediaViewer, setMediaViewer] = useState<{url:string;name:string;type:string|null}|null>(null);

  useEffect(() => {
    if (loading) return;
    setLoadingData(true);
    const loader = isAdmin ? fetchProposals(instance) : fetchMyProposals(instance);
    Promise.all([
      loader,
      fetchDealerStateCounts(instance).catch(() => [] as DealerStateCount[]),
    ]).then(([props, counts]) => {
      setProposals(props);
      setBaplCounts(counts);
    }).catch((e) => setDataError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoadingData(false));
  }, [loading, instance, isAdmin]);

  const states = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.state))).sort()],
    [proposals],
  );
  const months = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.month)))],
    [proposals],
  );
  const years = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => (p as any).year).filter(Boolean))).sort()],
    [proposals],
  );

  const handleKpiClick = (filter: ActiveFilter) =>
    setActiveFilter((prev) => (prev === filter ? "All" : filter));

  const baseFiltered = useMemo(() =>
    proposals.filter((p) => {
      if (activeFilter !== "All" && p.status !== activeFilter) return false;
      if (stateFilter  !== "All" && p.state  !== stateFilter)  return false;
      if (monthFilter  !== "All" && p.month  !== monthFilter)   return false;
      if (yearFilter   !== "All" && (p as any).year !== yearFilter) return false;
      return true;
    }),
  [proposals, activeFilter, stateFilter, monthFilter, yearFilter]);

  // ── POINT 4: KPI cards reflect filtered set when any filter is active ──────
  const hasActiveFilter = activeFilter !== "All" || stateFilter !== "All" || monthFilter !== "All" || yearFilter !== "All";
  const stats = useMemo(
    () => computeStats(hasActiveFilter ? baseFiltered : proposals),
    [baseFiltered, proposals, hasActiveFilter],
  );

  const searchFiltered = useMemo(() => {
    const q = sharedSearch.toLowerCase().trim();
    if (!q) return baseFiltered;
    return baseFiltered.filter((p) =>
      [p.state, p.dealerName, p.rsmName, p.location, p.month]
        .join(" ").toLowerCase().includes(q),
    );
  }, [baseFiltered, sharedSearch]);

  const currentReportFilters = useMemo((): ReportFilters => ({
    period: "monthly",
    state:  stateFilter !== "All" ? stateFilter : undefined,
  }), [stateFilter]);

  const handleDownload = async (type: "excel" | "pdf") => {
    setDownloading(type); setDlError(null);
    try {
      if (type === "excel") await downloadExcelReport(currentReportFilters, instance);
      else                  await downloadPdfReport(currentReportFilters, instance);
    } catch (e) { setDlError(e instanceof Error ? e.message : "Download failed."); }
    finally { setDownloading(null); }
  };

  // ── State breakdown — POINT 7: includes revision count ────────────────────
  const stateBreakdown = useMemo(() => {
    interface StateRow {
      oldDealers: Set<string>; oldRetail: number; oldLead: number; oldBudget: number;
      newDealers: Set<string>; newRetail: number; newLead: number; newBudget: number;
      nonDealers: Set<string>; nonRetail: number; nonLead: number; nonBudget: number;
      pending: number; approved: number; rejected: number;
      revision: number; // ← ADDED Point #7
      remarks: string;
    }
    const map: Record<string, StateRow> = {};
    const ensure = (state: string) => {
      if (!map[state]) map[state] = {
        oldDealers: new Set(), oldRetail: 0, oldLead: 0, oldBudget: 0,
        newDealers: new Set(), newRetail: 0, newLead: 0, newBudget: 0,
        nonDealers: new Set(), nonRetail: 0, nonLead: 0, nonBudget: 0,
        pending: 0, approved: 0, rejected: 0,
        revision: 0, // ← ADDED Point #7
        remarks: "",
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
      if (p.status === "Pending")       r.pending++;
      if (p.status === "Approved")      r.approved++;
      if (p.status === "Rejected")      r.rejected++;
      if (p.status === "NeedsRevision") r.revision++; // ← ADDED Point #7
      if (p.remarks) r.remarks = p.remarks;
    }

    const baplByState = Object.fromEntries(
      baplCounts.map(c => [c.state.toLowerCase(), c]),
    );
    for (const bc of baplCounts) {
      if (!map[bc.state]) map[bc.state] = {
        oldDealers: new Set(), oldRetail: 0, oldLead: 0, oldBudget: 0,
        newDealers: new Set(), newRetail: 0, newLead: 0, newBudget: 0,
        nonDealers: new Set(), nonRetail: 0, nonLead: 0, nonBudget: 0,
        pending: 0, approved: 0, rejected: 0, revision: 0, remarks: "",
      };
    }

    return Object.entries(map).map(([state, d]) => {
      const bapl             = baplByState[state.toLowerCase()];
      const nonCountFromBapl = bapl?.nonEligible ?? 0;
      const nonCountFinal    = Math.max(d.nonDealers.size, nonCountFromBapl);
      const oldCountFinal    = Math.max(d.oldDealers.size, bapl?.eligibleOld ?? 0);
      const newCountFinal    = Math.max(d.newDealers.size, bapl?.eligibleNew ?? 0);
      const totalDealers     = oldCountFinal + newCountFinal + nonCountFinal;
      // FIX: include nonBudget too — Total Retail/Total Lead already include
      // their Non-Eligible counterparts, so Total Budget must too, or states
      // where every dealer is Non-Eligible show Total Budget = ₹0 while
      // Total Retail/Total Lead are non-zero, which then makes Overall CAC
      // and Overall CPL (both = totalBudget ÷ totalRetail|totalLead) show 0
      // as well — exactly what Delhi and Jharkhand were doing.
      const totalBudget      = d.oldBudget + d.newBudget + d.nonBudget;
      const totalRetail      = d.oldRetail + d.newRetail + d.nonRetail;
      const totalLead        = d.oldLead + d.newLead + d.nonLead;
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
        revision: d.revision, // ← ADDED Point #7
        remarks: d.remarks,
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
      pending:      stateBreakdown.reduce((s, r) => s + r.pending,      0),
      approved:     stateBreakdown.reduce((s, r) => s + r.approved,     0),
      rejected:     stateBreakdown.reduce((s, r) => s + r.rejected,     0),
      revision:     stateBreakdown.reduce((s, r) => s + r.revision,     0),
    };
  }, [stateBreakdown]);

  const dealerRows = useMemo(() => {
    const map: Record<string, {
      state: string; dealerName: string; monthTarget: number;
      eligibleOldBudget: number; eligibleNewBudget: number; nonBudget: number;
      retailTarget: number; leadTarget: number; activities: number;
      eligibility: string; type: string;
      pending: number; approved: number; rejected: number; revision: number;
      activityNames: Set<string>;
    }> = {};
    for (const p of searchFiltered) {
      const key = `${p.dealerName}__${p.state}`;
      if (!map[key]) map[key] = {
        state: p.state, dealerName: p.dealerName, monthTarget: 0,
        eligibleOldBudget: 0, eligibleNewBudget: 0, nonBudget: 0,
        retailTarget: 0, leadTarget: 0, activities: 0,
        eligibility: p.eligibility ?? "", type: p.type ?? "",
        pending: 0, approved: 0, rejected: 0, revision: 0,
        activityNames: new Set<string>(),
      };
      const d  = map[key];
      const ty = (p.type ?? "").toLowerCase();
      const el = (p.eligibility ?? "").toLowerCase();
      d.monthTarget  += p.totalRetailTarget;
      d.retailTarget += p.totalRetailTarget;
      d.leadTarget   += p.totalLeadTarget;
      d.activities   += p.activities.length;
      p.activities.forEach(a => { if (a.activityType) d.activityNames.add(a.activityType); });
      if (el.includes("not") || el.includes("non")) d.nonBudget         += p.totalBudget;
      else if (ty === "new")                         d.eligibleNewBudget += p.totalBudget;
      else                                           d.eligibleOldBudget += p.totalBudget;
      if (p.status === "Pending")       d.pending++;
      if (p.status === "Approved")      d.approved++;
      if (p.status === "Rejected")      d.rejected++;
      if (p.status === "NeedsRevision") d.revision = (d.revision||0) + 1;
      d.eligibility = p.eligibility ?? d.eligibility;
      d.type        = p.type        ?? d.type;
    }
    return Object.values(map).sort(
      (a, b) => a.state.localeCompare(b.state) || a.dealerName.localeCompare(b.dealerName),
    );
  }, [searchFiltered]);

  // ── Grand totals for the dealer-wise table — same shape used both by the
  // on-screen footer and by the Excel/PDF exports, so every surface always
  // agrees on the same numbers. ──────────────────────────────────────────────
  const dealerGrandTotal = useMemo(() => {
    if (!dealerRows.length) return null;
    return {
      dealerCount:  dealerRows.length,
      monthTarget:  dealerRows.reduce((s, r) => s + r.monthTarget, 0),
      activities:   dealerRows.reduce((s, r) => s + r.activities, 0),
      retailTarget: dealerRows.reduce((s, r) => s + r.retailTarget, 0),
      leadTarget:   dealerRows.reduce((s, r) => s + r.leadTarget, 0),
      btlBudget:    dealerRows.reduce((s, r) => s + r.eligibleOldBudget + r.eligibleNewBudget + r.nonBudget, 0),
      pending:      dealerRows.reduce((s, r) => s + r.pending, 0),
      approved:     dealerRows.reduce((s, r) => s + r.approved, 0),
      rejected:     dealerRows.reduce((s, r) => s + r.rejected, 0),
      revision:     dealerRows.reduce((s, r) => s + (r.revision||0), 0),
    };
  }, [dealerRows]);

  const searchResultLabel = useMemo(() => {
    if (!sharedSearch.trim()) return null;
    return `${stateBreakdown.length} state${stateBreakdown.length !== 1 ? "s" : ""} · ${dealerRows.length} dealer${dealerRows.length !== 1 ? "s" : ""} matching "${sharedSearch}"`;
  }, [sharedSearch, stateBreakdown.length, dealerRows.length]);

  const activeFilterCount = [
    activeFilter !== "All",
    stateFilter  !== "All",
    monthFilter  !== "All",
    yearFilter   !== "All",
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setActiveFilter("All"); setStateFilter("All");
    setMonthFilter("All");  setYearFilter("All"); setSharedSearch("");
  };

  // ── Filename suffix reflecting whichever filters are currently active ─────
  const filterSuffix = () =>
    [
      stateFilter !== "All" ? stateFilter : "",
      monthFilter !== "All" ? monthFilter : "",
      yearFilter  !== "All" ? yearFilter  : "",
      activeFilter !== "All" ? activeFilter : "",
    ].filter(Boolean).join("_").replace(/\s+/g, "");

  // ── Excel: State-wise Summary — built directly from `stateBreakdown`, the
  // exact same filtered array driving the on-screen table, with a correct
  // Grand Totals row (pure column sums / weighted CAC-CPL) appended at the end. ──
  const downloadStateExcel = () => {
    const rows: (string | number)[][] = [[
      "State",
      "Old Retail Target", "Old Count", "Old Budget (₹)", "Old CAC (₹)",
      "New Retail Target", "New Count", "New Budget (₹)", "New CAC (₹)",
      "Non-Eligible Retail Target", "Non-Eligible Count", "Non-Eligible Budget (₹)", "Non-Eligible CAC (₹)",
      "Total Dealers", "Total Budget (₹)", "Total Retail Target", "Total Lead Target",
      "Overall CAC (₹)", "Overall CPL (₹)",
      "Pending", "Approved", "Rejected", "Needs Revision", "Remarks",
    ]];
    for (const r of stateBreakdown) {
      rows.push([
        r.state,
        r.oldRetail, r.oldCount, Math.round(r.oldBudget), Math.round(r.oldCac),
        r.newRetail, r.newCount, Math.round(r.newBudget), Math.round(r.newCac),
        r.nonRetail, r.nonCount, Math.round(r.nonBudget), Math.round(r.nonCac),
        r.totalDealers, Math.round(r.totalBudget), Math.round(r.totalRetail), Math.round(r.totalLead),
        Math.round(r.overallCac), Math.round(r.overallCpl),
        r.pending, r.approved, r.rejected, r.revision, r.remarks || "",
      ]);
    }
    // Grand Totals row — same math as `stateGrandTotal`, so the file always
    // agrees with whatever the app itself would show as the grand total.
    if (stateGrandTotal) {
      const oldCacTotal = stateGrandTotal.oldRetail > 0 ? stateGrandTotal.oldBudget / stateGrandTotal.oldRetail : 0;
      const newCacTotal = stateGrandTotal.newRetail > 0 ? stateGrandTotal.newBudget / stateGrandTotal.newRetail : 0;
      const nonCacTotal = stateGrandTotal.nonRetail > 0 ? stateGrandTotal.nonBudget / stateGrandTotal.nonRetail : 0;
      const overallCacTotal = stateGrandTotal.totalRetail > 0 ? stateGrandTotal.totalBudget / stateGrandTotal.totalRetail : 0;
      const overallCplTotal = stateGrandTotal.totalLead   > 0 ? stateGrandTotal.totalBudget / stateGrandTotal.totalLead   : 0;
      rows.push([
        "GRAND TOTAL",
        stateGrandTotal.oldRetail, stateGrandTotal.oldCount, Math.round(stateGrandTotal.oldBudget), Math.round(oldCacTotal),
        stateGrandTotal.newRetail, stateGrandTotal.newCount, Math.round(stateGrandTotal.newBudget), Math.round(newCacTotal),
        stateGrandTotal.nonRetail, stateGrandTotal.nonCount, Math.round(stateGrandTotal.nonBudget), Math.round(nonCacTotal),
        stateGrandTotal.totalDealers, Math.round(stateGrandTotal.totalBudget),
        Math.round(stateGrandTotal.totalRetail), Math.round(stateGrandTotal.totalLead),
        Math.round(overallCacTotal), Math.round(overallCplTotal),
        stateGrandTotal.pending, stateGrandTotal.approved, stateGrandTotal.rejected, stateGrandTotal.revision, "",
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = rows[0].map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "State-wise Summary");
    const suffix = filterSuffix();
    XLSX.writeFile(wb, `BTL_State_Summary${suffix ? `_${suffix}` : ""}.xlsx`);
  };

  // ── Excel: Dealer-wise Data — built directly from `dealerRows`, with a
  // correct Grand Totals row (pure column sums) appended at the end. ────────
  const downloadDealerExcel = () => {
    const rows: (string | number)[][] = [[
      "State", "Dealer", "Month Target", "Category", "Activities / BTL Category",
      "Retail Target", "Lead Target", "Budget for BTL (₹)",
      "Pending", "Approved", "Rejected", "Needs Revision",
    ]];
    for (const row of dealerRows) {
      const el = (row.eligibility ?? "").toLowerCase();
      const isNon = el.includes("not") || el.includes("non");
      const btlBudget = row.eligibleOldBudget + row.eligibleNewBudget + row.nonBudget;
      rows.push([
        row.state, row.dealerName, Math.round(row.monthTarget),
        isNon ? "Non Eligible" : "BTL Budget Eligible",
        row.activityNames.size > 0 ? Array.from(row.activityNames).join(", ") : "",
        Math.round(row.retailTarget), Math.round(row.leadTarget), Math.round(btlBudget),
        row.pending, row.approved, row.rejected, row.revision || 0,
      ]);
    }
    if (dealerGrandTotal) {
      rows.push([
        "GRAND TOTAL", `${dealerGrandTotal.dealerCount} dealers`, Math.round(dealerGrandTotal.monthTarget),
        "", `${dealerGrandTotal.activities} activities`,
        Math.round(dealerGrandTotal.retailTarget), Math.round(dealerGrandTotal.leadTarget),
        Math.round(dealerGrandTotal.btlBudget),
        dealerGrandTotal.pending, dealerGrandTotal.approved, dealerGrandTotal.rejected, dealerGrandTotal.revision,
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = rows[0].map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dealer-wise Data");
    const suffix = filterSuffix();
    XLSX.writeFile(wb, `BTL_Dealer_Data${suffix ? `_${suffix}` : ""}.xlsx`);
  };

  // ── Approved proposals — the single source used for every live report tab ──
  const approvedProposals = useMemo(
    () => proposals.filter(p => p.status === "Approved"),
    [proposals],
  );

  // ── All daily entries aggregated across every approved proposal (needed for
  // the Lead Report's proportional BTL-channel distribution) ──────────────────
  const dailyAgg = useMemo(() => {
    const map: Record<string, DailyEntry> = {};
    for (const p of approvedProposals) {
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
  }, [approvedProposals]);

  // ── Live daily summary — one row per activity, matching AnalyticsDashboard's
  // exact (corrected) formulas: sums for real flows, "latest non-zero" for
  // manual/cumulative snapshot fields (retailMtdAct, retailMtd, retailRatePerCanopy,
  // closingStock, bookInHand), and Conv% = MTD Retail (Activity) ÷ LMS Leads. ──
  const liveDailySummary = useMemo((): DailySummaryRow[] => {
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
        const totalSetupCount = entries.reduce((s,e)=>s+((e as any).setupCount||0),0);
        const totalHot        = entries.reduce((s,e)=>s+((e as any).enquiryHot||0),0);

        const lastBookInHand   = [...entries].reverse().find(e=>((e as any).bookingInHand||0)>0) as any;
        const bookInHandVal    = lastBookInHand?.bookingInHand ?? 0;
        const lastMtdActivity  = [...entries].reverse().find(e=>((e as any).retailMtdActivity||0)>0) as any;
        const retailMtdActivityVal = lastMtdActivity?.retailMtdActivity ?? 0;
        const lastClosingStock = [...entries].reverse().find(e=>((e as any).closingStock||0)>0) as any;
        const closingStockVal  = lastClosingStock?.closingStock ?? 0;
        const lastRetailMtd    = [...entries].reverse().find(e=>((e as any).retailMtd||0)>0) as any;
        const retailMtdVal     = lastRetailMtd?.retailMtd ?? 0;
        const lastRetailRate   = [...entries].reverse().find(e=>((e as any).retailRatePerCanopy||0)>0) as any;
        const retailRatePerCanopyVal = lastRetailRate?.retailRatePerCanopy ?? 0;
        const activityDayCount = entries.filter(e =>
          (e.enquiryActual||0) > 0 || (e.testDriveActual||0) > 0 ||
          (e.bookingActual||0) > 0 || (e.retailActual||0) > 0 ||
          (e.leadsPunched||0) > 0 || ((e as any).setupCount||0) > 0
        ).length;

        const rawMedia = (a as any).mediaFiles ?? [];
        const media: ProofMedia[] = rawMedia.map((m: any) => ({
          id: m.id, fileUrl: m.fileUrl, fileName: m.fileName, fileType: m.fileType ?? null,
          capturedAt: m.capturedAt ?? new Date().toISOString(),
          latitude: m.latitude ?? null, longitude: m.longitude ?? null,
        }));

        const canopy = (a as any).qty || 1;

        rows.push({
          sr, dealer: p.dealerName||"", location: p.location||"",
          state: p.state||"", zone: (p as any).zone||"", bgMember: p.rsmName||"",
          canopy, setupCount: totalSetupCount,
          enquiryPlanned: totalEnqPlanned, enquiryActual: totalEnqActual,
          perCanopy: totalSetupCount>0 ? Math.round(totalEnqActual/totalSetupCount) : 0,
          hot: totalHot,
          trPlanned: totalTrPlanned, trActual: totalTrActual,
          trPerCanopy: totalSetupCount>0 ? Math.round(totalTrActual/totalSetupCount) : 0,
          bookToday: totalBookToday, bookInHand: bookInHandVal,
          retailToday: totalRetail, retailMtdAct: retailMtdActivityVal, retailMtd: retailMtdVal,
          retailRatePerCanopy: retailRatePerCanopyVal,
          activityDay: activityDayCount, closingStock: closingStockVal,
          leads: totalLmsLeads, punched: totalPunched,
          gap: totalLmsLeads - totalPunched,
          convPct: totalLmsLeads > 0 ? Math.round((retailMtdActivityVal/totalLmsLeads)*100) : 0,
          proposalId: p.id, activityId: a.id, activityType: a.activityType,
          dailyEntries: entries, media, photos: media.length,
        });
        sr++;
      }
    }
    return rows;
  }, [approvedProposals]);

  // Daily summary totals — pure column sums, matching AnalyticsDashboard exactly
  const dsTotals = useMemo(() => {
    const src = liveDailySummary;
    const totalSetupCount = src.reduce((s, r) => s + (r.setupCount||0), 0);
    const totalEnqAct  = src.reduce((s, r) => s + r.enquiryActual, 0);
    const totalTrAct   = src.reduce((s, r) => s + r.trActual, 0);
    const totalRetail  = src.reduce((s, r) => s + r.retailMtd, 0);
    const totalLeads   = src.reduce((s, r) => s + r.leads, 0);
    return {
      canopy:         src.reduce((s, r) => s + r.canopy, 0),
      setupCount:     totalSetupCount,
      enquiryPlanned: src.reduce((s, r) => s + r.enquiryPlanned, 0),
      enquiryActual:  totalEnqAct,
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

  if (loading) {
    return (
      <div className="dash-loading-screen">
        <div className="dash-spinner"/><p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="dash-root">

      {/* Media lightbox */}
      {mediaViewer && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:10000,
          display:"flex",alignItems:"center",justifyContent:"center" }} onClick={()=>setMediaViewer(null)}>
          <div style={{ maxWidth:"92vw",maxHeight:"92vh" }} onClick={(e)=>e.stopPropagation()}>
            {isImageType(mediaViewer.type)
              ? <img src={mediaViewer.url} alt={mediaViewer.name} style={{ maxWidth:"88vw",maxHeight:"82vh",borderRadius:8 }}/>
              : isVideoType(mediaViewer.type)
                ? <video src={mediaViewer.url} controls autoPlay style={{ maxWidth:"88vw",maxHeight:"82vh",borderRadius:8 }}/>
                : <a href={mediaViewer.url} target="_blank" rel="noopener noreferrer" style={{ color:"#fff" }}>Open {mediaViewer.name} ↗</a>}
          </div>
        </div>
      )}

      {/* ── Quick actions ── */}
      <div className="dash-quick-actions">
        <button className="dash-action-card" onClick={() => navigate("/rsm-form")}>
          <span className="dash-action-icon">📋</span>
          <div><div className="dash-action-title">New Proposal</div><div className="dash-action-desc">Submit a BTL activity plan</div></div>
        </button>
        {isAdmin && (
          <button className="dash-action-card" onClick={() => navigate("/approver")}>
            <span className="dash-action-icon">✅</span>
            <div><div className="dash-action-title">Review Proposals</div><div className="dash-action-desc">Approve or reject pending plans</div></div>
          </button>
        )}
        <button className="dash-action-card dash-action-card--report" onClick={() => navigate("/reports")}>
          <span className="dash-action-icon">📊</span>
          <div><div className="dash-action-title">Download Report</div><div className="dash-action-desc">Excel &amp; PDF · by period, state, dealer</div></div>
        </button>
        {user?.role === "Admin" && (
          <button className="dash-action-card" onClick={() => navigate("/admin/users")}>
            <span className="dash-action-icon">👥</span>
            <div><div className="dash-action-title">Manage Users &amp; Activity</div><div className="dash-action-desc">Add Activity, edit roles and status</div></div>
          </button>
        )}
      </div>

      {loadingData ? (
        <div className="dash-loading-inline">
          <div className="dash-spinner dash-spinner--sm"/><span>Loading proposals…</span>
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
          {/* ══ KPI Cards ══════════════════════════════════════════════════ */}
          <div className="dash-kpi-grid">
            <KpiCard icon="📄" label="Total Proposals"
              value={String(stats.totalProposals)}
              sub={`${stats.dealerCount} dealers · ${stats.stateCount} states`}
              accent="blue" active={activeFilter === "All"}
              onClick={() => { handleKpiClick("All"); }}/>
            <KpiCard icon="⏳" label="Pending Approval"
              value={String(stats.pendingCount)}
              sub={`Budget: ${inrCompact(stats.pendingBudget)}`}
              accent="amber" active={activeFilter === "Pending"}
              badge={stats.pendingCount > 0 ? "action needed" : undefined}
              onClick={() => { handleKpiClick("Pending"); }}/>
            <KpiCard icon="✅" label="Approved"
              value={String(stats.approvedCount)}
              sub={`Budget: ${inrCompact(stats.approvedBudget)}`}
              accent="green" active={activeFilter === "Approved"}
              onClick={() => { handleKpiClick("Approved"); }}/>
            <KpiCard icon="❌" label="Rejected"
              value={String(stats.rejectedCount)}
              sub={`${Math.round(stats.totalRetailTarget).toLocaleString("en-IN")} total units`}
              accent="red" active={activeFilter === "Rejected"}
              onClick={() => { handleKpiClick("Rejected"); }}/>
            <KpiCard icon="💰" label="Total Budget"
              value={inrCompact(stats.totalBudget)}
              sub={`Avg CAC ₹${Math.round(stats.avgCac).toLocaleString("en-IN")}`}
              accent="purple" onClick={clearAllFilters}/>
            <KpiCard icon="📊" label="Avg CPL"
              value={`₹${Math.round(stats.avgCpl).toLocaleString("en-IN")}`}
              sub={`${stats.totalLeadTarget.toLocaleString("en-IN")} total leads`}
              accent="blue" onClick={clearAllFilters}/>
            {stats.needsRevision !== undefined && (
              <KpiCard icon="↩" label="Needs Revision"
                value={String(stats.needsRevision??0)}
                sub="Sent back for changes"
                accent="amber" active={activeFilter==="NeedsRevision"}
                onClick={()=>handleKpiClick("NeedsRevision")}/>
            )}
          </div>

          {/* ── POINT 4: Filter scope hint when month/state filter active ── */}
          {hasActiveFilter && (
            <div style={{
              background: "#eff6ff", border: "1px solid #bfdbfe",
              borderRadius: 8, padding: "8px 14px", fontSize: 12,
              color: "#1e40af", marginBottom: 4,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span>📊</span>
              <strong>KPI counts filtered:</strong>
              {stateFilter  !== "All" && <span>State: <b>{stateFilter}</b></span>}
              {monthFilter  !== "All" && <span>Month: <b>{monthFilter}</b></span>}
              {yearFilter   !== "All" && <span>Year: <b>{yearFilter}</b></span>}
              {activeFilter !== "All" && <span>Status: <b>{activeFilter}</b></span>}
              <button
                style={{
                  marginLeft: "auto", background: "none", border: "none",
                  color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600,
                }}
                onClick={clearAllFilters}>
                Show all ✕
              </button>
            </div>
          )}

          {/* ══ Report Tabs — Admin only ════════════════════════════════════ */}
          {isAdmin && (
            <div className="dash-report-tabs">
              {([
                { id: "overview",      label: "📋 BTL Overview",   desc: "Proposals, state & dealer summary" },
                // { id: "daily-summary", label: "📅 Daily Activity", desc: "Live canopy & activity sheet" },
                // { id: "lead-report",   label: "🎯 Lead Report",    desc: "State-wise planned vs actual leads" },
              ] as { id: ReportTab; label: string; desc: string }[]).map(({ id, label, desc }) => (
                <button key={id}
                  className={`dash-report-tab${reportTab === id ? " dash-report-tab--active" : ""}`}
                  onClick={() => setReportTab(id)}>
                  <span className="dash-report-tab-label">{label}</span>
                  <span className="dash-report-tab-desc">{desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: BTL OVERVIEW
          ══════════════════════════════════════════════════════════════ */}
          {(!isAdmin || reportTab === "overview") && (
            <>
              {/* Global filter bar */}
              <div className="dash-global-filter-bar">
                <div className="dash-global-filter-left">
                  <span className="dash-filter-label">Filters:</span>

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
                  <select className="dash-filter-select dash-filter-select--inline"
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}>
                    {years.map((y) => (
                      <option key={y} value={y}>{y === "All" ? "All Years" : y}</option>
                    ))}
                  </select>
                  <select className="dash-filter-select dash-filter-select--inline"
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
                    {["All","Pending","Approved","Rejected","NeedsRevision"].map((s) => (
                      <option key={s} value={s}>{s === "All" ? "All Statuses" : s === "NeedsRevision" ? "Needs Revision" : s}</option>
                    ))}
                  </select>
                  {activeFilterCount > 0 && (
                    <span className="dash-active-filter-count">{activeFilterCount} active</span>
                  )}
                </div>
                {(activeFilterCount > 0 || sharedSearch) && (
                  <button className="dash-filter-clear-all" onClick={clearAllFilters}>✕ Clear all</button>
                )}
              </div>

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
                  {yearFilter !== "All" && (
                    <span className="dash-pill dash-pill--month">
                      Year: {yearFilter}
                      <button onClick={() => setYearFilter("All")}>✕</button>
                    </span>
                  )}
                </div>
              )}

              <div className="dash-shared-search-bar">
                <div className="dash-search-wrap dash-search-wrap--shared">
                  <span className="dash-search-icon">🔍</span>
                  <input className="dash-search-input" type="search"
                    placeholder="Search state, dealer, RSM, city…"
                    value={sharedSearch}
                    onChange={(e) => setSharedSearch(e.target.value)}/>
                  {sharedSearch && (
                    <button className="dash-search-clear" onClick={() => setSharedSearch("")}>✕</button>
                  )}
                </div>
                {searchResultLabel && (
                  <span className="dash-search-results-info">{searchResultLabel}</span>
                )}
              </div>

              {dlError && (
                <div className="dash-dl-error">
                  ⚠ {dlError}
                  <button onClick={() => setDlError(null)}>✕</button>
                </div>
              )}

              {/* ── State-wise table — POINT 7: Revision column ── */}
              {stateBreakdown.length > 0 && (
                <section className="dash-section">
                  <div className="dash-section-head">
                    <h2 className="dash-section-title">
                      State-wise Summary
                      <span className="dash-count-chip">{stateBreakdown.length}</span>
                    </h2>
                    <div className="dash-section-dl-group">
                      {stateFilter !== "All" && (
                        <span className="dash-section-filter-hint">
                          {stateFilter}{monthFilter !== "All" ? ` · ${monthFilter}` : ""}
                        </span>
                      )}
                      <button className="dash-dl-btn dash-dl-btn--excel" onClick={downloadStateExcel}>
                        ⬇ Excel
                      </button>
                      <button className="dash-dl-btn dash-dl-btn--pdf"
                        onClick={() => printSection("dash-state-table", "State-wise Summary")}>
                        ⬇ PDF
                      </button>
                      <button className="dash-dl-btn dash-dl-btn--full" onClick={() => navigate("/reports")}>
                        Full Report ↗
                      </button>
                    </div>
                  </div>
                  <div className="dash-table-wrap dash-table-wrap--wide">
                    <table id="dash-state-table" className="dash-table dash-table--summary">
                      <thead>
                        <tr className="dash-thead-group">
                          <th className="dash-th dash-th--state" rowSpan={2}>States</th>
                          <th className="dash-th dash-th--group dash-th--old" colSpan={4}>Eligible Old Dealer</th>
                          <th className="dash-th dash-th--group dash-th--new" colSpan={4}>Eligible New Dealer</th>
                          <th className="dash-th dash-th--group dash-th--non" colSpan={4}>Non Eligible Dealer</th>
                          <th className="dash-th dash-th--group dash-th--tot" colSpan={6}>Totals</th>
                          {/* POINT 7: Status group now has colSpan 4 (Pending/Approved/Rejected/Revision) */}
                          <th className="dash-th dash-th--group" colSpan={4}>Status</th>
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
                          {/* POINT 7: 4 status sub-headers */}
                          <th className="dash-th dash-th--right" style={{background:"#f59e0b22",color:"#92400e"}}>Pending</th>
                          <th className="dash-th dash-th--right" style={{background:"#16a34a22",color:"#14532d"}}>Approved</th>
                          <th className="dash-th dash-th--right" style={{background:"#dc262622",color:"#7f1d1d"}}>Rejected</th>
                          <th className="dash-th dash-th--right" style={{background:"#f59e0b33",color:"#78350f"}}>Revision</th>
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
                            <td className="dash-td dash-td--right">{row.oldRetail > 0 ? row.oldRetail : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.oldCount  > 0 ? row.oldCount  : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.oldBudget > 0 ? inr(row.oldBudget) : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.oldCac > 0 ? `₹${Math.round(row.oldCac).toLocaleString("en-IN")}` : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.newRetail > 0 ? row.newRetail : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.newCount  > 0 ? row.newCount  : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.newBudget > 0 ? inr(row.newBudget) : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.newCac > 0 ? `₹${Math.round(row.newCac).toLocaleString("en-IN")}` : <Dash/>}</td>
                            <td className="dash-td dash-td--right">{row.nonRetail > 0 ? row.nonRetail : <Dash/>}</td>
                            <td className="dash-td dash-td--right"
                              title={row.baplNonEligible > 0 ? `${row.baplNonEligible} non-eligible from BaplFinal DB` : ""}>
                              {row.nonCount > 0 ? <span className="dash-non-count">{row.nonCount}</span> : <Dash/>}
                            </td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.nonBudget > 0 ? inr(row.nonBudget) : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--mono">{row.nonCac > 0 ? `₹${Math.round(row.nonCac).toLocaleString("en-IN")}` : <Dash/>}</td>
                            <td className="dash-td dash-td--right dash-td--bold">{row.totalDealers}</td>
                            <td className="dash-td dash-td--right dash-td--mono dash-td--bold">{inr(row.totalBudget)}</td>
                            <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalRetail).toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--bold">{Math.round(row.totalLead).toLocaleString("en-IN")}</td>
                            <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                              {row.overallCac > 0 ? `₹${Math.round(row.overallCac).toLocaleString("en-IN")}` : <Dash/>}
                            </td>
                            <td className="dash-td dash-td--right dash-td--mono dash-td--bold">
                              {row.overallCpl > 0 ? `₹${Math.round(row.overallCpl).toLocaleString("en-IN")}` : <Dash/>}
                            </td>
                            {/* POINT 7: status cells */}
                            <td className="dash-td dash-td--right">
                              {row.pending  > 0
                                ? <span className="dash-badge dash-badge--pending">{row.pending}</span>
                                : <span className="dash-muted">—</span>}
                            </td>
                            <td className="dash-td dash-td--right">
                              {row.approved > 0
                                ? <span className="dash-badge dash-badge--approved">{row.approved}</span>
                                : <span className="dash-muted">—</span>}
                            </td>
                            <td className="dash-td dash-td--right">
                              {row.rejected > 0
                                ? <span className="dash-badge dash-badge--rejected">{row.rejected}</span>
                                : <span className="dash-muted">—</span>}
                            </td>
                            {/* POINT 7: NEW revision column */}
                            <td className="dash-td dash-td--right">
                              {row.revision > 0
                                ? <span className="dash-badge dash-badge--revision">{row.revision}</span>
                                : <span className="dash-muted">—</span>}
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
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.pending  > 0 ? stateGrandTotal.pending  : "—"}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.approved > 0 ? stateGrandTotal.approved : "—"}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.rejected > 0 ? stateGrandTotal.rejected : "—"}</td>
                            <td className="dash-td dash-td--right dash-td--grand">{stateGrandTotal.revision > 0 ? stateGrandTotal.revision : "—"}</td>
                            <td className="dash-td"/>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </section>
              )}

              {/* ── Dealer-wise table ── */}
              <section className="dash-section">
                <div className="dash-section-head">
                  <h2 className="dash-section-title">
                    Dealer-wise Data
                    <span className="dash-count-chip">{dealerRows.length}</span>
                  </h2>
                  <div className="dash-section-dl-group">
                    <button className="dash-dl-btn dash-dl-btn--excel" onClick={downloadDealerExcel}>
                      ⬇ Excel
                    </button>
                    <button className="dash-dl-btn dash-dl-btn--pdf"
                      onClick={() => printSection("dash-dealer-table", "Dealer-wise Data")}>
                      ⬇ PDF
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
                    <table id="dash-dealer-table" className="dash-table dash-table--dealer">
                      <thead>
                        <tr>
                          <th className="dash-th" style={{textAlign:"left"}}>State</th>
                          <th className="dash-th" style={{textAlign:"left"}}>Dealer Name</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Month Target</th>
                          <th className="dash-th" style={{textAlign:"left"}}>Category</th>
                          <th className="dash-th" style={{textAlign:"left"}}>BTL Category</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Activities</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Retail Target</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Lead Target</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Budget for BTL (₹)</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Pending</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Approved</th>
                          <th className="dash-th" style={{textAlign:"center"}}>Rejected</th>
                          <th className="dash-th" style={{textAlign:"center",background:"#f59e0b22",color:"#92400e"}}>Revision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dealerRows.map((row, i) => {
                          const el     = (row.eligibility ?? "").toLowerCase();
                          const isNon  = el.includes("not") || el.includes("non");
                          const isNew  = row.type?.toLowerCase() === "new";
                          const catBase = isNon ? "Non Eligible" : "BTL Budget Eligible";
                          const cat    = isNon
                            ? "Dealers Non Eligible for BTL"
                            : isNew
                            ? "Budget taken for BTL (New)"
                            : "Budget taken for BTL (Old+New+Special Approval)";
                          const btlBudget = row.eligibleOldBudget + row.eligibleNewBudget + row.nonBudget;
                          const q           = sharedSearch.toLowerCase().trim();
                          const dealerMatch = q && row.dealerName.toLowerCase().includes(q);
                          return (
                            <tr key={`${row.dealerName}__${row.state}`}
                              className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                              <td className="dash-td"><span className="dash-state-tag">{row.state}</span></td>
                              <td className="dash-td">
                                <span className={`dash-dealer-name${dealerMatch ? " dash-dealer-name--match" : ""}`}>
                                  {row.dealerName}
                                </span>
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>{Math.round(row.monthTarget).toLocaleString("en-IN")}</td>
                              <td className="dash-td">
                                <span className={`dash-cat-tag dash-cat-tag--${isNon ? "non" : "eligible"}`}>{catBase}</span>
                              </td>
                              <td className="dash-td dash-td--category">
                                {row.activityNames && row.activityNames.size > 0
                                  ? Array.from(row.activityNames).join(", ")
                                  : cat}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>{row.activities}</td>
                              <td className="dash-td" style={{textAlign:"center"}}>{Math.round(row.retailTarget).toLocaleString("en-IN")}</td>
                              <td className="dash-td" style={{textAlign:"center"}}>{Math.round(row.leadTarget).toLocaleString("en-IN")}</td>
                              <td className="dash-td dash-td--mono" style={{textAlign:"center"}}>
                                {btlBudget > 0 ? inr(btlBudget) : <Dash/>}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>
                                {row.pending  > 0 ? <span className="dash-badge dash-badge--pending">{row.pending}</span>   : <span className="dash-muted">—</span>}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>
                                {row.approved > 0 ? <span className="dash-badge dash-badge--approved">{row.approved}</span> : <span className="dash-muted">—</span>}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>
                                {row.rejected > 0 ? <span className="dash-badge dash-badge--rejected">{row.rejected}</span> : <span className="dash-muted">—</span>}
                              </td>
                              <td className="dash-td" style={{textAlign:"center"}}>
                                {(row as any).revision > 0 ? <span className="dash-badge dash-badge--revision">{(row as any).revision}</span> : <span className="dash-muted">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {dealerGrandTotal && (
                        <tfoot>
                          <tr className="dash-grand-total">
                            <td className="dash-td dash-td--grand-label" colSpan={2}>
                              Grand Totals ({dealerGrandTotal.dealerCount} dealers)
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>
                              {Math.round(dealerGrandTotal.monthTarget).toLocaleString("en-IN")}
                            </td>
                            <td className="dash-td"/>
                            <td className="dash-td"/>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>{dealerGrandTotal.activities}</td>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>
                              {Math.round(dealerGrandTotal.retailTarget).toLocaleString("en-IN")}
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>
                              {Math.round(dealerGrandTotal.leadTarget).toLocaleString("en-IN")}
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand dash-td--mono" style={{textAlign:"center"}}>
                              {inr(dealerGrandTotal.btlBudget)}
                            </td>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>{dealerGrandTotal.pending  > 0 ? dealerGrandTotal.pending  : "—"}</td>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>{dealerGrandTotal.approved > 0 ? dealerGrandTotal.approved : "—"}</td>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>{dealerGrandTotal.rejected > 0 ? dealerGrandTotal.rejected : "—"}</td>
                            <td className="dash-td dash-td--right dash-td--grand" style={{textAlign:"center"}}>{dealerGrandTotal.revision > 0 ? dealerGrandTotal.revision : "—"}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: DAILY ACTIVITY SUMMARY — banded, matches AnalyticsDashboard
          ══════════════════════════════════════════════════════════════ */}
          {isAdmin && reportTab === "daily-summary" && (
            <>
              <div style={{ display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center" }}>
                <input value={dailySearch} onChange={e=>setDailySearch(e.target.value)}
                  placeholder="🔍 Search dealer, location, state…"
                  style={{ flex:"1 1 220px",height:36,padding:"0 12px",border:"1.5px solid #e2e8f0",
                    borderRadius:8,fontSize:13,outline:"none",fontFamily:"inherit" }}/>
                <select value={dailyStateFilter} onChange={e=>setDailyStateFilter(e.target.value)}
                  style={{ height:36,padding:"0 10px",border:"1.5px solid #e2e8f0",borderRadius:8,
                    fontSize:12,fontFamily:"inherit",outline:"none" }}>
                  <option value="All">All States</option>
                  {states.filter(s=>s!=="All").map(s=><option key={s} value={s}>{s}</option>)}
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
                <button
                  onClick={()=>printSection("daily-summary-table","Daily Activity Sheet Summary")}
                  style={{ marginLeft:"auto",background:"#dc2626",color:"#fff",border:"none",borderRadius:6,
                    padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",
                    display:"flex",alignItems:"center",gap:5}}>
                  ⬇ PDF
                </button>
              </div>

              <section className="dash-section">
                <div className="dash-section-head">
                  <div>
                    <h2 className="dash-section-title" style={{fontSize:16}}>
                      📅 Daily Activity Sheet Summary
                      <span style={{fontSize:12,fontWeight:400,color:"#64748b",marginLeft:10}}>
                        Live · {filteredDailySummary.length} activities · {approvedProposals.length} approved proposal{approvedProposals.length===1?"":"s"}
                      </span>
                    </h2>
                    <p style={{margin:"2px 0 0",fontSize:11,color:"#94a3b8"}}>
                      Click any dealer row to view their full daily activity sheet ↗
                    </p>
                  </div>
                </div>

                {liveDailySummary.length === 0 ? (
                  <div style={{ textAlign:"center",padding:"60px 24px",color:"#9ca3af" }}>
                    <div style={{ fontSize:40,marginBottom:12 }}>📅</div>
                    <div style={{ fontWeight:700,fontSize:15,color:"#0a2540",marginBottom:6 }}>No post-activity data yet</div>
                    <div style={{ fontSize:13 }}>Daily data appears here once RSMs fill post-activity entries for approved proposals.</div>
                  </div>
                ) : (
                  <>
                    {/* Summary KPIs */}
                    <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,marginBottom:16 }}>
                      {[
                        {label:"Total Canopy",  value:String(dsTotals.canopy),      color:"#0a2540"},
                        {label:"Setup Count",   value:String(dsTotals.setupCount),  color:"#92400e"},
                        {label:"Enq Actual",    value:String(dsTotals.enquiryActual), color:"#16a34a"},
                        {label:"Hot",           value:String(dsTotals.hot),         color:"#dc2626"},
                        {label:"TD Actual",     value:String(dsTotals.trActual),      color:"#7c3aed"},
                        {label:"Retail MTD",    value:String(dsTotals.retailMtd),        color:"#f59e0b"},
                      ].map(k=>(
                        <div key={k.label} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, padding:"12px 14px", borderTop:`3px solid ${k.color}` }}>
                          <div style={{ fontSize:10,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.4px" }}>{k.label}</div>
                          <div style={{ fontSize:20,fontWeight:800,color:k.color,marginTop:2 }}>{k.value}</div>
                        </div>
                      ))}
                    </div>

                    {(()=>{
                      const bandEnquiry = "#0e5f7a", bandTestRide = "#0369a1", bandBooking = "#1d4ed8",
                            bandRetail = "#c2410c", bandLms = "#be123c", bandConv = "#0891b2";
                      const perCanopyColor = (v:number) => v>=25?"#16a34a":v>=15?"#ca8a04":v>0?"#dc2626":"#94a3b8";
                      const perCanopyBg    = (v:number) => v>=25?"#dcfce7":v>=15?"#fef9c3":v>0?"#fee2e2":"transparent";
                      const convBg = (v:number) => v>=10?"#dcfce7":v>=5?"#fef9c3":"#fee2e2";
                      const convColor = (v:number) => v>=10?"#166534":v>=5?"#854d0e":"#991b1b";

                      return (
                        <div className="dash-table-wrap dash-table-wrap--wide">
                          <table id="daily-summary-table" style={{ width:"100%",borderCollapse:"separate",borderSpacing:0,fontSize:12,minWidth:2000 }}>
                            <thead>
                              <tr>
                                <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 8px",textAlign:"center",verticalAlign:"middle" }}>Sr.No</th>
                                <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>Dealer</th>
                                <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>Activity Type</th>
                                <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>Location</th>
                                <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"8px 10px",textAlign:"left",verticalAlign:"middle" }}>State</th>
                                <th colSpan={5} style={{ background:bandEnquiry,color:"#fff",padding:"6px 8px",textAlign:"center" }}>Enquiry</th>
                                <th colSpan={3} style={{ background:bandTestRide,color:"#fff",padding:"6px 8px",textAlign:"center" }}>Test Rides</th>
                                <th colSpan={2} style={{ background:bandBooking,color:"#fff",padding:"6px 8px",textAlign:"center" }}>Bookings</th>
                                <th colSpan={4} style={{ background:bandRetail,color:"#fff",padding:"6px 8px",textAlign:"center" }}>Retail</th>
                                <th rowSpan={2} style={{ background:"#334155",color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Activity<br/>Day</th>
                                <th rowSpan={2} style={{ background:"#334155",color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle",fontSize:11 }}>Closing<br/>Stock</th>
                                <th colSpan={3} style={{ background:bandLms,color:"#fff",padding:"6px 8px",textAlign:"center" }}>LMS</th>
                                <th rowSpan={2} style={{ background:bandConv,color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle" }}>Conv%</th>
                                <th rowSpan={2} style={{ background:"#0a2540",color:"#fff",padding:"6px 8px",textAlign:"center",verticalAlign:"middle" }}>Photos</th>
                              </tr>
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
                                <tr key={i} style={{ background:i%2===0?"#fff":"#f8fafc",cursor:"pointer" }}
                                  onClick={()=>{ setSelectedDealerDaily(row); setReportTab("dealer-daily"); }}
                                  title={`View ${row.dealer} daily sheet`}>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#94a3b8",fontSize:11,border:"1px solid #e2e8f0" }}>{row.sr}</td>
                                  <td style={{ padding:"7px",fontWeight:700,color:"#0a2540",border:"1px solid #e2e8f0" }}>{row.dealer}</td>
                                  <td style={{ padding:"7px",fontWeight:700,color:"#0a2540",border:"1px solid #e2e8f0" }}>{row.activityType}</td>
                                  <td style={{ padding:"7px",fontSize:11,color:"#6b7280",border:"1px solid #e2e8f0" }}>{row.location}</td>
                                  <td style={{ padding:"7px",fontSize:11,border:"1px solid #e2e8f0" }}>{row.state}</td>
                                  <td style={{ padding:"7px",textAlign:"center",fontWeight:700,background:"#fefce8",border:"1px solid #e2e8f0" }}>{row.setupCount||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#0369a1",border:"1px solid #e2e8f0" }}>{row.enquiryPlanned||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#0e7490",border:"1px solid #e2e8f0" }}>{row.enquiryActual||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",fontWeight:700,background:perCanopyBg(row.perCanopy),color:perCanopyColor(row.perCanopy),border:"1px solid #e2e8f0" }}>{row.perCanopy||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:row.hot>0?"#dc2626":"#94a3b8",fontWeight:row.hot>0?700:400,border:"1px solid #e2e8f0" }}>{row.hot||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#0369a1",border:"1px solid #e2e8f0" }}>{row.trPlanned||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#0369a1",border:"1px solid #e2e8f0" }}>{row.trActual||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",fontWeight:700,background:perCanopyBg(row.trPerCanopy),color:perCanopyColor(row.trPerCanopy),border:"1px solid #e2e8f0" }}>{row.trPerCanopy||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#1d4ed8",fontWeight:row.bookToday>0?700:400,border:"1px solid #e2e8f0" }}>{row.bookToday||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#1d4ed8",border:"1px solid #e2e8f0" }}>{row.bookInHand||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#c2410c",fontWeight:700,border:"1px solid #e2e8f0" }}>{row.retailToday||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#c2410c",border:"1px solid #e2e8f0" }}>{row.retailMtdAct||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#c2410c",fontWeight:700,border:"1px solid #e2e8f0" }}>{row.retailMtd||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",fontWeight:700,background:row.retailRatePerCanopy>=1?"#dcfce7":row.retailRatePerCanopy>0?"#fef9c3":"#fee2e2",color:row.retailRatePerCanopy>=1?"#166534":row.retailRatePerCanopy>0?"#854d0e":"#991b1b",border:"1px solid #e2e8f0" }}>{row.retailRatePerCanopy||"0.0"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#64748b",border:"1px solid #e2e8f0" }}>{row.activityDay||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#64748b",border:"1px solid #e2e8f0" }}>{row.closingStock||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#be123c",border:"1px solid #e2e8f0" }}>{row.leads||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#be123c",fontWeight:700,border:"1px solid #e2e8f0" }}>{row.punched||"—"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",color:"#be123c",border:"1px solid #e2e8f0" }}>{row.gap||"0"}</td>
                                  <td style={{ padding:"7px",textAlign:"center",fontWeight:700,background:convBg(row.convPct),color:convColor(row.convPct),border:"1px solid #e2e8f0" }}>{row.convPct}%</td>
                                  <td style={{ padding:"7px",textAlign:"center",border:"1px solid #e2e8f0" }}>
                                    {row.photos>0?<span style={{ color:"#16a34a",fontWeight:700,fontSize:11 }}>📸 {row.photos}</span>:<span style={{ color:"#e2e8f0",fontSize:11 }}>—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan={5} style={{ padding:"8px 12px",fontWeight:800,color:"#0a2540",background:"#fce7d6",border:"1px solid #e2e8f0" }}>Total ({filteredDailySummary.length})</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.setupCount}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.enquiryPlanned}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.enquiryActual}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.perCanopy}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.hot}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.trPlanned}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.trActual}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.trPerCanopy}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.bookToday}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.bookInHand}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.retailToday}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.retailMtdAct}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.retailMtd}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>
                                  {dsTotals.setupCount>0?(Math.round((dsTotals.retailMtd/dsTotals.setupCount)*10)/10):"0.0"}
                                </td>
                                <td style={{ background:"#fce7d6",border:"1px solid #e2e8f0" }}/>
                                <td style={{ background:"#fce7d6",border:"1px solid #e2e8f0" }}/>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.leads}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.punched}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.gap}</td>
                                <td style={{ padding:"8px",textAlign:"center",fontWeight:700,background:"#fce7d6",border:"1px solid #e2e8f0" }}>{dsTotals.convPct}%</td>
                                <td style={{ background:"#fce7d6",border:"1px solid #e2e8f0" }}/>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      );
                    })()}
                  </>
                )}
              </section>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: LEAD REPORT — 10-point formula set, matches AnalyticsDashboard
          ══════════════════════════════════════════════════════════════ */}
          {isAdmin && reportTab === "lead-report" && (
            <section className="dash-section">
              <div className="dash-section-head">
                <div>
                  <h2 className="dash-section-title" style={{fontSize:16}}>
                    🎯 Lead Report — State-wise
                    <span style={{fontSize:12,fontWeight:400,color:"#64748b",marginLeft:10}}>Planned vs Actual leads by source</span>
                  </h2>
                </div>
                <button
                  onClick={()=>printSection("lead-report-table","Lead Report — Statewise")}
                  style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:6,
                    padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",
                    display:"flex",alignItems:"center",gap:5}}>
                  ⬇ PDF
                </button>
              </div>
              <div className="dash-table-wrap dash-table-wrap--wide">
                <table id="lead-report-table" style={{ width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:2200 }}>
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
                      const totalLeadForProportion = stateBreakdown.reduce((s,r)=>s+r.totalLead,0) || 1;
                      const totalPunchedAllDays = dailyAgg.reduce((s,d)=>s+d.leadsPunched,0);

                      const stateRetailAchieved: Record<string, number> = {};
                      for (const p of approvedProposals) {
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

                      const leadRows: LeadReportRow[] = stateBreakdown.map(sr => {
                        // NOTE: per-channel Walkin/Referral/ATL/Digital data will come from
                        // the LMS API once integrated. Only BTL is populated from live data.
                        const walkinTarget=0, walkinMtdT=0, walkinMtdA=0;
                        const btlTarget = sr.totalLead;
                        const btlMtdT   = Math.round(sr.totalLead * monthFrac);
                        const btlMtdA   = totalPunchedAllDays > 0
                          ? Math.round(totalPunchedAllDays * (sr.totalLead / totalLeadForProportion))
                          : 0;
                        const referralTarget=0, referralMtdT=0, referralMtdA=0;
                        const atlTarget=0, atlMtdT=0, atlMtdA=0;
                        const digitalTarget=0, digitalMtdT=0, digitalMtdA=0;

                        const leadsMonthTarget = walkinTarget+btlTarget+referralTarget+atlTarget+digitalTarget;
                        const leadsMtdTarget = walkinMtdT+btlMtdT+referralMtdT+atlMtdT+digitalMtdT;
                        const totalReceived = walkinMtdA+btlMtdA+referralMtdA+atlMtdA+digitalMtdA;
                        const variance = totalReceived - leadsMonthTarget;
                        const achPct    = leadsMonthTarget>0 ? Math.round((totalReceived/leadsMonthTarget)*100) : 0;
                        const achPctMtd = leadsMtdTarget>0   ? Math.round((totalReceived/leadsMtdTarget)*100)   : 0;

                        const retailTarget = parseFloat(manualRetailTargets[sr.state] ?? "0") || 0;
                        const mtdRetailTarget = Math.round(retailTarget * monthFrac);
                        const mtdRetailAchieved = stateRetailAchieved[sr.state] || 0;
                        const mtdRetailAchPct = mtdRetailTarget>0 ? Math.round((mtdRetailAchieved/mtdRetailTarget)*100) : 0;
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
                      const rowCount = leadRows.length || 1;
                      const avgAchPct       = Math.round(leadRows.reduce((s,r)=>s+r.achPct,0)/rowCount);
                      const avgAchPctMtd    = Math.round(leadRows.reduce((s,r)=>s+r.achPctMtd,0)/rowCount);
                      const avgRetailAchPct = Math.round(leadRows.reduce((s,r)=>s+r.mtdRetailAchPct,0)/rowCount);
                      const avgRetailEnqPct = Math.round(leadRows.reduce((s,r)=>s+r.retailEnqPct,0)/rowCount);

                      return (<>
                        {leadRows.map((r, i)=>(
                          <tr key={r.state} style={{ background:i%2===0?"#fff":"#f8fafc" }}>
                            <td style={{ padding:"7px",fontWeight:700,color:"#0a2540",border:"1px solid #e2e8f0" }}>{r.state}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#92400e",border:"1px solid #e2e8f0" }}>{r.leadsMonthTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,color:"#92400e",border:"1px solid #e2e8f0" }}>{r.leadsMtdTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.walkinTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.walkinMtdT}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#2563eb",border:"1px solid #e2e8f0" }}>{r.walkinMtdA}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.btlTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.btlMtdT}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#16a34a",border:"1px solid #e2e8f0" }}>{r.btlMtdA}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.referralTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.referralMtdT}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#7c3aed",border:"1px solid #e2e8f0" }}>{r.referralMtdA}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.atlTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.atlMtdT}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#db2777",border:"1px solid #e2e8f0" }}>{r.atlMtdA}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.digitalTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.digitalMtdT}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:"#f59e0b",border:"1px solid #e2e8f0" }}>{r.digitalMtdA}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:800,color:"#0a2540",border:"1px solid #e2e8f0" }}>{r.totalReceived}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:r.variance<0?"#dc2626":"#16a34a",border:"1px solid #e2e8f0" }}>{r.variance<0?r.variance:`+${r.variance}`}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:r.achPct>=80?"#16a34a":r.achPct>=50?"#f59e0b":"#dc2626",border:"1px solid #e2e8f0" }}>{r.achPct}%</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:r.achPctMtd>=80?"#16a34a":r.achPctMtd>=50?"#f59e0b":"#dc2626",border:"1px solid #e2e8f0" }}>{r.achPctMtd}%</td>
                            <td style={{ padding:"7px",textAlign:"center",border:"1px solid #e2e8f0" }}>
                              <input type="number" min={0} value={manualRetailTargets[r.state] ?? ""} placeholder="0"
                                style={{ width:60,textAlign:"center",border:"1px solid #fecaca",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:"#fef2f2" }}
                                onChange={(e)=>setManualRetailTargets(prev=>({...prev,[r.state]:e.target.value}))}/>
                            </td>
                            <td style={{ padding:"7px",textAlign:"center",fontSize:11,border:"1px solid #e2e8f0" }}>{r.mtdRetailTarget}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,border:"1px solid #e2e8f0" }}>{r.mtdRetailAchieved}</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:r.mtdRetailAchPct>=80?"#16a34a":r.mtdRetailAchPct>=50?"#f59e0b":"#dc2626",border:"1px solid #e2e8f0" }}>{r.mtdRetailAchPct}%</td>
                            <td style={{ padding:"7px",textAlign:"center",fontWeight:700,color:r.retailEnqPct>=10?"#16a34a":r.retailEnqPct>=5?"#f59e0b":"#dc2626",border:"1px solid #e2e8f0" }}>{r.retailEnqPct}%</td>
                          </tr>
                        ))}
                        <tr style={{ background:"#0a2540", fontWeight:800 }}>
                          <td style={{ padding:"8px 10px",color:"#fbbf24",border:"1px solid #e2e8f0" }}>Grand Total</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#fde68a",border:"1px solid #e2e8f0" }}>{totals.leadsMonthTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#fde68a",border:"1px solid #e2e8f0" }}>{totals.leadsMtdTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#93c5fd",border:"1px solid #e2e8f0" }}>{totals.walkinTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#93c5fd",border:"1px solid #e2e8f0" }}>{totals.walkinMtdT}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#93c5fd",border:"1px solid #e2e8f0" }}>{totals.walkinMtdA}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#6ee7b7",border:"1px solid #e2e8f0" }}>{totals.btlTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#6ee7b7",border:"1px solid #e2e8f0" }}>{totals.btlMtdT}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#6ee7b7",border:"1px solid #e2e8f0" }}>{totals.btlMtdA}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#c4b5fd",border:"1px solid #e2e8f0" }}>{totals.referralTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#c4b5fd",border:"1px solid #e2e8f0" }}>{totals.referralMtdT}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#c4b5fd",border:"1px solid #e2e8f0" }}>{totals.referralMtdA}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#f472b6",border:"1px solid #e2e8f0" }}>{totals.atlTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#f472b6",border:"1px solid #e2e8f0" }}>{totals.atlMtdT}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#f472b6",border:"1px solid #e2e8f0" }}>{totals.atlMtdA}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#fbbf24",border:"1px solid #e2e8f0" }}>{totals.digitalTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#fbbf24",border:"1px solid #e2e8f0" }}>{totals.digitalMtdT}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#fbbf24",border:"1px solid #e2e8f0" }}>{totals.digitalMtdA}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#e2e8f0",border:"1px solid #e2e8f0" }}>{totals.totalReceived}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:totalVariance<0?"#fca5a5":"#86efac",border:"1px solid #e2e8f0" }}>{totalVariance<0?totalVariance:`+${totalVariance}`}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#67e8f9",border:"1px solid #e2e8f0" }}>{totalAchPct}%</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#67e8f9",border:"1px solid #e2e8f0" }}>{totalAchPctMtd}%</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#fca5a5",border:"1px solid #e2e8f0" }}>{totals.retailTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#e2e8f0",border:"1px solid #e2e8f0" }}>{totals.mtdRetailTarget}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#e2e8f0",border:"1px solid #e2e8f0" }}>{totals.mtdRetailAchieved}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#86efac",border:"1px solid #e2e8f0" }}>{totalRetailAchPct}%</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#86efac",border:"1px solid #e2e8f0" }}>{totalRetailEnqPct}%</td>
                        </tr>
                        <tr style={{ background:"#1e293b", fontWeight:700 }}>
                          <td style={{ padding:"7px 10px",color:"#94a3b8",border:"1px solid #e2e8f0" }}>Avg</td>
                          <td colSpan={16} style={{ border:"1px solid #e2e8f0" }}/>
                          <td style={{ border:"1px solid #e2e8f0" }}/>
                          <td style={{ padding:"7px",textAlign:"center",color:"#67e8f9",fontSize:11,border:"1px solid #e2e8f0" }}>{avgAchPct}%</td>
                          <td style={{ padding:"7px",textAlign:"center",color:"#67e8f9",fontSize:11,border:"1px solid #e2e8f0" }}>{avgAchPctMtd}%</td>
                          <td colSpan={2} style={{ border:"1px solid #e2e8f0" }}/>
                          <td style={{ border:"1px solid #e2e8f0" }}/>
                          <td style={{ padding:"7px",textAlign:"center",color:"#86efac",fontSize:11,border:"1px solid #e2e8f0" }}>{avgRetailAchPct}%</td>
                          <td style={{ padding:"7px",textAlign:"center",color:"#86efac",fontSize:11,border:"1px solid #e2e8f0" }}>{avgRetailEnqPct}%</td>
                        </tr>
                      </>);
                    })()}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: DEALER DAILY SHEET — drill-down, shared totals object
              (Total row = pure sums, Avg row = pure averages), matches
              AnalyticsDashboard's fixed dealer-daily drilldown exactly.
          ══════════════════════════════════════════════════════════════ */}
          {isAdmin && reportTab === "dealer-daily" && selectedDealerDaily && (() => {
            const entries = selectedDealerDaily.dailyEntries;
            const dayCount = entries.length || 1;
            const sum = (fn: (e: DailyEntry) => number) => entries.reduce((s,e)=>s+(fn(e)||0),0);

            const totals = {
              canopy:              sum(e => (e as any).setupCount || 0),
              planned:             sum(e => e.enquiryPlanned),
              actual:              sum(e => e.enquiryActual),
              hot:                 sum(e => (e as any).enquiryHot || 0),
              tdPlanned:           sum(e => e.testDrivePlanned),
              tdActual:            sum(e => e.testDriveActual),
              bookToday:           sum(e => e.bookingActual),
              bookInHand:          sum(e => (e as any).bookingInHand || 0),
              retail:              sum(e => e.retailActual),
              retailMtdActivity:   sum(e => (e as any).retailMtdActivity || 0),
              retailMtd:           sum(e => (e as any).retailMtd || 0),
              retailRatePerCanopy: sum(e => (e as any).retailRatePerCanopy || 0),
              closingStock:        sum(e => (e as any).closingStock || 0),
              lmsLeads:            sum(e => (e as any).lmsLeads || 0),
              leadsPunched:        sum(e => e.leadsPunched),
            };
            const enqPerCanopyTotal = entries.reduce((s,e) => {
              const sc = (e as any).setupCount || 0;
              return s + (sc>0 ? Math.round((e.enquiryActual||0)/sc) : 0);
            }, 0);
            const tdPerCanopyTotal = entries.reduce((s,e) => {
              const sc = (e as any).setupCount || 0;
              return s + (sc>0 ? Math.round((e.testDriveActual||0)/sc) : 0);
            }, 0);
            const retailConvPctTotal = entries.reduce((s,e) => {
              const leadsD = (e as any).lmsLeads || 0;
              const mtdAct = (e as any).retailMtdActivity || 0;
              return s + (leadsD>0 ? Math.round((mtdAct/leadsD)*100) : 0);
            }, 0);
            const lmsGapTotal = totals.lmsLeads - totals.leadsPunched;

            const avgRow = {
              canopy:              Math.round((totals.canopy / dayCount) * 10) / 10,
              planned:             Math.round(totals.planned / dayCount),
              actual:              Math.round(totals.actual / dayCount),
              perCanopy:           Math.round((enqPerCanopyTotal / dayCount) * 10) / 10,
              hot:                 Math.round((totals.hot / dayCount) * 10) / 10,
              tdPlanned:           Math.round(totals.tdPlanned / dayCount),
              tdActual:            Math.round(totals.tdActual / dayCount),
              tdPerCanopy:         Math.round((tdPerCanopyTotal / dayCount) * 10) / 10,
              bookToday:           Math.round((totals.bookToday / dayCount) * 10) / 10,
              bookInHand:          Math.round((totals.bookInHand / dayCount) * 10) / 10,
              retail:              Math.round((totals.retail / dayCount) * 10) / 10,
              retailMtdActivity:   Math.round((totals.retailMtdActivity / dayCount) * 10) / 10,
              retailMtd:           Math.round((totals.retailMtd / dayCount) * 10) / 10,
              retailRatePerCanopy: Math.round((totals.retailRatePerCanopy / dayCount) * 10) / 10,
              closingStock:        Math.round((totals.closingStock / dayCount) * 10) / 10,
              lmsLeads:            Math.round((totals.lmsLeads / dayCount) * 10) / 10,
              leadsPunched:        Math.round((totals.leadsPunched / dayCount) * 10) / 10,
              lmsGap:              Math.round((lmsGapTotal / dayCount) * 10) / 10,
              retailConvPct:       Math.round((retailConvPctTotal / dayCount) * 10) / 10,
            };
            const kpiConvPct = totals.lmsLeads > 0
              ? Math.round((totals.retailMtdActivity / totals.lmsLeads) * 100) : 0;

            const th = (label:React.ReactNode) => (
              <th style={{ padding:"6px 8px", fontSize:11, fontWeight:700, textAlign:"center",
                border:"1px solid #cbd5e1", background:"#bfdbfe", color:"#0a2540" }}>{label}</th>
            );
            const td = (val: React.ReactNode, extra:React.CSSProperties = {}) => (
              <td style={{ padding:"5px 8px", fontSize:12, textAlign:"center",
                border:"1px solid #e2e8f0", ...extra }}>{val ?? ""}</td>
            );

            return (
              <section className="dash-section">
                <div style={{ marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                  <button onClick={() => { setReportTab("daily-summary"); setSelectedDealerDaily(null); }}
                    style={{ background:"#f1f5f9", border:"1px solid #e2e8f0", borderRadius:7,
                      padding:"6px 14px", fontSize:12, fontWeight:600, cursor:"pointer", color:"#374151" }}>
                    ← Back to Daily Summary
                  </button>
                  <span style={{ fontSize:12, color:"#64748b" }}>
                    {selectedDealerDaily.state} · {selectedDealerDaily.activityType} · Live daily history
                  </span>
                  <button
                    onClick={()=>printSection("dealer-daily-table",`${selectedDealerDaily.dealer} Daily Sheet`)}
                    style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:6,
                      padding:"7px 16px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    ⬇ PDF
                  </button>
                </div>

                {/* Title banner */}
                <div style={{ background:"#0a2540", borderRadius:8, padding:"14px 28px",
                  textAlign:"center", marginBottom:16, boxShadow:"0 4px 10px rgba(10,37,64,0.25)" }}>
                  <span style={{ color:"#fff", fontWeight:800, fontSize:20, letterSpacing:"0.02em" }}>
                    {selectedDealerDaily.dealer}, {selectedDealerDaily.location}
                  </span>
                </div>

                {/* KPI summary cards — sourced from the exact same `totals` used below */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10, marginBottom:16 }}>
                  {[
                    { label:"Canopy", value: selectedDealerDaily.canopy },
                    { label:"Setup Count", value: totals.canopy },
                    { label:"Enq Actual (MTD)", value: totals.actual },
                    { label:"Hot", value: totals.hot },
                    { label:"TD Actual (MTD)", value: totals.tdActual },
                    { label:"Booking In Hand", value: totals.bookInHand },
                    { label:"Retail MTD", value: totals.retailMtd },
                    { label:"Retail Rate/Canopy", value: totals.retailRatePerCanopy },
                    { label:"Activity Day", value: entries.length },
                    { label:"Closing Stock", value: totals.closingStock },
                    { label:"Leads (Target)", value: totals.lmsLeads },
                    { label:"Leads Punched", value: totals.leadsPunched },
                    { label:"Gap", value: lmsGapTotal },
                    { label:"Conv %", value: `${kpiConvPct}%` },
                  ].map((f) => (
                    <div key={f.label} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:"#6b7280", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>{f.label}</div>
                      <div style={{ fontSize:18, fontWeight:700, color:"#0a2540", marginTop:4 }}>{f.value}</div>
                    </div>
                  ))}
                </div>

                {entries.length === 0 ? (
                  <div style={{ textAlign:"center",padding:"40px 20px",color:"#9ca3af" }}>
                    <div style={{ fontSize:32,marginBottom:10 }}>📋</div>
                    <div style={{ fontWeight:700,fontSize:14,color:"#0a2540" }}>No daily entries yet for this activity</div>
                  </div>
                ) : (
                  <div className="dash-table-wrap dash-table-wrap--wide">
                    <table id="dealer-daily-table" style={{ width:"100%", borderCollapse:"collapse", minWidth:1900, background:"#fff" }}>
                      <thead>
                        <tr>
                          <th colSpan={2} style={{ background:"#e5e7eb", padding:"6px 8px", fontWeight:700,
                            fontSize:13, textAlign:"left", border:"1px solid #cbd5e1" }}>
                            {selectedDealerDaily.dealer}, {selectedDealerDaily.location}
                          </th>
                          <th colSpan={16} style={{ background:"#e5e7eb", border:"1px solid #cbd5e1" }}/>
                          <th colSpan={2} style={{ background:"#e5e7eb", padding:"6px 8px", fontWeight:700,
                            fontSize:13, textAlign:"center", border:"1px solid #cbd5e1" }}>
                            BG- {selectedDealerDaily.bgMember || "—"}
                          </th>
                          <th style={{ background:"#e5e7eb", border:"1px solid #cbd5e1" }}/>
                        </tr>
                        <tr>
                          <th rowSpan={2} style={{ background:"#93c5fd", padding:"6px 8px", fontSize:11,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Date</th>
                          <th colSpan={5} style={{ background:"#93c5fd", padding:"5px 8px", fontSize:12,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Enquiry</th>
                          <th colSpan={3} style={{ background:"#fbbf24", padding:"5px 8px", fontSize:12,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Test Drive</th>
                          <th colSpan={2} style={{ background:"#93c5fd", padding:"5px 8px", fontSize:12,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Booking</th>
                          <th colSpan={4} style={{ background:"#fbbf24", padding:"5px 8px", fontSize:12,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Retail</th>
                          <th rowSpan={2} style={{ background:"#94a3b8", padding:"6px 8px", fontSize:11,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Activity<br/>Day</th>
                          <th rowSpan={2} style={{ background:"#e2e8f0", padding:"6px 8px", fontSize:11,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Closing<br/>Stock</th>
                          <th colSpan={3} style={{ background:"#a5b4fc", padding:"5px 8px", fontSize:12,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>LMS</th>
                          <th rowSpan={2} style={{ background:"#67e8f9", padding:"6px 8px", fontSize:11,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Retail<br/>Conv%</th>
                          <th rowSpan={2} style={{ background:"#c4b5fd", padding:"6px 8px", fontSize:11,
                            fontWeight:700, textAlign:"center", border:"1px solid #cbd5e1" }}>Media</th>
                        </tr>
                        <tr>
                          {th("Setup Count")}{th("Planned")}{th("Actual")}{th("Per\u00A0Canopy")}{th("Hot")}
                          {th("Planned")}{th("Actual")}{th("Per Canopy")}
                          {th("Today")}{th("In hand")}
                          {th("Today")}{th("MTD(Act.)")}{th("MTD")}{th("Rate/Canopy")}
                          {th("Leads")}{th("Punched")}{th("Gap")}
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry, i) => {
                          const photosOnDay = selectedDealerDaily.media.filter(m =>
                            m.capturedAt.startsWith(entry.date) && (isImageType(m.fileType) || isVideoType(m.fileType)));
                          const invoicesOnDay = selectedDealerDaily.media.filter(m =>
                            m.capturedAt.startsWith(entry.date) && !isImageType(m.fileType) && !isVideoType(m.fileType));
                          const hasCanopy = ((entry as any).setupCount||0) > 0 || (entry.enquiryPlanned||0) > 0;
                          const hasData = entry.enquiryActual>0||entry.testDriveActual>0||entry.bookingActual>0||entry.retailActual>0||entry.leadsPunched>0||photosOnDay.length>0||invoicesOnDay.length>0;
                          const setupCount=(entry as any).setupCount||0;
                          const enqPerCanopy=setupCount>0?Math.round(entry.enquiryActual/setupCount):0;
                          const tdPerCanopy=setupCount>0?Math.round(entry.testDriveActual/setupCount):0;
                          const retailMtdRunning=(entry as any).retailMtd || 0;
                          const retailRatePerCanopy=(entry as any).retailRatePerCanopy || 0;
                          const activityDay=i+1;
                          const lmsLeadsDay=(entry as any).lmsLeads||0;
                          const lmsGapDay=lmsLeadsDay-(entry.leadsPunched||0);
                          const retailMtdActivityDay=(entry as any).retailMtdActivity||0;
                          const retailConvPctDay=lmsLeadsDay>0?Math.round((retailMtdActivityDay/lmsLeadsDay)*100):0;
                          return (
                            <tr key={entry.date} style={{ background:i%2===0?"#fff":"#f8fafc", opacity:hasData?1:0.6 }}>
                              {td(entry.date, { textAlign:"left", fontWeight:600, color:"#374151" })}
                              {td(hasCanopy ? (setupCount||"") : "")}
                              {td(entry.enquiryPlanned || 0)}
                              {td(entry.enquiryActual || "")}
                              {td(enqPerCanopy||"—", { color:"#059669", fontWeight:600 })}
                              {td((entry as any).enquiryHot || "", { color:(entry as any).enquiryHot>0?"#b91c1c":undefined, fontWeight:(entry as any).enquiryHot>0?700:400 })}
                              {td(entry.testDrivePlanned || 0)}
                              {td(entry.testDriveActual || "")}
                              {td(tdPerCanopy||"—", { color:"#7c3aed", fontWeight:600 })}
                              {td(entry.bookingActual || "")}
                              {td((entry as any).bookingInHand || "")}
                              {td(entry.retailActual || "")}
                              {td(retailMtdActivityDay || "")}
                              {td(retailMtdRunning||"—", { color:"#92400e", fontWeight:700 })}
                              {td(retailRatePerCanopy||"0.0", { color:"#c2410c", fontWeight:600 })}
                              {td(<span title="Auto-locked">{activityDay} 🔒</span>, { color:"#64748b" })}
                              {td((entry as any).closingStock || "")}
                              {td(lmsLeadsDay||"", { color: lmsLeadsDay>0?"#3730a3":undefined, fontWeight: lmsLeadsDay>0?700:400 })}
                              {td(entry.leadsPunched || "", { color: entry.leadsPunched>0?"#4338ca":undefined, fontWeight: entry.leadsPunched>0?700:400 })}
                              {td(lmsGapDay, { color: lmsGapDay>0?"#b91c1c":lmsGapDay<0?"#166534":"#64748b", fontWeight:700 })}
                              {td(`${retailConvPctDay}%`, { color:retailConvPctDay>=10?"#166534":retailConvPctDay>0?"#854d0e":"#94a3b8", fontWeight:700, background:retailConvPctDay>=10?"#f0fdf4":retailConvPctDay>0?"#fefce8":"transparent" })}
                              {td(
                                <div style={{ display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center",alignItems:"center" }}>
                                  {photosOnDay.slice(0,3).map(m => {
                                    const url = resolveMediaUrl(m.fileUrl);
                                    return (
                                      <div key={m.id} style={{ width:24,height:24,borderRadius:3,overflow:"hidden",cursor:"pointer",border:"1px solid #bbf7d0" }}
                                        onClick={() => setMediaViewer({ url, name: m.fileName, type: m.fileType })}>
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

                        {/* Total row — pure sum of every column */}
                        <tr style={{ background:"#93c5fd", fontWeight:800 }}>
                          {td("Total", { textAlign:"left", background:"#93c5fd" })}
                          {td(totals.canopy, { background:"#93c5fd" })}
                          {td(totals.planned, { background:"#93c5fd" })}
                          {td(totals.actual, { background:"#93c5fd" })}
                          {td(enqPerCanopyTotal||"—", { background:"#93c5fd" })}
                          {td(totals.hot, { background:"#93c5fd" })}
                          {td(totals.tdPlanned, { background:"#93c5fd" })}
                          {td(totals.tdActual, { background:"#93c5fd" })}
                          {td(tdPerCanopyTotal||"—", { background:"#93c5fd" })}
                          {td(totals.bookToday, { background:"#93c5fd" })}
                          {td(totals.bookInHand, { background:"#93c5fd" })}
                          {td(totals.retail, { background:"#93c5fd" })}
                          {td(totals.retailMtdActivity, { background:"#93c5fd" })}
                          {td(totals.retailMtd, { background:"#93c5fd" })}
                          {td(totals.retailRatePerCanopy, { background:"#93c5fd" })}
                          {td(`${entries.length}d 🔒`, { background:"#93c5fd", fontSize:10 })}
                          {td(totals.closingStock, { background:"#93c5fd" })}
                          {td(totals.lmsLeads, { background:"#93c5fd" })}
                          {td(totals.leadsPunched, { background:"#93c5fd" })}
                          {td(lmsGapTotal, { background:"#93c5fd" })}
                          {td(retailConvPctTotal+"%", { background:"#93c5fd" })}
                          {td("📸"+selectedDealerDaily.media.filter(m=>isImageType(m.fileType)||isVideoType(m.fileType)).length, { background:"#93c5fd", fontSize:10 })}
                        </tr>

                        {/* Avg row — pure average (Total ÷ days) of every column */}
                        <tr style={{ fontWeight:700 }}>
                          {td("Average", { textAlign:"left" })}
                          {td(avgRow.canopy, { background:"#fef9c3" })}
                          {td(avgRow.planned, { background:"#fef9c3" })}
                          {td(avgRow.actual, { background:"#fef9c3" })}
                          {td(avgRow.perCanopy, { background:"#fef9c3" })}
                          {td(avgRow.hot, { background:"#fef9c3" })}
                          {td(avgRow.tdPlanned, { background:"#fef9c3" })}
                          {td(avgRow.tdActual, { background:"#fef9c3" })}
                          {td(avgRow.tdPerCanopy, { background:"#fef9c3" })}
                          {td(avgRow.bookToday, { background:"#fef9c3" })}
                          {td(avgRow.bookInHand, { background:"#fef9c3" })}
                          {td(avgRow.retail, { background:"#fef9c3" })}
                          {td(avgRow.retailMtdActivity, { background:"#fef9c3" })}
                          {td(avgRow.retailMtd, { background:"#fef9c3" })}
                          {td(avgRow.retailRatePerCanopy, { background:"#fef9c3" })}
                          {td("—", { fontSize:10, color:"#94a3b8" })}
                          {td(avgRow.closingStock, { background:"#fef9c3" })}
                          {td(avgRow.lmsLeads, { background:"#fef9c3" })}
                          {td(avgRow.leadsPunched, { background:"#fef9c3" })}
                          {td(avgRow.lmsGap, { background:"#fef9c3" })}
                          {td(avgRow.retailConvPct+"%", { background:"#fef9c3" })}
                          {td("—", { fontSize:10, color:"#94a3b8" })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })()}
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
      {active && <div className="dash-kpi-active-dot"/>}
    </button>
  );
}

function Dash() {
  return <span className="dash-muted">0</span>;
}
// src/pages/ReportsPage.tsx
import { useState } from "react";
import { useMsal } from "@azure/msal-react";
import * as XLSX from "xlsx";
import {
  downloadExcelReport, downloadPdfReport, fetchReportData,
  type ReportFilters,
} from "../services/reportService";
import { useAuthStore } from "../store/authStore";
import { fetchLeadFunnelSummary, type LeadFunnelSummaryResponse } from "../services/leadReportService";
import "./ReportsPage.css";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const inr  = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const inrC = (v: number) => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};

// ── Print/PDF helper — prints the target table(s) in a clean PDF-ready view ──
function printSections(sectionIds: string[], title: string) {
  const els = sectionIds.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
  if (els.length === 0) return;

  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) { alert("Allow pop-ups to download PDF."); return; }

  const styles = Array.from(document.styleSheets)
    .flatMap((ss) => {
      try { return Array.from(ss.cssRules).map((r) => r.cssText); }
      catch { return []; }
    })
    .join("\n");

  const sectionsHtml = els.map((el) => el.outerHTML).join('<div style="height:24px"></div>');

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
      ${sectionsHtml}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
}

export default function ReportsPage() {
  const { instance } = useMsal();
  const { user }     = useAuthStore();

  // ── Filters ───────────────────────────────────────────────────────────────
  const [period,       setPeriod]       = useState<"daily"|"weekly"|"monthly"|"custom">("monthly");
  const [from,         setFrom]         = useState("");
  const [to,           setTo]           = useState("");
  const [stateFilter,  setStateFilter]  = useState("");
  const [dealerFilter, setDealerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter,  setMonthFilter]  = useState("");
  const [leadGroupBy,  setLeadGroupBy]  = useState<"rsm"|"dealer">("rsm");
  const [leadSummary,  setLeadSummary]  = useState<LeadFunnelSummaryResponse|null>(null);
  const [leadLoading,  setLeadLoading]  = useState(false);
  const [leadError,    setLeadError]    = useState<string|null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [preview,     setPreview]     = useState<any>(null);
  const [activeTab,   setActiveTab]   = useState<"summary"|"dealer"|"activity"|"leads">("summary");
  const [loading,     setLoading]     = useState(false);
  const [downloading, setDownloading] = useState<"excel"|"pdf"|null>(null);
  const [error,       setError]       = useState<string|null>(null);

  // Build API filters — used ONLY for the top-of-page "quick download" buttons,
  // which have no preview loaded yet and therefore no Status/Month to apply.
  const apiFilters: ReportFilters = {
    period:  period === "custom" ? undefined : period,
    from:    period === "custom" ? from   : undefined,
    to:      period === "custom" ? to     : undefined,
    state:   stateFilter  || undefined,
    dealer:  dealerFilter || undefined,
  };

  const handlePreview = async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchReportData(apiFilters, instance);
      setPreview(data);
      setActiveTab("summary");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadLeadSummary = async (groupBy: "rsm"|"dealer" = leadGroupBy) => {
    setLeadLoading(true); setLeadError(null);
    try {
      const data = await fetchLeadFunnelSummary(instance, {
        groupBy,
        state: stateFilter || undefined,   // reuses the same State filter you already have
      });
      setLeadSummary(data);
      setLeadGroupBy(groupBy);
    } catch (e) {
      setLeadError(e instanceof Error ? e.message : "Failed to load LMS lead summary.");
    } finally {
      setLeadLoading(false);
    }
  };

  // ── Quick download (top of page, no preview needed) — Period/State/Dealer
  // only, since Status/Month have no data source to filter against yet. ─────
  const handleDownload = async (type: "excel"|"pdf") => {
    setDownloading(type); setError(null);
    try {
      if (type === "excel") await downloadExcelReport(apiFilters, instance);
      else                  await downloadPdfReport(apiFilters, instance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };

  // ── Client-side filtering of preview rows ─────────────────────────────────
  const filteredRows = preview?.rows?.filter((r: any) => {
    if (monthFilter  && r.month  !== monthFilter)  return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  }) ?? [];

  const filteredState = preview?.stateSummary ?? [];

  const filteredDealer = preview?.dealerSummary?.filter((d: any) =>
    (!stateFilter  || d.state.toLowerCase().includes(stateFilter.toLowerCase())) &&
    (!dealerFilter || d.dealer.toLowerCase().includes(dealerFilter.toLowerCase()))
  ) ?? [];

  const hasFilters = stateFilter || dealerFilter || statusFilter || monthFilter;

  // ── Filename suffix reflecting whichever filters are currently active ─────
  const filterSuffix = () =>
    [stateFilter, dealerFilter, monthFilter, statusFilter]
      .filter(Boolean).join("_").replace(/\s+/g, "");

  // ── Filtered Excel download — built directly from filteredState /
  // filteredDealer / filteredRows, the EXACT arrays driving the on-screen
  // tables, so State + Dealer + Status + Month all apply correctly. Includes
  // a Grand Totals row on each sheet, computed as pure column sums (CAC/CPL
  // recomputed as totalBudget ÷ totalRetail|totalLead — weighted, not an
  // average-of-averages). ────────────────────────────────────────────────────
  const handleDownloadFiltered = (type: "excel" | "pdf") => {
    if (!preview) return;

    if (type === "excel") {
      const wb = XLSX.utils.book_new();

      // ── Sheet 1: State-wise ──────────────────────────────────────────────
      const stateRows: (string | number)[][] = [[
        "State", "Dealers", "Total Budget (₹)", "Retail Target", "Lead Target", "CAC (₹)", "CPL (₹)",
        "Pending", "Approved", "Rejected", "Needs Revision",
      ]];
      for (const s of filteredState) {
        stateRows.push([
          s.state, s.dealers, Math.round(s.totalBudget), s.totalRetailTarget, s.totalLeadTarget,
          Math.round(s.cac), Math.round(s.cpl), s.pending, s.approved, s.rejected,
          (s as any).needsRevision ?? (s as any).NeedsRevision ?? 0,
        ]);
      }
      if (filteredState.length > 0) {
        const gDealers  = filteredState.reduce((s: number, r: any) => s + r.dealers, 0);
        const gBudget   = filteredState.reduce((s: number, r: any) => s + r.totalBudget, 0);
        const gRetail   = filteredState.reduce((s: number, r: any) => s + r.totalRetailTarget, 0);
        const gLead     = filteredState.reduce((s: number, r: any) => s + r.totalLeadTarget, 0);
        const gPending  = filteredState.reduce((s: number, r: any) => s + r.pending, 0);
        const gApproved = filteredState.reduce((s: number, r: any) => s + r.approved, 0);
        const gRejected = filteredState.reduce((s: number, r: any) => s + r.rejected, 0);
        const gRevision = filteredState.reduce((s: number, r: any) => s + ((r as any).needsRevision ?? (r as any).NeedsRevision ?? 0), 0);
        const gCac = gRetail > 0 ? gBudget / gRetail : 0;
        const gCpl = gLead   > 0 ? gBudget / gLead   : 0;
        stateRows.push([
          "GRAND TOTAL", gDealers, Math.round(gBudget), gRetail, gLead,
          Math.round(gCac), Math.round(gCpl), gPending, gApproved, gRejected, gRevision,
        ]);
      }
      const wsState = XLSX.utils.aoa_to_sheet(stateRows);
      wsState["!cols"] = stateRows[0].map(() => ({ wch: 16 }));
      XLSX.utils.book_append_sheet(wb, wsState, "State-wise");

      // ── Sheet 2: Dealer-wise ─────────────────────────────────────────────
      const dealerRowsOut: (string | number)[][] = [[
        "State", "Dealer", "Activities", "Total Budget (₹)", "Retail Target", "Lead Target", "CAC (₹)", "CPL (₹)",
        "Pending", "Approved", "Rejected", "Needs Revision",
      ]];
      for (const d of filteredDealer) {
        dealerRowsOut.push([
          d.state, d.dealer, d.activities, Math.round(d.totalBudget), d.totalRetailTarget, d.totalLeadTarget,
          Math.round(d.cac), Math.round(d.cpl), d.pending, d.approved, d.rejected,
          (d as any).needsRevision ?? (d as any).NeedsRevision ?? 0,
        ]);
      }
      if (filteredDealer.length > 0) {
        const gActivities = filteredDealer.reduce((s: number, r: any) => s + r.activities, 0);
        const gBudget      = filteredDealer.reduce((s: number, r: any) => s + r.totalBudget, 0);
        const gRetail      = filteredDealer.reduce((s: number, r: any) => s + r.totalRetailTarget, 0);
        const gLead        = filteredDealer.reduce((s: number, r: any) => s + r.totalLeadTarget, 0);
        const gPending     = filteredDealer.reduce((s: number, r: any) => s + r.pending, 0);
        const gApproved    = filteredDealer.reduce((s: number, r: any) => s + r.approved, 0);
        const gRejected    = filteredDealer.reduce((s: number, r: any) => s + r.rejected, 0);
        const gRevision    = filteredDealer.reduce((s: number, r: any) => s + ((r as any).needsRevision ?? (r as any).NeedsRevision ?? 0), 0);
        const gCac = gRetail > 0 ? gBudget / gRetail : 0;
        const gCpl = gLead   > 0 ? gBudget / gLead   : 0;
        dealerRowsOut.push([
          "GRAND TOTAL", `${filteredDealer.length} dealers`, gActivities, Math.round(gBudget), gRetail, gLead,
          Math.round(gCac), Math.round(gCpl), gPending, gApproved, gRejected, gRevision,
        ]);
      }
      const wsDealer = XLSX.utils.aoa_to_sheet(dealerRowsOut);
      wsDealer["!cols"] = dealerRowsOut[0].map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, wsDealer, "Dealer-wise");

      // ── Sheet 3: Activity Detail ─────────────────────────────────────────
      const activityRows: (string | number)[][] = [[
        "Token", "Dealer", "State", "RSM", "Month", "Status", "Activity", "Type", "Subcategory",
        "QTY", "Sales%", "Lead", "Retail", "Budget (₹)", "BGauss%", "BGauss Amt (₹)", "Total (₹)", "Start", "End",
      ]];
      for (const r of filteredRows) {
        activityRows.push([
          r.tokenNumber ?? "—", r.dealerName, r.state, r.rsmName, r.month, r.status,
          r.activityType, r.category ?? "—", r.subcategory ?? "—", r.qty ?? 1,
          r.salesPercent != null ? r.salesPercent : "—", r.leadTarget, r.retailTarget,
          Math.round(r.budget), r.bgaussShare ?? 100, Math.round(r.bgaussAmount ?? 0), Math.round(r.total),
          r.startDate ?? "—", r.endDate ?? "—",
        ]);
      }
      if (filteredRows.length > 0) {
        const gLead    = filteredRows.reduce((s: number, r: any) => s + (r.leadTarget || 0), 0);
        const gRetail  = filteredRows.reduce((s: number, r: any) => s + (r.retailTarget || 0), 0);
        const gBudget  = filteredRows.reduce((s: number, r: any) => s + (r.budget || 0), 0);
        const gBgAmt   = filteredRows.reduce((s: number, r: any) => s + (r.bgaussAmount || 0), 0);
        const gTotal   = filteredRows.reduce((s: number, r: any) => s + (r.total || 0), 0);
        activityRows.push([
          "GRAND TOTAL", `${filteredRows.length} activities`, "", "", "", "", "", "", "",
          "", "", gLead, gRetail, Math.round(gBudget), "", Math.round(gBgAmt), Math.round(gTotal), "", "",
        ]);
      }
      const wsActivity = XLSX.utils.aoa_to_sheet(activityRows);
      wsActivity["!cols"] = activityRows[0].map(() => ({ wch: 14 }));
      XLSX.utils.book_append_sheet(wb, wsActivity, "Activity Detail");

      const suffix = filterSuffix();
      XLSX.writeFile(wb, `BTL_Report${suffix ? `_${suffix}` : ""}.xlsx`);
    } else {
      // PDF — print all three currently-filtered tables together
      printSections(
        ["rp-summary-table", "rp-dealer-table", "rp-activity-table"],
        "Filtered Report — State-wise, Dealer-wise & Activity Detail",
      );
    }
  };

  return (
    <div className="rp-page">

      {/* ── Page header ── */}
      <div className="rp-header">
        <div>
          <h1 className="rp-title">📊 BTL Reports</h1>
          <p className="rp-sub">
            Download Excel &amp; PDF reports — activity detail, state-wise and dealer-wise summaries.
            Includes Subcategory, Qty, Sales%, BGauss Share.
          </p>
        </div>
        {/* Quick download — no preview needed, so Status/Month can't apply yet */}
        <div className="rp-header-btns">
          <button className="rp-btn rp-btn--excel"
            onClick={() => handleDownload("excel")}
            disabled={downloading !== null}
            title="Quick download using Period/State/Dealer only — click Preview Data first if you need Status or Month filters applied.">
            {downloading === "excel"
              ? <><span className="rp-spin"/>Generating…</>
              : "⬇ Excel"}
          </button>
          <button className="rp-btn rp-btn--pdf"
            onClick={() => handleDownload("pdf")}
            disabled={downloading !== null}
            title="Quick download using Period/State/Dealer only — click Preview Data first if you need Status or Month filters applied.">
            {downloading === "pdf"
              ? <><span className="rp-spin"/>Generating…</>
              : "⬇ PDF"}
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      <div className="rp-filter-panel">

        {/* Period selector */}
        <div className="rp-filter-row">
          <div className="rp-field rp-field--wide">
            <label className="rp-label">Period</label>
            <div className="rp-period-btns">
              {(["daily","weekly","monthly","custom"] as const).map((p) => (
                <button key={p}
                  className={`rp-period-btn${period===p?" rp-period-btn--active":""}`}
                  onClick={() => setPeriod(p)}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {period === "custom" && (
            <>
              <div className="rp-field">
                <label className="rp-label">From</label>
                <input className="rp-input" type="date" value={from}
                  onChange={(e) => setFrom(e.target.value)}/>
              </div>
              <div className="rp-field">
                <label className="rp-label">To</label>
                <input className="rp-input" type="date" value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}/>
              </div>
            </>
          )}
        </div>

        {/* Extra filters */}
        <div className="rp-filter-row rp-filter-row--extras">
          <div className="rp-field">
            <label className="rp-label">State</label>
            <input className="rp-input" type="text" placeholder="e.g. Maharashtra"
              value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}/>
          </div>
          <div className="rp-field">
            <label className="rp-label">Dealer</label>
            <input className="rp-input" type="text" placeholder="Dealer name"
              value={dealerFilter} onChange={(e) => setDealerFilter(e.target.value)}/>
          </div>
          <div className="rp-field">
            <label className="rp-label">Status</label>
            <select className="rp-input" value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="NeedsRevision">Needs Revision</option>
            </select>
          </div>
          <div className="rp-field">
            <label className="rp-label">Month</label>
            <select className="rp-input" value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All Months</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {!preview && (stateFilter || dealerFilter || statusFilter || monthFilter) && (
          <div style={{ fontSize:11, color:"#92400e", background:"#fffbeb", border:"1px solid #fde68a",
            borderRadius:7, padding:"6px 12px", marginTop:8 }}>
            ⚠ Click <strong>Preview Data</strong> below to load matching data before downloading — the quick download
            buttons above only apply Period/State/Dealer, not Status or Month.
          </div>
        )}

        {/* Footer actions */}
        <div className="rp-filter-footer">
          <button className="rp-btn rp-btn--preview"
            onClick={handlePreview} disabled={loading}>
            {loading
              ? <><span className="rp-spin"/>Loading preview…</>
              : "🔍 Preview Data"}
          </button>
          {hasFilters && (
            <button className="rp-btn rp-btn--ghost" onClick={() => {
              setStateFilter(""); setDealerFilter("");
              setStatusFilter(""); setMonthFilter("");
            }}>✕ Clear filters</button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rp-error">
          <span>⚠</span>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── Preview ── */}
      {preview && (
        <div className="rp-preview">

          {/* KPI strip */}
          <div className="rp-kpi-strip">
            <div className="rp-kpi rp-kpi--blue">
              <span className="rp-kpi-val">{preview.totalProposals}</span>
              <span className="rp-kpi-lbl">Proposals</span>
            </div>
            <div className="rp-kpi rp-kpi--teal">
              <span className="rp-kpi-val">{preview.totalActivities}</span>
              <span className="rp-kpi-lbl">Activities</span>
            </div>
            <div className="rp-kpi rp-kpi--green">
              <span className="rp-kpi-val">{inrC(preview.totalBudget)}</span>
              <span className="rp-kpi-lbl">Total Budget</span>
            </div>
            <div className="rp-kpi rp-kpi--amber">
              <span className="rp-kpi-val">{inr(preview.overallCac)}</span>
              <span className="rp-kpi-lbl">Overall CAC</span>
            </div>
            <div className="rp-kpi rp-kpi--purple">
              <span className="rp-kpi-val">{inr(preview.overallCpl)}</span>
              <span className="rp-kpi-lbl">Overall CPL</span>
            </div>
            <div className="rp-kpi rp-kpi--muted">
              <span className="rp-kpi-val rp-kpi-val--sm">{preview.periodLabel}</span>
              <span className="rp-kpi-lbl">Period</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="rp-tabs">
            {([
              ["summary",  `State-wise (${filteredState.length})`],
              ["dealer",   `Dealer-wise (${filteredDealer.length})`],
              ["activity", `Activity Detail (${filteredRows.length})`],
              ["leads",    `Leads (LMS)${leadSummary ? ` (${leadSummary.rows.length})` : ""}`],
            ] as const).map(([tab, label]) => (
              <button key={tab}
                className={`rp-tab${activeTab===tab?" rp-tab--active":""}`}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === "leads" && !leadSummary) handleLoadLeadSummary();
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── State Summary tab ── */}
          {activeTab === "summary" && (
            <div className="rp-table-scroll">
              <table id="rp-summary-table" className="rp-table" style={{ minWidth: "700px" }}>
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="rp-num">Dealers</th>
                    <th className="rp-num">Total Budget</th>
                    <th className="rp-num">Retail Target</th>
                    <th className="rp-num">Lead Target</th>
                    <th className="rp-num">CAC</th>
                    <th className="rp-num">CPL</th>
                    <th className="rp-num">Pending</th>
                    <th className="rp-num">Approved</th>
                    <th className="rp-num">Rejected</th>
                    <th className="rp-num" style={{background:"#f59e0b22",color:"#92400e"}}>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredState.map((s: any, i: number) => (
                    <tr key={s.state} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td><span className="rp-state-tag">{s.state}</span></td>
                      <td className="rp-num">{s.dealers}</td>
                      <td className="rp-num rp-mono">{inr(s.totalBudget)}</td>
                      <td className="rp-num">{s.totalRetailTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num">{s.totalLeadTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num rp-mono">{inr(s.cac)}</td>
                      <td className="rp-num rp-mono">{inr(s.cpl)}</td>
                      <td className="rp-num"><StatusBadge v={s.pending}  t="pending"/></td>
                      <td className="rp-num"><StatusBadge v={s.approved} t="approved"/></td>
                      <td className="rp-num"><StatusBadge v={s.rejected} t="rejected"/></td>
                      <td className="rp-num"><StatusBadge v={(s as any).needsRevision ?? (s as any).NeedsRevision ?? 0} t="revision"/></td>
                    </tr>
                  ))}
                </tbody>
                {filteredState.length > 0 && (() => {
                  const gDealers  = filteredState.reduce((s: number, r: any) => s + r.dealers, 0);
                  const gBudget   = filteredState.reduce((s: number, r: any) => s + r.totalBudget, 0);
                  const gRetail   = filteredState.reduce((s: number, r: any) => s + r.totalRetailTarget, 0);
                  const gLead     = filteredState.reduce((s: number, r: any) => s + r.totalLeadTarget, 0);
                  const gPending  = filteredState.reduce((s: number, r: any) => s + r.pending, 0);
                  const gApproved = filteredState.reduce((s: number, r: any) => s + r.approved, 0);
                  const gRejected = filteredState.reduce((s: number, r: any) => s + r.rejected, 0);
                  const gRevision = filteredState.reduce((s: number, r: any) => s + ((r as any).needsRevision ?? (r as any).NeedsRevision ?? 0), 0);
                  const gCac = gRetail > 0 ? gBudget / gRetail : 0;
                  const gCpl = gLead   > 0 ? gBudget / gLead   : 0;
                  return (
                    <tfoot>
                      <tr style={{ background:"#0a2540", fontWeight:800 }}>
                        <td style={{ color:"#fbbf24" }}>Grand Total</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gDealers}</td>
                        <td className="rp-num rp-mono" style={{ color:"#e2e8f0" }}>{inr(gBudget)}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gRetail.toLocaleString("en-IN")}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gLead.toLocaleString("en-IN")}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac" }}>{inr(gCac)}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac" }}>{inr(gCpl)}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{gPending || "—"}</td>
                        <td className="rp-num" style={{ color:"#86efac" }}>{gApproved || "—"}</td>
                        <td className="rp-num" style={{ color:"#fca5a5" }}>{gRejected || "—"}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{gRevision || "—"}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}

          {/* ── Dealer Summary tab ── */}
          {activeTab === "dealer" && (
            <div className="rp-table-scroll">
              <table id="rp-dealer-table" className="rp-table" style={{ minWidth: "900px" }}>
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Dealer</th>
                    <th className="rp-num">Activities</th>
                    <th className="rp-num">Total Budget</th>
                    <th className="rp-num">Retail</th>
                    <th className="rp-num">Lead</th>
                    <th className="rp-num">CAC</th>
                    <th className="rp-num">CPL</th>
                    <th className="rp-num">Pending</th>
                    <th className="rp-num">Approved</th>
                    <th className="rp-num">Rejected</th>
                    <th className="rp-num" style={{background:"#f59e0b22",color:"#92400e"}}>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDealer.map((d: any, i: number) => (
                    <tr key={`${d.state}__${d.dealer}`} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td><span className="rp-state-tag">{d.state}</span></td>
                      <td className="rp-dealer">{d.dealer}</td>
                      <td className="rp-num">{d.activities}</td>
                      <td className="rp-num rp-mono">{inr(d.totalBudget)}</td>
                      <td className="rp-num">{d.totalRetailTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num">{d.totalLeadTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num rp-mono">{inr(d.cac)}</td>
                      <td className="rp-num rp-mono">{inr(d.cpl)}</td>
                      <td className="rp-num"><StatusBadge v={d.pending}  t="pending"/></td>
                      <td className="rp-num"><StatusBadge v={d.approved} t="approved"/></td>
                      <td className="rp-num"><StatusBadge v={d.rejected} t="rejected"/></td>
                      <td className="rp-num"><StatusBadge v={(d as any).needsRevision ?? (d as any).NeedsRevision ?? 0} t="revision"/></td>
                    </tr>
                  ))}
                </tbody>
                {filteredDealer.length > 0 && (() => {
                  const gActivities = filteredDealer.reduce((s: number, r: any) => s + r.activities, 0);
                  const gBudget      = filteredDealer.reduce((s: number, r: any) => s + r.totalBudget, 0);
                  const gRetail      = filteredDealer.reduce((s: number, r: any) => s + r.totalRetailTarget, 0);
                  const gLead        = filteredDealer.reduce((s: number, r: any) => s + r.totalLeadTarget, 0);
                  const gPending     = filteredDealer.reduce((s: number, r: any) => s + r.pending, 0);
                  const gApproved    = filteredDealer.reduce((s: number, r: any) => s + r.approved, 0);
                  const gRejected    = filteredDealer.reduce((s: number, r: any) => s + r.rejected, 0);
                  const gRevision    = filteredDealer.reduce((s: number, r: any) => s + ((r as any).needsRevision ?? (r as any).NeedsRevision ?? 0), 0);
                  const gCac = gRetail > 0 ? gBudget / gRetail : 0;
                  const gCpl = gLead   > 0 ? gBudget / gLead   : 0;
                  return (
                    <tfoot>
                      <tr style={{ background:"#0a2540", fontWeight:800 }}>
                        <td colSpan={2} style={{ color:"#fbbf24" }}>Grand Total ({filteredDealer.length} dealers)</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gActivities}</td>
                        <td className="rp-num rp-mono" style={{ color:"#e2e8f0" }}>{inr(gBudget)}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gRetail.toLocaleString("en-IN")}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gLead.toLocaleString("en-IN")}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac" }}>{inr(gCac)}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac" }}>{inr(gCpl)}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{gPending || "—"}</td>
                        <td className="rp-num" style={{ color:"#86efac" }}>{gApproved || "—"}</td>
                        <td className="rp-num" style={{ color:"#fca5a5" }}>{gRejected || "—"}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{gRevision || "—"}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}

          {/* ── Activity Detail tab ── */}
          {activeTab === "activity" && (
            <div className="rp-table-scroll">
              <table id="rp-activity-table" className="rp-table rp-table--wide" style={{ minWidth: "1400px" }}>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Dealer</th>
                    <th>State</th>
                    <th>RSM</th>
                    <th>Month</th>
                    <th>Status</th>
                    <th>Activity</th>
                    <th>Type</th>
                    <th>Subcategory</th>
                    <th className="rp-num">QTY</th>
                    <th className="rp-num">Sales%</th>
                    <th className="rp-num">Lead</th>
                    <th className="rp-num">Retail</th>
                    <th className="rp-num">Budget</th>
                    <th className="rp-num">BGauss%</th>
                    <th className="rp-num">BGauss Amt</th>
                    <th className="rp-num">Total</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r: any, i: number) => (
                    <tr key={i} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td className="rp-token">{r.tokenNumber ?? "—"}</td>
                      <td className="rp-dealer">{r.dealerName}</td>
                      <td><span className="rp-state-tag">{r.state}</span></td>
                      <td className="rp-sm">{r.rsmName}</td>
                      <td className="rp-sm">{r.month}</td>
                      <td>
                        <span className={`rp-status rp-status--${(r.status??"").toLowerCase().replace(" ","-")}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="rp-bold">{r.activityType}</td>
                      <td>
                        {r.category
                          ? <span className={`rp-cat rp-cat--${(r.category??"").toLowerCase()}`}>{r.category}</span>
                          : <span className="rp-muted">—</span>}
                      </td>
                      <td className="rp-sm">{r.subcategory || <span className="rp-muted">—</span>}</td>
                      <td className="rp-num rp-sm">{r.qty ?? 1}</td>
                      <td className="rp-num rp-sm">
                        {r.salesPercent != null ? `${r.salesPercent}%` : <span className="rp-muted">—</span>}
                      </td>
                      <td className="rp-num">{r.leadTarget}</td>
                      <td className="rp-num">{r.retailTarget}</td>
                      <td className="rp-num rp-mono">{inr(r.budget)}</td>
                      <td className="rp-num rp-sm">
                        {r.bgaussShare ? `${r.bgaussShare}%` : "100%"}
                      </td>
                      <td className="rp-num rp-mono rp-blue">{inr(r.bgaussAmount ?? 0)}</td>
                      <td className="rp-num rp-mono rp-bold">{inr(r.total)}</td>
                      <td className="rp-sm">{r.startDate ?? "—"}</td>
                      <td className="rp-sm">{r.endDate   ?? "—"}</td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={19} className="rp-empty-row">
                        No activities match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
                {filteredRows.length > 0 && (() => {
                  const gLead    = filteredRows.reduce((s: number, r: any) => s + (r.leadTarget || 0), 0);
                  const gRetail  = filteredRows.reduce((s: number, r: any) => s + (r.retailTarget || 0), 0);
                  const gBudget  = filteredRows.reduce((s: number, r: any) => s + (r.budget || 0), 0);
                  const gBgAmt   = filteredRows.reduce((s: number, r: any) => s + (r.bgaussAmount || 0), 0);
                  const gTotal   = filteredRows.reduce((s: number, r: any) => s + (r.total || 0), 0);
                  return (
                    <tfoot>
                      <tr style={{ background:"#0a2540", fontWeight:800 }}>
                        <td colSpan={9} style={{ color:"#fbbf24" }}>Grand Total ({filteredRows.length} activities)</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}></td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}></td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gLead.toLocaleString("en-IN")}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gRetail.toLocaleString("en-IN")}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac" }}>{inr(gBudget)}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}></td>
                        <td className="rp-num rp-mono" style={{ color:"#93c5fd" }}>{inr(gBgAmt)}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac" }}>{inr(gTotal)}</td>
                        <td></td><td></td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}

          {/* Download strip */}
          <div className="rp-dl-strip">
            <span className="rp-dl-label">
              Download {hasFilters ? "filtered" : "full"} report with all 3 sheets
              {hasFilters && (
                <span style={{ fontWeight:400, color:"#64748b" }}>
                  {" "}({[stateFilter, dealerFilter, monthFilter, statusFilter].filter(Boolean).join(" · ")})
                </span>
              )}:
            </span>
            <button className="rp-btn rp-btn--excel" onClick={() => handleDownloadFiltered("excel")}>
              ⬇ Download Excel
            </button>
            <button className="rp-btn rp-btn--pdf" onClick={() => handleDownloadFiltered("pdf")}>
              ⬇ Download PDF
            </button>
          </div>
        </div>
      )}

      {/* ── Leads (LMS) tab ── */}
      {activeTab === "leads" && (
        <div>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:12, flexWrap:"wrap" }}>
            <span style={{ fontSize:12, fontWeight:600, color:"#64748b" }}>Group by:</span>
            {(["rsm","dealer"] as const).map(g => (
              <button key={g}
                onClick={() => handleLoadLeadSummary(g)}
                disabled={leadLoading}
                style={{
                  padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer",
                  border: leadGroupBy===g ? "1.5px solid #2563eb" : "1.5px solid #e2e8f0",
                  background: leadGroupBy===g ? "#eff6ff" : "#fff",
                  color: leadGroupBy===g ? "#1e40af" : "#374151",
                }}>
                {g === "rsm" ? "RSM-wise" : "Dealer-wise"}
              </button>
            ))}
            {stateFilter && (
              <span style={{ fontSize:11, color:"#64748b" }}>
                Filtered to state: <strong>{stateFilter}</strong> (uses the State field above)
              </span>
            )}
            <button onClick={() => handleLoadLeadSummary()} disabled={leadLoading}
              style={{ marginLeft:"auto", padding:"6px 14px", borderRadius:7, fontSize:12,
                fontWeight:600, cursor:"pointer", border:"1.5px solid #e2e8f0", background:"#fff", color:"#374151" }}>
              {leadLoading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>

          {leadError && (
            <div className="rp-error" style={{ marginBottom:12 }}>
              <span>⚠</span><span>{leadError}</span>
              <button onClick={() => setLeadError(null)}>✕</button>
            </div>
          )}

          {leadLoading && !leadSummary && (
            <div style={{ textAlign:"center", padding:"40px 20px", color:"#9ca3af" }}>
              <div style={{ fontSize:32, marginBottom:10 }}>⏳</div>
              Loading LMS lead data…
            </div>
          )}

          {leadSummary && (
            <div className="rp-table-scroll">
              <table className="rp-table" style={{ minWidth: leadGroupBy==="dealer" ? "1100px" : "900px" }}>
                <thead>
                  <tr>
                    <th>{leadGroupBy === "rsm" ? "RSM" : "Dealer"}</th>
                    {leadGroupBy === "dealer" && (<><th>City</th><th>State</th></>)}
                    <th className="rp-num">Total Leads</th>
                    <th className="rp-num">Not Called</th>
                    <th className="rp-num">Follow-Up</th>
                    <th className="rp-num">Closed</th>
                    <th className="rp-num" style={{background:"#eef2ff",color:"#3730a3"}}>Qualified</th>
                    <th className="rp-num" style={{background:"#fef2f2",color:"#b91c1c"}}>Hot</th>
                    <th className="rp-num" style={{background:"#fffbeb",color:"#92400e"}}>Warm</th>
                    <th className="rp-num">Normal</th>
                    <th className="rp-num" style={{background:"#f0fdf4",color:"#166534"}}>Booked</th>
                    <th className="rp-num" style={{background:"#fef2f2",color:"#991b1b"}}>Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {leadSummary.rows.map((r, i) => (
                    <tr key={r.dealerCode ?? r.name} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td className="rp-bold">{r.dealerName ?? r.name}</td>
                      {leadGroupBy === "dealer" && (<><td className="rp-sm">{r.city ?? "—"}</td><td><span className="rp-state-tag">{r.state ?? "—"}</span></td></>)}
                      <td className="rp-num rp-bold">{r.totalLeads}</td>
                      <td className="rp-num">{r.notCalled}</td>
                      <td className="rp-num">{r.followUp}</td>
                      <td className="rp-num">{r.closed}</td>
                      <td className="rp-num rp-bold">{r.qualified.total}</td>
                      <td className="rp-num" style={{color:"#b91c1c",fontWeight:700}}>{r.qualified.hot}</td>
                      <td className="rp-num" style={{color:"#92400e"}}>{r.qualified.warm}</td>
                      <td className="rp-num">{r.qualified.normal}</td>
                      <td className="rp-num" style={{color:"#166534",fontWeight:700}}>{r.booked}</td>
                      <td className="rp-num" style={{color:"#991b1b"}}>{r.lost}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background:"#0a2540" }}>
                    <td colSpan={leadGroupBy==="dealer" ? 3 : 1} style={{ padding:"8px 12px", fontWeight:800, color:"#fbbf24" }}>Total</td>
                    <td className="rp-num" style={{ color:"#fff", fontWeight:800 }}>{leadSummary.total.totalLeads}</td>
                    <td className="rp-num" style={{ color:"#e2e8f0" }}>{leadSummary.total.notCalled}</td>
                    <td className="rp-num" style={{ color:"#e2e8f0" }}>{leadSummary.total.followUp}</td>
                    <td className="rp-num" style={{ color:"#e2e8f0" }}>{leadSummary.total.closed}</td>
                    <td className="rp-num" style={{ color:"#a5b4fc", fontWeight:700 }}>{leadSummary.total.qualified.total}</td>
                    <td className="rp-num" style={{ color:"#fca5a5" }}>{leadSummary.total.qualified.hot}</td>
                    <td className="rp-num" style={{ color:"#fde68a" }}>{leadSummary.total.qualified.warm}</td>
                    <td className="rp-num" style={{ color:"#e2e8f0" }}>{leadSummary.total.qualified.normal}</td>
                    <td className="rp-num" style={{ color:"#86efac", fontWeight:700 }}>{leadSummary.total.booked}</td>
                    <td className="rp-num" style={{ color:"#fca5a5" }}>{leadSummary.total.lost}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* No preview yet — show quick-start hint */}
      {!preview && !loading && !error && (
        <div className="rp-hint-card">
          <div style={{ fontSize:36,marginBottom:10 }}>📊</div>
          <strong>Select your filters above, then:</strong>
          <ul>
            <li>Click <strong>Preview Data</strong> to load matching data — required for Status/Month filters, and for the Grand Totals on each sheet</li>
            <li>Or click <strong>⬇ Excel / ⬇ PDF</strong> in the top-right for a quick download using Period/State/Dealer only</li>
          </ul>
          <div className="rp-hint-sheets">
            <div className="rp-hint-sheet"><span>Sheet 1</span> State-wise summary</div>
            <div className="rp-hint-sheet"><span>Sheet 2</span> Dealer-wise summary</div>
            <div className="rp-hint-sheet"><span>Sheet 3</span> Activity detail — all fields including Subcategory, Qty, Sales%, BGauss%</div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ v, t }: { v: number; t: string }) {
  if (!v) return <span className="rp-muted">—</span>;
  if (t === "revision") return (
    <span style={{background:"#fef3c7",color:"#92400e",padding:"2px 8px",
      borderRadius:10,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{v}</span>
  );
  return <span className={`rp-badge rp-badge--${t}`}>{v}</span>;
}
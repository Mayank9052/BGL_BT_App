// src/pages/ReportsPage.tsx
// [BTL-2026-11-02] State-wise / Dealer-wise / Activity Detail / Leads (LMS): every header sortable
//                  (click ▲ → ▼ → off) + pagination (10/25/50/100). Grand Totals always cover ALL rows.
//                  Excel + PDF download all rows of all three sheets in the on-screen sort order.
//                  ₹ amounts never wrap.
import { useState, useMemo } from "react";
import { useMsal } from "@azure/msal-react";
import * as XLSX from "xlsx";
import {
  downloadExcelReport, downloadPdfReport, fetchReportData,
  type ReportFilters,
} from "../services/reportService";
import { fetchLeadFunnelSummary, type LeadFunnelSummaryResponse } from "../services/leadReportService";
import { useSortPage, SortTh, Pager } from "../components/TableTools";
import "./ReportsPage.css";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const inr  = (v: number) => "₹" + Math.round(v || 0).toLocaleString("en-IN");
const inrC = (v: number) => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};
const NOWRAP: React.CSSProperties = { whiteSpace: "nowrap" };
const revisionOf = (r: any): number => r?.needsRevision ?? r?.NeedsRevision ?? 0;
const EMPTY: never[] = [];

type LeadRow = LeadFunnelSummaryResponse["rows"][number];

// ── PDF: prints the given sheets (header row + data rows, from the same arrays as Excel) ──
function printSheets(sections: { title: string; aoa: (string | number)[][] }[], title: string) {
  const esc = (v: unknown) => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN") : esc(v));
  const tables = sections.filter((s) => s.aoa.length > 1).map((s) => {
    const [head, ...body] = s.aoa;
    const rows = body.map((r) => {
      const total = String(r[0] ?? "").toUpperCase().startsWith("GRAND TOTAL");
      return `<tr${total ? ' class="gt"' : ""}>${r.map((c) => `<td${typeof c === "number" ? ' class="n"' : ""}>${fmt(c)}</td>`).join("")}</tr>`;
    }).join("");
    return `<h2>${esc(s.title)}</h2><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  }).join('<div style="height:18px"></div>');
  if (!tables) { alert("No rows to print."); return; }

  const w = window.open("", "_blank", "width=1200,height=900");
  if (!w) { alert("Allow pop-ups to download PDF."); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${esc(title)}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; margin: 0; background: #fff; color: #1a2233; }
      .ph { background: #0a2540; color: #fff; padding: 12px 18px; margin-bottom: 14px; border-radius: 6px; }
      .ph h1 { margin: 0; font-size: 15px; } .ph p { margin: 3px 0 0; font-size: 10px; opacity: .75; }
      h2 { font-size: 12px; color: #0a2540; margin: 10px 0 6px; }
      table { border-collapse: collapse; width: 100%; font-size: 9px; }
      th, td { border: 1px solid #e2e8f0; padding: 3px 5px; white-space: nowrap; }
      th { background: #0a2540; color: #fff; text-align: left; }
      td.n { text-align: right; }
      tr:nth-child(even) td { background: #f8fafc; }
      tr.gt td { background: #fef3c7 !important; font-weight: 700; }
      @page { size: A3 landscape; margin: 1cm; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>
    <div class="ph"><h1>BGauss BTL — ${esc(title)}</h1><p>Generated: ${new Date().toLocaleString("en-IN")}</p></div>
    ${tables}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 500);
}

export default function ReportsPage() {
  const { instance } = useMsal();

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
    // Send period="custom" explicitly — omitting it made the backend ignore from/to.
    period:  period === "custom" ? "custom" : period,
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

  // ── Quick download (top of page, no preview needed) — Period/State/Dealer only ──
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
  const filteredRows: any[] = useMemo(() => preview?.rows?.filter((r: any) => {
    if (monthFilter  && r.month  !== monthFilter)  return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  }) ?? EMPTY, [preview, monthFilter, statusFilter]);

  const filteredState: any[] = useMemo(() => preview?.stateSummary ?? EMPTY, [preview]);

  const filteredDealer: any[] = useMemo(() => preview?.dealerSummary?.filter((d: any) =>
    (!stateFilter  || (d.state ?? "").toLowerCase().includes(stateFilter.toLowerCase())) &&
    (!dealerFilter || (d.dealer ?? "").toLowerCase().includes(dealerFilter.toLowerCase()))
  ) ?? EMPTY, [preview, stateFilter, dealerFilter]);

  // ── [BTL-2026-11-02] sorting + pagination ──
  const resetKey = [preview, stateFilter, dealerFilter, statusFilter, monthFilter];
  const stTbl = useSortPage(filteredState, useMemo(() => ({
    state: (s: any) => s.state, dealers: (s: any) => s.dealers, budget: (s: any) => s.totalBudget,
    retail: (s: any) => s.totalRetailTarget, lead: (s: any) => s.totalLeadTarget,
    cac: (s: any) => s.cac, cpl: (s: any) => s.cpl,
    pending: (s: any) => s.pending, approved: (s: any) => s.approved, rejected: (s: any) => s.rejected,
    revision: (s: any) => revisionOf(s),
  }), []), { storageKey: "rp_state", pageSize: 50, resetOn: resetKey });
  const dlTbl = useSortPage(filteredDealer, useMemo(() => ({
    state: (d: any) => d.state, dealer: (d: any) => d.dealer, activities: (d: any) => d.activities,
    budget: (d: any) => d.totalBudget, retail: (d: any) => d.totalRetailTarget, lead: (d: any) => d.totalLeadTarget,
    cac: (d: any) => d.cac, cpl: (d: any) => d.cpl,
    pending: (d: any) => d.pending, approved: (d: any) => d.approved, rejected: (d: any) => d.rejected,
    revision: (d: any) => revisionOf(d),
  }), []), { storageKey: "rp_dealer", pageSize: 25, resetOn: resetKey });
  const acTbl = useSortPage(filteredRows, useMemo(() => ({
    token: (r: any) => r.tokenNumber, dealer: (r: any) => r.dealerName, state: (r: any) => r.state,
    rsm: (r: any) => r.rsmName, month: (r: any) => MONTHS.indexOf(r.month), status: (r: any) => r.status,
    activity: (r: any) => r.activityType, type: (r: any) => r.category, sub: (r: any) => r.subcategory,
    qty: (r: any) => r.qty ?? 1, sales: (r: any) => r.salesPercent, lead: (r: any) => r.leadTarget,
    retail: (r: any) => r.retailTarget, budget: (r: any) => r.budget, bgPct: (r: any) => r.bgaussShare ?? 100,
    bgAmt: (r: any) => r.bgaussAmount ?? 0, total: (r: any) => r.total,
    start: (r: any) => r.startDate, end: (r: any) => r.endDate,
  }), []), { storageKey: "rp_activity", pageSize: 25, resetOn: resetKey });
  const ldTbl = useSortPage<LeadRow>(leadSummary?.rows ?? EMPTY, useMemo(() => ({
    name: (r: LeadRow) => r.dealerName ?? r.name, city: (r: LeadRow) => r.city ?? "", state: (r: LeadRow) => r.state ?? "",
    total: (r: LeadRow) => r.totalLeads, notCalled: (r: LeadRow) => r.notCalled, followUp: (r: LeadRow) => r.followUp,
    closed: (r: LeadRow) => r.closed, qualified: (r: LeadRow) => r.qualified.total, hot: (r: LeadRow) => r.qualified.hot,
    warm: (r: LeadRow) => r.qualified.warm, normal: (r: LeadRow) => r.qualified.normal,
    booked: (r: LeadRow) => r.booked, lost: (r: LeadRow) => r.lost,
  }), []), { storageKey: "rp_leads", pageSize: 50, resetOn: [leadSummary, leadGroupBy] });
  const spOf = (t: { sortKey: string | null; sortDir: "asc" | "desc"; onSort: (k: string) => void }) =>
    ({ sortKey: t.sortKey, sortDir: t.sortDir, onSort: t.onSort });

  const hasFilters = stateFilter || dealerFilter || statusFilter || monthFilter;

  // ── Filename suffix reflecting whichever filters are currently active ─────
  const filterSuffix = () =>
    [stateFilter, dealerFilter, monthFilter, statusFilter]
      .filter(Boolean).join("_").replace(/\s+/g, "");

  // ── The three sheets (all filtered rows, in the on-screen sort order, with Grand Totals) ──
  const buildSheets = () => {
    const stateRows: (string | number)[][] = [[
      "State", "Dealers", "Total Budget (₹)", "Retail Target", "Lead Target", "CAC (₹)", "CPL (₹)",
      "Pending", "Approved", "Rejected", "Needs Revision",
    ]];
    for (const s of stTbl.sorted) {
      stateRows.push([
        s.state, s.dealers, Math.round(s.totalBudget), s.totalRetailTarget, s.totalLeadTarget,
        Math.round(s.cac), Math.round(s.cpl), s.pending, s.approved, s.rejected, revisionOf(s),
      ]);
    }
    if (filteredState.length > 0) {
      const sum = (f: (r: any) => number) => filteredState.reduce((a: number, r: any) => a + (f(r) || 0), 0);
      const gBudget = sum((r) => r.totalBudget), gRetail = sum((r) => r.totalRetailTarget), gLead = sum((r) => r.totalLeadTarget);
      stateRows.push([
        "GRAND TOTAL", sum((r) => r.dealers), Math.round(gBudget), gRetail, gLead,
        Math.round(gRetail > 0 ? gBudget / gRetail : 0), Math.round(gLead > 0 ? gBudget / gLead : 0),
        sum((r) => r.pending), sum((r) => r.approved), sum((r) => r.rejected), sum(revisionOf),
      ]);
    }

    const dealerRowsOut: (string | number)[][] = [[
      "State", "Dealer", "Activities", "Total Budget (₹)", "Retail Target", "Lead Target", "CAC (₹)", "CPL (₹)",
      "Pending", "Approved", "Rejected", "Needs Revision",
    ]];
    for (const d of dlTbl.sorted) {
      dealerRowsOut.push([
        d.state, d.dealer, d.activities, Math.round(d.totalBudget), d.totalRetailTarget, d.totalLeadTarget,
        Math.round(d.cac), Math.round(d.cpl), d.pending, d.approved, d.rejected, revisionOf(d),
      ]);
    }
    if (filteredDealer.length > 0) {
      const sum = (f: (r: any) => number) => filteredDealer.reduce((a: number, r: any) => a + (f(r) || 0), 0);
      const gBudget = sum((r) => r.totalBudget), gRetail = sum((r) => r.totalRetailTarget), gLead = sum((r) => r.totalLeadTarget);
      dealerRowsOut.push([
        "GRAND TOTAL", `${filteredDealer.length} dealers`, sum((r) => r.activities), Math.round(gBudget), gRetail, gLead,
        Math.round(gRetail > 0 ? gBudget / gRetail : 0), Math.round(gLead > 0 ? gBudget / gLead : 0),
        sum((r) => r.pending), sum((r) => r.approved), sum((r) => r.rejected), sum(revisionOf),
      ]);
    }

    const activityRows: (string | number)[][] = [[
      "Token", "Dealer", "State", "RSM", "Month", "Status", "Activity", "Type", "Subcategory",
      "QTY", "Sales%", "Lead", "Retail", "Budget (₹)", "BGauss%", "BGauss Amt (₹)", "Total (₹)", "Start", "End",
    ]];
    for (const r of acTbl.sorted) {
      activityRows.push([
        r.tokenNumber ?? "—", r.dealerName, r.state, r.rsmName, r.month, r.status,
        r.activityType, r.category ?? "—", r.subcategory ?? "—", r.qty ?? 1,
        r.salesPercent != null ? r.salesPercent : "—", r.leadTarget, r.retailTarget,
        Math.round(r.budget), r.bgaussShare ?? 100, Math.round(r.bgaussAmount ?? 0), Math.round(r.total),
        r.startDate ?? "—", r.endDate ?? "—",
      ]);
    }
    if (filteredRows.length > 0) {
      const sum = (f: (r: any) => number) => filteredRows.reduce((a: number, r: any) => a + (f(r) || 0), 0);
      activityRows.push([
        "GRAND TOTAL", `${filteredRows.length} activities`, "", "", "", "", "", "", "",
        "", "", sum((r) => r.leadTarget), sum((r) => r.retailTarget), Math.round(sum((r) => r.budget)), "",
        Math.round(sum((r) => r.bgaussAmount)), Math.round(sum((r) => r.total)), "", "",
      ]);
    }
    return { stateRows, dealerRowsOut, activityRows };
  };

  const handleDownloadFiltered = (type: "excel" | "pdf") => {
    if (!preview) return;
    const { stateRows, dealerRowsOut, activityRows } = buildSheets();

    if (type === "excel") {
      const wb = XLSX.utils.book_new();
      const add = (aoa: (string | number)[][], name: string, wch: number) => {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = aoa[0].map(() => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      add(stateRows, "State-wise", 16);
      add(dealerRowsOut, "Dealer-wise", 18);
      add(activityRows, "Activity Detail", 14);
      const suffix = filterSuffix();
      XLSX.writeFile(wb, `BTL_Report${suffix ? `_${suffix}` : ""}.xlsx`);
    } else {
      printSheets([
        { title: "State-wise Summary", aoa: stateRows },
        { title: "Dealer-wise Summary", aoa: dealerRowsOut },
        { title: "Activity Detail", aoa: activityRows },
      ], "Filtered Report — State-wise, Dealer-wise & Activity Detail");
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
              <span className="rp-kpi-val" style={NOWRAP}>{inrC(preview.totalBudget)}</span>
              <span className="rp-kpi-lbl">Total Budget</span>
            </div>
            <div className="rp-kpi rp-kpi--amber">
              <span className="rp-kpi-val" style={NOWRAP}>{inr(preview.overallCac)}</span>
              <span className="rp-kpi-lbl">Overall CAC</span>
            </div>
            <div className="rp-kpi rp-kpi--purple">
              <span className="rp-kpi-val" style={NOWRAP}>{inr(preview.overallCpl)}</span>
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
            <>
            <Pager page={stTbl.page} pageSize={stTbl.pageSize} total={stTbl.total} onPage={stTbl.setPage} onPageSize={stTbl.setPageSize}/>
            <div className="rp-table-scroll" id="rp-summary-wrap">
              <table id="rp-summary-table" className="rp-table" style={{ minWidth: "700px" }}>
                <thead>
                  <tr>
                    <SortTh k="state"    label="State" {...spOf(stTbl)}/>
                    <SortTh k="dealers"  label="Dealers"       align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="budget"   label="Total Budget"  align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="retail"   label="Retail Target" align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="lead"     label="Lead Target"   align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="cac"      label="CAC"           align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="cpl"      label="CPL"           align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="pending"  label="Pending"       align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="approved" label="Approved"      align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="rejected" label="Rejected"      align="right" className="rp-num" {...spOf(stTbl)}/>
                    <SortTh k="revision" label="Revision"      align="right" className="rp-num" style={{background:"#f59e0b22",color:"#92400e"}} {...spOf(stTbl)}/>
                  </tr>
                </thead>
                <tbody>
                  {stTbl.pageRows.map((s: any, i: number) => (
                    <tr key={s.state} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td><span className="rp-state-tag">{s.state}</span></td>
                      <td className="rp-num">{s.dealers}</td>
                      <td className="rp-num rp-mono" style={NOWRAP}>{inr(s.totalBudget)}</td>
                      <td className="rp-num">{s.totalRetailTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num">{s.totalLeadTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num rp-mono" style={NOWRAP}>{inr(s.cac)}</td>
                      <td className="rp-num rp-mono" style={NOWRAP}>{inr(s.cpl)}</td>
                      <td className="rp-num"><StatusBadge v={s.pending}  t="pending"/></td>
                      <td className="rp-num"><StatusBadge v={s.approved} t="approved"/></td>
                      <td className="rp-num"><StatusBadge v={s.rejected} t="rejected"/></td>
                      <td className="rp-num"><StatusBadge v={revisionOf(s)} t="revision"/></td>
                    </tr>
                  ))}
                </tbody>
                {filteredState.length > 0 && (() => {
                  const sum = (f: (r: any) => number) => filteredState.reduce((a: number, r: any) => a + (f(r) || 0), 0);
                  const gBudget = sum((r) => r.totalBudget), gRetail = sum((r) => r.totalRetailTarget), gLead = sum((r) => r.totalLeadTarget);
                  const gCac = gRetail > 0 ? gBudget / gRetail : 0;
                  const gCpl = gLead   > 0 ? gBudget / gLead   : 0;
                  return (
                    <tfoot>
                      <tr style={{ background:"#0a2540", fontWeight:800 }}>
                        <td style={{ color:"#fbbf24" }}>Grand Total</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{sum((r) => r.dealers)}</td>
                        <td className="rp-num rp-mono" style={{ color:"#e2e8f0", ...NOWRAP }}>{inr(gBudget)}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gRetail.toLocaleString("en-IN")}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gLead.toLocaleString("en-IN")}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac", ...NOWRAP }}>{inr(gCac)}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac", ...NOWRAP }}>{inr(gCpl)}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{sum((r) => r.pending) || "—"}</td>
                        <td className="rp-num" style={{ color:"#86efac" }}>{sum((r) => r.approved) || "—"}</td>
                        <td className="rp-num" style={{ color:"#fca5a5" }}>{sum((r) => r.rejected) || "—"}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{sum(revisionOf) || "—"}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
            {stTbl.total > stTbl.pageSize && <Pager page={stTbl.page} pageSize={stTbl.pageSize} total={stTbl.total} onPage={stTbl.setPage} onPageSize={stTbl.setPageSize} scrollTo="#rp-summary-wrap"/>}
            </>
          )}

          {/* ── Dealer Summary tab ── */}
          {activeTab === "dealer" && (
            <>
            <Pager page={dlTbl.page} pageSize={dlTbl.pageSize} total={dlTbl.total} onPage={dlTbl.setPage} onPageSize={dlTbl.setPageSize}/>
            <div className="rp-table-scroll" id="rp-dealer-wrap">
              <table id="rp-dealer-table" className="rp-table" style={{ minWidth: "900px" }}>
                <thead>
                  <tr>
                    <SortTh k="state"      label="State"        {...spOf(dlTbl)}/>
                    <SortTh k="dealer"     label="Dealer"       {...spOf(dlTbl)}/>
                    <SortTh k="activities" label="Activities"   align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="budget"     label="Total Budget" align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="retail"     label="Retail"       align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="lead"       label="Lead"         align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="cac"        label="CAC"          align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="cpl"        label="CPL"          align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="pending"    label="Pending"      align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="approved"   label="Approved"     align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="rejected"   label="Rejected"     align="right" className="rp-num" {...spOf(dlTbl)}/>
                    <SortTh k="revision"   label="Revision"     align="right" className="rp-num" style={{background:"#f59e0b22",color:"#92400e"}} {...spOf(dlTbl)}/>
                  </tr>
                </thead>
                <tbody>
                  {dlTbl.pageRows.map((d: any, i: number) => (
                    <tr key={`${d.state}__${d.dealer}`} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td><span className="rp-state-tag">{d.state}</span></td>
                      <td className="rp-dealer">{d.dealer}</td>
                      <td className="rp-num">{d.activities}</td>
                      <td className="rp-num rp-mono" style={NOWRAP}>{inr(d.totalBudget)}</td>
                      <td className="rp-num">{d.totalRetailTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num">{d.totalLeadTarget?.toLocaleString("en-IN")}</td>
                      <td className="rp-num rp-mono" style={NOWRAP}>{inr(d.cac)}</td>
                      <td className="rp-num rp-mono" style={NOWRAP}>{inr(d.cpl)}</td>
                      <td className="rp-num"><StatusBadge v={d.pending}  t="pending"/></td>
                      <td className="rp-num"><StatusBadge v={d.approved} t="approved"/></td>
                      <td className="rp-num"><StatusBadge v={d.rejected} t="rejected"/></td>
                      <td className="rp-num"><StatusBadge v={revisionOf(d)} t="revision"/></td>
                    </tr>
                  ))}
                </tbody>
                {filteredDealer.length > 0 && (() => {
                  const sum = (f: (r: any) => number) => filteredDealer.reduce((a: number, r: any) => a + (f(r) || 0), 0);
                  const gBudget = sum((r) => r.totalBudget), gRetail = sum((r) => r.totalRetailTarget), gLead = sum((r) => r.totalLeadTarget);
                  const gCac = gRetail > 0 ? gBudget / gRetail : 0;
                  const gCpl = gLead   > 0 ? gBudget / gLead   : 0;
                  return (
                    <tfoot>
                      <tr style={{ background:"#0a2540", fontWeight:800 }}>
                        <td colSpan={2} style={{ color:"#fbbf24" }}>Grand Total ({filteredDealer.length} dealers)</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{sum((r) => r.activities)}</td>
                        <td className="rp-num rp-mono" style={{ color:"#e2e8f0", ...NOWRAP }}>{inr(gBudget)}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gRetail.toLocaleString("en-IN")}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{gLead.toLocaleString("en-IN")}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac", ...NOWRAP }}>{inr(gCac)}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac", ...NOWRAP }}>{inr(gCpl)}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{sum((r) => r.pending) || "—"}</td>
                        <td className="rp-num" style={{ color:"#86efac" }}>{sum((r) => r.approved) || "—"}</td>
                        <td className="rp-num" style={{ color:"#fca5a5" }}>{sum((r) => r.rejected) || "—"}</td>
                        <td className="rp-num" style={{ color:"#fde68a" }}>{sum(revisionOf) || "—"}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
            {dlTbl.total > dlTbl.pageSize && <Pager page={dlTbl.page} pageSize={dlTbl.pageSize} total={dlTbl.total} onPage={dlTbl.setPage} onPageSize={dlTbl.setPageSize} scrollTo="#rp-dealer-wrap"/>}
            </>
          )}

          {/* ── Activity Detail tab ── */}
          {activeTab === "activity" && (
            <>
            <Pager page={acTbl.page} pageSize={acTbl.pageSize} total={acTbl.total} onPage={acTbl.setPage} onPageSize={acTbl.setPageSize}/>
            <div className="rp-table-scroll" id="rp-activity-wrap">
              <table id="rp-activity-table" className="rp-table rp-table--wide" style={{ minWidth: "1400px" }}>
                <thead>
                  <tr>
                    <SortTh k="token"    label="Token"       {...spOf(acTbl)}/>
                    <SortTh k="dealer"   label="Dealer"      {...spOf(acTbl)}/>
                    <SortTh k="state"    label="State"       {...spOf(acTbl)}/>
                    <SortTh k="rsm"      label="RSM"         {...spOf(acTbl)}/>
                    <SortTh k="month"    label="Month"       {...spOf(acTbl)}/>
                    <SortTh k="status"   label="Status"      {...spOf(acTbl)}/>
                    <SortTh k="activity" label="Activity"    {...spOf(acTbl)}/>
                    <SortTh k="type"     label="Type"        {...spOf(acTbl)}/>
                    <SortTh k="sub"      label="Subcategory" {...spOf(acTbl)}/>
                    <SortTh k="qty"      label="QTY"        align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="sales"    label="Sales%"     align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="lead"     label="Lead"       align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="retail"   label="Retail"     align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="budget"   label="Budget"     align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="bgPct"    label="BGauss%"    align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="bgAmt"    label="BGauss Amt" align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="total"    label="Total"      align="right" className="rp-num" {...spOf(acTbl)}/>
                    <SortTh k="start"    label="Start"      {...spOf(acTbl)}/>
                    <SortTh k="end"      label="End"        {...spOf(acTbl)}/>
                  </tr>
                </thead>
                <tbody>
                  {acTbl.pageRows.map((r: any, i: number) => (
                    <tr key={`${r.tokenNumber ?? ""}_${r.activityType ?? ""}_${(acTbl.page - 1) * acTbl.pageSize + i}`} className={i%2===0?"rp-row-even":"rp-row-odd"}>
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
                      <td className="rp-num rp-mono" style={NOWRAP}>{inr(r.budget)}</td>
                      <td className="rp-num rp-sm">
                        {r.bgaussShare ? `${r.bgaussShare}%` : "100%"}
                      </td>
                      <td className="rp-num rp-mono rp-blue" style={NOWRAP}>{inr(r.bgaussAmount ?? 0)}</td>
                      <td className="rp-num rp-mono rp-bold" style={NOWRAP}>{inr(r.total)}</td>
                      <td className="rp-sm" style={NOWRAP}>{r.startDate ?? "—"}</td>
                      <td className="rp-sm" style={NOWRAP}>{r.endDate   ?? "—"}</td>
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
                  const sum = (f: (r: any) => number) => filteredRows.reduce((a: number, r: any) => a + (f(r) || 0), 0);
                  return (
                    <tfoot>
                      <tr style={{ background:"#0a2540", fontWeight:800 }}>
                        <td colSpan={9} style={{ color:"#fbbf24" }}>Grand Total ({filteredRows.length} activities)</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}></td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}></td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{sum((r) => r.leadTarget).toLocaleString("en-IN")}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}>{sum((r) => r.retailTarget).toLocaleString("en-IN")}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac", ...NOWRAP }}>{inr(sum((r) => r.budget))}</td>
                        <td className="rp-num" style={{ color:"#e2e8f0" }}></td>
                        <td className="rp-num rp-mono" style={{ color:"#93c5fd", ...NOWRAP }}>{inr(sum((r) => r.bgaussAmount))}</td>
                        <td className="rp-num rp-mono" style={{ color:"#86efac", ...NOWRAP }}>{inr(sum((r) => r.total))}</td>
                        <td></td><td></td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
            {acTbl.total > acTbl.pageSize && <Pager page={acTbl.page} pageSize={acTbl.pageSize} total={acTbl.total} onPage={acTbl.setPage} onPageSize={acTbl.setPageSize} scrollTo="#rp-activity-wrap"/>}
            </>
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
            <>
            <Pager page={ldTbl.page} pageSize={ldTbl.pageSize} total={ldTbl.total} onPage={ldTbl.setPage} onPageSize={ldTbl.setPageSize}/>
            <div className="rp-table-scroll" id="rp-leads-wrap">
              <table className="rp-table" style={{ minWidth: leadGroupBy==="dealer" ? "1100px" : "900px" }}>
                <thead>
                  <tr>
                    <SortTh k="name" label={leadGroupBy === "rsm" ? "RSM" : "Dealer"} {...spOf(ldTbl)}/>
                    {leadGroupBy === "dealer" && (<>
                      <SortTh k="city"  label="City"  {...spOf(ldTbl)}/>
                      <SortTh k="state" label="State" {...spOf(ldTbl)}/>
                    </>)}
                    <SortTh k="total"     label="Total Leads" align="right" className="rp-num" {...spOf(ldTbl)}/>
                    <SortTh k="notCalled" label="Not Called"  align="right" className="rp-num" {...spOf(ldTbl)}/>
                    <SortTh k="followUp"  label="Follow-Up"   align="right" className="rp-num" {...spOf(ldTbl)}/>
                    <SortTh k="closed"    label="Closed"      align="right" className="rp-num" {...spOf(ldTbl)}/>
                    <SortTh k="qualified" label="Qualified"   align="right" className="rp-num" style={{background:"#eef2ff",color:"#3730a3"}} {...spOf(ldTbl)}/>
                    <SortTh k="hot"       label="Hot"         align="right" className="rp-num" style={{background:"#fef2f2",color:"#b91c1c"}} {...spOf(ldTbl)}/>
                    <SortTh k="warm"      label="Warm"        align="right" className="rp-num" style={{background:"#fffbeb",color:"#92400e"}} {...spOf(ldTbl)}/>
                    <SortTh k="normal"    label="Normal"      align="right" className="rp-num" {...spOf(ldTbl)}/>
                    <SortTh k="booked"    label="Booked"      align="right" className="rp-num" style={{background:"#f0fdf4",color:"#166534"}} {...spOf(ldTbl)}/>
                    <SortTh k="lost"      label="Lost"        align="right" className="rp-num" style={{background:"#fef2f2",color:"#991b1b"}} {...spOf(ldTbl)}/>
                  </tr>
                </thead>
                <tbody>
                  {ldTbl.pageRows.map((r, i) => (
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
            {ldTbl.total > ldTbl.pageSize && <Pager page={ldTbl.page} pageSize={ldTbl.pageSize} total={ldTbl.total} onPage={ldTbl.setPage} onPageSize={ldTbl.setPageSize} scrollTo="#rp-leads-wrap"/>}
            </>
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
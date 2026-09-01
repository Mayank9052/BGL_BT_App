// src/pages/ReportsPage.tsx
import { useState } from "react";
import { useMsal } from "@azure/msal-react";
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
  //const [activeTab,   setActiveTab]   = useState<"summary"|"dealer"|"activity">("summary");
  const [activeTab,   setActiveTab]   = useState<"summary"|"dealer"|"activity"|"leads">("summary");
  const [loading,     setLoading]     = useState(false);
  const [downloading, setDownloading] = useState<"excel"|"pdf"|null>(null);
  const [error,       setError]       = useState<string|null>(null);

  // Build API filters (status/month are client-side only)
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
        {/* Quick download — no preview needed */}
        <div className="rp-header-btns">
          <button className="rp-btn rp-btn--excel"
            onClick={() => handleDownload("excel")}
            disabled={downloading !== null}>
            {downloading === "excel"
              ? <><span className="rp-spin"/>Generating…</>
              : "⬇ Excel"}
          </button>
          <button className="rp-btn rp-btn--pdf"
            onClick={() => handleDownload("pdf")}
            disabled={downloading !== null}>
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
            <label className="rp-label">Status (preview only)</label>
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
            <label className="rp-label">Month (preview only)</label>
            <select className="rp-input" value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All Months</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

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
              <table className="rp-table" style={{ minWidth: "700px" }}>
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
              </table>
            </div>
          )}

          {/* ── Dealer Summary tab ── */}
          {activeTab === "dealer" && (
            <div className="rp-table-scroll">
              <table className="rp-table" style={{ minWidth: "900px" }}>
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
              </table>
            </div>
          )}

          {/* ── Activity Detail tab ── */}
          {activeTab === "activity" && (
            <div className="rp-table-scroll">
              <table className="rp-table rp-table--wide" style={{ minWidth: "1400px" }}>
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
              </table>
            </div>
          )}

          {/* Download strip */}
          <div className="rp-dl-strip">
            <span className="rp-dl-label">Download full report with all 3 sheets:</span>
            <button className="rp-btn rp-btn--excel"
              onClick={() => handleDownload("excel")}
              disabled={downloading !== null}>
              {downloading === "excel" ? "Generating…" : "⬇ Download Excel"}
            </button>
            <button className="rp-btn rp-btn--pdf"
              onClick={() => handleDownload("pdf")}
              disabled={downloading !== null}>
              {downloading === "pdf" ? "Generating…" : "⬇ Download PDF"}
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
            <li>Click <strong>Preview Data</strong> to see the data before downloading</li>
            <li>Or click <strong>⬇ Excel / ⬇ PDF</strong> directly to download immediately</li>
          </ul>
          <div className="rp-hint-sheets">
            <div className="rp-hint-sheet"><span>Sheet 1</span> Activity detail — all fields including Subcategory, Qty, Sales%, BGauss%</div>
            <div className="rp-hint-sheet"><span>Sheet 2</span> State-wise summary</div>
            <div className="rp-hint-sheet"><span>Sheet 3</span> Dealer-wise summary</div>
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
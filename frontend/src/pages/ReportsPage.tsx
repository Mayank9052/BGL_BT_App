// src/pages/ReportsPage.tsx
import { useState } from "react";
import { useMsal } from "@azure/msal-react";
import { downloadExcelReport, downloadPdfReport, fetchReportData } from "../services/reportService";
import { useAuthStore } from "../store/authStore";
import "./ReportsPage.css";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");

export default function ReportsPage() {
  const { instance } = useMsal();
  const { user }     = useAuthStore();

  const [period,      setPeriod]      = useState<"daily"|"weekly"|"monthly"|"custom">("monthly");
  const [from,        setFrom]        = useState("");
  const [to,          setTo]          = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [dealerFilter,setDealerFilter]= useState("");
  const [statusFilter,setStatusFilter]= useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const [preview,     setPreview]     = useState<any>(null);
  const [loading,     setLoading]     = useState(false);
  const [downloading, setDownloading] = useState<"excel"|"pdf"|null>(null);
  const [error,       setError]       = useState<string|null>(null);

  const [activeTab,   setActiveTab]   = useState<"summary"|"proposals"|"activities">("summary");

  const filters = {
    period:  period === "custom" ? undefined : period,
    from:    period === "custom" ? from      : undefined,
    to:      period === "custom" ? to        : undefined,
    state:   stateFilter  || undefined,
    dealer:  dealerFilter || undefined,
    status:  statusFilter || undefined,
    month:   monthFilter  || undefined,
  };

  const handlePreview = async () => {
    setLoading(true); setError(null);
    try { setPreview(await fetchReportData(filters, instance)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load report."); }
    finally { setLoading(false); }
  };

  const handleDownload = async (type: "excel"|"pdf") => {
    setDownloading(type); setError(null);
    try {
      if (type === "excel") await downloadExcelReport(filters, instance);
      else                  await downloadPdfReport(filters, instance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="rp-page">
      {/* ── Header ── */}
      <div className="rp-header">
        <div>
          <h1 className="rp-title">BTL Reports</h1>
          <p className="rp-sub">Download proposal &amp; activity reports — daily, weekly, monthly, or custom range.</p>
        </div>
        <div className="rp-header-actions">
          <button className="rp-btn rp-btn--excel" onClick={() => handleDownload("excel")}
            disabled={downloading !== null}>
            {downloading === "excel" ? <><span className="rp-spin"/>Generating…</> : "⬇ Excel"}
          </button>
          <button className="rp-btn rp-btn--pdf" onClick={() => handleDownload("pdf")}
            disabled={downloading !== null}>
            {downloading === "pdf" ? <><span className="rp-spin"/>Generating…</> : "⬇ PDF"}
          </button>
        </div>
      </div>

      {/* ── Filter Panel ── */}
      <div className="rp-filter-panel">
        <div className="rp-filter-row">
          {/* Period */}
          <div className="rp-field">
            <label className="rp-label">Period</label>
            <div className="rp-period-btns">
              {(["daily","weekly","monthly","custom"] as const).map((p) => (
                <button key={p} className={`rp-period-btn${period===p?" rp-period-btn--active":""}`}
                  onClick={() => setPeriod(p)}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date range */}
          {period === "custom" && (
            <>
              <div className="rp-field">
                <label className="rp-label">From</label>
                <input className="rp-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)}/>
              </div>
              <div className="rp-field">
                <label className="rp-label">To</label>
                <input className="rp-input" type="date" value={to} min={from||undefined} onChange={(e) => setTo(e.target.value)}/>
              </div>
            </>
          )}
        </div>

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
            <select className="rp-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="NeedsRevision">Needs Revision</option>
            </select>
          </div>
          <div className="rp-field">
            <label className="rp-label">Month</label>
            <select className="rp-input" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All Months</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="rp-filter-footer">
          <button className="rp-btn rp-btn--preview" onClick={handlePreview} disabled={loading}>
            {loading ? <><span className="rp-spin"/>Loading…</> : "🔍 Preview Data"}
          </button>
          {(stateFilter||dealerFilter||statusFilter||monthFilter) && (
            <button className="rp-btn rp-btn--ghost" onClick={() => {
              setStateFilter(""); setDealerFilter(""); setStatusFilter(""); setMonthFilter("");
            }}>✕ Clear filters</button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rp-error">
          <span>⚠</span> {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── Preview ── */}
      {preview && (
        <div className="rp-preview">
          {/* KPI strip */}
          <div className="rp-kpi-strip">
            <div className="rp-kpi-cell rp-kpi-cell--blue">
              <span className="rp-kpi-val">{preview.totalProposals}</span>
              <span className="rp-kpi-lbl">Proposals</span>
            </div>
            <div className="rp-kpi-cell rp-kpi-cell--teal">
              <span className="rp-kpi-val">{preview.totalActivities}</span>
              <span className="rp-kpi-lbl">Activities</span>
            </div>
            <div className="rp-kpi-cell rp-kpi-cell--green">
              <span className="rp-kpi-val">{inr(preview.totalBudget)}</span>
              <span className="rp-kpi-lbl">Total Budget</span>
            </div>
            <div className="rp-kpi-cell rp-kpi-cell--amber">
              <span className="rp-kpi-val">{inr(preview.overallCac)}</span>
              <span className="rp-kpi-lbl">Overall CAC</span>
            </div>
            <div className="rp-kpi-cell rp-kpi-cell--purple">
              <span className="rp-kpi-val">{inr(preview.overallCpl)}</span>
              <span className="rp-kpi-lbl">Overall CPL</span>
            </div>
          </div>
          <p className="rp-period-label">📅 {preview.periodLabel}</p>

          {/* Tabs */}
          <div className="rp-tabs">
            {(["summary","proposals","activities"] as const).map((tab) => (
              <button key={tab} className={`rp-tab${activeTab===tab?" rp-tab--active":""}`}
                onClick={() => setActiveTab(tab)}>
                {tab === "summary" ? "State Summary" : tab === "proposals" ? "Dealer Summary" : "Activity Detail"}
              </button>
            ))}
          </div>

          {/* State Summary tab */}
          {activeTab === "summary" && preview.stateSummary && (
            <div className="rp-table-wrap">
              <table className="rp-table">
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
                  </tr>
                </thead>
                <tbody>
                  {preview.stateSummary.map((s: any, i: number) => (
                    <tr key={s.state} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td><span className="rp-state-tag">{s.state}</span></td>
                      <td className="rp-num">{s.dealers}</td>
                      <td className="rp-num rp-mono">{inr(s.totalBudget)}</td>
                      <td className="rp-num">{s.totalRetailTarget.toLocaleString("en-IN")}</td>
                      <td className="rp-num">{s.totalLeadTarget.toLocaleString("en-IN")}</td>
                      <td className="rp-num rp-mono">{inr(s.cac)}</td>
                      <td className="rp-num rp-mono">{inr(s.cpl)}</td>
                      <td className="rp-num"><StatusBadge v={s.pending}  type="pending"/></td>
                      <td className="rp-num"><StatusBadge v={s.approved} type="approved"/></td>
                      <td className="rp-num"><StatusBadge v={s.rejected} type="rejected"/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Dealer Summary tab */}
          {activeTab === "proposals" && preview.dealerSummary && (
            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Dealer</th>
                    <th className="rp-num">Activities</th>
                    <th className="rp-num">Total Budget</th>
                    <th className="rp-num">Retail Target</th>
                    <th className="rp-num">Lead Target</th>
                    <th className="rp-num">CAC</th>
                    <th className="rp-num">CPL</th>
                    <th className="rp-num">Pending</th>
                    <th className="rp-num">Approved</th>
                    <th className="rp-num">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.dealerSummary.map((d: any, i: number) => (
                    <tr key={`${d.state}__${d.dealer}`} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td><span className="rp-state-tag">{d.state}</span></td>
                      <td className="rp-dealer">{d.dealer}</td>
                      <td className="rp-num">{d.activities}</td>
                      <td className="rp-num rp-mono">{inr(d.totalBudget)}</td>
                      <td className="rp-num">{d.totalRetailTarget.toLocaleString("en-IN")}</td>
                      <td className="rp-num">{d.totalLeadTarget.toLocaleString("en-IN")}</td>
                      <td className="rp-num rp-mono">{inr(d.cac)}</td>
                      <td className="rp-num rp-mono">{inr(d.cpl)}</td>
                      <td className="rp-num"><StatusBadge v={d.pending}  type="pending"/></td>
                      <td className="rp-num"><StatusBadge v={d.approved} type="approved"/></td>
                      <td className="rp-num"><StatusBadge v={d.rejected} type="rejected"/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Activity Detail tab */}
          {activeTab === "activities" && preview.rows && (
            <div className="rp-table-wrap">
              <table className="rp-table rp-table--detail">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Dealer</th>
                    <th>State</th>
                    <th>RSM</th>
                    <th>Month</th>
                    <th>Status</th>
                    <th>Activity Type</th>
                    <th>Category</th>
                    <th>Subcategory</th>
                    <th className="rp-num">QTY</th>
                    <th className="rp-num">Sales%</th>
                    <th className="rp-num">Lead</th>
                    <th className="rp-num">Retail</th>
                    <th className="rp-num">Budget</th>
                    <th className="rp-num">Add. Budget</th>
                    <th className="rp-num">BGauss%</th>
                    <th className="rp-num">Total</th>
                    <th className="rp-num">CPL</th>
                    <th className="rp-num">CAC</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r: any, i: number) => (
                    <tr key={i} className={i%2===0?"rp-row-even":"rp-row-odd"}>
                      <td className="rp-token">{r.tokenNumber ?? "—"}</td>
                      <td className="rp-dealer">{r.dealerName}</td>
                      <td><span className="rp-state-tag">{r.state}</span></td>
                      <td>{r.rsmName}</td>
                      <td>{r.month}</td>
                      <td>
                        <span className={`rp-status rp-status--${(r.status??"").toLowerCase()}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="rp-bold">{r.activityType}</td>
                      <td>
                        {r.category && (
                          <span className={`rp-cat rp-cat--${r.category==="ATL"?"atl":"btl"}`}>{r.category}</span>
                        )}
                      </td>
                      <td>{r.subcategory ?? "—"}</td>
                      <td className="rp-num">{r.qty ?? 1}</td>
                      <td className="rp-num">{r.salesPercent != null ? `${r.salesPercent}%` : "—"}</td>
                      <td className="rp-num">{r.leadTarget}</td>
                      <td className="rp-num">{r.retailTarget}</td>
                      <td className="rp-num rp-mono">{inr(r.budget)}</td>
                      <td className="rp-num rp-mono">{inr(r.additionalBudget)}</td>
                      <td className="rp-num">{r.bgaussShare ? `${r.bgaussShare}%` : "100%"}</td>
                      <td className="rp-num rp-mono rp-bold">{inr(r.total)}</td>
                      <td className="rp-num rp-mono">{inr(r.cpl)}</td>
                      <td className="rp-num rp-mono">{inr(r.cac)}</td>
                      <td className="rp-date">{r.startDate ?? "—"}</td>
                      <td className="rp-date">{r.endDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Download strip at bottom of preview */}
          <div className="rp-preview-download-strip">
            <span className="rp-preview-label">Download full report:</span>
            <button className="rp-btn rp-btn--excel" onClick={() => handleDownload("excel")}
              disabled={downloading !== null}>
              {downloading === "excel" ? "Generating…" : "⬇ Download Excel"}
            </button>
            <button className="rp-btn rp-btn--pdf" onClick={() => handleDownload("pdf")}
              disabled={downloading !== null}>
              {downloading === "pdf" ? "Generating…" : "⬇ Download PDF"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ v, type }: { v: number; type: string }) {
  if (!v) return <span style={{ color:"#cbd5e1" }}>—</span>;
  return <span className={`rp-badge rp-badge--${type}`}>{v}</span>;
}
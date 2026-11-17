// src/pages/AccountsDashboard.tsx
// [BTL-2026-11-17] Compact one-line KPI strip (all statuses, clickable) + Insights charts
//                  (status donut, state-wise value, month-wise trend) — every bar / slice filters the table.
// [BTL-2026-11-16] CN actions, attachments, email history, status filter, Excel export — now with page-wise
// permissions (View / Download / Full) from Accounts Access Management. The API enforces the same rules.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import * as XLSX from "xlsx";
import { fetchCnReport, CN_STATUS_META, type CnReportRow, type CnStatus } from "../services/cnService";
import { useAccountsAccess } from "../hooks/useAccountsAccess";
import CnPanel from "../components/CnPanel";
import AccountsActionPanel from "../components/AccountsActionPanel";
import CnAttachments from "../components/CnAttachments";
import CnEmailHistory from "../components/CnEmailHistory";
import DownloadReportButton from "../components/DownloadReportButton";
import MultiSelectDropdown from "../components/MultiSelectDropdown";
import { useSortPage, SortTh, Pager, Inr } from "../components/TableTools";
import "./AccountsDashboard.css";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const STATUS_LABEL = Object.fromEntries(
  Object.entries(CN_STATUS_META).map(([k, v]) => [k, v.label])) as Record<string, string>;
const ALL_STATUS_LABELS = Object.values(STATUS_LABEL);
const labelOf = (s: CnStatus | string) => STATUS_LABEL[s] ?? s;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const ACTIONABLE: string[] = ["SentToAccounts", "CnPending"];

// KPI strip — order = CN life-cycle on the Accounts side. "pipe" = everything still before Accounts.
type KpiDef = { key: string; label: string; icon: string; color: string; st: CnStatus[] };
const PIPE: CnStatus[] = ["NotStarted", "SentForRsmApproval", "RsmApproved", "RsmRejected"];
const KPIS: KpiDef[] = [
  { key: "todo",   label: "To process",   icon: "📥", color: "#7c3aed", st: ["SentToAccounts"] },
  { key: "pend",   label: "CN Pending",   icon: "⏳", color: "#d97706", st: ["CnPending"] },
  { key: "rev",    label: "Revision",     icon: "↩",  color: "#ea580c", st: ["AccountsRevision"] },
  { key: "rej",    label: "Rejected",     icon: "✕",  color: "#dc2626", st: ["AccountsRejected"] },
  { key: "proc",   label: "Processed",    icon: "✓",  color: "#16a34a", st: ["CnProcessed"] },
  { key: "clear",  label: "CN Cleared",   icon: "🏁", color: "#047857", st: ["CnCleared"] },
  { key: "pipe",   label: "Pipeline", icon: "🕓", color: "#64748b", st: PIPE },
];
// Donut order + colours (all 10 statuses)
const STATUS_ORDER: CnStatus[] = ["SentToAccounts", "CnPending", "AccountsRevision", "AccountsRejected", "CnProcessed", "CnCleared",
  "NotStarted", "SentForRsmApproval", "RsmApproved", "RsmRejected"];
const STATUS_COLOR: Record<string, string> = {
  SentToAccounts: "#7c3aed", CnPending: "#f59e0b", AccountsRevision: "#ea580c", AccountsRejected: "#dc2626",
  CnProcessed: "#22c55e", CnCleared: "#047857", NotStarted: "#cbd5e1", SentForRsmApproval: "#94a3b8",
  RsmApproved: "#60a5fa", RsmRejected: "#f87171",
};
const compactInr = (v: number) =>
  v >= 1_00_00_000 ? `₹${(v / 1_00_00_000).toFixed(2)} Cr` : v >= 1_00_000 ? `₹${(v / 1_00_000).toFixed(1)} L`
  : v >= 1_000 ? `₹${(v / 1_000).toFixed(0)}K` : `₹${Math.round(v)}`;
const INSIGHTS_KEY = "acc_insights_open";

const exportColumns = [
  { header: "Token", key: "tokenNumber" }, { header: "Dealer", key: "dealerName" }, { header: "State", key: "state" },
  { header: "Month", key: "month" }, { header: "Year", key: "year" }, { header: "Activity", key: "activityName" },
  { header: "RSM", key: "rsmName" }, { header: "Approved Budget", key: "approvedBudget" },
  { header: "Actual Budget", key: "actualBudget" }, { header: "Approved Leads", key: "approvedLeads" },
  { header: "Actual Leads", key: "actualLeads" }, { header: "Approved Retail", key: "approvedRetail" },
  { header: "Actual Retail", key: "actualRetail" }, { header: "Activity Photos", key: "photoCount" },
  { header: "Vendor Invoices", key: "vendorInvoiceCount" }, { header: "Final Invoice", key: "invoice" },
  { header: "CN Status", key: "statusLabel" }, { header: "CN Number", key: "cnNumber" },
];

export default function AccountsDashboard() {
  const { instance, accounts } = useMsal();
  const msal = accounts.length > 0 ? instance : null;
  const access = useAccountsAccess(msal);

  const canDash       = access.can("cn-dashboard", "view");
  const canExport     = access.can("cn-dashboard", "download");
  const canProcessView= access.can("cn-process", "view");
  const canProcessFull= access.can("cn-process", "full");
  const canPhotos     = access.can("cn-attachments", "view");
  const canPhotosDl   = access.can("cn-attachments", "download");
  const canMails      = access.can("cn-emails", "view");

  const [rows, setRows]       = useState<CnReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [statusSel, setStatusSel] = useState<string[]>([labelOf("SentToAccounts")]);
  const [stateSel, setStateSel] = useState<string[]>([]);
  const [monthSel, setMonthSel] = useState<string[]>([]);
  const [yearSel, setYearSel]   = useState<string[]>([]);
  const [open, setOpen]       = useState<CnReportRow | null>(null);
  const [photoRow, setPhotoRow] = useState<CnReportRow | null>(null);
  const [tick, setTick]       = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await fetchCnReport({}, msal)); }
    catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load credit notes.";
      setError(/403|forbid/i.test(msg) && !/access/i.test(msg) ? "Your login does not have Accounts access. Ask Admin to set your role to Accounts." : msg);
    } finally { setLoading(false); }
  }, [msal]);

  useEffect(() => {
    if (!access.ready) return;
    if (access.can("cn-dashboard", "view")) load(); else setLoading(false);
  }, [access.ready, access.can, load]);

  const sum = (rs: CnReportRow[]) => rs.reduce((s, r) => s + (r.actualBudget ?? r.approvedBudget), 0);

  // Filter with an optional dimension left out — charts use it so a chart never filters itself away.
  const match = useCallback((r: CnReportRow, skip?: "status" | "state" | "month") => {
    const q = search.trim().toLowerCase();
    if (skip !== "status" && statusSel.length && !statusSel.includes(labelOf(r.cnStatus))) return false;
    if (skip !== "state" && stateSel.length && !stateSel.includes(r.state)) return false;
    if (skip !== "month" && monthSel.length && !monthSel.includes(r.month)) return false;
    if (yearSel.length && !yearSel.includes(String(r.year))) return false;
    if (q && ![r.tokenNumber, r.dealerName, r.state, r.activityName, r.rsmName, r.cnNumber ?? ""].join(" ").toLowerCase().includes(q)) return false;
    return true;
  }, [search, statusSel, stateSel, monthSel, yearSel]);

  const filtered = useMemo(() => rows.filter((r) => match(r)), [rows, match]);
  // KPI counts follow every filter EXCEPT status (clicking a KPI sets the status)
  const kpiBase = useMemo(() => rows.filter((r) => match(r, "status")), [rows, match]);

  const [insightsOpen, setInsightsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(INSIGHTS_KEY) !== "0"; } catch { return true; }
  });
  const toggleInsights = () => setInsightsOpen((v) => {
    try { localStorage.setItem(INSIGHTS_KEY, v ? "0" : "1"); } catch { /* ignore */ }
    return !v;
  });

  const statusChart = useMemo(() => STATUS_ORDER
    .map((st) => ({ st, n: kpiBase.filter((r) => r.cnStatus === st).length }))
    .filter((x) => x.n > 0), [kpiBase]);

  const stateChart = useMemo(() => {
    const m = new Map<string, { n: number; v: number }>();
    rows.filter((r) => match(r, "state")).forEach((r) => {
      const k = r.state || "—"; const cur = m.get(k) ?? { n: 0, v: 0 };
      cur.n++; cur.v += r.actualBudget ?? r.approvedBudget; m.set(k, cur);
    });
    return Array.from(m, ([state, x]) => ({ state, ...x })).sort((a, b) => b.v - a.v).slice(0, 8);
  }, [rows, match]);

  const monthChart = useMemo(() => {
    const base = rows.filter((r) => match(r, "month"));
    return MONTHS.map((m) => {
      const list = base.filter((r) => r.month === m);
      return { m, n: list.length, done: list.filter((r) => r.cnStatus === "CnProcessed" || r.cnStatus === "CnCleared").length };
    }).filter((x) => x.n > 0);
  }, [rows, match]);

  const toggleIn = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.length === 1 && list[0] === v ? [] : [v]);

  const getters = useMemo(() => ({
    token: (r: CnReportRow) => r.tokenNumber, dealer: (r: CnReportRow) => r.dealerName, state: (r: CnReportRow) => r.state,
    period: (r: CnReportRow) => Number(r.year) * 100 + MONTHS.indexOf(r.month), activity: (r: CnReportRow) => r.activityName,
    rsm: (r: CnReportRow) => r.rsmName, approved: (r: CnReportRow) => r.approvedBudget,
    actual: (r: CnReportRow) => r.actualBudget ?? null, leads: (r: CnReportRow) => pct(r.actualLeads, r.approvedLeads),
    retail: (r: CnReportRow) => pct(r.actualRetail, r.approvedRetail), invoice: (r: CnReportRow) => (r.hasFinalInvoice ? 1 : 0),
    status: (r: CnReportRow) => labelOf(r.cnStatus), cn: (r: CnReportRow) => r.cnNumber ?? "",
  }), []);
  const t = useSortPage(filtered, getters, { storageKey: "accounts", resetOn: [search, statusSel, stateSel, monthSel, yearSel] });

  const exportRows = filtered.map((r) => ({
    ...r, invoice: r.hasFinalInvoice ? "Yes" : "No", statusLabel: labelOf(r.cnStatus), cnNumber: r.cnNumber ?? "",
  }));
  const exportExcel = () => {
    if (!canExport) return;
    const data = exportRows.map((r) => Object.fromEntries(exportColumns.map((c) => [c.header, (r as any)[c.key] ?? ""])));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Credit Notes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Filter", "Value"],
      ["Status", statusSel.join(", ") || "All"], ["State", stateSel.join(", ") || "All"],
      ["Month", monthSel.join(", ") || "All"], ["Year", yearSel.join(", ") || "All"],
      ["Search", search || "—"], ["Rows exported", data.length],
      ["Exported on", new Date().toLocaleString("en-IN")],
    ]), "Filters");
    XLSX.writeFile(wb, `Accounts_Credit_Notes_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const states = Array.from(new Set(rows.map((r) => r.state).filter(Boolean))).sort();
  const years  = Array.from(new Set(rows.map((r) => String(r.year)).filter(Boolean))).sort();
  const sp = { sortKey: t.sortKey, sortDir: t.sortDir, onSort: t.onSort };
  const hasFilters = !!(search || stateSel.length || monthSel.length || yearSel.length);
  const dealersInView = new Set(filtered.map((r) => r.dealerName)).size;

  const isStatus = (...st: CnStatus[]) => statusSel.length === st.length && st.every((s) => statusSel.includes(labelOf(s)));
  const pickKpi = (st: CnStatus[]) => setStatusSel(isStatus(...st) ? [] : st.map(labelOf));   // 2nd click = back to All
  const closeModal = () => { setOpen(null); load(); };

  const Head = (
    <div className="acc-head">
      <div className="acc-head-text">
        <div className="acc-eyebrow">Accounts</div>
        <h1>Credit Notes</h1>
        {/* <p>Credit notes sent by the Checker. Verify invoice and actuals, then mark CN Pending, Reject, Request Revision, enter the CN number, and finally mark it Cleared — every step is mailed and logged.</p> */}
      </div>
      <div className="acc-head-actions">
        {access.isAdmin && <Link className="acc-link-btn" to="/accounts/access">🔐 Access Management</Link>}
        <button className="acc-refresh" onClick={load} disabled={loading || !canDash}>{loading ? "Loading…" : "↻ Refresh"}</button>
      </div>
    </div>
  );

  if (!access.ready) return <div className="acc-page">{Head}<div className="acc-card acc-empty"><span className="acc-spinner" />Checking your access…</div></div>;

  if (!canDash) return (
    <div className="acc-page">{Head}
      <div className="acc-card acc-noaccess">
        <div className="acc-empty-icon">🔒</div>
        <b>{access.error ?? "You don't have access to the Credit Notes dashboard."}</b>
        <p>Ask an Accounts access admin (Ankit Heda or Gaurav Zore) to grant you access.</p>
      </div>
    </div>);

  return (
    <div className="acc-page">
      {Head}

      {/* ── KPI strip: one line, compact, every chip filters the table (click again = All) ── */}
      <div className="acc-kpis" role="tablist" aria-label="Credit note status">
        {KPIS.map((k) => {
          const list = kpiBase.filter((r) => k.st.includes(r.cnStatus));
          const active = isStatus(...k.st);
          return (
            <button key={k.key} type="button" role="tab" aria-selected={active}
              className={`acc-kpi${active ? " is-active" : ""}`} style={{ ["--kpi" as string]: k.color }}
              onClick={() => pickKpi(k.st)} title={`${k.label}: ${list.length} · ${compactInr(sum(list))} — click to filter`}>
              <span className="acc-kpi-ico" aria-hidden="true">{k.icon}</span>
              <span className="acc-kpi-txt">
                <span className="acc-kpi-lbl">{k.label}</span>
                <span className="acc-kpi-val"><b>{list.length}</b><small>{compactInr(sum(list))}</small></span>
              </span>
            </button>
          );
        })}
        <button type="button" role="tab" aria-selected={statusSel.length === 0}
          className={`acc-kpi acc-kpi--all${statusSel.length === 0 ? " is-active" : ""}`} style={{ ["--kpi" as string]: "#0a2540" }}
          onClick={() => setStatusSel([])} title="Show every status">
          <span className="acc-kpi-ico" aria-hidden="true">Σ</span>
          <span className="acc-kpi-txt">
            <span className="acc-kpi-lbl">All</span>
            <span className="acc-kpi-val"><b>{kpiBase.length}</b><small>{dealersInView} dealer{dealersInView === 1 ? "" : "s"}</small></span>
          </span>
        </button>
      </div>

      {/* ── Insights: status donut · state-wise value · month-wise trend (all clickable) ── */}
      <div className="acc-insights">
        <button type="button" className="acc-insights-toggle" onClick={toggleInsights} aria-expanded={insightsOpen}>
          📊 Insights <span>{insightsOpen ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {insightsOpen && (
          <div className="acc-charts">
            {/* Donut — CN status mix */}
            <div className="acc-chart">
              <div className="acc-chart-title">Status mix <small>click a slice</small></div>
              {statusChart.length === 0 ? <div className="acc-chart-empty">No data</div> : (() => {
                const total = statusChart.reduce((a, x) => a + x.n, 0);
                const R = 42, C = 2 * Math.PI * R; let off = 0;
                return (
                  <div className="acc-donut-wrap">
                    <svg viewBox="0 0 120 120" className="acc-donut" role="img" aria-label="CN status mix">
                      <circle cx="60" cy="60" r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
                      {statusChart.map((x) => {
                        const len = (x.n / total) * C; const dash = `${len} ${C - len}`;
                        const el = (
                          <circle key={x.st} cx="60" cy="60" r={R} fill="none" stroke={STATUS_COLOR[x.st]}
                            strokeWidth={isStatus(x.st) ? 20 : 16} strokeDasharray={dash} strokeDashoffset={-off}
                            transform="rotate(-90 60 60)" className="acc-donut-seg"
                            onClick={() => pickKpi([x.st])}>
                            <title>{`${labelOf(x.st)}: ${x.n}`}</title>
                          </circle>);
                        off += len; return el;
                      })}
                      <text x="60" y="57" textAnchor="middle" className="acc-donut-num">{total}</text>
                      <text x="60" y="72" textAnchor="middle" className="acc-donut-lbl">activities</text>
                    </svg>
                    <ul className="acc-legend">
                      {statusChart.map((x) => (
                        <li key={x.st}>
                          <button type="button" className={isStatus(x.st) ? "is-active" : ""} onClick={() => pickKpi([x.st])}>
                            <i style={{ background: STATUS_COLOR[x.st] }} />{labelOf(x.st)}<b>{x.n}</b>
                          </button>
                        </li>))}
                    </ul>
                  </div>);
              })()}
            </div>

            {/* Bars — value by state */}
            <div className="acc-chart">
              <div className="acc-chart-title">Value by state <small>top 8 · click a bar</small></div>
              {stateChart.length === 0 ? <div className="acc-chart-empty">No data</div> : (() => {
                const max = Math.max(...stateChart.map((x) => x.v), 1);
                return (
                  <div className="acc-hbars">
                    {stateChart.map((x) => {
                      const on = stateSel.length === 1 && stateSel[0] === x.state;
                      return (
                        <button key={x.state} type="button" className={`acc-hbar${on ? " is-active" : ""}`}
                          onClick={() => toggleIn(stateSel, x.state, setStateSel)} title={`${x.state}: ${x.n} CN · ${compactInr(x.v)}`}>
                          <span className="acc-hbar-lbl">{x.state}</span>
                          <span className="acc-hbar-track"><span style={{ width: `${Math.max(4, (x.v / max) * 100)}%` }} /></span>
                          <span className="acc-hbar-val">{compactInr(x.v)}<small>{x.n}</small></span>
                        </button>);
                    })}
                  </div>);
              })()}
            </div>

            {/* Columns — month-wise count, processed part highlighted */}
            <div className="acc-chart">
              <div className="acc-chart-title">Month-wise <small><i className="acc-key acc-key--all" />total <i className="acc-key acc-key--done" />processed / cleared</small></div>
              {monthChart.length === 0 ? <div className="acc-chart-empty">No data</div> : (() => {
                const max = Math.max(...monthChart.map((x) => x.n), 1);
                return (
                  <div className="acc-cols">
                    {monthChart.map((x) => {
                      const on = monthSel.length === 1 && monthSel[0] === x.m;
                      return (
                        <button key={x.m} type="button" className={`acc-col${on ? " is-active" : ""}`}
                          onClick={() => toggleIn(monthSel, x.m, setMonthSel)} title={`${x.m}: ${x.n} total · ${x.done} processed/cleared`}>
                          <span className="acc-col-n">{x.n}</span>
                          <span className="acc-col-bar" style={{ height: `${Math.max(6, (x.n / max) * 100)}%` }}>
                            <span style={{ height: `${x.n ? (x.done / x.n) * 100 : 0}%` }} />
                          </span>
                          <span className="acc-col-lbl">{x.m.slice(0, 3)}</span>
                        </button>);
                    })}
                  </div>);
              })()}
            </div>
          </div>
        )}
      </div>

      <div className="acc-toolbar">
        <div className="acc-filters">
          <input className="acc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search token, dealer, activity, RSM, CN number…" />
          <MultiSelectDropdown label="Statuses" options={ALL_STATUS_LABELS} value={statusSel} onChange={setStatusSel} width={190} />
          <MultiSelectDropdown label="States" options={states} value={stateSel} onChange={setStateSel} width={160} />
          <MultiSelectDropdown label="Months" options={MONTHS} value={monthSel} onChange={setMonthSel} width={150} />
          <MultiSelectDropdown label="Years" options={years} value={yearSel} onChange={setYearSel} width={120} />
          {(hasFilters || statusSel.length > 0) && (
            <button className="acc-clear" onClick={() => { setSearch(""); setStatusSel([]); setStateSel([]); setMonthSel([]); setYearSel([]); }}>Clear ✕</button>
          )}
        </div>
        {canExport && (
          <div className="acc-export">
            <button className="acc-btn acc-btn--excel" onClick={exportExcel} disabled={filtered.length === 0}
              title="Exports the rows matching the current filters">⬇ Excel ({filtered.length})</button>
            <DownloadReportButton filename="Accounts_Credit_Notes" title="Credit Notes — Accounts" columns={exportColumns} rows={exportRows} />
          </div>
        )}
      </div>

      {error && <div className="acc-error"><span>⚠ {error}</span><button onClick={load}>Retry</button></div>}

      <div className="acc-card">
        <Pager page={t.page} pageSize={t.pageSize} total={t.total} onPage={t.setPage} onPageSize={t.setPageSize} />
        <div className="acc-table-wrap">
          <table className="acc-table">
            <thead><tr>
              <SortTh k="token" label="Token" {...sp} /><SortTh k="dealer" label="Dealer" {...sp} /><SortTh k="state" label="State" {...sp} />
              <SortTh k="period" label="Month" {...sp} /><SortTh k="activity" label="Activity" {...sp} /><SortTh k="rsm" label="RSM" {...sp} />
              <SortTh k="approved" label="Approved Budget" align="right" {...sp} /><SortTh k="actual" label="Actual Budget" align="right" {...sp} />
              <SortTh k="leads" label="Leads A/P" align="center" {...sp} /><SortTh k="retail" label="Retail A/P" align="center" {...sp} />
              <SortTh k="invoice" label="Invoice" align="center" {...sp} /><SortTh k="status" label="Status" {...sp} />
              <SortTh k="cn" label="CN No." {...sp} /><th className="acc-th-plain">Action</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={14} className="acc-empty"><span className="acc-spinner" />Loading credit notes…</td></tr>
              : error ? <tr><td colSpan={14} className="acc-empty">Credit notes could not be loaded — see the message above.</td></tr>
              : t.pageRows.length === 0 ? <tr><td colSpan={14} className="acc-empty"><div className="acc-empty-icon">🔍</div>No credit notes match the filters.</td></tr>
              : t.pageRows.map((r) => {
                const meta = CN_STATUS_META[r.cnStatus];
                const actionable = ACTIONABLE.includes(r.cnStatus) && canProcessFull;
                return (
                  <tr key={r.activityId}
                      className={`${r.cnStatus === "SentToAccounts" ? "acc-row--todo" : ""}${canProcessView ? "" : " acc-row--static"}`}
                      onClick={() => canProcessView && setOpen(r)}>
                    <td><span className="acc-token">{r.tokenNumber}</span></td>
                    <td className="acc-bold">{r.dealerName}</td>
                    <td>{r.state}</td>
                    <td className="acc-nowrap">{r.month} {r.year}</td>
                    <td>{r.activityName}{r.category && <span className="acc-cat">{r.category}</span>}</td>
                    <td>{r.rsmName}</td>
                    <td className="acc-num"><Inr value={r.approvedBudget} /></td>
                    <td className="acc-num"><Inr value={r.actualBudget} zero="—" /></td>
                    <td className="acc-c">{r.actualLeads}/{r.approvedLeads}<small className={pct(r.actualLeads, r.approvedLeads) >= 100 ? "ok" : "low"}>{pct(r.actualLeads, r.approvedLeads)}%</small></td>
                    <td className="acc-c">{r.actualRetail}/{r.approvedRetail}<small className={pct(r.actualRetail, r.approvedRetail) >= 100 ? "ok" : "low"}>{pct(r.actualRetail, r.approvedRetail)}%</small></td>
                    <td className="acc-c">{r.hasFinalInvoice ? <span className="acc-yes">✓</span> : <span className="acc-no">—</span>}</td>
                    <td><span className={`acc-status acc-status--${r.cnStatus}`} style={{ background: meta?.bg, color: meta?.color }}>{labelOf(r.cnStatus)}</span></td>
                    <td className="acc-nowrap acc-mono">{r.cnNumber ?? "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="acc-actions-cell">
                        {canProcessView && (
                          <button className={actionable ? "acc-btn acc-btn--go" : "acc-btn"} onClick={() => setOpen(r)}>
                            {actionable ? "Process CN" : "View"}</button>)}
                        {canPhotos && <button className="acc-btn" onClick={() => setPhotoRow(r)}>📷 Photos</button>}
                        {!canProcessView && !canPhotos && <span className="acc-no">—</span>}
                      </div>
                    </td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
        {t.total > t.pageSize && <Pager page={t.page} pageSize={t.pageSize} total={t.total} onPage={t.setPage} onPageSize={t.setPageSize} scrollTo=".acc-table-wrap" />}
      </div>

      {photoRow && canPhotos && (
        <div className="acc-modal" onClick={() => setPhotoRow(null)}>
          <div className="acc-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="acc-modal-head">
              <div><div className="acc-modal-token">{photoRow.tokenNumber}</div>
                <div className="acc-modal-title">{photoRow.dealerName} · {photoRow.activityName}</div></div>
              <button onClick={() => setPhotoRow(null)} aria-label="Close">✕</button>
            </div>
            <div className="acc-modal-body"><CnAttachments activityId={photoRow.activityId} instance={msal} canDownload={canPhotosDl} /></div>
          </div>
        </div>
      )}

      {open && canProcessView && (
        <div className="acc-modal" onClick={closeModal}>
          <div className="acc-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="acc-modal-head">
              <div><div className="acc-modal-token">{open.tokenNumber}</div>
                <div className="acc-modal-title">{open.dealerName} · {open.activityName} · {open.month} {open.year}</div></div>
              <button onClick={closeModal} aria-label="Close">✕</button>
            </div>
            <div className="acc-modal-body acc-modal-stack">
              {canProcessFull ? (
                <>
                  <AccountsActionPanel proposalId={open.proposalId} activityId={open.activityId} instance={msal} onChanged={() => setTick((n) => n + 1)} />
                  <CnPanel proposalId={open.proposalId} activityId={open.activityId} instance={msal} refreshKey={`${open.activityId}-${tick}`} onChanged={() => { setTick((n) => n + 1); load(); }} />
                </>
              ) : (
                <>
                  <div className="acc-banner acc-banner--info">👁 View-only access — you can review this CN but not change it.</div>
                  <fieldset disabled className="acc-readonly">
                    <CnPanel proposalId={open.proposalId} activityId={open.activityId} instance={msal} refreshKey={`${open.activityId}-${tick}`} />
                  </fieldset>
                </>
              )}
              {canPhotos && <CnAttachments activityId={open.activityId} instance={msal} refreshKey={tick} canDownload={canPhotosDl} />}
              {canMails && <CnEmailHistory activityId={open.activityId} instance={msal} refreshKey={tick} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
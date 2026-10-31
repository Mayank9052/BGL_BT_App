// src/pages/AccountsDashboard.tsx
// Accounts team login — Credit Notes sent by the Checker ("Send to Accounts" mail).
//   • Tabs: To process (SentToAccounts) · Processed (CnProcessed) · All
//   • Search, State / Month / Year filters, sortable headers, pagination, Excel/PDF/CSV
//   • "Process CN" opens the activity's CN panel: invoice, photos, approved vs actual,
//     enter CN number → Mark processed (dealer + RSM/TSM/Commando are mailed).
// Access: Users.Role = "Accounts", or the email is in Cn:AccountsTeamEmails (backend decides).
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCnReport, type CnReportRow } from "../services/cnService";
import CnPanel from "../components/CnPanel";
import DownloadReportButton from "../components/DownloadReportButton";
import MultiSelectDropdown from "../components/MultiSelectDropdown";
import { useSortPage, SortTh, Pager, Inr } from "../components/TableTools";
import "./AccountsDashboard.css";

type Tab = "todo" | "done" | "all";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const STATUS_LABEL: Record<string, string> = {
  NotStarted: "Not started", SentForRsmApproval: "With RSM", RsmApproved: "RSM approved",
  RsmRejected: "RSM rejected", SentToAccounts: "To process", CnProcessed: "Processed",
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

const exportColumns = [
  { header: "Token", key: "tokenNumber" }, { header: "Dealer", key: "dealerName" }, { header: "State", key: "state" },
  { header: "Month", key: "month" }, { header: "Year", key: "year" }, { header: "Activity", key: "activityName" },
  { header: "RSM", key: "rsmName" }, { header: "Approved Budget", key: "approvedBudget" },
  { header: "Actual Budget", key: "actualBudget" }, { header: "Approved Leads", key: "approvedLeads" },
  { header: "Actual Leads", key: "actualLeads" }, { header: "Approved Retail", key: "approvedRetail" },
  { header: "Actual Retail", key: "actualRetail" }, { header: "Final Invoice", key: "invoice" },
  { header: "CN Status", key: "statusLabel" }, { header: "CN Number", key: "cnNumber" },
];

export default function AccountsDashboard() {
  const [rows, setRows]       = useState<CnReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tab, setTab]         = useState<Tab>("todo");
  const [search, setSearch]   = useState("");
  const [stateSel, setStateSel] = useState<string[]>([]);
  const [monthSel, setMonthSel] = useState<string[]>([]);
  const [yearSel, setYearSel]   = useState<string[]>([]);
  const [open, setOpen]       = useState<CnReportRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [todo, done] = await Promise.all([
        fetchCnReport({ status: "SentToAccounts" }),
        fetchCnReport({ status: "CnProcessed" }),
      ]);
      setRows([...todo, ...done]);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load credit notes."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const todoCount = rows.filter((r) => r.cnStatus === "SentToAccounts").length;
  const doneRows  = rows.filter((r) => r.cnStatus === "CnProcessed");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "todo" && r.cnStatus !== "SentToAccounts") return false;
      if (tab === "done" && r.cnStatus !== "CnProcessed") return false;
      if (stateSel.length && !stateSel.includes(r.state)) return false;
      if (monthSel.length && !monthSel.includes(r.month)) return false;
      if (yearSel.length && !yearSel.includes(String(r.year))) return false;
      if (q && ![r.tokenNumber, r.dealerName, r.state, r.activityName, r.rsmName, r.cnNumber ?? ""]
        .join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tab, search, stateSel, monthSel, yearSel]);

  const getters = useMemo(() => ({
    token: (r: CnReportRow) => r.tokenNumber, dealer: (r: CnReportRow) => r.dealerName, state: (r: CnReportRow) => r.state,
    period: (r: CnReportRow) => Number(r.year) * 100 + MONTHS.indexOf(r.month), activity: (r: CnReportRow) => r.activityName,
    rsm: (r: CnReportRow) => r.rsmName, approved: (r: CnReportRow) => r.approvedBudget,
    actual: (r: CnReportRow) => r.actualBudget ?? null, leads: (r: CnReportRow) => pct(r.actualLeads, r.approvedLeads),
    retail: (r: CnReportRow) => pct(r.actualRetail, r.approvedRetail), invoice: (r: CnReportRow) => (r.hasFinalInvoice ? 1 : 0),
    status: (r: CnReportRow) => STATUS_LABEL[r.cnStatus] ?? r.cnStatus, cn: (r: CnReportRow) => r.cnNumber ?? "",
  }), []);
  const t = useSortPage(filtered, getters, { storageKey: "accounts", resetOn: [tab, search, stateSel, monthSel, yearSel] });

  const kpi = {
    todo: todoCount,
    todoValue: rows.filter((r) => r.cnStatus === "SentToAccounts").reduce((s, r) => s + (r.actualBudget ?? r.approvedBudget), 0),
    done: doneRows.length,
    doneValue: doneRows.reduce((s, r) => s + (r.actualBudget ?? r.approvedBudget), 0),
    dealers: new Set(filtered.map((r) => r.dealerName)).size,
  };

  const exportRows = filtered.map((r) => ({
    ...r, invoice: r.hasFinalInvoice ? "Yes" : "No", statusLabel: STATUS_LABEL[r.cnStatus] ?? r.cnStatus, cnNumber: r.cnNumber ?? "",
  }));
  const states = Array.from(new Set(rows.map((r) => r.state).filter(Boolean))).sort();
  const years  = Array.from(new Set(rows.map((r) => String(r.year)).filter(Boolean))).sort();
  const sp = { sortKey: t.sortKey, sortDir: t.sortDir, onSort: t.onSort };

  return (
    <div className="acc-page">
      <div className="acc-head">
        <div>
          <h1>Accounts — Credit Notes</h1>
          <p>Credit notes sent by the Checker for processing. Open a CN, verify invoice and actuals, enter the CN number and mark it processed — the dealer and RSM team are informed by mail.</p>
        </div>
        <button className="acc-refresh" onClick={load} disabled={loading}>{loading ? "Loading…" : "↻ Refresh"}</button>
      </div>

      <div className="acc-kpis">
        <button className={`acc-kpi acc-kpi--amber${tab === "todo" ? " is-active" : ""}`} onClick={() => setTab("todo")}>
          <span>To process</span><b>{kpi.todo}</b><small><Inr value={kpi.todoValue}/></small>
        </button>
        <button className={`acc-kpi acc-kpi--green${tab === "done" ? " is-active" : ""}`} onClick={() => setTab("done")}>
          <span>Processed</span><b>{kpi.done}</b><small><Inr value={kpi.doneValue}/></small>
        </button>
        <button className={`acc-kpi${tab === "all" ? " is-active" : ""}`} onClick={() => setTab("all")}>
          <span>All</span><b>{rows.length}</b><small>{kpi.dealers} dealer{kpi.dealers === 1 ? "" : "s"} in view</small>
        </button>
      </div>

      <div className="acc-filters">
        <input className="acc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search token, dealer, activity, RSM, CN number…"/>
        <MultiSelectDropdown label="States" options={states} value={stateSel} onChange={setStateSel} width={160}/>
        <MultiSelectDropdown label="Months" options={MONTHS} value={monthSel} onChange={setMonthSel} width={150}/>
        <MultiSelectDropdown label="Years" options={years} value={yearSel} onChange={setYearSel} width={120}/>
        {(search || stateSel.length > 0 || monthSel.length > 0 || yearSel.length > 0) && (
          <button className="acc-clear" onClick={() => { setSearch(""); setStateSel([]); setMonthSel([]); setYearSel([]); }}>Clear ✕</button>
        )}
        <div style={{ marginLeft: "auto" }}>
          <DownloadReportButton filename="Accounts_Credit_Notes" title="Credit Notes — Accounts" columns={exportColumns} rows={exportRows}/>
        </div>
      </div>

      {error && <div className="acc-error">⚠ {error}</div>}

      <Pager page={t.page} pageSize={t.pageSize} total={t.total} onPage={t.setPage} onPageSize={t.setPageSize}/>
      <div className="acc-table-wrap">
        <table className="acc-table">
          <thead><tr>
            <SortTh k="token" label="Token" {...sp}/>
            <SortTh k="dealer" label="Dealer" {...sp}/>
            <SortTh k="state" label="State" {...sp}/>
            <SortTh k="period" label="Month" {...sp}/>
            <SortTh k="activity" label="Activity" {...sp}/>
            <SortTh k="rsm" label="RSM" {...sp}/>
            <SortTh k="approved" label="Approved Budget" align="right" {...sp}/>
            <SortTh k="actual" label="Actual Budget" align="right" {...sp}/>
            <SortTh k="leads" label="Leads A/P" align="center" {...sp}/>
            <SortTh k="retail" label="Retail A/P" align="center" {...sp}/>
            <SortTh k="invoice" label="Invoice" align="center" {...sp}/>
            <SortTh k="status" label="Status" {...sp}/>
            <SortTh k="cn" label="CN No." {...sp}/>
            <th className="acc-th-plain">Action</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={14} className="acc-empty">Loading credit notes…</td></tr>
            ) : t.pageRows.length === 0 ? (
              <tr><td colSpan={14} className="acc-empty">
                {tab === "todo" ? "Nothing waiting — all credit notes sent to Accounts are processed. ✓" : "No credit notes match the filters."}
              </td></tr>
            ) : t.pageRows.map((r) => (
              <tr key={r.activityId} className={r.cnStatus === "SentToAccounts" ? "acc-row--todo" : ""} onClick={() => setOpen(r)}>
                <td><span className="acc-token">{r.tokenNumber}</span></td>
                <td className="acc-bold">{r.dealerName}</td>
                <td>{r.state}</td>
                <td className="acc-nowrap">{r.month} {r.year}</td>
                <td>{r.activityName}{r.category && <span className="acc-cat">{r.category}</span>}</td>
                <td>{r.rsmName}</td>
                <td className="acc-num"><Inr value={r.approvedBudget}/></td>
                <td className="acc-num"><Inr value={r.actualBudget} zero="—"/></td>
                <td className="acc-c">{r.actualLeads}/{r.approvedLeads}<small className={pct(r.actualLeads, r.approvedLeads) >= 100 ? "ok" : "low"}>{pct(r.actualLeads, r.approvedLeads)}%</small></td>
                <td className="acc-c">{r.actualRetail}/{r.approvedRetail}<small className={pct(r.actualRetail, r.approvedRetail) >= 100 ? "ok" : "low"}>{pct(r.actualRetail, r.approvedRetail)}%</small></td>
                <td className="acc-c">{r.hasFinalInvoice ? <span className="acc-yes">✓</span> : <span className="acc-no">—</span>}</td>
                <td><span className={`acc-status acc-status--${r.cnStatus}`}>{STATUS_LABEL[r.cnStatus] ?? r.cnStatus}</span></td>
                <td className="acc-nowrap acc-mono">{r.cnNumber ?? "—"}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className={r.cnStatus === "SentToAccounts" ? "acc-btn acc-btn--go" : "acc-btn"} onClick={() => setOpen(r)}>
                    {r.cnStatus === "SentToAccounts" ? "Process CN" : "View"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={t.page} pageSize={t.pageSize} total={t.total} onPage={t.setPage} onPageSize={t.setPageSize} scrollTo=".acc-table-wrap"/>

      {open && (
        <div className="acc-modal" onClick={() => { setOpen(null); load(); }}>
          <div className="acc-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="acc-modal-head">
              <div>
                <div className="acc-modal-token">{open.tokenNumber}</div>
                <div className="acc-modal-title">{open.dealerName} · {open.activityName} · {open.month} {open.year}</div>
              </div>
              <button onClick={() => { setOpen(null); load(); }} aria-label="Close">✕</button>
            </div>
            <div className="acc-modal-body">
              <CnPanel proposalId={open.proposalId} activityId={open.activityId} refreshKey={open.activityId} onChanged={() => load()}/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
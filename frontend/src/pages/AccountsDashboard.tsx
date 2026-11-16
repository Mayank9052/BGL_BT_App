// src/pages/AccountsDashboard.tsx
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

  const count = (...st: CnStatus[]) => rows.filter((r) => st.includes(r.cnStatus));
  const sum = (rs: CnReportRow[]) => rs.reduce((s, r) => s + (r.actualBudget ?? r.approvedBudget), 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusSel.length && !statusSel.includes(labelOf(r.cnStatus))) return false;
      if (stateSel.length && !stateSel.includes(r.state)) return false;
      if (monthSel.length && !monthSel.includes(r.month)) return false;
      if (yearSel.length && !yearSel.includes(String(r.year))) return false;
      if (q && ![r.tokenNumber, r.dealerName, r.state, r.activityName, r.rsmName, r.cnNumber ?? ""].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusSel, stateSel, monthSel, yearSel]);

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
  const Kpi = ({ cls, label, st, list }: { cls: string; label: string; st: CnStatus[]; list: CnReportRow[] }) => (
    <button className={`acc-kpi acc-kpi--${cls}${isStatus(...st) ? " is-active" : ""}`} onClick={() => setStatusSel(st.map(labelOf))}>
      <span>{label}</span><b>{list.length}</b><small><Inr value={sum(list)} /></small>
    </button>
  );
  const closeModal = () => { setOpen(null); load(); };

  const Head = (
    <div className="acc-head">
      <div className="acc-head-text">
        <div className="acc-eyebrow">Accounts</div>
        <h1>Credit Notes</h1>
        <p>Credit notes sent by the Checker. Verify invoice and actuals, then mark CN Pending, Reject, Request Revision, enter the CN number, and finally mark it Cleared — every step is mailed and logged.</p>
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

      <div className="acc-kpis">
        <Kpi cls="amber" label="To process" st={["SentToAccounts"]} list={count("SentToAccounts")} />
        <Kpi cls="amber" label="CN Pending" st={["CnPending"]} list={count("CnPending")} />
        <Kpi cls="green" label="Processed" st={["CnProcessed"]} list={count("CnProcessed")} />
        <Kpi cls="green" label="CN Cleared" st={["CnCleared"]} list={count("CnCleared")} />
        <button className={`acc-kpi acc-kpi--navy${statusSel.length === 0 ? " is-active" : ""}`} onClick={() => setStatusSel([])}>
          <span>All</span><b>{rows.length}</b><small>{dealersInView} dealer{dealersInView === 1 ? "" : "s"} in view</small>
        </button>
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
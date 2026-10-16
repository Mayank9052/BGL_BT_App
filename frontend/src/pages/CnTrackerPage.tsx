// src/pages/CnTrackerPage.tsx
// Activity-wise Approved vs Actual (Leads / Retail / Budget / CPL / CAC) + CN status.
// Only APPROVED proposals. Rows are scoped by the backend:
//   Checker / Admin / Final Approver → all · RSM/TSM/Commando → mapped dealers · Dealer → own.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import * as XLSX from "xlsx";
import { fetchCnReport, CN_STATUS_META, type CnReportRow, type CnStatus } from "../services/cnService";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CY = new Date().getFullYear();
const YEARS = [String(CY - 1), String(CY), String(CY + 1)];
const STATUSES: ("All" | CnStatus)[] = ["All","NotStarted","SentForRsmApproval","RsmApproved","RsmRejected","SentToAccounts","CnProcessed"];

const inr = (v: number | null | undefined) => (v == null ? "—" : "₹" + Math.round(v).toLocaleString("en-IN"));
const lakh = (v: number) => v >= 1_00_000 ? `₹${(v / 1_00_000).toFixed(2)} L` : inr(v);
const achColor = (p: number) => (p >= 90 ? "#166534" : p >= 60 ? "#92400e" : "#991b1b");

export default function CnTrackerPage() {
  const { instance, accounts } = useMsal();
  const msal = accounts.length > 0 ? instance : null;   // local logins fall back to their JWT

  const [rows, setRows]       = useState<CnReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [month, setMonth]     = useState("All");
  const [year, setYear]       = useState(String(CY));
  const [status, setStatus]   = useState<"All" | CnStatus>("All");
  const [search, setSearch]   = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await fetchCnReport({ month, year, status }, msal)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load."); }
    finally { setLoading(false); }
  }, [month, year, status, msal]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.dealerName, r.activityName, r.tokenNumber, r.rsmName, r.state, r.cnNumber ?? ""].join(" ").toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(() => {
    const t = filtered.reduce((s, r) => ({
      apLeads: s.apLeads + r.approvedLeads, acLeads: s.acLeads + r.actualLeads,
      apRetail: s.apRetail + r.approvedRetail, acRetail: s.acRetail + r.actualRetail,
      apBudget: s.apBudget + r.approvedBudget, acBudget: s.acBudget + (r.actualBudget ?? 0),
      processed: s.processed + (r.cnStatus === "CnProcessed" ? 1 : 0),
      pendingRsm: s.pendingRsm + (r.cnStatus === "SentForRsmApproval" ? 1 : 0),
      withAccounts: s.withAccounts + (r.cnStatus === "SentToAccounts" ? 1 : 0),
    }), { apLeads: 0, acLeads: 0, apRetail: 0, acRetail: 0, apBudget: 0, acBudget: 0, processed: 0, pendingRsm: 0, withAccounts: 0 });
    return t;
  }, [filtered]);

  const exportExcel = () => {
    // Sheet 1 — the 7-field Post-Activity Format (Actual)
    const fmt = filtered.map((r) => ({
      "Dealer Name": r.dealerName, "Activity Name": r.activityName,
      "Total Leads": r.actualLeads, "Total Retail": r.actualRetail,
      "Total Budget": r.actualBudget ?? "", "CPL": r.actualCpl ?? "", "CAC": r.actualCac ?? "",
    }));
    // Sheet 2 — Approved vs Actual with CN status
    const detail = filtered.map((r) => ({
      Token: r.tokenNumber, Dealer: r.dealerName, State: r.state, Month: r.month, Year: r.year, RSM: r.rsmName,
      Activity: r.activityName, Category: r.category ?? "",
      "Approved Leads": r.approvedLeads, "Actual Leads": r.actualLeads, "Leads Ach %": r.leadsAchievementPct,
      "Approved Retail": r.approvedRetail, "Actual Retail": r.actualRetail, "Retail Ach %": r.retailAchievementPct,
      "Approved Budget": r.approvedBudget, "Actual Budget": r.actualBudget ?? "",
      "Approved CPL": r.approvedCpl, "Actual CPL": r.actualCpl ?? "",
      "Approved CAC": r.approvedCac, "Actual CAC": r.actualCac ?? "",
      "Photos": r.photoCount, "Vendor Invoices": r.vendorInvoiceCount, "BGauss Invoice": r.hasFinalInvoice ? "Yes" : "No",
      "CN Status": CN_STATUS_META[r.cnStatus].label, "CN Number": r.cnNumber ?? "",
      "Leads Source": r.leadsSource, "Retail Source": r.retailSource,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fmt), "Post-Activity Format");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Approved vs Actual");
    const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
    XLSX.writeFile(wb, `CN_Tracker_${month === "All" ? "AllMonths" : month}_${year}_${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}.xlsx`);
  };

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1500, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "#0a2540" }}>CN Tracker</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>Approved activities · Approved vs Actual · Credit Note status</p>
        </div>
        <button onClick={exportExcel} disabled={filtered.length === 0}
          style={{ marginLeft: "auto", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px",
            fontWeight: 700, fontSize: 13, cursor: filtered.length ? "pointer" : "not-allowed", opacity: filtered.length ? 1 : 0.5 }}>
          ⬇ Export Excel
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={sel}>
          <option value="All">All months</option>{MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)} style={sel}>
          <option value="All">All years</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as "All" | CnStatus)} style={sel}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "All" ? "All CN statuses" : CN_STATUS_META[s].label}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dealer, activity, token, RSM, CN no…"
          style={{ ...sel, flex: "1 1 240px" }} />
        <button onClick={load} style={{ ...sel, cursor: "pointer", fontWeight: 600 }}>↻ Refresh</button>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 14 }}>
        <Kpi label="Activities" value={String(filtered.length)} sub={`${totals.processed} CN processed`} color="#0a2540" />
        <Kpi label="Leads (Actual / Approved)" value={`${totals.acLeads.toLocaleString("en-IN")} / ${totals.apLeads.toLocaleString("en-IN")}`}
          sub={totals.apLeads ? `${Math.round(totals.acLeads * 100 / totals.apLeads)}% achieved` : "—"} color="#0369a1" />
        <Kpi label="Retail (Actual / Approved)" value={`${totals.acRetail.toLocaleString("en-IN")} / ${totals.apRetail.toLocaleString("en-IN")}`}
          sub={totals.apRetail ? `${Math.round(totals.acRetail * 100 / totals.apRetail)}% achieved` : "—"} color="#7c3aed" />
        <Kpi label="Budget (Invoiced / Approved)" value={`${lakh(totals.acBudget)} / ${lakh(totals.apBudget)}`}
          sub="BGauss share" color="#16a34a" />
        <Kpi label="Pipeline" value={`${totals.pendingRsm} RSM · ${totals.withAccounts} Accounts`} sub="awaiting action" color="#f59e0b" />
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Loading…</div>}
      {error && <div style={{ padding: 14, background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>⚠ {error}</div>}

      {!loading && !error && (
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1350 }}>
            <thead>
              <tr style={{ background: "#0a2540" }}>
                {["Token","Dealer","Month","Activity","RSM","Leads A / P","Retail A / P","Budget Inv / Appr","CPL A / P","CAC A / P","Docs","CN Status"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", color: "#e2e8f0", fontSize: 10, textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No approved activities for these filters.</td></tr>
              )}
              {filtered.map((r, i) => {
                const meta = CN_STATUS_META[r.cnStatus];
                return (
                  <tr key={r.activityId} style={{ background: i % 2 ? "#f8fafc" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
                    <td style={td}><span style={{ fontFamily: "monospace", color: "#1e3a5f", fontWeight: 600 }}>{r.tokenNumber}</span></td>
                    <td style={td}><div style={{ fontWeight: 600, color: "#0a2540" }}>{r.dealerName}</div><div style={{ fontSize: 10, color: "#6b7280" }}>{r.state}</div></td>
                    <td style={td}>{r.month} {r.year}</td>
                    <td style={td}>{r.activityName}{r.category && <span style={{ fontSize: 10, color: "#6b7280" }}> · {r.category}</span>}</td>
                    <td style={td}>{r.rsmName}</td>
                    <td style={td}><b>{r.actualLeads}</b> / {r.approvedLeads} <span style={{ color: achColor(r.leadsAchievementPct), fontSize: 10, fontWeight: 700 }}>{r.leadsAchievementPct}%</span></td>
                    <td style={td}><b>{r.actualRetail}</b> / {r.approvedRetail} <span style={{ color: achColor(r.retailAchievementPct), fontSize: 10, fontWeight: 700 }}>{r.retailAchievementPct}%</span></td>
                    <td style={td}><b>{inr(r.actualBudget)}</b> / {inr(r.approvedBudget)}</td>
                    <td style={td}><b>{inr(r.actualCpl)}</b> / {inr(r.approvedCpl)}</td>
                    <td style={td}><b style={{ color: (r.actualCac ?? 0) > 4000 ? "#dc2626" : undefined }}>{inr(r.actualCac)}</b> / {inr(r.approvedCac)}</td>
                    <td style={td}>📸{r.photoCount} 🧾{r.vendorInvoiceCount} {r.hasFinalInvoice ? "✓Inv" : ""}</td>
                    <td style={td}>
                      <span style={{ background: meta.bg, color: meta.color, borderRadius: 10, padding: "2px 8px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{meta.label}</span>
                      {r.cnNumber && <div style={{ fontSize: 10, color: "#166534", marginTop: 2 }}>CN {r.cnNumber}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
        A = Actual, P = Approved (planned). Budget = BGauss share; Actual budget = amount on the dealer's invoice in BGauss's name.
        Actual leads/retail come from the Post-Activity daily entries.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: `3px solid ${color}`, borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>
    </div>
  );
}

const sel = { height: 34, padding: "0 10px", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 13, background: "#fff" } as const;
const td = { padding: "7px 10px", verticalAlign: "top" as const, whiteSpace: "nowrap" as const };

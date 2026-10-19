// src/components/DailyHistoryPanel.tsx
//
// Post-Activity "Daily Activity History" — the SAME columns, formulas and
// footer rows as ApproverDashboard (Microsoft login: Admin / User), shared by:
//   • DealerDashboard  (Dealer login)
//   • StaffDashboard   (RSM / TSM / Commando login)
//
// Columns: Date · Opening Stock · Canopy · Planned · Actual · Walk in · In LMS ·
//          Gap · Hot · Revised Hot · TD Planned · TD Actual · Booking Today ·
//          Booking In Hand · Retail · MTD Retail · Media
// Footer : TOTAL row + Avg Per Canopy row.
//
// Formulas (identical to ApproverDashboard):
//   Enquiry Planned  = 35 × Canopy      (read-only while Canopy > 0)
//   TD Planned       = 30 × Canopy
//   Gap              = In LMS − Enquiry Actual
//   Booking In Hand  = running Σ (Booking Today − Retail)
//   MTD Retail       = day-1 value entered manually, then previous + today's Retail
//
// Data is stored in ProposalActivities.DailyData (JSON) — same shape for every login,
// so a figure entered by a Dealer is shown unchanged to the Checker and vice-versa.

import type { CSSProperties, ChangeEvent } from "react";

export const DEFAULT_ENQ_PLAN_PER_SETUP = 35;
export const DEFAULT_TD_PLAN_PER_SETUP  = 30;

export interface DailyEntry {
  date: string;
  openingStock: number;
  setupCount: number;            // "Canopy"
  enquiryPlanned: number; enquiryActual: number;
  walkIn: number;
  inLms: number;
  enquiryGap: number;            // computed: inLms − enquiryActual
  enquiryHot: number;
  revisedHot: number;
  testDrivePlanned: number; testDriveActual: number; testDrivePerCanopy: number;
  bookingActual: number; bookingInHand: number;
  retailActual: number; retailMtdActivity: number; closingStock: number;
  retailMtd: number; retailRatePerCanopy: number;
  lmsLeads: number;
  leadsPunched: number;
}

export interface HistoryMedia {
  id: string; fileUrl: string; fileName: string; fileType: string; capturedAt: string;
}

const NUMERIC_KEYS: (keyof DailyEntry)[] = [
  "openingStock", "setupCount", "enquiryPlanned", "enquiryActual", "walkIn", "inLms",
  "enquiryGap", "enquiryHot", "revisedHot", "testDrivePlanned", "testDriveActual",
  "testDrivePerCanopy", "bookingActual", "bookingInHand", "retailActual", "retailMtdActivity",
  "closingStock", "retailMtd", "retailRatePerCanopy", "lmsLeads", "leadsPunched",
];

// Local-date helpers (no UTC shift in IST)
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseLocal = (v: string): Date | null => {
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
const fmtDate = (iso: string | null | undefined) =>
  !iso ? "—" : new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function emptyDailyEntry(date: string): DailyEntry {
  const e: any = { date };
  NUMERIC_KEYS.forEach((k) => { e[k] = 0; });
  return e as DailyEntry;
}

// ─── Derived columns (same as ApproverDashboard) ────────────────────────────
export function recalcEnquiryGap(entries: DailyEntry[]): DailyEntry[] {
  return entries.map((e) => ({ ...e, enquiryGap: (e.inLms || 0) - (e.enquiryActual || 0) }));
}
export function recalcBookingInHand(entries: DailyEntry[]): DailyEntry[] {
  let running = 0;
  return entries.map((e) => {
    running += (e.bookingActual || 0) - (e.retailMtdActivity || 0);
    return { ...e, bookingInHand: running };
  });
}
export function recalcRetailMtd(entries: DailyEntry[]): DailyEntry[] {
  let running = 0;
  return entries.map((e, i) => {
    if (i === 0) { running = e.retailMtd || 0; return e; }
    running += e.retailMtdActivity || 0;
    return { ...e, retailMtd: running };
  });
}
export const recalcAll = (entries: DailyEntry[]) =>
  recalcRetailMtd(recalcEnquiryGap(recalcBookingInHand(entries)));

// Accepts old Dealer/Staff JSON (setupCount, enquiry*, testDrive*, bookingActual,
// retailActual, leadsPunched only) and fills the missing Approver columns with 0.
// Old "retailActual" is carried into the "Retail" column when that column is empty.
export function normalizeDailyEntries(raw: unknown): DailyEntry[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw
    .filter((r: any) => r && typeof r.date === "string" && r.date.length >= 10)
    .map((r: any) => {
      const e: any = { ...emptyDailyEntry(r.date.slice(0, 10)), ...r, date: r.date.slice(0, 10) };
      NUMERIC_KEYS.forEach((k) => { e[k] = Number(e[k]) || 0; });
      if (!e.retailMtdActivity && e.retailActual) e.retailMtdActivity = e.retailActual;
      return e as DailyEntry;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return recalcAll(rows);
}

export function buildDailyEntries(start?: string | null, end?: string | null): DailyEntry[] {
  if (!start || !end) return [];
  const s = parseLocal(start), e = parseLocal(end);
  if (!s || !e) return [];
  const out: DailyEntry[] = [];
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(emptyDailyEntry(isoLocal(d)));
  return out;
}

// Saved DailyData first; otherwise blank rows for the actual (or planned) date range.
export function parseDailyData(dailyData: string | null | undefined, start?: string | null, end?: string | null): DailyEntry[] {
  if (dailyData) {
    try {
      const parsed = normalizeDailyEntries(JSON.parse(dailyData));
      if (parsed.length > 0) return parsed;
    } catch { /* fall through to blank rows */ }
  }
  return buildDailyEntries(start, end);
}

// One cell edit → updated, fully re-calculated rows.
export function applyDailyChange(entries: DailyEntry[], date: string, key: keyof DailyEntry, value: number): DailyEntry[] {
  const next = entries.map((e) => {
    if (e.date !== date) return e;
    const u: any = { ...e, [key]: value };
    if (key === "setupCount") {
      u.enquiryPlanned   = value * DEFAULT_ENQ_PLAN_PER_SETUP;
      u.testDrivePlanned = value * DEFAULT_TD_PLAN_PER_SETUP;
    }
    // Keep the legacy field in step so older readers of DailyData see the same Retail figure.
    if (key === "retailMtdActivity") u.retailActual = value;
    return u as DailyEntry;
  });
  return recalcAll(next);
}

// Actual Start/End changed → keep rows already filled, add/remove the rest.
// Incomplete range → keep existing rows (no data loss while the user is mid-edit).
export function rebuildDaily(existing: DailyEntry[], start: string, end: string): DailyEntry[] {
  if (!start || !end) return existing;
  const fresh = buildDailyEntries(start, end);
  return recalcAll(fresh.map((ne) => existing.find((e) => e.date === ne.date) ?? ne));
}

// ─── LMS chips shown above the Actual-date bar (same as ApproverDashboard) ──
export function LmsSummaryChips({ entries }: { entries: DailyEntry[] }) {
  const totalLmsLeads = entries.reduce((s, e) => s + (e.lmsLeads || 0), 0);
  const totalPunched  = entries.reduce((s, e) => s + (e.leadsPunched || 0), 0);
  const lmsGap = totalLmsLeads - totalPunched;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ fontSize: 11, background: "#eef2ff", color: "#4338ca", padding: "3px 9px", borderRadius: 5, fontWeight: 600 }}>LMS Leads: {totalLmsLeads}</span>
      <span style={{ fontSize: 11, background: "#eef2ff", color: "#4338ca", padding: "3px 9px", borderRadius: 5, fontWeight: 600 }}>LMS Punched: {totalPunched}</span>
      <span style={{ fontSize: 11, background: lmsGap > 0 ? "#fef2f2" : "#f0fdf4", color: lmsGap > 0 ? "#b91c1c" : "#166534", padding: "3px 9px", borderRadius: 5, fontWeight: 600 }}>LMS Gap: {lmsGap}</span>
    </div>
  );
}

function mediaIcon(t: string | null) {
  if (!t) return "📎";
  if (t.startsWith("image/")) return "🖼";
  if (t.includes("pdf")) return "📄";
  if (t.startsWith("video/")) return "🎬";
  return "📎";
}
const isImage = (t: string | null) => !!t?.startsWith("image/");

interface Props {
  entries: DailyEntry[];
  actualStartDate: string;
  actualEndDate: string;
  proofMedia: HistoryMedia[];
  invoiceMedia: HistoryMedia[];
  resolveUrl: (url: string) => string;
  onChange: (date: string, key: keyof DailyEntry, value: number) => void;
  onDateUpload: (date: string, files: FileList) => void;
  onViewMedia: (m: { url: string; name: string; type: string }) => void;
}

const numIn = (extra: CSSProperties = {}): CSSProperties => ({
  width: 48, textAlign: "center", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", ...extra,
});
const th = (color: string, extra: CSSProperties = {}): CSSProperties => ({
  padding: "8px 8px", textAlign: "center", color, fontSize: 10, fontWeight: 700, ...extra,
});

export default function DailyHistoryPanel({
  entries, actualStartDate, actualEndDate, proofMedia, invoiceMedia,
  resolveUrl, onChange, onDateUpload, onViewMedia,
}: Props) {
  const sum = (k: keyof DailyEntry) => entries.reduce((s, e) => s + (Number(e[k]) || 0), 0);
  const totalCanopy = sum("setupCount");
  const avg = (v: number) => (totalCanopy > 0 ? Math.round((v / totalCanopy) * 10) / 10 : 0);
  const avgTd = (v: number | string, c = "#92400e") => (
    <td style={{ padding: "6px", textAlign: "center", fontWeight: 700, fontSize: 11, color: c, background: "#fef9c3" }}>{v}</td>
  );
  const blank = <td style={{ background: "#fef9c3" }} />;
  const totTd = (v: number | string, color: string) => (
    <td style={{ padding: "7px 6px", textAlign: "center", fontWeight: 700, fontSize: 12, color }}>{v}</td>
  );

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden", marginBottom: 10 }}>
      <div style={{ background: "#0a2540", padding: "9px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>📊 Daily Activity History</span>
        <span style={{ color: "#94a3b8", fontSize: 11 }}>{fmtDate(actualStartDate)} → {fmtDate(actualEndDate)}</span>
        {entries.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "#86efac", fontWeight: 600 }}>{entries.length} day{entries.length !== 1 ? "s" : ""}</span>}
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No entries yet for this date range.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1600 }}>
            <thead>
              <tr style={{ background: "#1e293b" }}>
                <th style={th("#e2e8f0", { padding: "8px 10px", textAlign: "left", width: 95 })}>Date</th>
                <th style={th("#e2e8f0")}>Opening<br />Stock</th>
                <th style={th("#fde68a")}>Canopy</th>
                <th style={th("#93c5fd")}>Planned</th>
                <th style={th("#6ee7b7")}>Actual</th>
                <th style={th("#a7f3d0")}>Walk in</th>
                <th style={th("#a7f3d0")}>In LMS</th>
                <th style={th("#fca5a5")}>Gap</th>
                <th style={th("#fca5a5")}>Hot</th>
                <th style={th("#fca5a5")}>Revised<br />Hot</th>
                <th style={th("#93c5fd")}>TD<br />Planned</th>
                <th style={th("#6ee7b7")}>TD<br />Actual</th>
                <th style={th("#c4b5fd")}>Booking<br />Today</th>
                <th style={th("#c4b5fd")}>Booking<br />In Hand</th>
                <th style={th("#fbbf24")}>Retail</th>
                <th style={th("#fcd34d")}>MTD<br />Retail</th>
                <th style={th("#e2e8f0")}>Media</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, ei) => {
                const day = entry.date;
                const photosOnDay   = proofMedia.filter((m) => m.capturedAt.startsWith(day));
                const invoicesOnDay = invoiceMedia.filter((m) => m.capturedAt.startsWith(day));
                const hasAnyData = entry.enquiryActual > 0 || entry.testDriveActual > 0 || entry.bookingActual > 0
                  || entry.retailMtdActivity > 0 || entry.retailActual > 0 || photosOnDay.length > 0 || invoicesOnDay.length > 0;
                const sc = entry.setupCount || 0;
                const gapColor = entry.enquiryGap < 0 ? "#dc2626" : entry.enquiryGap > 0 ? "#16a34a" : "#64748b";
                const set = (k: keyof DailyEntry) => (e: ChangeEvent<HTMLInputElement>) =>
                  onChange(day, k, parseInt(e.target.value) || 0);
                const cell = { padding: "4px 5px", textAlign: "center" as const };
                return (
                  <tr key={day} style={{ background: ei % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9", opacity: hasAnyData ? 1 : 0.5 }}>
                    <td style={{ padding: "5px 10px", fontWeight: 600, color: "#374151", whiteSpace: "nowrap", fontSize: 11 }}>{day}</td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ border: "1px solid #e2e8f0", background: "#f8fafc" })}
                        value={entry.openingStock || ""} placeholder="0" onChange={set("openingStock")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} max={20}
                        style={numIn({ width: 40, padding: "2px", border: "1px solid #fde68a", background: "#fefce8", fontWeight: 700 })}
                        value={sc || ""} placeholder="0"
                        title="Canopy — Enquiry Plan = 35 × count, TD Plan = 30 × count"
                        onChange={set("setupCount")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} readOnly={sc > 0}
                        style={numIn({ border: "1px solid #e2e8f0", background: "#f8fafc", color: sc > 0 ? "#1e40af" : "inherit", fontWeight: sc > 0 ? 700 : 400 })}
                        value={entry.enquiryPlanned || ""} placeholder="0"
                        title={sc > 0 ? "Auto-calculated (35 × Canopy)" : "Enter manually"}
                        onChange={(e) => { if (!sc) onChange(day, "enquiryPlanned", parseInt(e.target.value) || 0); }} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ border: "1px solid #bbf7d0", fontWeight: entry.enquiryActual > 0 ? 700 : 400 })}
                        value={entry.enquiryActual || ""} placeholder="0" onChange={set("enquiryActual")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ width: 44, border: "1px solid #a7f3d0", background: entry.walkIn > 0 ? "#ecfdf5" : "#fff" })}
                        value={entry.walkIn || ""} placeholder="0" onChange={set("walkIn")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ border: "1px solid #a7f3d0", background: entry.inLms > 0 ? "#ecfdf5" : "#fff", fontWeight: entry.inLms > 0 ? 700 : 400 })}
                        value={entry.inLms || ""} placeholder="0" title="Manual — drives Gap = In LMS − Actual" onChange={set("inLms")} />
                    </td>

                    <td style={{ ...cell, fontSize: 11, fontWeight: 700, color: gapColor }}>{entry.enquiryGap ?? 0}</td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ width: 44, border: "1px solid #fecaca", background: entry.enquiryHot > 0 ? "#fef2f2" : "#fff", fontWeight: entry.enquiryHot > 0 ? 700 : 400, color: entry.enquiryHot > 0 ? "#b91c1c" : "inherit" })}
                        value={entry.enquiryHot || ""} placeholder="0" onChange={set("enquiryHot")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ width: 44, border: "1px solid #fecaca", background: entry.revisedHot > 0 ? "#fef2f2" : "#fff", fontWeight: entry.revisedHot > 0 ? 700 : 400, color: entry.revisedHot > 0 ? "#b91c1c" : "inherit" })}
                        value={entry.revisedHot || ""} placeholder="0" onChange={set("revisedHot")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ border: "1px solid #e2e8f0", background: "#f8fafc" })}
                        value={entry.testDrivePlanned || ""} placeholder="0" onChange={set("testDrivePlanned")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ border: "1px solid #bbf7d0", fontWeight: entry.testDriveActual > 0 ? 700 : 400 })}
                        value={entry.testDriveActual || ""} placeholder="0" onChange={set("testDriveActual")} />
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ border: "1px solid #e9d5ff", background: entry.bookingActual > 0 ? "#fdf4ff" : "#fff", fontWeight: entry.bookingActual > 0 ? 700 : 400, color: entry.bookingActual > 0 ? "#7c3aed" : "inherit" })}
                        value={entry.bookingActual || ""} placeholder="0" onChange={set("bookingActual")} />
                    </td>

                    <td style={cell}>
                      <div title="Auto: running (Booking Today − Retail)"
                        style={{ width: 48, margin: "0 auto", border: "1px solid #e9d5ff", borderRadius: 4, padding: "3px", fontSize: 11,
                          background: entry.bookingInHand > 0 ? "#fdf4ff" : "#fff", fontWeight: entry.bookingInHand > 0 ? 700 : 400,
                          color: entry.bookingInHand > 0 ? "#7c3aed" : "#9ca3af" }}>
                        {entry.bookingInHand ?? 0} 🔒
                      </div>
                    </td>

                    <td style={cell}>
                      <input type="number" min={0} style={numIn({ width: 50, border: "1px solid #fcd34d", background: "#fffbeb", fontWeight: entry.retailMtdActivity > 0 ? 700 : 400, color: entry.retailMtdActivity > 0 ? "#92400e" : "inherit" })}
                        value={entry.retailMtdActivity || ""} placeholder="0" title="Manual — Retail for this day" onChange={set("retailMtdActivity")} />
                    </td>

                    <td style={cell}>
                      {ei === 0 ? (
                        <input type="number" min={0} style={numIn({ width: 50, border: "1px solid #f59e0b", background: "#fffbeb", fontWeight: 700, color: "#92400e" })}
                          value={entry.retailMtd || ""} placeholder="0"
                          title="Starting MTD Retail — seeds the running total for all following days"
                          onChange={set("retailMtd")} />
                      ) : (
                        <div title="Auto: previous day's MTD Retail + today's Retail"
                          style={{ width: 50, margin: "0 auto", border: "1px solid #fde68a", borderRadius: 4, padding: "3px", fontSize: 11,
                            background: entry.retailMtd > 0 ? "#fffbeb" : "#fff", fontWeight: entry.retailMtd > 0 ? 700 : 400,
                            color: entry.retailMtd > 0 ? "#92400e" : "#9ca3af" }}>
                          {entry.retailMtd ?? 0} 🔒
                        </div>
                      )}
                    </td>

                    <td style={{ padding: "4px 8px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
                        {photosOnDay.slice(0, 2).map((m) => {
                          const url = resolveUrl(m.fileUrl);
                          return (
                            <div key={m.id} onClick={() => onViewMedia({ url, name: m.fileName, type: m.fileType })}
                              style={{ width: 26, height: 26, borderRadius: 3, overflow: "hidden", cursor: "pointer", border: "1px solid #bbf7d0", flexShrink: 0 }}>
                              {isImage(m.fileType)
                                ? <img src={url} alt={m.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <span style={{ fontSize: 14, lineHeight: "26px", display: "block", textAlign: "center" }}>{mediaIcon(m.fileType)}</span>}
                            </div>
                          );
                        })}
                        {photosOnDay.length > 2 && <span style={{ fontSize: 9, color: "#16a34a", fontWeight: 700 }}>+{photosOnDay.length - 2}</span>}
                        {invoicesOnDay.length > 0 && <span style={{ fontSize: 10, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 3, padding: "1px 4px", color: "#374151", whiteSpace: "nowrap" }}>🧾{invoicesOnDay.length}</span>}
                        {photosOnDay.length === 0 && invoicesOnDay.length === 0 && <span style={{ color: "#e2e8f0", fontSize: 10 }}>—</span>}
                        <label title={`Upload photo for ${day}`} style={{ cursor: "pointer", fontSize: 11, color: "#60a5fa", marginLeft: 2 }}>
                          📷
                          <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }}
                            onChange={(ev) => {
                              if (!ev.target.files?.length) return;
                              onDateUpload(day, ev.target.files);
                              ev.target.value = "";
                            }} />
                        </label>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: "#0a2540", borderTop: "2px solid #1e3a5f" }}>
                <td style={{ padding: "7px 10px", fontWeight: 800, color: "#fbbf24", fontSize: 11 }}>TOTAL</td>
                {totTd("—", "#e2e8f0")}
                {totTd(totalCanopy, "#fde68a")}
                {totTd(sum("enquiryPlanned"), "#93c5fd")}
                {totTd(sum("enquiryActual"), "#6ee7b7")}
                {totTd(sum("walkIn"), "#a7f3d0")}
                {totTd(sum("inLms"), "#a7f3d0")}
                {totTd(sum("enquiryGap"), "#fca5a5")}
                {totTd(sum("enquiryHot"), "#fca5a5")}
                {totTd(sum("revisedHot"), "#fca5a5")}
                {totTd(sum("testDrivePlanned"), "#93c5fd")}
                {totTd(sum("testDriveActual"), "#6ee7b7")}
                {totTd(sum("bookingActual"), "#c4b5fd")}
                {totTd(entries.length ? (entries[entries.length - 1].bookingInHand ?? 0) : 0, "#c4b5fd")}
                {totTd(sum("retailMtdActivity"), "#fbbf24")}
                <td />
                <td style={{ padding: "7px 8px", textAlign: "center" }}>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>
                    {proofMedia.length > 0 && `📸${proofMedia.length} `}{invoiceMedia.length > 0 && `🧾${invoiceMedia.length}`}
                  </span>
                </td>
              </tr>
              <tr style={{ background: "#fef9c3" }}>
                <td style={{ padding: "6px 10px", fontWeight: 700, color: "#92400e", fontSize: 11 }}>Avg Per Canopy</td>
                <td /><td />
                {avgTd(avg(sum("enquiryPlanned")))}
                {avgTd(avg(sum("enquiryActual")))}
                {avgTd(avg(sum("walkIn")))}
                {blank}{blank}
                {avgTd(avg(sum("enquiryHot")))}
                {avgTd(avg(sum("revisedHot")))}
                {blank}
                {avgTd(avg(sum("testDriveActual")))}
                {avgTd(avg(sum("bookingActual")))}
                {blank}
                {avgTd(avg(sum("retailMtdActivity")))}
                {blank}{blank}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div style={{ padding: "7px 14px", fontSize: 11, color: "#6b7280", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
        ℹ Green ≥90% · Yellow ≥60% · Red &lt;60% · Dim rows = no data yet
      </div>
    </div>
  );
}

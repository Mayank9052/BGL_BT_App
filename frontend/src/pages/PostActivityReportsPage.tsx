// src/pages/PostActivityReportsPage.tsx
//
// Post-Activity reporting — answers Shivam's review points 2A–2E:
//   2A  BTL Activity Report  → Daily / MTD / custom date range (not proposal-wise)
//   2B  Date filter + MULTI-select activity types
//   2C  PPT daily report: (1) Daily Activity Summary dealer-wise
//                         (2) Dealer-wise Activity-wise MTD
//                         (3) GPS pictures of that day
//   2D  Lead Report (from Post-Activity daily entries: Enquiry / Walk-in / In LMS / Gap / Hot / TD / Booking)
//   2E  Proposed vs Actual — State → Dealer: Leads, Retail, Budget, Actual amount (CN invoice)
//
// Data source: GET /api/proposals (Approved only) — activities + DailyData JSON + media (GPS),
//              GET /api/cn/report — CN invoice amount per activity (actual amount used).
// Retail per day = "Retail" column of the daily table (retailMtdActivity; legacy retailActual fallback).

import { useEffect, useMemo, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import * as XLSX from "xlsx";
import pptxgen from "pptxgenjs";
import { fetchProposals, type ProposalResponse, type ActivityResponse } from "../services/proposalService";
import { fetchCnReport } from "../services/cnService";

// ─── helpers ──────────────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const resolveUrl = (u: string) => (u.startsWith("http") ? u : `${API_BASE}${u.startsWith("/") ? u : `/${u}`}`);
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ddmmyyyy = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");
const n0 = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : "—");
const TODAY = isoLocal(new Date());

type Period = "daily" | "mtd" | "range";
type Tab = "report" | "summary" | "leads";

interface Day {
  date: string; setupCount: number; enquiryPlanned: number; enquiryActual: number; walkIn: number;
  inLms: number; enquiryGap: number; enquiryHot: number; revisedHot: number;
  testDrivePlanned: number; testDriveActual: number; bookingActual: number; retail: number;
}
interface Photo { id: string; url: string; name: string; date: string; capturedAt: string; lat: number | null; lng: number | null; }
interface ActRow {
  p: ProposalResponse; a: ActivityResponse; days: Day[]; photos: Photo[];
  bgAmt: number;            // approved BGauss amount = (budget + add.) × share%
  cnAmount: number | null;  // CN / BGauss invoice amount (actual amount used)
}
interface Agg {
  days: number; canopy: number; enqPlan: number; enqAct: number; walkIn: number; inLms: number;
  hot: number; revHot: number; tdPlan: number; tdAct: number; booking: number; retail: number;
}

function parseDays(raw: unknown): Day[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r.date === "string")
      .map((r) => ({
        date: String(r.date).slice(0, 10),
        setupCount: n0(r.setupCount), enquiryPlanned: n0(r.enquiryPlanned), enquiryActual: n0(r.enquiryActual),
        walkIn: n0(r.walkIn), inLms: n0(r.inLms), enquiryGap: n0(r.inLms) - n0(r.enquiryActual),
        enquiryHot: n0(r.enquiryHot), revisedHot: n0(r.revisedHot),
        testDrivePlanned: n0(r.testDrivePlanned), testDriveActual: n0(r.testDriveActual),
        bookingActual: n0(r.bookingActual),
        retail: n0(r.retailMtdActivity) || n0(r.retailActual),
      }));
  } catch { return []; }
}

const hasData = (d: Day) =>
  d.setupCount + d.enquiryActual + d.walkIn + d.inLms + d.enquiryHot + d.testDriveActual + d.bookingActual + d.retail > 0;

function agg(days: Day[]): Agg {
  const a: Agg = { days: 0, canopy: 0, enqPlan: 0, enqAct: 0, walkIn: 0, inLms: 0, hot: 0, revHot: 0, tdPlan: 0, tdAct: 0, booking: 0, retail: 0 };
  for (const d of days) {
    if (hasData(d)) a.days++;
    a.canopy += d.setupCount; a.enqPlan += d.enquiryPlanned; a.enqAct += d.enquiryActual; a.walkIn += d.walkIn;
    a.inLms += d.inLms; a.hot += d.enquiryHot; a.revHot += d.revisedHot; a.tdPlan += d.testDrivePlanned;
    a.tdAct += d.testDriveActual; a.booking += d.bookingActual; a.retail += d.retail;
  }
  return a;
}
const addAgg = (x: Agg, y: Agg): Agg => {
  const r = { ...x };
  (Object.keys(r) as (keyof Agg)[]).forEach((k) => { r[k] = x[k] + y[k]; });
  return r;
};
const emptyAgg = (): Agg => agg([]);

// image URL → data URL (for PPT). Same-origin /uploads, so no CORS issue in production.
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ─── Multi-select dropdown (2B) ───────────────────────────────────────────────
function MultiSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  const text = value.length === 0 ? `All ${label}` : value.length === 1 ? value[0] : `${value.length} ${label} selected`;
  return (
    <div ref={ref} style={{ position: "relative", minWidth: 220 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...sel, width: "100%", textAlign: "left", cursor: "pointer" }}>
        {text} <span style={{ float: "right", color: "#9ca3af" }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#fff",
          border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", maxHeight: 300, overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 8, padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
            <button type="button" style={linkBtn} onClick={() => onChange(options)}>Select all</button>
            <button type="button" style={linkBtn} onClick={() => onChange([])}>Clear</button>
          </div>
          {options.map((o) => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {o}
            </label>
          ))}
          {options.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#9ca3af" }}>No options</div>}
        </div>
      )}
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────
const sel: React.CSSProperties = { height: 34, padding: "0 10px", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 12, background: "#fff", color: "#0a2540" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#2563eb", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 };
const th: React.CSSProperties = { padding: "8px 8px", color: "#e2e8f0", fontSize: 10, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" };
const thL: React.CSSProperties = { ...th, textAlign: "left" };
const td: React.CSSProperties = { padding: "6px 8px", fontSize: 12, textAlign: "right", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };
const tdL: React.CSSProperties = { ...td, textAlign: "left" };
const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" });

// ═════════════════════════════════════════════════════════════════════════════
export default function PostActivityReportsPage() {
  const { instance } = useMsal();
  const [proposals, setProposals] = useState<ProposalResponse[]>([]);
  const [cnByActivity, setCnByActivity] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("report");
  const [period, setPeriod] = useState<Period>("daily");
  const [date, setDate] = useState(TODAY);
  const [from, setFrom] = useState(TODAY.slice(0, 8) + "01");
  const [to, setTo] = useState(TODAY);
  const [stateF, setStateF] = useState("All");
  const [dealerF, setDealerF] = useState("All");
  const [actF, setActF] = useState<string[]>([]);
  const [pptBusy, setPptBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchProposals(instance),
      fetchCnReport({} as Parameters<typeof fetchCnReport>[0]).catch(() => [] as unknown[]),
    ])
      .then(([props, cn]) => {
        setProposals(props.filter((p) => p.status === "Approved"));
        const m = new Map<string, number>();
        (cn as unknown[]).forEach((r) => {
          const row = r as { activityId?: string; actualBudget?: number | null; cnInvoiceAmount?: number | null };
          const amt = row.actualBudget ?? row.cnInvoiceAmount;
          if (row.activityId && typeof amt === "number") m.set(row.activityId, amt);
        });
        setCnByActivity(m);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load proposals."))
      .finally(() => setLoading(false));
  }, [instance]);

  // ── period → date range ──
  const range = useMemo(() => {
    if (period === "daily") return { from: date, to: date };
    if (period === "mtd")   return { from: date.slice(0, 8) + "01", to: date };
    return from <= to ? { from, to } : { from: to, to: from };
  }, [period, date, from, to]);
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const periodLabel = period === "daily" ? `Daily · ${ddmmyyyy(range.to)}`
    : period === "mtd" ? `MTD · ${ddmmyyyy(range.from)} – ${ddmmyyyy(range.to)}`
    : `${ddmmyyyy(range.from)} – ${ddmmyyyy(range.to)}`;

  // ── flatten to activity rows ──
  const allRows: ActRow[] = useMemo(() => proposals.flatMap((p) => p.activities.map((a) => {
    const share = n0(a.bgaussShare) || 100;
    const photos: Photo[] = (a.mediaFiles ?? [])
      .filter((m) => m.fileType?.startsWith("image/"))
      .map((m) => {
        const at = m.capturedAt ?? "";
        return { id: m.id, url: resolveUrl(m.fileUrl), name: m.fileName, capturedAt: at,
          date: at ? isoLocal(new Date(at)) : "", lat: m.latitude ?? null, lng: m.longitude ?? null };
      });
    return {
      p, a, photos,
      days: parseDays((a as unknown as { dailyData?: string | null }).dailyData),
      bgAmt: Math.round((n0(a.budget) + n0(a.additionalBudget)) * share / 100),
      cnAmount: cnByActivity.get(a.id) ?? null,
    };
  })), [proposals, cnByActivity]);

  const states = useMemo(() => ["All", ...Array.from(new Set(allRows.map((r) => r.p.state).filter(Boolean))).sort()], [allRows]);
  const dealers = useMemo(() => ["All", ...Array.from(new Set(allRows
    .filter((r) => stateF === "All" || r.p.state === stateF).map((r) => r.p.dealerName))).sort()], [allRows, stateF]);
  const activityTypes = useMemo(() => Array.from(new Set(allRows.map((r) => r.a.activityType))).sort(), [allRows]);

  const rows = useMemo(() => allRows.filter((r) =>
    (stateF === "All" || r.p.state === stateF) &&
    (dealerF === "All" || r.p.dealerName === dealerF) &&
    (actF.length === 0 || actF.includes(r.a.activityType))), [allRows, stateF, dealerF, actF]);

  // ── 2A: activity report rows (only rows with data or photos in range) ──
  const reportRows = useMemo(() => rows.map((r) => ({
    r, g: agg(r.days.filter((d) => inRange(d.date))), photos: r.photos.filter((ph) => inRange(ph.date)).length,
  })).filter((x) => x.g.days > 0 || x.photos > 0)
    .sort((x, y) => x.r.p.state.localeCompare(y.r.p.state) || x.r.p.dealerName.localeCompare(y.r.p.dealerName)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, range.from, range.to]);
  const reportTotal = useMemo(() => reportRows.reduce((s, x) => addAgg(s, x.g), emptyAgg()), [reportRows]);
  const reportPhotos = reportRows.reduce((s, x) => s + x.photos, 0);

  // ── 2E: proposed vs actual — activities whose planned dates overlap the range ──
  const summary = useMemo(() => {
    type Line = { state: string; dealer: string; leadT: number; leadA: number; retT: number; retA: number; budget: number; actualAmt: number; cnCount: number; acts: number };
    const map = new Map<string, Line>();
    for (const r of rows) {
      const s = r.a.startDate?.slice(0, 10) ?? "", e = r.a.endDate?.slice(0, 10) ?? s;
      if (s && (e < range.from || s > range.to)) continue;
      const key = `${r.p.state}||${r.p.dealerName}`;
      const l = map.get(key) ?? { state: r.p.state, dealer: r.p.dealerName, leadT: 0, leadA: 0, retT: 0, retA: 0, budget: 0, actualAmt: 0, cnCount: 0, acts: 0 };
      const g = agg(r.days.filter((d) => inRange(d.date)));
      l.leadT += n0(r.a.leadTarget); l.leadA += g.enqAct;
      l.retT += n0(r.a.retailTarget); l.retA += g.retail;
      l.budget += r.bgAmt; l.acts++;
      if (r.cnAmount !== null) { l.actualAmt += r.cnAmount; l.cnCount++; }
      map.set(key, l);
    }
    const lines = Array.from(map.values()).sort((a, b) => a.state.localeCompare(b.state) || a.dealer.localeCompare(b.dealer));
    const byState = new Map<string, typeof lines>();
    lines.forEach((l) => byState.set(l.state, [...(byState.get(l.state) ?? []), l]));
    return byState;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range.from, range.to]);

  // ── 2D: lead rows (date × dealer × activity) ──
  const leadRows = useMemo(() => rows.flatMap((r) => r.days.filter((d) => inRange(d.date) && hasData(d)).map((d) => ({ r, d })))
    .sort((x, y) => x.d.date.localeCompare(y.d.date) || x.r.p.dealerName.localeCompare(y.r.p.dealerName)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, range.from, range.to]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // ── Excel export (current tab) ──
  const exportExcel = () => {
    let aoa: (string | number)[][] = [];
    let sheet = "";
    if (tab === "report") {
      sheet = "BTL Activity Report";
      aoa = [["State", "Dealer", "Activity", "Days", "Canopy", "Enquiry Plan", "Enquiry Actual", "Walk-in", "TD Actual", "Booking", "Retail", "Photos"],
        ...reportRows.map(({ r, g, photos }) => [r.p.state, r.p.dealerName, r.a.activityType, g.days, g.canopy, g.enqPlan, g.enqAct, g.walkIn, g.tdAct, g.booking, g.retail, photos]),
        ["TOTAL", "", "", reportTotal.days, reportTotal.canopy, reportTotal.enqPlan, reportTotal.enqAct, reportTotal.walkIn, reportTotal.tdAct, reportTotal.booking, reportTotal.retail, reportPhotos]];
    } else if (tab === "summary") {
      sheet = "Proposed vs Actual";
      aoa = [["State", "Dealer", "Activities", "Lead Target", "Leads Actual", "Lead %", "Retail Target", "Retail Actual", "Retail %", "Approved BGauss Budget (₹)", "Actual Amount – CN (₹)", "Utilisation %"]];
      summary.forEach((lines) => lines.forEach((l) => aoa.push([l.state, l.dealer, l.acts, l.leadT, l.leadA, pct(l.leadA, l.leadT), l.retT, l.retA, pct(l.retA, l.retT), l.budget, l.actualAmt, pct(l.actualAmt, l.budget)])));
    } else {
      sheet = "Lead Report";
      aoa = [["Date", "State", "Dealer", "Activity", "Enquiry Actual", "Walk-in", "In LMS", "Gap (LMS − Actual)", "Hot", "Revised Hot", "TD Actual", "Booking"],
        ...leadRows.map(({ r, d }) => [ddmmyyyy(d.date), r.p.state, r.p.dealerName, r.a.activityType, d.enquiryActual, d.walkIn, d.inLms, d.enquiryGap, d.enquiryHot, d.revisedHot, d.testDriveActual, d.bookingActual])];
    }
    const ws = XLSX.utils.aoa_to_sheet([[`BGauss BTL — ${sheet} — ${periodLabel}`], [], ...aoa]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
    XLSX.writeFile(wb, `BTL_${sheet.replace(/\W+/g, "_")}_${range.from}_${range.to}.xlsx`);
  };

  // ── 2C: PPT daily report (day = selected date; section 2 = MTD up to that day) ──
  const exportPpt = async () => {
    setPptBusy(true);
    try {
      const day = period === "range" ? range.to : date;
      const mtdFrom = day.slice(0, 8) + "01";
      const pptx = new pptxgen();
      pptx.layout = "LAYOUT_WIDE";            // 13.33 × 7.5 in
      const NAVY = "0A2540";
      const head = (cells: string[]) => cells.map((t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 10 } }));
      const title = (s: pptxgen.Slide, t: string, sub: string) => {
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.8, fill: { color: NAVY } });
        s.addText(t, { x: 0.4, y: 0.1, w: 10, h: 0.4, fontSize: 20, bold: true, color: "FFFFFF" });
        s.addText(sub, { x: 0.4, y: 0.48, w: 12, h: 0.28, fontSize: 11, color: "CBD5E1" });
      };
      const filtersText = [stateF !== "All" ? `State: ${stateF}` : "All states", dealerF !== "All" ? `Dealer: ${dealerF}` : "All dealers",
        actF.length ? `Activities: ${actF.join(", ")}` : "All activities"].join(" · ");

      // Cover
      const cover = pptx.addSlide();
      cover.background = { color: NAVY };
      cover.addText("BGauss BTL — Daily Activity Report", { x: 0.6, y: 2.4, w: 12, h: 0.8, fontSize: 32, bold: true, color: "FFFFFF" });
      cover.addText(ddmmyyyy(day), { x: 0.6, y: 3.2, w: 12, h: 0.6, fontSize: 22, color: "86EFAC" });
      cover.addText(filtersText, { x: 0.6, y: 3.9, w: 12, h: 0.4, fontSize: 12, color: "CBD5E1" });

      // Section 1 — Daily Activity Summary, dealer-wise (that day)
      const dealerDay = new Map<string, { state: string; dealer: string; acts: Set<string>; g: Agg; photos: number }>();
      rows.forEach((r) => {
        const g = agg(r.days.filter((d) => d.date === day));
        const ph = r.photos.filter((p) => p.date === day).length;
        if (g.days === 0 && ph === 0) return;
        const k = `${r.p.state}||${r.p.dealerName}`;
        const x = dealerDay.get(k) ?? { state: r.p.state, dealer: r.p.dealerName, acts: new Set<string>(), g: emptyAgg(), photos: 0 };
        x.acts.add(r.a.activityType); x.g = addAgg(x.g, g); x.photos += ph;
        dealerDay.set(k, x);
      });
      const s1 = Array.from(dealerDay.values()).sort((a, b) => a.state.localeCompare(b.state) || a.dealer.localeCompare(b.dealer));
      const s1Head = head(["State", "Dealer", "Activities", "Canopy", "Enq Plan", "Enq Actual", "Walk-in", "TD", "Booking", "Retail", "Photos"]);
      const PER = 13;
      for (let i = 0; i < Math.max(1, s1.length); i += PER) {
        const s = pptx.addSlide();
        title(s, "1. Daily Activity Summary — Dealer-wise", `${ddmmyyyy(day)} · ${filtersText}${s1.length > PER ? ` · page ${i / PER + 1}` : ""}`);
        const body = s1.slice(i, i + PER).map((x) => [x.state, x.dealer, Array.from(x.acts).join(", "), x.g.canopy, x.g.enqPlan, x.g.enqAct, x.g.walkIn, x.g.tdAct, x.g.booking, x.g.retail, x.photos]
          .map((v) => ({ text: String(v), options: { fontSize: 9 } })));
        if (body.length === 0) s.addText("No activity data entered for this day.", { x: 0.4, y: 1.2, w: 12, h: 0.4, fontSize: 14, color: "64748B" });
        else s.addTable([s1Head, ...body], { x: 0.3, y: 1.0, w: 12.7, colW: [1.2, 2.4, 2.5, 0.7, 0.8, 0.9, 0.8, 0.6, 0.8, 0.7, 0.7], border: { type: "solid", color: "CBD5E1", pt: 0.5 } });
      }

      // Section 2 — Dealer-wise Activity-wise MTD
      const s2 = rows.map((r) => ({ r, g: agg(r.days.filter((d) => d.date >= mtdFrom && d.date <= day)) }))
        .filter((x) => x.g.days > 0)
        .sort((a, b) => a.r.p.dealerName.localeCompare(b.r.p.dealerName) || a.r.a.activityType.localeCompare(b.r.a.activityType));
      const s2Head = head(["Dealer", "Activity", "Days", "Enquiry", "TD", "Booking", "Retail", "BGauss Budget", "CPL", "CAC"]);
      for (let i = 0; i < Math.max(1, s2.length); i += PER) {
        const s = pptx.addSlide();
        title(s, "2. Dealer-wise Activity-wise Report — MTD", `${ddmmyyyy(mtdFrom)} – ${ddmmyyyy(day)}${s2.length > PER ? ` · page ${i / PER + 1}` : ""}`);
        const body = s2.slice(i, i + PER).map(({ r, g }) => [r.p.dealerName, r.a.activityType, g.days, g.enqAct, g.tdAct, g.booking, g.retail, inr(r.bgAmt),
          g.enqAct > 0 ? inr(r.bgAmt / g.enqAct) : "—", g.retail > 0 ? inr(r.bgAmt / g.retail) : "—"]
          .map((v) => ({ text: String(v), options: { fontSize: 9 } })));
        if (body.length === 0) s.addText("No MTD activity data.", { x: 0.4, y: 1.2, w: 12, h: 0.4, fontSize: 14, color: "64748B" });
        else s.addTable([s2Head, ...body], { x: 0.3, y: 1.0, w: 12.7, colW: [2.6, 2.4, 0.6, 0.9, 0.7, 0.9, 0.8, 1.4, 1.1, 1.2], border: { type: "solid", color: "CBD5E1", pt: 0.5 } });
        s.addText("CPL / CAC = approved BGauss budget ÷ actual MTD enquiries / retail.", { x: 0.3, y: 7.05, w: 12, h: 0.3, fontSize: 9, color: "64748B" });
      }

      // Section 3 — GPS pictures of that day (4 per slide, max 120 photos)
      const pics = rows.flatMap((r) => r.photos.filter((p) => p.date === day).map((p) => ({ r, p }))).slice(0, 120);
      const slots = [{ x: 0.4, y: 1.0 }, { x: 6.85, y: 1.0 }, { x: 0.4, y: 4.15 }, { x: 6.85, y: 4.15 }];
      if (pics.length === 0) {
        const s = pptx.addSlide();
        title(s, "3. GPS Pictures", ddmmyyyy(day));
        s.addText("No photos uploaded for this day.", { x: 0.4, y: 1.2, w: 12, h: 0.4, fontSize: 14, color: "64748B" });
      }
      for (let i = 0; i < pics.length; i += 4) {
        const s = pptx.addSlide();
        title(s, "3. GPS Pictures", `${ddmmyyyy(day)} · ${i + 1}–${Math.min(i + 4, pics.length)} of ${pics.length}`);
        const batch = pics.slice(i, i + 4);
        const data = await Promise.all(batch.map((b) => toDataUrl(b.p.url)));
        batch.forEach((b, j) => {
          const { x, y } = slots[j];
          if (data[j]) s.addImage({ data: data[j]!, x, y, w: 6.05, h: 2.5, sizing: { type: "contain", w: 6.05, h: 2.5 } });
          else s.addText("Image could not be loaded", { x, y, w: 6.05, h: 2.5, fontSize: 11, color: "9CA3AF", align: "center", fill: { color: "F1F5F9" } });
          const time = b.p.capturedAt ? new Date(b.p.capturedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
          const gps = b.p.lat !== null && b.p.lng !== null ? `GPS ${b.p.lat.toFixed(5)}, ${b.p.lng.toFixed(5)}` : "No GPS";
          s.addText(`${b.r.p.dealerName} · ${b.r.a.activityType} · ${time} · ${gps}`, {
            x, y: y + 2.52, w: 6.05, h: 0.4, fontSize: 9, color: "0A2540",
            hyperlink: b.p.lat !== null && b.p.lng !== null ? { url: `https://maps.google.com/?q=${b.p.lat},${b.p.lng}` } : undefined,
          });
        });
      }
      await pptx.writeFile({ fileName: `BTL_Daily_Report_${day}.pptx` });
      flash("PPT downloaded.");
    } catch (e) {
      flash(e instanceof Error ? `PPT failed: ${e.message}` : "PPT failed.");
    } finally {
      setPptBusy(false);
    }
  };

  // ── render ──
  if (loading) return <div style={{ padding: 40, color: "#64748b" }}>Loading post-activity data…</div>;
  if (error) return <div style={{ padding: 40, color: "#991b1b" }}>⚠ {error}</div>;

  const tabBtn = (t: Tab, label: string) => (
    <button key={t} type="button" onClick={() => setTab(t)}
      style={{ ...btn(tab === t ? "#0a2540" : "#fff", tab === t ? "#fff" : "#0a2540"), border: "1px solid #0a2540" }}>{label}</button>
  );

  return (
    <div style={{ padding: "4px 12px 40px" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, background: "#0a2540", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, zIndex: 9999 }}>{toast}</div>}

      <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0a2540", margin: "0 0 4px" }}>Post-Activity Reports</h1>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px" }}>
        Daily / MTD BTL activity, Proposed vs Actual, Lead report and the daily PPT — from Post-Activity entries of approved proposals.
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <select style={sel} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="daily">Daily</option><option value="mtd">Month to date</option><option value="range">Date range</option>
        </select>
        {period !== "range" ? (
          <input type="date" style={sel} value={date} max={TODAY} onChange={(e) => setDate(e.target.value || TODAY)} />
        ) : (
          <>
            <input type="date" style={sel} value={from} onChange={(e) => setFrom(e.target.value)} />
            <span style={{ fontSize: 12, color: "#64748b" }}>to</span>
            <input type="date" style={sel} value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <select style={sel} value={stateF} onChange={(e) => { setStateF(e.target.value); setDealerF("All"); }}>
          {states.map((s) => <option key={s} value={s}>{s === "All" ? "All states" : s}</option>)}
        </select>
        <select style={{ ...sel, maxWidth: 260 }} value={dealerF} onChange={(e) => setDealerF(e.target.value)}>
          {dealers.map((d) => <option key={d} value={d}>{d === "All" ? "All dealers" : d}</option>)}
        </select>
        <MultiSelect label="activities" options={activityTypes} value={actF} onChange={setActF} />
        <span style={{ fontSize: 12, color: "#166534", fontWeight: 700, marginLeft: "auto" }}>{periodLabel}</span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {tabBtn("report", "📊 BTL Activity Report")}
        {tabBtn("summary", "🎯 Proposed vs Actual")}
        {tabBtn("leads", "📋 Lead Report")}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" style={btn("#1e3a5f")} onClick={exportExcel}>⬇ Excel</button>
          <button type="button" style={{ ...btn("#16a34a"), opacity: pptBusy ? 0.6 : 1 }} disabled={pptBusy} onClick={exportPpt}
            title="Daily PPT: dealer-wise summary, dealer-activity MTD, GPS pictures">{pptBusy ? "Building PPT…" : "⬇ Daily PPT"}</button>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflowX: "auto" }}>
        {tab === "report" && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead><tr style={{ background: "#0a2540" }}>
              <th style={thL}>State</th><th style={thL}>Dealer</th><th style={thL}>Activity</th><th style={th}>Days</th><th style={th}>Canopy</th>
              <th style={th}>Enq Plan</th><th style={th}>Enq Actual</th><th style={th}>Walk-in</th><th style={th}>TD Actual</th>
              <th style={th}>Booking</th><th style={th}>Retail</th><th style={th}>Photos</th>
            </tr></thead>
            <tbody>
              {reportRows.length === 0 && <tr><td colSpan={12} style={{ ...tdL, textAlign: "center", padding: 30, color: "#9ca3af" }}>No post-activity data for this period / filter.</td></tr>}
              {reportRows.map(({ r, g, photos }, i) => (
                <tr key={r.a.id} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                  <td style={tdL}>{r.p.state}</td><td style={{ ...tdL, fontWeight: 600 }}>{r.p.dealerName}</td><td style={tdL}>{r.a.activityType}</td>
                  <td style={td}>{g.days}</td><td style={td}>{g.canopy}</td><td style={td}>{g.enqPlan}</td><td style={{ ...td, fontWeight: 700 }}>{g.enqAct}</td>
                  <td style={td}>{g.walkIn}</td><td style={td}>{g.tdAct}</td><td style={td}>{g.booking}</td><td style={{ ...td, fontWeight: 700 }}>{g.retail}</td><td style={td}>{photos}</td>
                </tr>
              ))}
            </tbody>
            {reportRows.length > 0 && (
              <tfoot><tr style={{ background: "#f0fdf4", fontWeight: 700 }}>
                <td style={tdL} colSpan={3}>TOTAL ({reportRows.length} activities)</td>
                <td style={td}>{reportTotal.days}</td><td style={td}>{reportTotal.canopy}</td><td style={td}>{reportTotal.enqPlan}</td><td style={td}>{reportTotal.enqAct}</td>
                <td style={td}>{reportTotal.walkIn}</td><td style={td}>{reportTotal.tdAct}</td><td style={td}>{reportTotal.booking}</td><td style={td}>{reportTotal.retail}</td><td style={td}>{reportPhotos}</td>
              </tr></tfoot>
            )}
          </table>
        )}

        {tab === "summary" && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
            <thead><tr style={{ background: "#0a2540" }}>
              <th style={thL}>State / Dealer</th><th style={th}>Activities</th>
              <th style={th}>Lead Target</th><th style={th}>Leads Actual</th><th style={th}>Lead %</th>
              <th style={th}>Retail Target</th><th style={th}>Retail Actual</th><th style={th}>Retail %</th>
              <th style={th}>Approved BGauss Budget</th><th style={th}>Actual Amount (CN)</th><th style={th}>Utilisation</th>
            </tr></thead>
            <tbody>
              {summary.size === 0 && <tr><td colSpan={11} style={{ ...tdL, textAlign: "center", padding: 30, color: "#9ca3af" }}>No approved activities planned in this period.</td></tr>}
              {Array.from(summary.entries()).map(([state, lines]) => {
                const t = lines.reduce((s, l) => ({ acts: s.acts + l.acts, leadT: s.leadT + l.leadT, leadA: s.leadA + l.leadA, retT: s.retT + l.retT, retA: s.retA + l.retA, budget: s.budget + l.budget, actualAmt: s.actualAmt + l.actualAmt }),
                  { acts: 0, leadT: 0, leadA: 0, retT: 0, retA: 0, budget: 0, actualAmt: 0 });
                return [
                  <tr key={`s-${state}`} style={{ background: "#e8edf2", fontWeight: 700 }}>
                    <td style={tdL}>{state}</td><td style={td}>{t.acts}</td><td style={td}>{t.leadT}</td><td style={td}>{t.leadA}</td><td style={td}>{pct(t.leadA, t.leadT)}</td>
                    <td style={td}>{t.retT}</td><td style={td}>{t.retA}</td><td style={td}>{pct(t.retA, t.retT)}</td>
                    <td style={td}>{inr(t.budget)}</td><td style={td}>{inr(t.actualAmt)}</td><td style={td}>{pct(t.actualAmt, t.budget)}</td>
                  </tr>,
                  ...lines.map((l) => (
                    <tr key={`d-${state}-${l.dealer}`}>
                      <td style={{ ...tdL, paddingLeft: 22 }}>{l.dealer}</td><td style={td}>{l.acts}</td><td style={td}>{l.leadT}</td><td style={td}>{l.leadA}</td><td style={td}>{pct(l.leadA, l.leadT)}</td>
                      <td style={td}>{l.retT}</td><td style={td}>{l.retA}</td><td style={td}>{pct(l.retA, l.retT)}</td>
                      <td style={td}>{inr(l.budget)}</td>
                      <td style={td} title={`${l.cnCount} of ${l.acts} activities have a CN / BGauss invoice amount`}>{l.cnCount ? inr(l.actualAmt) : "—"}</td>
                      <td style={td}>{l.cnCount ? pct(l.actualAmt, l.budget) : "—"}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        )}

        {tab === "leads" && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead><tr style={{ background: "#0a2540" }}>
              <th style={thL}>Date</th><th style={thL}>State</th><th style={thL}>Dealer</th><th style={thL}>Activity</th>
              <th style={th}>Enquiry Actual</th><th style={th}>Walk-in</th><th style={th}>In LMS</th><th style={th}>Gap</th>
              <th style={th}>Hot</th><th style={th}>Revised Hot</th><th style={th}>TD Actual</th><th style={th}>Booking</th>
            </tr></thead>
            <tbody>
              {leadRows.length === 0 && <tr><td colSpan={12} style={{ ...tdL, textAlign: "center", padding: 30, color: "#9ca3af" }}>No lead entries for this period / filter.</td></tr>}
              {leadRows.map(({ r, d }, i) => (
                <tr key={`${r.a.id}-${d.date}`} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
                  <td style={tdL}>{ddmmyyyy(d.date)}</td><td style={tdL}>{r.p.state}</td><td style={{ ...tdL, fontWeight: 600 }}>{r.p.dealerName}</td><td style={tdL}>{r.a.activityType}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{d.enquiryActual}</td><td style={td}>{d.walkIn}</td><td style={td}>{d.inLms}</td>
                  <td style={{ ...td, color: d.enquiryGap < 0 ? "#dc2626" : "#166534", fontWeight: 700 }}>{d.enquiryGap}</td>
                  <td style={td}>{d.enquiryHot}</td><td style={td}>{d.revisedHot}</td><td style={td}>{d.testDriveActual}</td><td style={td}>{d.bookingActual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
        Retail = “Retail” column of the daily Post-Activity table. Leads = Enquiry Actual. Actual Amount = CN / BGauss invoice amount
        (shown once uploaded in the Credit Note step). Proposed vs Actual includes activities whose planned dates fall in the selected period.
      </p>
    </div>
  );
}

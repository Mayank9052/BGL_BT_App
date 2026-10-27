// src/utils/dailyReportCore.ts
//
// ONE definition of the Daily BTL Report ("Project_Towns_<date>" format).
// dailyReportPpt.ts / dailyReportPdf.ts / dailyReportExcel.ts only draw these
// tables, so all three downloads always show identical figures and layout.

// ── Input types ─────────────────────────────────────────────────────────────
export interface PptEntry {
  date: string;
  openingStock?: number; setupCount?: number;
  enquiryPlanned?: number; enquiryActual?: number; walkIn?: number; inLms?: number;
  enquiryHot?: number; revisedHot?: number;
  testDrivePlanned?: number; testDriveActual?: number;
  bookingActual?: number; bookingInHand?: number;
  retailMtdActivity?: number; retailActual?: number; retailMtd?: number; closingStock?: number;
}
export interface PptMedia {
  fileUrl: string; fileName: string; fileType: string | null; capturedAt: string;
  latitude?: number | null; longitude?: number | null;
}
export interface PptActivity {
  dealer: string; location: string; state: string; zone: string; bgMember: string;
  activityType: string; entries: PptEntry[]; media: PptMedia[];
}
export interface PptLeadRow {
  state: string;
  leadsMonthTarget: number; leadsMtdTarget: number;
  walkinTarget: number; walkinMtdT: number; walkinMtdA: number;
  btlTarget: number; btlMtdT: number; btlMtdA: number;
  referralTarget: number; referralMtdT: number; referralMtdA: number;
  atlTarget: number; atlMtdT: number; atlMtdA: number;
  digitalTarget: number; digitalMtdT: number; digitalMtdA: number;
  totalReceived: number; variance: number; achPct: number; achPctMtd: number;
  retailTarget: number; mtdRetailTarget: number; mtdRetailAchieved: number;
  mtdRetailAchPct: number; retailEnqPct: number;
}
export interface LoadedImage { data: string; w: number; h: number }
export interface DailyReportOptions {
  reportDate: string;                       // yyyy-MM-dd — the report day
  activities: PptActivity[];
  leadRows?: PptLeadRow[];                  // omit/empty → Lead Report skipped
  resolveUrl?: (url: string) => string;     // relative /uploads/... → absolute
  assetBase?: string;                       // default "/ppt-assets/"
  maxPhotosPerDealer?: number;              // default 0 = ALL photos (no limit)
  photoFrom?: string;                       // yyyy-MM-dd — photos captured from this date (local / IST)
  photoTo?: string;                         // yyyy-MM-dd — … up to and including this date
  loadImage?: (url: string) => Promise<LoadedImage | null>;   // override (tests)
  onProgress?: (msg: string) => void;
  fileName?: string;
  save?: (data: ArrayBuffer | Blob, fileName: string) => Promise<void>;   // override (tests)
}
export type DailyPptOptions = DailyReportOptions;

// ── Table model ─────────────────────────────────────────────────────────────
export interface RCell {
  v: string | number;
  fill?: string;            // hex, no '#'
  color?: string;           // font colour
  bold?: boolean;
  fontSize?: number;
  colspan?: number;
  rowspan?: number;         // cells covered by a span are OMITTED in later rows
  link?: string;
  align?: "left" | "center";
}
export interface RTable {
  colW: number[];           // relative widths (inches at slide scale)
  head: RCell[][];
  body: RCell[][];
  foot: RCell[][];
  fontSize: number;
  rowsPerPage: number;      // PPT pagination
}
export interface DealerSheet {
  title: string;            // "D2 Galaxy, Nanded"
  activityType: string;
  sheetName: string;        // unique, Excel-safe
  table: RTable;
  photos: PptMedia[];
  photoLabel: string;       // "01 Oct 2026 – 27 Oct 2026" — period the photos cover
}
export interface DailyReportModel {
  day: string; longDate: string; shortDate: string; fileBase: string;
  summary: { title: string; table: RTable; empty: boolean };
  lead: { title: string; table: RTable } | null;
  dealers: DealerSheet[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────
export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const NAVY = "1F3864", GREEN = "00B050", GRID = "A6A6A6";
export const ASSET_FILES = ["cover-bg.jpg", "cover-logo.png", "bg-logo.png", "slide-bg.jpg", "closing-bg.jpg"] as const;

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r1 = (v: number) => Math.round(v * 10) / 10;
const retailOf = (e?: PptEntry) => (e ? n(e.retailMtdActivity) || n(e.retailActual) : 0);
const hasData = (e: PptEntry) =>
  n(e.setupCount) + n(e.enquiryActual) + n(e.walkIn) + n(e.inLms) + n(e.enquiryHot) +
  n(e.testDriveActual) + n(e.bookingActual) + retailOf(e) > 0;
export const longDate  = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)} ${iso.slice(0, 4)}`;
export const ddmmyyyy  = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
export const localIso  = (s: string) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return (s || "").slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const isImage = (t: string | null) => !!t && t.startsWith("image/");
export const photoCaption = (m: PptMedia) => {
  const t = new Date(m.capturedAt);
  const when = isNaN(t.getTime()) ? "" : t.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
  const gps = m.latitude != null && m.longitude != null ? `GPS ${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)}` : "No GPS";
  const link = m.latitude != null && m.longitude != null ? `https://maps.google.com/?q=${m.latitude},${m.longitude}` : undefined;
  return { when, gps, link };
};

const STATE_CODES: Record<string, string> = {
  "andhra pradesh":"AP","arunachal pradesh":"AR","assam":"AS","bihar":"BR","chhattisgarh":"CG","goa":"GA",
  "gujarat":"GJ","haryana":"HR","himachal pradesh":"HP","jharkhand":"JH","karnataka":"KA","kerala":"KL",
  "madhya pradesh":"MP","maharashtra":"MH","manipur":"MN","meghalaya":"ML","mizoram":"MZ","nagaland":"NL",
  "odisha":"OD","punjab":"PB","rajasthan":"RJ","sikkim":"SK","tamil nadu":"TN","telangana":"TS","tripura":"TR",
  "uttar pradesh":"UP","uttarakhand":"UK","west bengal":"WB","delhi":"DL","jammu and kashmir":"JK",
  "jammu & kashmir":"JK","ladakh":"LA","puducherry":"PY","chandigarh":"CH",
};
export const stateCode = (s: string) => STATE_CODES[(s || "").trim().toLowerCase()] ?? s;

const fillPerCanopyEnq = (v: number) => (v >= 30 ? "92D050" : v >= 20 ? "FFFF00" : v > 0 ? "FF7C80" : undefined);
const fillPerCanopyTd  = (v: number) => (v >= 25 ? "92D050" : v >= 20 ? "FFFF00" : v > 0 ? "FF7C80" : undefined);
const fillRate         = (v: number) => (v >= 0.7 ? "92D050" : v > 0 ? "FFFF00" : undefined);
const fillPct          = (v: number) => (v >= 100 ? "63BE7B" : v >= 75 ? "B1D580" : v >= 50 ? "FFEB84" : v >= 25 ? "FBAA77" : "F8696B");

const C = (v: string | number, o: Omit<RCell, "v"> = {}): RCell => ({ v, ...o });

// ── Image loading (browser) — photos are down-scaled to keep files small ──
export async function defaultLoadImage(url: string, maxPx = 1400): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const data = await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
    if (!data) return null;
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = data;
    });
    if (!img) return null;
    const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    const scale = Math.min(1, maxPx / Math.max(w, h));
    if (scale >= 1 || blob.type === "image/png") return { data, w, h };   // keep PNG (logos) lossless
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/jpeg", 0.82), w: canvas.width, h: canvas.height };
  } catch { return null; }
}

export async function loadAssets(o: DailyReportOptions) {
  const base = o.assetBase ?? "/ppt-assets/";
  const load = o.loadImage ?? ((u: string) => defaultLoadImage(u));
  const [coverBg, coverLogo, logo, slideBg, closingBg] = await Promise.all(ASSET_FILES.map((f) => load(base + f)));
  return { coverBg, coverLogo, logo, slideBg, closingBg };
}

export function fit(img: LoadedImage, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.w, h / img.h);
  const fw = img.w * s, fh = img.h * s;
  return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh };
}

export async function browserSave(data: ArrayBuffer | Blob, fileName: string, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── Per-activity summary ────────────────────────────────────────────────────
interface SummaryRow {
  a: PptActivity;
  canopy: number; planned: number; actual: number; perCanopy: number; hot: number;
  trPlanned: number; trActual: number; trPer: number; bookToday: number; inHand: number;
  retailToday: number; mtdActivity: number; mtdRetail: number; canopyMtd: number; rate: number;
  activityDay: number; closingStock: number; leads: number; punched: number; gap: number; conv: number;
}

function summarise(a: PptActivity, day: string): SummaryRow | null {
  const monthStart = day.slice(0, 8) + "01";
  const sorted = [...a.entries].sort((x, y) => x.date.localeCompare(y.date));
  const mtd = sorted.filter((e) => e.date >= monthStart && e.date <= day);
  const today = sorted.find((e) => e.date === day);
  const photosToday = a.media.some((m) => isImage(m.fileType) && localIso(m.capturedAt) === day);
  if (!mtd.some(hasData) && !photosToday) return null;
  const sum = (f: (e: PptEntry) => number) => mtd.reduce((s, e) => s + f(e), 0);
  const canopy = n(today?.setupCount), actual = n(today?.enquiryActual), trActual = n(today?.testDriveActual);
  const mtdActivity = sum(retailOf), canopyMtd = sum((e) => n(e.setupCount));
  const lastMtd = [...mtd].reverse().find((e) => n(e.retailMtd) > 0);
  const next = sorted.find((e) => e.date > day);
  const leads = sum((e) => n(e.enquiryActual)), punched = sum((e) => n(e.inLms));
  return {
    a, canopy, planned: n(today?.enquiryPlanned), actual,
    perCanopy: canopy ? Math.round(actual / canopy) : 0, hot: n(today?.enquiryHot),
    trPlanned: n(today?.testDrivePlanned), trActual, trPer: canopy ? Math.round(trActual / canopy) : 0,
    bookToday: n(today?.bookingActual), inHand: n(today?.bookingInHand),
    retailToday: retailOf(today), mtdActivity, mtdRetail: n(today?.retailMtd) || n(lastMtd?.retailMtd),
    canopyMtd, rate: canopyMtd ? r1(mtdActivity / canopyMtd) : 0,
    activityDay: mtd.filter(hasData).length,
    closingStock: n(today?.closingStock) || n(next?.openingStock) || n(today?.openingStock),
    leads, punched, gap: leads - punched, conv: leads ? Math.round((mtdActivity / leads) * 100) : 0,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
export function buildDailyReportModel(o: DailyReportOptions): DailyReportModel {
  const day = o.reportDate;
  const maxPhotos = o.maxPhotosPerDealer ?? 0;   // 0 = no limit

  // ── Daily Activity Sheet Summary ──────────────────────────────────────────
  const rows = o.activities.map((a) => summarise(a, day)).filter((r): r is SummaryRow => r !== null)
    .sort((x, y) => x.a.state.localeCompare(y.a.state) || x.a.dealer.localeCompare(y.a.dealer));

  const hdr = (t: string, fill: string, color = "000000", extra: Omit<RCell, "v"> = {}) => C(t, { fill, color, bold: true, ...extra });
  const summary: RTable = {
    colW: [0.4, 1.0, 1.0, 0.38, 0.42, 0.95, 0.42, 0.5, 0.45, 0.45, 0.32, 0.5, 0.45, 0.45,
           0.38, 0.48, 0.38, 0.55, 0.36, 0.52, 0.48, 0.48, 0.42, 0.52, 0.38, 0.45],
    fontSize: 7, rowsPerPage: 22,
    head: [
      [hdr(`Daily Activity Sheet Summary (${shortDate(day)})`, "FFFF00", "000000", { colspan: 26, fontSize: 10 })],
      [
        ...Array.from({ length: 6 }, () => hdr("", "BDD7EE")),
        hdr("Enquiry", "1F4E79", "FFC000", { colspan: 5 }), hdr("Test Rides", "FFC000", "000000", { colspan: 3 }),
        hdr("Bookings", "00B0F0", "000000", { colspan: 2 }), hdr("Retail", "ED7D31", "000000", { colspan: 4 }),
        hdr("", "E4C1F9"), hdr("", "E4C1F9"), hdr("LMS", "F8CBAD", "000000", { colspan: 3 }), hdr("Retail", "66CCFF"),
      ],
      ["Sr.No","Dealer","Location","State","Zone","BG Team Member","Canopy /Mela","Planned","Actual","Per Canopy","Hot",
       "Planned","Actual","Per Canopy","Today","In Hand","Today","MTD (Activity)","MTD","Retail Rate Per Canopy",
       "Activity Day","Closing Stock","Leads","Punched","Gap","Conv %"].map((t) => hdr(t, "FFFFFF")),
    ],
    body: rows.map((r, i) => [
      C(i + 1), C(r.a.dealer), C(r.a.location), C(stateCode(r.a.state)), C(r.a.zone), C(r.a.bgMember),
      C(r.canopy), C(r.planned), C(r.actual), C(r.perCanopy, { fill: fillPerCanopyEnq(r.perCanopy) }), C(r.hot),
      C(r.trPlanned), C(r.trActual), C(r.trPer, { fill: fillPerCanopyTd(r.trPer) }),
      C(r.bookToday), C(r.inHand), C(r.retailToday), C(r.mtdActivity), C(r.mtdRetail),
      C(r.rate.toFixed(1), { fill: fillRate(r.rate) }),
      C(r.activityDay), C(r.closingStock), C(r.leads), C(r.punched), C(r.gap), C(`${r.conv}%`, { fill: "C6EFCE" }),
    ]),
    foot: [],
  };
  {
    const T = (f: (r: SummaryRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const tc = T((r) => r.canopy), tf = { fill: "FCE4D6", bold: true };
    const cmtd = T((r) => r.canopyMtd), mact = T((r) => r.mtdActivity), leads = T((r) => r.leads), punched = T((r) => r.punched);
    summary.foot = [[
      C("", tf), C(`Total (${rows.length})`, tf), C("", tf), C("", tf), C("", tf), C("", tf),
      C(tc, tf), C(T((r) => r.planned), tf), C(T((r) => r.actual), tf), C(tc ? Math.round(T((r) => r.actual) / tc) : 0, tf), C(T((r) => r.hot), tf),
      C(T((r) => r.trPlanned), tf), C(T((r) => r.trActual), tf), C(tc ? Math.round(T((r) => r.trActual) / tc) : 0, tf),
      C(T((r) => r.bookToday), tf), C(T((r) => r.inHand), tf), C(T((r) => r.retailToday), tf), C(mact, tf), C(T((r) => r.mtdRetail), tf),
      C(cmtd ? r1(mact / cmtd).toFixed(1) : "0.0", tf), C("", tf), C("", tf),
      C(leads, tf), C(punched, tf), C(leads - punched, tf), C("", tf),
    ]];
  }

  // ── Lead Report ───────────────────────────────────────────────────────────
  let lead: DailyReportModel["lead"] = null;
  if (o.leadRows && o.leadRows.length) {
    const sorted = [...o.leadRows].sort((a, b) => b.achPct - a.achPct);
    const S = (k: keyof PptLeadRow) => sorted.reduce((s, r) => s + n(r[k]), 0);
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
    const P = (v: number) => C(`${v}%`, { fill: fillPct(v) });
    const hf = (t: string, fill: string, extra: Omit<RCell, "v"> = {}) => C(t, { fill, bold: true, ...extra });
    const monTag = `${MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)} ${day.slice(2, 4)}`;
    const CH = ["walkin", "btl", "referral", "atl", "digital"] as const;
    const gt = { fill: "D6DCE4", bold: true };
    lead = {
      title: `Lead Report (${longDate(day)})`,
      table: {
        colW: [1.0, 0.55, 0.55, ...Array(15).fill(0.42), 0.6, 0.6, 0.58, 0.58, 0.52, 0.52, 0.55, 0.55, 0.55],
        fontSize: 7, rowsPerPage: 18,
        head: [
          [hf(`Statewise Planned leads vs Actual till ${shortDate(day)} EoD`, "9BC2E6", { colspan: 27, fontSize: 10 })],
          [
            hf("State", "D6DCE4", { rowspan: 2 }), hf("Leads Month Targets", "D6DCE4", { rowspan: 2 }), hf("Leads MTD Target", "D6DCE4", { rowspan: 2 }),
            ...["Walkin", "BTL", "Referral", "ATL", "Digital"].map((t) => hf(t, "F8CBAD", { colspan: 3 })),
            hf("Total Leads Received", "D6DCE4", { rowspan: 2 }), hf("Leads Variance", "D6DCE4", { rowspan: 2 }),
            hf("Leads Achievement %", "D6DCE4", { rowspan: 2 }), hf("Leads Achievement % MTD", "D6DCE4", { rowspan: 2 }),
            hf(`${monTag} Retail Targets`, "D6DCE4", { rowspan: 2 }), hf("MTD Retail Targets", "D6DCE4", { rowspan: 2 }),
            hf("MTD Retail Achieved", "D6DCE4", { rowspan: 2 }), hf("MTD Retail Achievement %", "D6DCE4", { rowspan: 2 }),
            hf("Retails/ Enquiries %", "D6DCE4", { rowspan: 2 }),
          ],
          CH.flatMap(() => [hf("Target", "FCE4D6"), hf("MTD Target", "FCE4D6"), hf("MTD Ach.", "FCE4D6")]),
        ],
        body: sorted.map((r) => [
          C(r.state), C(r.leadsMonthTarget), C(r.leadsMtdTarget),
          ...CH.flatMap((k) => [C(n(r[`${k}Target` as keyof PptLeadRow])), C(n(r[`${k}MtdT` as keyof PptLeadRow])), C(n(r[`${k}MtdA` as keyof PptLeadRow]))]),
          C(r.totalReceived), C(r.variance), P(r.achPct), P(r.achPctMtd),
          C(r.retailTarget), C(r.mtdRetailTarget), C(r.mtdRetailAchieved), P(r.mtdRetailAchPct), P(r.retailEnqPct),
        ]),
        foot: [
          [
            C("Grand Total", gt), C(S("leadsMonthTarget"), gt), C(S("leadsMtdTarget"), gt),
            ...CH.flatMap((k) => [C(S(`${k}Target` as keyof PptLeadRow), gt), C(S(`${k}MtdT` as keyof PptLeadRow), gt), C(S(`${k}MtdA` as keyof PptLeadRow), gt)]),
            C(S("totalReceived"), gt), C(S("totalReceived") - S("leadsMonthTarget"), gt),
            C(`${pct(S("totalReceived"), S("leadsMonthTarget"))}%`, gt), C(`${pct(S("totalReceived"), S("leadsMtdTarget"))}%`, gt),
            C(S("retailTarget"), gt), C(S("mtdRetailTarget"), gt), C(S("mtdRetailAchieved"), gt),
            C(`${pct(S("mtdRetailAchieved"), S("mtdRetailTarget"))}%`, gt), C(`${pct(S("mtdRetailAchieved"), S("totalReceived"))}%`, gt),
          ],
          [
            C("MTD Ach %", { bold: true }), C(""), C(""),
            ...CH.flatMap((k) => [C(""), C(""), C(`${pct(S(`${k}MtdA` as keyof PptLeadRow), S(`${k}MtdT` as keyof PptLeadRow))}%`, { bold: true, fill: "FFFF00" })]),
            ...Array.from({ length: 9 }, () => C("")),
          ],
        ],
      },
    };
  }

  // ── Dealer daily sheets ───────────────────────────────────────────────────
  const usedNames = new Set<string>(["Daily Summary", "Lead Report"]);
  const sheetName = (s: string) => {
    const base = s.replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Dealer";
    let name = base, k = 2;
    while (usedNames.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${k++}`;
    usedNames.add(name.toLowerCase());
    return name;
  };
  const monthStart = day.slice(0, 8) + "01";
  const blue = "8DB4E2", amber = "FFC000";
  const dealers: DealerSheet[] = rows.map(({ a }) => {
    const sorted = [...a.entries].sort((x, y) => x.date.localeCompare(y.date)).filter((e) => e.date >= monthStart);
    const shown = sorted.filter((e) => e.date <= day || e.date.slice(0, 7) === day.slice(0, 7));
    const mtd = sorted.filter((e) => e.date <= day);
    const sum = (f: (e: PptEntry) => number) => mtd.reduce((s, e) => s + f(e), 0);
    const T = {
      canopy: sum((e) => n(e.setupCount)), planned: sum((e) => n(e.enquiryPlanned)), actual: sum((e) => n(e.enquiryActual)),
      walkIn: sum((e) => n(e.walkIn)), inLms: sum((e) => n(e.inLms)), hot: sum((e) => n(e.enquiryHot)),
      revHot: sum((e) => n(e.revisedHot)), tdPlanned: sum((e) => n(e.testDrivePlanned)), tdActual: sum((e) => n(e.testDriveActual)),
      book: sum((e) => n(e.bookingActual)), inHand: n(mtd[mtd.length - 1]?.bookingInHand), retail: sum(retailOf),
    };
    const avg = (v: number): number => (!T.canopy ? 0 : v / T.canopy >= 10 ? Math.round(v / T.canopy) : r1(v / T.canopy));
    const W0 = { fill: "FFFFFF" }, Y = { fill: "FFFF00", bold: true }, tb = { fill: blue, bold: true };
    const hb = (t: string, fill: string, extra: Omit<RCell, "v"> = {}) => C(t, { fill, bold: true, ...extra });
    const blank0 = (v: number) => (v ? v : "");

    // Photos: EVERY photo in the selected From–To range (oldest first). Without a range:
    // the report day's photos, else the month-to-date photos (previous behaviour).
    const imgs = a.media.filter((m) => isImage(m.fileType));
    let photos: PptMedia[];
    let photoLabel: string;
    if (o.photoFrom || o.photoTo) {
      const lo = o.photoFrom || "0000-01-01", hi = o.photoTo || "9999-12-31";
      photos = imgs.filter((m) => { const d = localIso(m.capturedAt); return d >= lo && d <= hi; })
        .sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
      photoLabel = o.photoFrom ? `${shortDate(lo)} – ${shortDate(o.photoTo || day)}` : `up to ${shortDate(hi)}`;
    } else {
      photos = imgs.filter((m) => localIso(m.capturedAt) === day);
      photoLabel = shortDate(day);
      if (photos.length === 0) {
        photos = imgs.filter((m) => localIso(m.capturedAt) <= day && localIso(m.capturedAt) >= monthStart)
          .sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
        photoLabel = `${shortDate(monthStart)} – ${shortDate(day)}`;
      }
    }

    return {
      title: `${a.dealer}, ${a.location}`,
      activityType: a.activityType,
      sheetName: sheetName(`${a.dealer}-${a.location}`),
      photos: maxPhotos > 0 ? photos.slice(0, maxPhotos) : photos,
      photoLabel,
      table: {
        colW: [0.95, 0.65, 0.6, 0.7, 0.65, 0.65, 0.65, 0.6, 0.55, 0.85, 0.7, 0.65, 0.6, 0.65, 0.65, 0.7],
        fontSize: 9, rowsPerPage: 18,
        head: [
          [
            hb(`${a.dealer.toUpperCase()} ${a.location.toUpperCase()} (${stateCode(a.state)})`, "D9D9D9", { colspan: 10, fontSize: 11 }),
            hb(`BG - ${a.bgMember || "—"}`, "D9D9D9", { colspan: 5, fontSize: 11 }), hb("", "FFFFFF"),
          ],
          [
            hb("Date", blue, { rowspan: 2 }), hb("Opening Stock", blue, { rowspan: 2 }),
            hb("Enquiry", blue, { colspan: 8 }), hb("Test Drive", amber, { colspan: 2 }), hb("Booking", blue, { colspan: 2 }),
            hb("Retail", amber, { rowspan: 2 }), hb("MTD Retail", blue, { rowspan: 2 }),
          ],
          ["Canopy","Planned","Actual","Walk in","In LMS","Gap","Hot","Revised Hot","Planned","Actual","Today","In hand"]
            .map((t, i) => hb(t, i === 8 || i === 9 ? amber : blue)),
        ],
        body: shown.map((e) => {
          const fut = e.date > day;
          const v = (x: number) => C(fut ? "" : x, W0);
          return [
            C(ddmmyyyy(e.date), W0), C(blank0(n(e.openingStock)), W0), C(fut ? "" : blank0(n(e.setupCount)), W0),
            C(n(e.enquiryPlanned), W0), v(n(e.enquiryActual)), v(n(e.walkIn)), v(n(e.inLms)),
            C(n(e.inLms) - n(e.enquiryActual), W0), v(n(e.enquiryHot)), v(n(e.revisedHot)),
            C(n(e.testDrivePlanned), W0), v(n(e.testDriveActual)), v(n(e.bookingActual)), v(n(e.bookingInHand)),
            v(retailOf(e)), C(fut ? "" : blank0(n(e.retailMtd)), W0),
          ];
        }),
        foot: [
          [
            C("Total", tb), C("", tb), C(T.canopy, tb), C(T.planned, tb), C(T.actual, tb), C(T.walkIn, tb), C(T.inLms, tb),
            C(T.inLms - T.actual, tb), C(T.hot, tb), C(T.revHot, tb), C(T.tdPlanned, tb), C(T.tdActual, tb),
            C(T.book, tb), C(T.inHand, tb), C(T.retail, tb), C("", tb),
          ],
          [
            C("Avg Per Canopy", { colspan: 3, ...W0 }), C(avg(T.planned), W0), C(avg(T.actual), Y), C(avg(T.walkIn), W0),
            C("", W0), C("", W0), C(avg(T.hot), W0), C(avg(T.revHot), W0), C(avg(T.tdPlanned), W0), C(avg(T.tdActual), Y),
            C(avg(T.book), Y), C("", W0), C(avg(T.retail), Y), C("", W0),
          ],
        ],
      },
    };
  });

  return {
    day, longDate: longDate(day), shortDate: shortDate(day), fileBase: `BTL_Daily_Report_${ddmmyyyy(day)}`,
    summary: { title: `Daily Summary Sheet (${longDate(day)})`, table: summary, empty: rows.length === 0 },
    lead, dealers,
  };
}

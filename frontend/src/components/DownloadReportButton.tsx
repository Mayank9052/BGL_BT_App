// src/components/DownloadReportButton.tsx
// One "⬇ Download ▾" menu for every report: CSV · Excel · PDF (+ PPT when the page supplies it).
// Same props as before (filename, title, columns, rows) so existing pages keep working.
//
// • Excel / PDF use the report look: green title bar, navy header, borders, zebra rows.
// • A page can plug in its own exporters (custom.ppt / custom.pdf / custom.xlsx / custom.csv) —
//   the Daily Activity Report does this so the menu downloads the full Project-Towns format.
// • PDF uses utils/pdfTable.ts (safe autoTable import) — fixes "(0 , wL.default) is not a function".
import { useEffect, useRef, useState } from "react";
import ExcelJS from "exceljs";
import type { ExportColumn } from "../utils/exportReport";
import { jsPDF, autoTable } from "../utils/pdfTable";
import { browserSave } from "../utils/dailyReportCore";
import "./DownloadReportButton.css";

type Fmt = "ppt" | "xlsx" | "pdf" | "csv";
type Exporter = () => Promise<unknown> | unknown;

interface Props {
  filename: string;
  title: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[] | unknown[];
  subtitle?: string;
  disabled?: boolean;
  label?: string;
  /** Page-specific exporters; a format given here replaces the generic one. */
  custom?: Partial<Record<Fmt, Exporter>>;
  [extra: string]: unknown;
}

const NAVY = "0A2540", GREEN = "00B050", GRID = "A6A6A6";
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = () => { const d = new Date(); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`; };
const nowText = () => { const d = new Date(); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Report";

const cell = (row: unknown, key: string): string | number => {
  const v = (row as Record<string, unknown>)?.[key];
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};

// ── Generic exporters ────────────────────────────────────────────────────────
async function exportCsv(p: Props) {
  const q = (v: string | number) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [p.columns.map((c) => q(c.header)).join(","),
    ...(p.rows as unknown[]).map((r) => p.columns.map((c) => q(cell(r, c.key))).join(","))];
  await browserSave(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${safeName(p.filename)}_${stamp()}.csv`, "text/csv");
}

async function exportXlsx(p: Props) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BGauss BTL Portal";
  const ws = wb.addWorksheet(safeName(p.title).slice(0, 31), {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const n = p.columns.length;
  const thin = { style: "thin" as const, color: { argb: `FF${GRID}` } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  ws.mergeCells(1, 1, 1, n);
  Object.assign(ws.getCell(1, 1), {
    value: p.title,
    font: { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GREEN}` } },
    alignment: { horizontal: "center", vertical: "middle" },
  });
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, n);
  Object.assign(ws.getCell(2, 1), {
    value: `${p.subtitle ? p.subtitle + " · " : ""}Generated ${nowText()} · ${(p.rows as unknown[]).length} rows`,
    font: { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } },
    alignment: { horizontal: "center" },
  });

  const head = ws.getRow(3);
  p.columns.forEach((c, i) => {
    const x = head.getCell(i + 1);
    x.value = c.header;
    x.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${NAVY}` } };
    x.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    x.border = border;
  });
  head.height = 30;

  (p.rows as unknown[]).forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    p.columns.forEach((c, i) => {
      const x = row.getCell(i + 1);
      x.value = cell(r, c.key);
      x.font = { name: "Calibri", size: 10 };
      x.alignment = { horizontal: typeof x.value === "number" ? "center" : "left", vertical: "middle" };
      x.border = border;
      if (ri % 2 === 1) x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
  });

  p.columns.forEach((c, i) => {
    const longest = Math.max(c.header.length, ...(p.rows as unknown[]).slice(0, 500).map((r) => String(cell(r, c.key)).length));
    ws.getColumn(i + 1).width = Math.min(40, Math.max(8, longest + 2));
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + (p.rows as unknown[]).length, column: n } };

  const buf = await wb.xlsx.writeBuffer();
  await browserSave(buf as ArrayBuffer, `${safeName(p.filename)}_${stamp()}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

async function exportPdf(p: Props) {
  const n = p.columns.length;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: n > 16 ? "a3" : "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const fontSize = n > 22 ? 6 : n > 14 ? 7 : 8;
  autoTable(doc, {
    head: [p.columns.map((c) => c.header)],
    body: (p.rows as unknown[]).map((r) => p.columns.map((c) => String(cell(r, c.key)))),
    startY: 24,
    margin: { top: 24, left: 8, right: 8, bottom: 12 },
    theme: "grid",
    styles: { font: "helvetica", fontSize, cellPadding: 1.2, halign: "center", valign: "middle", lineColor: `#${GRID}`, lineWidth: 0.15, overflow: "linebreak" },
    headStyles: { fillColor: `#${NAVY}`, textColor: "#FFFFFF", fontStyle: "bold" },
    alternateRowStyles: { fillColor: "#F8FAFC" },
    columnStyles: { 0: { halign: "left" } },
    willDrawPage: () => {
      doc.setFillColor(`#${GREEN}`); doc.rect(8, 6, W - 16, 10, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor("#FFFFFF");
      doc.text(p.title, W / 2, 12.8, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor("#64748B");
      doc.text(`${p.subtitle ? p.subtitle + " · " : ""}Generated ${nowText()} · ${(p.rows as unknown[]).length} rows`, W / 2, 20.5, { align: "center" });
    },
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7); doc.setTextColor("#94A3B8");
    doc.text(`BGauss Auto Pvt. Ltd. · Page ${i} of ${pages}`, W - 8, doc.internal.pageSize.getHeight() - 5, { align: "right" });
  }
  await browserSave(doc.output("arraybuffer"), `${safeName(p.filename)}_${stamp()}.pdf`, "application/pdf");
}

const META: Record<Fmt, { icon: string; label: string; hint: string }> = {
  ppt:  { icon: "📊", label: "PowerPoint (.pptx)", hint: "Slides with summary, lead report, dealer sheets and photos" },
  xlsx: { icon: "📗", label: "Excel (.xlsx)",      hint: "Formatted sheet — filter and sum" },
  pdf:  { icon: "📕", label: "PDF",                hint: "Print-ready, same layout" },
  csv:  { icon: "📄", label: "CSV",                hint: "Plain data for other tools" },
};

export default function DownloadReportButton(props: Props) {
  const { rows, disabled, label = "⬇ Download", custom } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Fmt | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const empty = !(rows as unknown[])?.length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const formats: Fmt[] = [...(custom?.ppt ? (["ppt"] as Fmt[]) : []), "xlsx", "pdf", "csv"];

  const run = async (f: Fmt) => {
    setOpen(false); setBusy(f);
    try {
      const fn = custom?.[f];
      if (fn) await fn();
      else if (f === "csv") await exportCsv(props);
      else if (f === "xlsx") await exportXlsx(props);
      else if (f === "pdf") await exportPdf(props);
    } catch (e) {
      alert(`Download failed (${META[f].label}): ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="drb" ref={ref}>
      <button type="button" className="drb-btn" disabled={disabled || empty || !!busy}
        onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        title={empty ? "Nothing to download for the current filters" : "Download this report"}>
        {busy ? `⏳ Preparing ${META[busy].label.split(" ")[0]}…` : <>{label} <span className="drb-caret">▾</span></>}
      </button>
      {open && (
        <div className="drb-menu" role="menu">
          {formats.map((f) => (
            <button key={f} type="button" role="menuitem" className="drb-item" onClick={() => run(f)}>
              <span className="drb-icon">{META[f].icon}</span>
              <span className="drb-text"><b>{META[f].label}</b><small>{custom?.[f] ? "Full report format" : META[f].hint}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

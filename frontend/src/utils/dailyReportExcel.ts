// src/utils/dailyReportExcel.ts
// Daily BTL report as Excel — same tables as the PPT/PDF (colours, merged headers, totals):
//   "Daily Summary", "Lead Report", then one sheet per dealer (daily sheet + GPS photos).
// Numbers stay numbers (%, 0.0 formats) so the sheet can be filtered / summed.
import ExcelJS from "exceljs";
import {
  buildDailyReportModel, photoCaption, browserSave, defaultLoadImage,
  GREEN, type DailyReportOptions, type RTable, type RCell,
} from "./dailyReportCore";

const PX_PER_CHAR = 7;                     // Excel column width ≈ 7 px per unit
const thin = { style: "thin" as const, color: { argb: "FFA6A6A6" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function cellValue(v: string | number): { value: string | number; numFmt?: string } {
  if (typeof v === "number") return { value: v };
  const pct = /^(-?\d+(?:\.\d+)?)%$/.exec(v);
  if (pct) return { value: Number(pct[1]) / 100, numFmt: "0%" };
  if (/^-?\d+\.\d$/.test(v)) return { value: Number(v), numFmt: "0.0" };
  return { value: v };
}

/** Writes an RTable at (startRow, 1); returns the next free row. Handles colspan/rowspan merges. */
function writeTable(ws: ExcelJS.Worksheet, t: RTable, startRow: number, baseFont: number): number {
  const taken = new Set<string>();
  const all: { rows: RCell[][]; kind: "head" | "body" | "foot" }[] = [
    { rows: t.head, kind: "head" }, { rows: t.body, kind: "body" }, { rows: t.foot, kind: "foot" },
  ];
  let r = startRow;
  for (const part of all) {
    for (const row of part.rows) {
      let c = 1;
      for (const cell of row) {
        while (taken.has(`${r}:${c}`)) c++;
        const cs = cell.colspan ?? 1, rs = cell.rowspan ?? 1;
        for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) {
          taken.add(`${rr}:${cc}`);
          const x = ws.getCell(rr, cc);
          x.border = border;
          if (cell.fill) x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${cell.fill}` } };
        }
        const x = ws.getCell(r, c);
        const { value, numFmt } = cellValue(cell.v);
        x.value = cell.link ? { text: String(value), hyperlink: cell.link } : value;
        if (numFmt) x.numFmt = numFmt;
        x.font = { name: "Calibri", size: cell.fontSize ? cell.fontSize + 1 : baseFont, bold: !!cell.bold || part.kind !== "body",
          color: { argb: `FF${cell.color ?? "000000"}` } };
        x.alignment = { horizontal: cell.align ?? "center", vertical: "middle", wrapText: true };
        if (cs > 1 || rs > 1) ws.mergeCells(r, c, r + rs - 1, c + cs - 1);
        c += cs;
      }
      ws.getRow(r).height = part.kind === "head" ? 30 : 18;
      r++;
    }
  }
  t.colW.forEach((w, i) => { ws.getColumn(i + 1).width = Math.max(6, Math.round(w * 14)); });
  return r;
}

function titleRow(ws: ExcelJS.Worksheet, text: string, cols: number, sub?: string) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = text;
  t.font = { name: "Arial", size: 16, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GREEN}` } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;
  if (sub) {
    ws.mergeCells(2, 1, 2, cols);
    const s = ws.getCell(2, 1);
    s.value = sub;
    s.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF1F3864" } };
    s.alignment = { horizontal: "center" };
  }
}

export async function buildDailyReportExcel(o: DailyReportOptions): Promise<string> {
  const progress = o.onProgress ?? (() => {});
  const loadPhoto = o.loadImage ?? ((u: string) => defaultLoadImage(u, 1000));
  const resolve = o.resolveUrl ?? ((u: string) => u);
  const model = buildDailyReportModel(o);

  const wb = new ExcelJS.Workbook();
  wb.creator = "BGauss BTL Portal";
  wb.created = new Date();

  // Daily Summary
  progress("Building daily summary…");
  {
    const ws = wb.addWorksheet("Daily Summary", { views: [{ state: "frozen", ySplit: 5, xSplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    titleRow(ws, model.summary.title, 26);
    if (model.summary.empty) ws.getCell(4, 1).value = "No post-activity data entered for this date.";
    else writeTable(ws, model.summary.table, 3, 9);
  }

  // Lead Report
  if (model.lead) {
    progress("Building lead report…");
    const ws = wb.addWorksheet("Lead Report", { views: [{ state: "frozen", ySplit: 5, xSplit: 1 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    titleRow(ws, model.lead.title, 27);
    writeTable(ws, model.lead.table, 3, 9);
  }

  // Dealer sheets (+ photos under the table)
  let i = 0;
  for (const d of model.dealers) {
    progress(`Dealer ${++i}/${model.dealers.length}: ${d.title}`);
    const ws = wb.addWorksheet(d.sheetName, { views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    titleRow(ws, d.title, 16, d.activityType);
    let r = writeTable(ws, d.table, 4, 10) + 1;
    if (!d.photos.length) continue;

    ws.mergeCells(r, 1, r, 16);
    const h = ws.getCell(r, 1);
    h.value = `Photos — ${d.photos.length} (${d.photoLabel})`;
    h.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${GREEN}` } };
    h.alignment = { horizontal: "center" };
    r += 1;

    const imgs = await Promise.all(d.photos.map((m) => loadPhoto(resolve(m.fileUrl))));
    const groups = [[0, 4], [4, 8], [8, 12], [12, 16]];          // 4 photos per band, 4 columns each
    const IMG_ROWS = 16, ROW_PX = 20;
    for (let p = 0; p < d.photos.length; p += 4) {
      for (let rr = r; rr < r + IMG_ROWS; rr++) ws.getRow(rr).height = ROW_PX * 0.75;   // points
      d.photos.slice(p, p + 4).forEach((m, j) => {
        const [c0, c1] = groups[j];
        const slotW = Array.from({ length: c1 - c0 }, (_, k) => (ws.getColumn(c0 + k + 1).width ?? 9) * PX_PER_CHAR)
          .reduce((s, v) => s + v, 0) - 8;
        const slotH = IMG_ROWS * ROW_PX - 6;
        const im = imgs[p + j];
        if (im) {
          const s = Math.min(slotW / im.w, slotH / im.h);
          const ext = im.data.startsWith("data:image/png") ? "png" : "jpeg";
          const id = wb.addImage({ base64: im.data.replace(/^data:image\/\w+;base64,/, ""), extension: ext });
          ws.addImage(id, { tl: { col: c0 + 0.05, row: r - 1 + 0.1 }, ext: { width: Math.round(im.w * s), height: Math.round(im.h * s) } });
        } else {
          ws.getCell(r, c0 + 1).value = "Photo could not be loaded";
        }
        const cap = photoCaption(m);
        ws.mergeCells(r + IMG_ROWS, c0 + 1, r + IMG_ROWS, c1);
        const cc = ws.getCell(r + IMG_ROWS, c0 + 1);
        cc.value = cap.link ? { text: `${cap.when} · ${cap.gps}`, hyperlink: cap.link } : `${cap.when} · ${cap.gps}`;
        cc.font = { name: "Calibri", size: 9, color: { argb: cap.link ? "FF0563C1" : "FF1F3864" }, underline: !!cap.link };
        cc.alignment = { horizontal: "center" };
      });
      r += IMG_ROWS + 2;
    }
  }

  progress("Saving Excel…");
  const fileName = (o.fileName ?? `${model.fileBase}.pptx`).replace(/\.pptx$/i, ".xlsx");
  const buf = await wb.xlsx.writeBuffer();
  await (o.save ?? ((dt, f) => browserSave(dt, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")))(buf as ArrayBuffer, fileName);
  return fileName;
}

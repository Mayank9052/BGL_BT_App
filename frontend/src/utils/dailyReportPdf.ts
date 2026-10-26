// src/utils/dailyReportPdf.ts
// Daily BTL report as PDF — page-for-page the same as the PPT (13.33" × 7.5" landscape),
// including the dealer daily sheets and GPS photos. Tables from dailyReportCore.ts.
import { jsPDF } from "jspdf";
import autoTable, { type CellDef, type RowInput } from "jspdf-autotable";
import {
  buildDailyReportModel, loadAssets, fit, photoCaption, browserSave, defaultLoadImage,
  NAVY, GREEN, GRID, type DailyReportOptions, type RTable, type RCell, type LoadedImage,
} from "./dailyReportCore";

const W = 13.333, H = 7.5;
const fmt = (data: string) => (data.startsWith("data:image/png") ? "PNG" : "JPEG");
const hex = (c: string) => `#${c}`;

const toCell = (c: RCell, base: number): CellDef => ({
  content: String(c.v),
  colSpan: c.colspan, rowSpan: c.rowspan,
  styles: {
    fillColor: c.fill ? hex(c.fill) : undefined,
    textColor: c.color ? hex(c.color) : "#000000",
    fontStyle: c.bold ? "bold" : "normal",
    fontSize: c.fontSize ?? base,
    halign: c.align ?? "center",
  },
});

export async function buildDailyReportPdf(o: DailyReportOptions): Promise<string> {
  const progress = o.onProgress ?? (() => {});
  const loadPhoto = o.loadImage ?? ((u: string) => defaultLoadImage(u));
  const resolve = o.resolveUrl ?? ((u: string) => u);
  const model = buildDailyReportModel(o);

  progress("Loading artwork…");
  const A = await loadAssets(o);
  const doc = new jsPDF({ orientation: "landscape", unit: "in", format: [W, H], compress: true });
  doc.setProperties({ title: `BTL Daily Report ${model.longDate}`, author: "BGauss Auto Pvt. Ltd." });

  const img = (i: LoadedImage | null, alias: string, x: number, y: number, w: number, h: number) => {
    if (i) doc.addImage(i.data, fmt(i.data), x, y, w, h, alias, "FAST");
  };
  const logo = (y = 0.11) => img(A.logo, "bglogo", 12.64, y, 0.5, 0.5);
  const greenBox = (x: number, y: number, w: number, h: number) => {
    doc.setFillColor(205, 205, 205); doc.rect(x + 0.1, y + 0.12, w, h, "F");          // soft shadow
    doc.setFillColor(GREEN); doc.rect(x, y, w, h, "F");
  };
  const wideTitle = (t: string) => {
    greenBox(2.88, 0.03, 7.17, 0.9);
    doc.setFont("helvetica", "normal"); doc.setFontSize(22); doc.setTextColor("#FFFFFF");
    doc.text(t, 3.0, 0.45);
  };
  const dealerTitle = (t: string) => {
    greenBox(3.69, 0.21, 6.17, 0.44);
    doc.setFont("helvetica", "normal"); doc.setFontSize(18); doc.setTextColor("#FFFFFF");
    doc.text(t, 3.69 + 6.17 / 2, 0.21 + 0.3, { align: "center", maxWidth: 6.0 });
  };
  const bg = () => img(A.slideBg, "slidebg", 0, 0, W, H);

  const table = (t: RTable, startY: number, centred: boolean, onPage: () => void) => {
    const totW = t.colW.reduce((s, v) => s + v, 0);
    const width = centred ? totW : W;
    const colW = t.colW.map((v) => (v * width) / totW);
    const left = centred ? (W - width) / 2 : 0;
    const conv = (rows: RCell[][]): RowInput[] => rows.map((r) => r.map((c) => toCell(c, t.fontSize)));
    doc.addPage([W, H], "landscape");          // later pages are added by autoTable itself
    autoTable(doc, {
      head: conv(t.head), body: conv(t.body), foot: conv(t.foot),
      startY, margin: { top: startY, left, right: W - left - width, bottom: 0.3 },
      tableWidth: width, theme: "grid", showHead: "everyPage", showFoot: "lastPage",
      styles: { font: "helvetica", fontSize: t.fontSize, cellPadding: 0.02, halign: "center", valign: "middle",
        lineColor: hex(GRID), lineWidth: 0.006, textColor: "#000000", fillColor: "#FFFFFF", overflow: "linebreak", minCellHeight: 0.2 },
      headStyles: { fillColor: "#FFFFFF", textColor: "#000000", fontStyle: "bold" },
      footStyles: { fillColor: "#FFFFFF", textColor: "#000000", fontStyle: "bold" },
      columnStyles: Object.fromEntries(colW.map((w, i) => [i, { cellWidth: w }])),
      willDrawPage: () => onPage(),
    });
  };

  // 1. Cover (page 1 already exists)
  doc.setFillColor("#FFFFFF"); doc.rect(0, 0, W, H, "F");
  img(A.coverBg, "coverbg", 0.87, 0, 11.15, 7.5);
  img(A.coverLogo, "coverlogo", 4.17, 2.82, 5.5, 1.69);
  doc.setFont("helvetica", "normal"); doc.setFontSize(14); doc.setTextColor(hex(NAVY));
  doc.text(`Date : ${model.longDate}`, 0.35, 0.6);

  // 2. Daily Summary
  progress("Building daily summary…");
  if (model.summary.empty) {
    doc.addPage([W, H], "landscape"); logo(); wideTitle(model.summary.title);
    doc.setFontSize(16); doc.setTextColor("#7F7F7F");
    doc.text("No post-activity data entered for this date.", W / 2, 2.8, { align: "center" });
  } else {
    table(model.summary.table, 1.6, false, () => { logo(); wideTitle(model.summary.title); });
  }

  // 3. Lead Report
  if (model.lead) {
    progress("Building lead report…");
    const L = model.lead;
    table(L.table, 1.64, false, () => { logo(); wideTitle(L.title); });
  }

  // 4. Dealers
  let i = 0;
  for (const d of model.dealers) {
    progress(`Dealer ${++i}/${model.dealers.length}: ${d.title}`);
    table(d.table, 1.2, true, () => {
      bg(); logo(0.21); dealerTitle(d.title);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(hex(NAVY));
      doc.text(d.activityType, W / 2, 1.0, { align: "center" });
    });
    for (let p = 0; p < d.photos.length; p += 4) {
      doc.addPage([W, H], "landscape"); bg(); logo(0.21); dealerTitle(d.title);
      const batch = d.photos.slice(p, p + 4);
      const imgs = await Promise.all(batch.map((m) => loadPhoto(resolve(m.fileUrl))));
      const slotW = 3.0, slotH = 4.3, gap = (W - 0.6 - 4 * slotW) / 3;
      batch.forEach((m, j) => {
        const x = 0.3 + j * (slotW + gap), y = 1.35, im = imgs[j];
        if (im) { const f = fit(im, x, y, slotW, slotH); doc.addImage(im.data, fmt(im.data), f.x, f.y, f.w, f.h, undefined, "FAST"); }
        else { doc.setFillColor("#F2F2F2"); doc.rect(x, y, slotW, slotH, "F"); doc.setFontSize(11); doc.setTextColor("#7F7F7F");
               doc.text("Photo could not be loaded", x + slotW / 2, y + slotH / 2, { align: "center" }); }
        const cap = photoCaption(m);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(hex(NAVY));
        const left = `${cap.when}  ·  `;
        const full = left + cap.gps;
        const tx = x + (slotW - doc.getTextWidth(full)) / 2, ty = y + slotH + 0.25;
        doc.text(left, tx, ty);
        if (cap.link) { doc.setTextColor("#0563C1"); doc.textWithLink(cap.gps, tx + doc.getTextWidth(left), ty, { url: cap.link }); }
        else doc.text(cap.gps, tx + doc.getTextWidth(left), ty);
      });
    }
  }

  // 5. Thank you
  doc.addPage([W, H], "landscape");
  img(A.closingBg, "closingbg", 0, 0, W, H);
  doc.setFillColor("#FFFFFF"); doc.rect(0.42, 0.25, 5.33, 0.75, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(hex(NAVY));
  doc.text("#Electricvehicles", 1.08, 0.78);

  progress("Saving PDF…");
  const fileName = (o.fileName ?? `${model.fileBase}.pptx`).replace(/\.pptx$/i, ".pdf");
  await (o.save ?? ((d, f) => browserSave(d, f, "application/pdf")))(doc.output("arraybuffer"), fileName);
  return fileName;
}

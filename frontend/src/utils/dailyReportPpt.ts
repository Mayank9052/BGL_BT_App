// src/utils/dailyReportPpt.ts
// Daily BTL report as PowerPoint — layout of "Project_Towns_<date>.pptx".
// Tables come from dailyReportCore.ts (shared with the PDF and Excel downloads).
import pptxgen from "pptxgenjs";
import {
  buildDailyReportModel, loadAssets, fit, photoCaption, browserSave, defaultLoadImage,
  NAVY, GREEN, GRID, type DailyReportOptions, type RTable, type RCell, type LoadedImage,
} from "./dailyReportCore";

export type { PptEntry, PptMedia, PptActivity, PptLeadRow, LoadedImage, DailyPptOptions, DailyReportOptions } from "./dailyReportCore";

const W = 13.333;
const pptData = (dataUrl: string) => dataUrl.replace(/^data:/, "");   // pptxgenjs wants "image/png;base64,…"

const toCell = (c: RCell): pptxgen.TableCell => ({
  text: String(c.v),
  options: {
    fill: c.fill ? { color: c.fill } : undefined, color: c.color, bold: c.bold, fontSize: c.fontSize,
    colspan: c.colspan, rowspan: c.rowspan, align: c.align,
  },
});

export async function buildDailyReportPpt(o: DailyReportOptions): Promise<string> {
  const progress = o.onProgress ?? (() => {});
  const loadPhoto = o.loadImage ?? ((u: string) => defaultLoadImage(u));
  const resolve = o.resolveUrl ?? ((u: string) => u);
  const model = buildDailyReportModel(o);

  progress("Loading artwork…");
  const A = await loadAssets(o);

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `BTL Daily Report ${model.longDate}`;
  pptx.company = "BGauss Auto Pvt. Ltd.";
  pptx.theme = { headFontFace: "Calibri", bodyFontFace: "Calibri" };

  const logo = (s: pptxgen.Slide, y = 0.11) => { if (A.logo) s.addImage({ data: pptData(A.logo.data), x: 12.64, y, w: 0.5, h: 0.5 }); };
  const shadow = (): pptxgen.ShadowProps => ({ type: "outer", angle: 45, blur: 15, offset: 12, color: "000000", opacity: 0.3 });
  const wideTitle = (s: pptxgen.Slide, t: string) => s.addText(t, { x: 2.88, y: 0.03, w: 7.17, h: 0.9, fontFace: "Arial",
    fontSize: 22, color: "FFFFFF", valign: "top", fill: { color: GREEN }, margin: [8, 10, 4, 10], isTextBox: true, shadow: shadow() });
  const dealerTitle = (s: pptxgen.Slide, t: string) => s.addText(t, { x: 3.69, y: 0.21, w: 6.17, h: 0.44, fontFace: "Arial",
    fontSize: 18, color: "FFFFFF", align: "center", valign: "middle", fill: { color: GREEN }, margin: 0, isTextBox: true, shadow: shadow() });
  const bgSlide = () => { const s = pptx.addSlide(); if (A.slideBg) s.background = { data: pptData(A.slideBg.data) }; return s; };

  const tableSlides = (t: RTable, make: (page: number, pages: number) => pptxgen.Slide,
    pos: { y: number; centred?: boolean }) => {
    const pages = Math.max(1, Math.ceil(t.body.length / t.rowsPerPage));
    const totW = t.colW.reduce((s, v) => s + v, 0);
    const width = pos.centred ? totW : W;
    const colW = t.colW.map((v) => (v * width) / totW);
    for (let p = 0; p < pages; p++) {
      const s = make(p, pages);
      const body = t.body.slice(p * t.rowsPerPage, (p + 1) * t.rowsPerPage);
      s.addTable([...t.head, ...body, ...(p === pages - 1 ? t.foot : [])].map((r) => r.map(toCell)), {
        x: pos.centred ? (W - width) / 2 : 0, y: pos.y, w: width, colW, fontFace: "Calibri", fontSize: t.fontSize,
        align: "center", valign: "middle", rowH: t.fontSize >= 9 ? 0.22 : 0.21, margin: 0.02,
        border: { type: "solid", pt: 0.5, color: GRID },
      });
    }
  };
  const pageTag = (p: number, n: number) => (n > 1 ? `  ·  ${p + 1}/${n}` : "");

  // 1. Cover
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    if (A.coverBg) s.addImage({ data: pptData(A.coverBg.data), x: 0.87, y: 0, w: 11.15, h: 7.5 });
    if (A.coverLogo) s.addImage({ data: pptData(A.coverLogo.data), x: 4.17, y: 2.82, w: 5.5, h: 1.69 });
    s.addText(`Date : ${model.longDate}`, { x: 0.35, y: 0.33, w: 3.4, h: 0.4, fontSize: 14, color: NAVY, margin: 0, isTextBox: true });
  }

  // 2. Daily Summary
  progress("Building daily summary…");
  if (model.summary.empty) {
    const s = pptx.addSlide(); logo(s); wideTitle(s, model.summary.title);
    s.addText("No post-activity data entered for this date.", { x: 0.5, y: 2.5, w: 12.3, h: 0.5, fontSize: 16,
      color: "7F7F7F", align: "center", isTextBox: true });
  } else {
    tableSlides(model.summary.table, (p, n) => { const s = pptx.addSlide(); s.background = { color: "FFFFFF" };
      logo(s); wideTitle(s, model.summary.title + pageTag(p, n)); return s; }, { y: 1.6 });
  }

  // 3. Lead Report
  if (model.lead) {
    progress("Building lead report…");
    const L = model.lead;
    tableSlides(L.table, (p, n) => { const s = pptx.addSlide(); s.background = { color: "FFFFFF" };
      logo(s); wideTitle(s, L.title + pageTag(p, n)); return s; }, { y: 1.64 });
  }

  // 4. Dealers
  let i = 0;
  for (const d of model.dealers) {
    progress(`Dealer ${++i}/${model.dealers.length}: ${d.title}`);
    tableSlides(d.table, (p, n) => {
      const s = bgSlide(); logo(s, 0.21); dealerTitle(s, d.title + (n > 1 ? ` (${p + 1}/${n})` : ""));
      s.addText(d.activityType, { x: 2.33, y: 0.8, w: 8.67, h: 0.3, fontSize: 11, color: NAVY, align: "center", bold: true, isTextBox: true, margin: 0 });
      return s;
    }, { y: 1.2, centred: true });

    for (let p = 0; p < d.photos.length; p += 4) {
      const s = bgSlide(); logo(s, 0.21); dealerTitle(s, d.title);
      const batch = d.photos.slice(p, p + 4);
      const imgs: (LoadedImage | null)[] = await Promise.all(batch.map((m) => loadPhoto(resolve(m.fileUrl))));
      const slotW = 3.0, slotH = 4.3, gap = (W - 0.6 - 4 * slotW) / 3;
      batch.forEach((m, j) => {
        const x = 0.3 + j * (slotW + gap), y = 1.35, img = imgs[j];
        if (img) s.addImage({ data: pptData(img.data), ...fit(img, x, y, slotW, slotH) });
        else s.addText("Photo could not be loaded", { x, y, w: slotW, h: slotH, fontSize: 11, color: "7F7F7F", align: "center", fill: { color: "F2F2F2" }, isTextBox: true });
        const cap = photoCaption(m);
        s.addText([{ text: `${cap.when}  ·  ` }, cap.link
          ? { text: cap.gps, options: { hyperlink: { url: cap.link }, color: "0563C1" } } : { text: cap.gps }],
          { x, y: y + slotH + 0.08, w: slotW, h: 0.3, fontSize: 8, color: NAVY, align: "center", isTextBox: true, margin: 0 });
      });
    }
  }

  // 5. Thank you
  {
    const s = pptx.addSlide();
    if (A.closingBg) s.background = { data: pptData(A.closingBg.data) };
    s.addShape(pptx.ShapeType.rect, { x: 0.42, y: 0.25, w: 5.33, h: 0.75, fill: { color: "FFFFFF" }, line: { color: "FFFFFF" } });
    s.addText("#Electricvehicles", { x: 1.08, y: 0.5, w: 4.08, h: 0.4, fontSize: 18, bold: true, color: NAVY, isTextBox: true, margin: 0 });
  }

  progress("Saving PPT…");
  const fileName = o.fileName ?? `${model.fileBase}.pptx`;
  const buf = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  await (o.save ?? ((d, f) => browserSave(d, f, "application/vnd.openxmlformats-officedocument.presentationml.presentation")))(buf, fileName);
  return fileName;
}

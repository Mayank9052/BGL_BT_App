// apply-changes-7.mjs — BGauss BTL, 27.10.2026 (part 7)
// Daily Activity Report → PPT / PDF / Excel: ALL photos of the selected From–To range
// (previously only the report day's photos, max 8 per activity).
// Copy first: src/utils/dailyReportCore.ts, dailyReportPpt.ts, dailyReportPdf.ts, dailyReportExcel.ts
// Run from the BGL_BT_App folder:   node apply-changes-7.mjs frontend
import fs from "fs";
import path from "path";

const MARK = "[BTL-2026-10-27d]";
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : fs.existsSync("frontend/src") ? path.resolve("frontend") : path.resolve(".");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

function edit(rel, fn) {
  try { editInner(rel, fn); }
  catch (e) { console.error(`✗ ${rel}: ${e.message} — file NOT changed`); process.exitCode = 1; }
}
function editInner(rel, fn) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Error(`Not found: ${file}`);
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(MARK)) { console.log(`= ${rel}: already patched, skipped`); return; }
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const api = makeApi(lines, rel);
  fn(api);
  fs.writeFileSync(`${file}.bak-${stamp}`, src);
  fs.writeFileSync(file, api.lines.join(eol));
  console.log(`✓ ${rel}: ${api.count} edit(s) applied (backup: ${path.basename(file)}.bak-${stamp})`);
}

function makeApi(lines, rel) {
  const api = {
    lines, count: 0,
    find(pred, from = 0, what = "") {
      for (let i = from; i < api.lines.length; i++) if (pred(api.lines[i].trim())) return i;
      throw new Error(`${rel}: anchor not found → ${what}`);
    },
    has: (s) => (t) => t.includes(s),
    eq: (s) => (t) => t === s,
    starts: (s) => (t) => t.startsWith(s),
    insertAfter(i, block) { api.lines.splice(i + 1, 0, ...block.split("\n")); api.count++; },
    insertBefore(i, block) { api.lines.splice(i, 0, ...block.split("\n")); api.count++; },
    replace(i, j, block) { api.lines.splice(i, j - i + 1, ...block.split("\n")); api.count++; },
  };
  return api;
}

edit("src/pages/AnalyticsDashboard.tsx", (A) => {
  A.insertBefore(A.find(A.has("onProgress: (m: string) => setPptBusy(m),"), 0, "exportDailyReport options"),
`        // ${MARK} photos = EVERY photo captured inside the From–To range shown on screen
        ...(dailyFrom || dailyTo ? {
          photoFrom: dailyFrom && dailyTo && dailyFrom > dailyTo ? dailyTo : (dailyFrom || undefined),
          photoTo:   dailyFrom && dailyTo && dailyFrom > dailyTo ? dailyFrom : (dailyTo || reportDate),
        } : {}),`);
});
console.log("\nDone. Next: npm run build");

// apply-changes-2.mjs — BGauss BTL, 26.10.2026 (part 2)
// Adds PDF and Excel downloads (same format as the Daily PPT) to AnalyticsDashboard.
// Run AFTER apply-changes.mjs:   node apply-changes-2.mjs frontend
// Needs the new files: src/utils/dailyReportCore.ts, dailyReportPdf.ts, dailyReportExcel.ts
// (and the updated dailyReportPpt.ts) + npm i jspdf@2.5.2 jspdf-autotable@3.8.4 exceljs@4.4.0
import fs from "fs";
import path from "path";

const V1 = "[BTL-2026-10-26]", MARK = "[BTL-2026-10-26b]";
const root = process.argv[2] ? path.resolve(process.argv[2])
  : fs.existsSync("frontend/src") ? path.resolve("frontend") : path.resolve(".");
const file = path.join(root, "src/pages/AnalyticsDashboard.tsx");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

try {
  if (!fs.existsSync(file)) throw new Error(`Not found: ${file}`);
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(MARK)) { console.log("= AnalyticsDashboard.tsx: already has PDF/Excel, skipped"); process.exit(0); }
  if (!src.includes(V1)) throw new Error("run apply-changes.mjs first (Daily PPT patch not found)");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const L = src.split(/\r?\n/);
  const find = (pred, from, what) => { for (let i = from; i < L.length; i++) if (pred(L[i].trim())) return i; throw new Error(`anchor not found → ${what}`); };

  // 1. imports
  const i1 = find((t) => t === 'import { buildDailyReportPpt } from "../utils/dailyReportPpt";', 0, "dailyReportPpt import");
  L.splice(i1 + 1, 0,
    `import { buildDailyReportPdf } from "../utils/dailyReportPdf";       // ${MARK}`,
    `import { buildDailyReportExcel } from "../utils/dailyReportExcel";   // ${MARK}`);

  // 2. handler: exportDailyPpt → exportDailyReport(format)
  const h1 = find((t) => t.startsWith("const exportDailyPpt = async () => {"), 0, "exportDailyPpt handler");
  const h2 = find((t) => t === "};", h1, "exportDailyPpt end");
  L.splice(h1, h2 - h1 + 1, ...`  // ${MARK} same report as PPT, PDF (with photos) or Excel (with photos)
  const exportDailyReport = async (format: "ppt" | "pdf" | "xlsx") => {
    const t = new Date();
    const today = \`\${t.getFullYear()}-\${String(t.getMonth()+1).padStart(2,"0")}-\${String(t.getDate()).padStart(2,"0")}\`;
    const reportDate = dailyTo || dailyFrom || today;
    setPptBusy("Preparing…");
    try {
      const opts = {
        reportDate,
        activities: filteredDailySummary.map(r => ({
          dealer: r.dealer, location: r.location, state: r.state, zone: r.zone, bgMember: r.bgMember,
          activityType: r.activityType, entries: r.allEntries, media: r.allMedia,
        })),
        leadRows: leadReportExportRows.filter(lr => !dailyStateSel.length || dailyStateSel.includes(lr.state)),
        resolveUrl: resolveMediaUrl,
        assetBase: \`\${import.meta.env.BASE_URL ?? "/"}ppt-assets/\`,
        onProgress: (m: string) => setPptBusy(m),
      };
      if (format === "ppt") await buildDailyReportPpt(opts);
      else if (format === "pdf") await buildDailyReportPdf(opts);
      else await buildDailyReportExcel(opts);
    } catch (e) {
      alert(\`Report could not be created: \${e instanceof Error ? e.message : String(e)}\`);
    } finally {
      setPptBusy(null);
    }
  };`.split("\n"));

  // 3. one button → three buttons
  const b1 = find((t) => t.includes("onClick={exportDailyPpt}"), 0, "Daily PPT button");
  const b2 = find((t) => t === "</button>", b1, "Daily PPT button end");
  L.splice(b1, b2 - b1 + 1, ...`            {/* ${MARK} Daily report — PPT / PDF / Excel, same format */}
            {pptBusy ? (
              <span style={{ display:"inline-flex",alignItems:"center",height:36,padding:"0 12px",marginRight:8,background:"#f1f5f9",
                border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,color:"#374151",fontWeight:600 }}>⏳ {pptBusy}</span>
            ) : ([
                ["ppt",  "⬇ PPT",   "#16a34a"],
                ["pdf",  "⬇ PDF",   "#dc2626"],
                ["xlsx", "⬇ Excel", "#15803d"],
              ] as const).map(([f, label, bg]) => (
                <button key={f} type="button" onClick={() => exportDailyReport(f)} disabled={filteredDailySummary.length===0}
                  title={\`Daily report (\${f.toUpperCase()}): Daily Summary, Lead Report, dealer daily sheets and GPS photos\`}
                  style={{ height:36,padding:"0 12px",marginRight:6,background:filteredDailySummary.length?bg:"#cbd5e1",color:"#fff",border:"none",
                    borderRadius:8,fontSize:12,fontWeight:700,cursor:filteredDailySummary.length?"pointer":"not-allowed" }}>
                  {label}
                </button>
              ))}`.split("\n"));

  fs.writeFileSync(`${file}.bak-${stamp}`, src);
  fs.writeFileSync(file, L.join(eol));
  console.log(`✓ AnalyticsDashboard.tsx: PDF + Excel added (backup: AnalyticsDashboard.tsx.bak-${stamp})`);
  console.log("Next: npm i jspdf@2.5.2 jspdf-autotable@3.8.4 exceljs@4.4.0 && npm run build");
} catch (e) {
  console.error(`✗ AnalyticsDashboard.tsx: ${e.message} — file NOT changed`);
  process.exitCode = 1;
}

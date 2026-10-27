// apply-changes-5.mjs — BGauss BTL, 27.10.2026 (part 5)
// Analytics → Daily Activity Report → dealer daily sheet: photos
//   • every photo / video viewable — click any thumbnail, "+N", the Total or the Average cell
//     → gallery with ◀ ▶ (keyboard ← → Esc), counter "3 / 37", time, GPS link, Open / Download
//   • counts match: photos are grouped by the LOCAL (IST) date; photos taken on a date that
//     has no daily row are shown as "N on other dates" (so day counts + other = Total)
//   • broken thumbnails fixed: URL built with the same API base as the other dashboards, with
//     fallbacks; if a file still can't be shown (e.g. HEIC) an icon is shown and it opens/downloads
//   • summary table "Photos" column now counts photos/videos only (not invoices / PDFs)
// Run from the BGL_BT_App folder (after parts 1–4):   node apply-changes-5.mjs frontend
import fs from "fs";
import path from "path";

const MARK = "[BTL-2026-10-27b]";
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

function appendCss(rel, css) {
  const file = path.join(root, rel);
  try {
    const src = fs.readFileSync(file, "utf8");
    if (src.includes(MARK)) { console.log(`= ${rel}: already patched, skipped`); return; }
    fs.writeFileSync(`${file}.bak-${stamp}`, src);
    fs.writeFileSync(file, src.replace(/\s*$/, "\n\n") + css + "\n");
    console.log(`✓ ${rel}: styles appended`);
  } catch (e) { console.error(`✗ ${rel}: ${e.message}`); process.exitCode = 1; }
}

edit("src/pages/AnalyticsDashboard.tsx", (A) => {
  // ── imports / URL resolver ────────────────────────────────────────────────
  A.insertAfter(A.find(A.eq('import "./AnalyticsDashboard.css";'), 0, "css import"),
`import { API_BASE_URL } from "../authConfig";   // ${MARK} same media base as Approver / Staff dashboards`);

  const ab = A.find(A.starts("const API_BASE = (import.meta.env.VITE_API_BASE_URL"), 0, "API_BASE");
  const rz = A.find(A.starts("const resolveMediaUrl = (url: string | null | undefined): string => {"), ab, "resolveMediaUrl");
  const rzEnd = A.find(A.eq("};"), rz, "resolveMediaUrl end");
  A.replace(ab, rzEnd,
`// ${MARK} media URLs — same API base as the other dashboards; handles "\\\\", missing "/", spaces
const API_BASE = String(API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "").replace(/\\/$/, "");
const cleanMediaPath = (url: string) => {
  let p = url.trim().replace(/\\\\/g, "/").replace(/^~\\//, "/");
  if (!p.startsWith("/")) p = \`/\${p}\`;
  return /%[0-9a-f]{2}/i.test(p) ? p : encodeURI(p);
};
const resolveMediaUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return \`\${API_BASE}\${cleanMediaPath(url)}\`;
};
// Tried in order when a thumbnail fails to load
const mediaUrlCandidates = (url: string | null | undefined): string[] => {
  if (!url) return [];
  if (/^(https?:|data:|blob:)/i.test(url)) return [url];
  const p = cleanMediaPath(url);
  const list = [\`\${API_BASE}\${p}\`, \`\${window.location.origin}\${p}\`];
  if (!/\\/uploads\\//i.test(p)) list.push(\`\${API_BASE}/uploads\${p}\`);
  return Array.from(new Set(list));
};`);

  // ── thumbnail + gallery components ───────────────────────────────────────
  A.insertAfter(A.find(A.starts("const isVideoType = (t: string | null) =>"), 0, "isVideoType"),
`
// ── ${MARK} thumbnail (falls back through URL candidates, then an icon) ──
function MediaThumb({ m, size = 30, onClick }: { m: ProofMedia; size?: number; onClick: () => void }) {
  const urls = useMemo(() => mediaUrlCandidates(m.fileUrl), [m.fileUrl]);
  const [i, setI] = useState(0);
  const img = isImageType(m.fileType) && i < urls.length;
  return (
    <button type="button" className="an-thumb" style={{ width: size, height: size }} onClick={onClick}
      title={\`\${m.fileName} · \${new Date(m.capturedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })} — click to view\`}>
      {img
        ? <img src={urls[i]} alt="" loading="lazy" onError={() => setI((x) => x + 1)}/>
        : <span className="an-thumb-icon">{isVideoType(m.fileType) ? "🎬" : isImageType(m.fileType) ? "🖼" : mediaIconFor(m.fileType)}</span>}
    </button>
  );
}

// ── ${MARK} gallery: every photo / video / file viewable, ◀ ▶, keyboard, counter ──
function MediaGallery({ items, index, title, onClose }: { items: ProofMedia[]; index: number; title: string; onClose: () => void }) {
  const [i, setI] = useState(Math.min(Math.max(index, 0), Math.max(items.length - 1, 0)));
  const [u, setU] = useState(0);
  const m = items[i];
  const urls = useMemo(() => (m ? mediaUrlCandidates(m.fileUrl) : []), [m]);
  useEffect(() => { setU(0); }, [i]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((x) => (x + 1) % items.length);
      else if (e.key === "ArrowLeft") setI((x) => (x - 1 + items.length) % items.length);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [items.length, onClose]);
  if (!m) return null;
  const url = urls[Math.min(u, urls.length - 1)] ?? "";
  const failed = u >= urls.length;
  const when = new Date(m.capturedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  return (
    <div className="an-gal" onClick={onClose}>
      <div className="an-gal-box" onClick={(e) => e.stopPropagation()}>
        <div className="an-gal-head">
          <div className="an-gal-title">{title}<span>{i + 1} / {items.length}</span></div>
          <div className="an-gal-meta">
            🕐 {when}
            {m.latitude != null && m.longitude != null
              ? <a href={\`https://maps.google.com/?q=\${m.latitude},\${m.longitude}\`} target="_blank" rel="noreferrer">📍 GPS {m.latitude.toFixed(5)}, {m.longitude.toFixed(5)}</a>
              : <span className="an-gal-nogps">No GPS</span>}
            <a href={url} target="_blank" rel="noreferrer">Open ↗</a>
            <a href={url} download={m.fileName}>⬇ Download</a>
          </div>
          <button type="button" className="an-gal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="an-gal-stage">
          {items.length > 1 && <button type="button" className="an-gal-nav an-gal-prev" aria-label="Previous"
            onClick={() => setI((x) => (x - 1 + items.length) % items.length)}>‹</button>}
          {isImageType(m.fileType) && !failed
            ? <img key={url} src={url} alt={m.fileName} onError={() => setU((x) => x + 1)}/>
            : isVideoType(m.fileType)
              ? <video key={url} src={url} controls autoPlay/>
              : <div className="an-gal-file">
                  <div style={{ fontSize: 48 }}>{isImageType(m.fileType) ? "🖼" : mediaIconFor(m.fileType)}</div>
                  <div className="an-gal-fname">{m.fileName}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
                    {isImageType(m.fileType) ? "This image format can't be previewed in the browser." : "Preview not available."}</div>
                  <a href={resolveMediaUrl(m.fileUrl)} target="_blank" rel="noreferrer">Open / Download ↗</a>
                </div>}
          {items.length > 1 && <button type="button" className="an-gal-nav an-gal-next" aria-label="Next"
            onClick={() => setI((x) => (x + 1) % items.length)}>›</button>}
        </div>
        <div className="an-gal-name">{m.fileName}</div>
        {items.length > 1 && (
          <div className="an-gal-strip">
            {items.map((x, k) => (
              <div key={x.id} className={\`an-gal-strip-item\${k === i ? " is-active" : ""}\`}>
                <MediaThumb m={x} size={52} onClick={() => setI(k)}/>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}`);

  // ── state ────────────────────────────────────────────────────────────────
  const st = A.find(A.starts("const [anMediaViewer, setAnMediaViewer]"), 0, "anMediaViewer state");
  A.replace(st, st,
`  const [anGallery, setAnGallery] = useState<{ items: ProofMedia[]; index: number; title: string } | null>(null);   // ${MARK}`);

  // ── summary table Photos = photos / videos only ──────────────────────────
  const ph = A.find(A.eq("photos: media.length,"), 0, "summary photos count");
  A.replace(ph, ph, `          photos: media.filter(m => isImageType(m.fileType) || isVideoType(m.fileType)).length,   // ${MARK}`);

  // ── viewer block → gallery ───────────────────────────────────────────────
  const v0 = A.find(A.eq("{anMediaViewer && ("), 0, "old media viewer");
  const v1 = A.find(A.eq(")}"), v0, "old media viewer end");
  A.replace(v0, v1,
`          {anGallery && <MediaGallery items={anGallery.items} index={anGallery.index} title={anGallery.title} onClose={() => setAnGallery(null)}/>}`);

  // ── dealer sheet: group media by LOCAL date ──────────────────────────────
  const en = A.find(A.eq("const entries = selectedDealerDaily.dailyEntries;"), v0, "dealer sheet entries");
  A.insertAfter(en,
`            // ${MARK} photos grouped by LOCAL (IST) date → day counts + "other dates" = Total
            const sheetPhotos = selectedDealerDaily.media
              .filter(m => isImageType(m.fileType) || isVideoType(m.fileType))
              .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
            const sheetFiles = selectedDealerDaily.media.filter(m => !isImageType(m.fileType) && !isVideoType(m.fileType));
            const entryDates = new Set(entries.map(e => (e.date || "").slice(0, 10)));
            const photosOn = (d: string) => sheetPhotos.filter(m => toLocalIso(m.capturedAt) === d);
            const filesOn  = (d: string) => sheetFiles.filter(m => toLocalIso(m.capturedAt) === d);
            const otherDayPhotos = sheetPhotos.filter(m => !entryDates.has(toLocalIso(m.capturedAt)));
            const sheetName = \`\${selectedDealerDaily.dealer}, \${selectedDealerDaily.location}\`;
            const openGallery = (items: ProofMedia[], start: ProofMedia | number, title: string) =>
              setAnGallery({ items, index: typeof start === "number" ? start : Math.max(0, items.indexOf(start)), title });`);

  A.insertAfter(A.find(A.has('{ label:"Activity Days", value: entries.length },'), en, "KPI Activity Days"),
`                    { label:"Photos", value: sheetPhotos.length },`);

  const pd = A.find(A.has("const photosOnDay = selectedDealerDaily.media.filter(m =>"), en, "photosOnDay");
  const pdEnd = A.find(A.has("!isImageType(m.fileType) && !isVideoType(m.fileType));"), pd, "invoicesOnDay");
  A.replace(pd, pdEnd,
`                      const photosOnDay   = photosOn((entry.date || "").slice(0, 10));   // ${MARK}
                      const invoicesOnDay = filesOn((entry.date || "").slice(0, 10));`);

  const c0 = A.find(A.has("{photosOnDay.slice(0,3).map(m => {"), pd, "media cell thumbnails") - 2;
  if (!A.lines[c0].trim().startsWith("{td(")) throw new Error("AnalyticsDashboard: media cell {td( not found");
  const cNone = A.find(A.has("{photosOnDay.length===0 && invoicesOnDay.length===0"), c0, "media cell empty");
  const c1 = A.find(A.eq(")}"), cNone, "media cell end");
  A.replace(c0, c1,
`                          {td(
                            <div className="an-media-cell">
                              {photosOnDay.slice(0, 3).map(m => (
                                <MediaThumb key={m.id} m={m} size={30}
                                  onClick={() => openGallery(photosOnDay, m, \`\${sheetName} · \${entry.date}\`)}/>
                              ))}
                              {photosOnDay.length > 3 && (
                                <button type="button" className="an-media-more" title={\`View all \${photosOnDay.length} photos of \${entry.date}\`}
                                  onClick={() => openGallery(photosOnDay, 3, \`\${sheetName} · \${entry.date}\`)}>+{photosOnDay.length - 3}</button>
                              )}
                              {invoicesOnDay.length > 0 && (
                                <button type="button" className="an-media-more an-media-more--file" title={\`\${invoicesOnDay.length} invoice / file(s)\`}
                                  onClick={() => openGallery(invoicesOnDay, 0, \`\${sheetName} · \${entry.date} · invoices\`)}>🧾{invoicesOnDay.length}</button>
                              )}
                              {photosOnDay.length === 0 && invoicesOnDay.length === 0 && <span style={{ color:"#cbd5e1",fontSize:10 }}>—</span>}
                            </div>
                          )}`);

  const tt = A.find(A.has('{td("📸"+selectedDealerDaily.media.filter('), c0, "Total media cell");
  A.replace(tt, tt,
`                      {td(sheetPhotos.length > 0
                        ? <button type="button" className="an-media-total" title="View all photos of this sheet"
                            onClick={() => openGallery(sheetPhotos, 0, \`\${sheetName} · all photos\`)}>📸 {sheetPhotos.length} · View all</button>
                        : "📸 0", { background:"#93c5fd", fontSize:10 })}`);

  const ar = A.find(A.has('{td(avgRow.retailMtd, { background:"#fef9c3" })}'), tt, "Average row last value");
  const am = A.find(A.eq('{td("—", { fontSize:10, color:"#94a3b8" })}'), ar, "Average row media cell");
  if (am !== ar + 1) throw new Error("AnalyticsDashboard: Average media cell not where expected");
  A.replace(am, am,
`                      {td(otherDayPhotos.length > 0
                        ? <button type="button" className="an-media-more an-media-more--other"
                            title="Photos whose capture date has no row in this sheet"
                            onClick={() => openGallery(otherDayPhotos, 0, \`\${sheetName} · other dates\`)}>📅 {otherDayPhotos.length} on other dates</button>
                        : "—", { fontSize:10, color:"#94a3b8" })}`);
});

appendCss("src/pages/AnalyticsDashboard.css", `/* ═══ ${MARK} dealer sheet media: thumbnails, counts, gallery ═══ */
.an-media-cell { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; align-items: center; }
.an-thumb {
  padding: 0; border: 1px solid #bbf7d0; border-radius: 5px; overflow: hidden; background: #f0fdf4;
  cursor: zoom-in; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: transform .1s, box-shadow .15s;
}
.an-thumb:hover { transform: scale(1.08); box-shadow: 0 2px 8px rgba(0,0,0,.18); }
.an-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.an-thumb-icon { font-size: 14px; line-height: 1; }
.an-media-more, .an-media-total {
  border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; border-radius: 5px;
  font: 700 10px/1 'Segoe UI', system-ui, sans-serif; padding: 5px 6px; cursor: pointer; white-space: nowrap;
}
.an-media-more:hover, .an-media-total:hover { background: #16a34a; color: #fff; border-color: #16a34a; }
.an-media-more--file  { border-color: #e2e8f0; background: #f8fafc; color: #475569; }
.an-media-more--other { border-color: #fde68a; background: #fffbeb; color: #92400e; }
.an-media-total { background: #fff; border-color: #fff; color: #0a2540; }

.an-gal { position: fixed; inset: 0; z-index: 10000; background: rgba(2,6,23,.9); display: flex; align-items: center; justify-content: center; padding: 16px; }
.an-gal-box { width: min(1100px, 100%); max-height: 100%; display: flex; flex-direction: column; background: #0f172a; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.an-gal-head { position: relative; padding: 12px 52px 10px 16px; border-bottom: 1px solid #1e293b; color: #e2e8f0; }
.an-gal-title { font-weight: 700; font-size: 14px; display: flex; gap: 10px; align-items: center; }
.an-gal-title span { font-size: 11px; font-weight: 700; background: #1e293b; color: #93c5fd; border-radius: 10px; padding: 2px 8px; }
.an-gal-meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: #94a3b8; margin-top: 4px; }
.an-gal-meta a { color: #86efac; text-decoration: none; font-weight: 600; }
.an-gal-meta a:hover { text-decoration: underline; }
.an-gal-nogps { color: #64748b; }
.an-gal-close { position: absolute; top: 10px; right: 12px; width: 32px; height: 32px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; cursor: pointer; font-size: 14px; }
.an-gal-close:hover { background: #334155; }
.an-gal-stage { position: relative; flex: 1; min-height: 300px; display: flex; align-items: center; justify-content: center; background: #020617; padding: 8px 56px; }
.an-gal-stage img, .an-gal-stage video { max-width: 100%; max-height: 62vh; border-radius: 6px; display: block; }
.an-gal-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; border-radius: 50%; border: none; background: rgba(255,255,255,.12); color: #fff; font-size: 26px; line-height: 1; cursor: pointer; }
.an-gal-nav:hover { background: rgba(255,255,255,.25); }
.an-gal-prev { left: 8px; } .an-gal-next { right: 8px; }
.an-gal-file { text-align: center; color: #e2e8f0; padding: 30px; }
.an-gal-file a { display: inline-block; background: #16a34a; color: #fff; padding: 8px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; }
.an-gal-fname { font-weight: 600; margin: 8px 0 4px; word-break: break-all; }
.an-gal-name { font-size: 11px; color: #64748b; text-align: center; padding: 6px 12px 0; word-break: break-all; }
.an-gal-strip { display: flex; gap: 6px; overflow-x: auto; padding: 10px 12px 12px; }
.an-gal-strip-item { border: 2px solid transparent; border-radius: 7px; flex-shrink: 0; }
.an-gal-strip-item.is-active { border-color: #22c55e; }
.an-gal-strip .an-thumb { border-color: #334155; background: #1e293b; }
@media (max-width: 640px) { .an-gal-stage { padding: 8px 8px 48px; } .an-gal-nav { top: auto; bottom: 6px; transform: none; } }`);

console.log("\nDone. Next: npm run build");

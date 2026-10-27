// apply-changes-6.mjs — BGauss BTL, 27.10.2026 (part 6)
// Approver Dashboard: pagination for the proposal table
//   • 10 / 25 / 50 / 100 rows per page (default 25), « ‹ 1 2 … 9 › », "Showing 26–50 of 137"
//   • pager above and below the table; bottom pager scrolls back to the table top
//   • goes back to page 1 whenever a filter, the search or the date range changes
//   • "select all" checkboxes still select ALL filtered proposals (all pages) — count shown in the bar
// Run from the BGL_BT_App folder (after parts 1–4):   node apply-changes-6.mjs frontend
import fs from "fs";
import path from "path";

const MARK = "[BTL-2026-10-27c]";
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

edit("src/pages/ApproverDashboard.tsx", (A) => {
  if (!A.lines.join("\n").includes("[BTL-2026-10-26c]")) throw new Error("run apply-changes-3.mjs (part 3) first");

  // ── Pager component (module level) ───────────────────────────────────────
  A.insertBefore(A.find(A.starts("export default function"), 0, "component start"),
`// ── ${MARK} table pager ──────────────────────────────────────────────────
function ApPager({ page, pageSize, total, onPage, onPageSize, scrollTop }: {
  page: number; pageSize: number; total: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void; scrollTop?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => {
    onPage(Math.min(Math.max(1, p), pages));
    if (scrollTop) document.querySelector(".ap-table-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div className="ap-pager">
      <span className="ap-pager-info">Showing <b>{from}–{to}</b> of <b>{total}</b></span>
      <label className="ap-pager-size">Rows
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="ap-pager-btns">
        <button type="button" disabled={page <= 1} onClick={() => go(1)} title="First page">«</button>
        <button type="button" disabled={page <= 1} onClick={() => go(page - 1)} title="Previous page">‹</button>
        {nums.map((n, i) => n === "…"
          ? <span key={\`e\${i}\`} className="ap-pager-gap">…</span>
          : <button type="button" key={n} className={n === page ? "is-active" : ""} onClick={() => go(n)}
              aria-current={n === page ? "page" : undefined}>{n}</button>)}
        <button type="button" disabled={page >= pages} onClick={() => go(page + 1)} title="Next page">›</button>
        <button type="button" disabled={page >= pages} onClick={() => go(pages)} title="Last page">»</button>
      </div>
    </div>
  );
}
`);

  // ── state + helpers ──────────────────────────────────────────────────────
  A.insertBefore(A.find(A.starts("const toggleActuals=(activityId:string)=>"), 0, "toggleActuals"),
`  // ── ${MARK} pagination ──
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    try { return Number(localStorage.getItem("ap_page_size")) || 25; } catch { return 25; }
  });
  const changePageSize = (n: number) => {
    setPageSize(n); setPage(1);
    try { localStorage.setItem("ap_page_size", String(n)); } catch { /* ignore */ }
  };
  useEffect(() => { setPage(1); },
    [statusSel, monthSel, yearSel, stateSel, dealerStatusSel, search, submittedFrom, submittedTo, fwdDateFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const paginate = <T,>(rows: T[]): T[] => rows.slice((curPage - 1) * pageSize, curPage * pageSize);
`);

  // ── table body: only the current page ────────────────────────────────────
  const tw = A.find(A.eq('<div className="ap-table-wrap">'), 0, "ap-table-wrap");
  const tb = A.find(A.has("<tbody>"), tw, "<tbody>");
  let m = -1;
  for (let i = tb; i < A.lines.length; i++) {
    if (A.lines[i].includes("</tbody>")) break;
    if (/filtered/.test(A.lines[i]) && /\.map\(\s*\(?\s*p\b/.test(A.lines[i])) { m = i; break; }
  }
  if (m < 0) throw new Error("ApproverDashboard: the row loop (…filtered….map((p…) was not found in <tbody>");
  const line = A.lines[m];
  const mapAt = line.search(/\.map\(\s*\(?\s*p\b/);
  const lead = line.search(/\S/);
  const open = line[lead] === "{" ? lead : line.lastIndexOf("{", mapAt);
  if (open < 0) throw new Error("ApproverDashboard: row loop expression start not found");
  let start = open + 1;
  const and = line.lastIndexOf("&&", mapAt);          // {cond && filtered.map(...)} → wrap only the list
  if (and > start) start = and + 2;
  const expr = line.slice(start, mapAt);
  const ws = expr.match(/^\s*/)[0];
  A.lines[m] = line.slice(0, start) + ws + "paginate(" + expr.trim() + ")" + line.slice(mapAt);

  // ── pagers above and below the table ─────────────────────────────────────
  A.insertBefore(tw,
`            {/* ${MARK} pager */}
            {filtered.length > 0 && <ApPager page={curPage} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={changePageSize}/>}`);
  const te = A.find(A.has("</table>"), tw, "</table>");
  const we = A.find(A.eq("</div>"), te, "ap-table-wrap end");
  A.insertAfter(we,
`            {filtered.length > pageSize && <ApPager page={curPage} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={changePageSize} scrollTop/>}`);
});

appendCss("src/pages/ApproverDashboard.css", `/* ═══ ${MARK} pagination ═══ */
.ap-pager {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 4px; margin: 4px 0; font-size: 12px; color: #64748b;
}
.ap-pager-info b { color: #0a2540; }
.ap-pager-size { display: inline-flex; align-items: center; gap: 6px; }
.ap-pager-size select {
  height: 30px; padding: 0 6px; border: 1.5px solid #e2e8f0; border-radius: 6px;
  background: #fff; color: #0a2540; font-size: 12px; font-family: inherit; cursor: pointer;
}
.ap-pager-btns { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.ap-pager-btns button {
  min-width: 30px; height: 30px; padding: 0 8px; border: 1.5px solid #e2e8f0; border-radius: 6px;
  background: #fff; color: #0a2540; font-size: 12px; font-weight: 600; cursor: pointer;
  font-family: inherit; transition: background .12s, border-color .12s;
}
.ap-pager-btns button:hover:not(:disabled):not(.is-active) { background: #f1f5f9; border-color: #cbd5e1; }
.ap-pager-btns button.is-active { background: #0a2540; border-color: #0a2540; color: #fff; cursor: default; }
.ap-pager-btns button:disabled { opacity: .4; cursor: not-allowed; }
.ap-pager-gap { padding: 0 4px; color: #94a3b8; }
@media (max-width: 640px) { .ap-pager-btns { margin-left: 0; width: 100%; justify-content: center; } }`);

console.log("\nDone. Next: npm run build");

// apply-changes-8.mjs — BGauss BTL, 27.10.2026 (part 8)
// Approver Dashboard: "Forward Selected to Final Approver" now sends ONE state-wise summary
// mail IMMEDIATELY (from the Checker's own mailbox, she is cc'd) — no more midnight digest.
// Adds a status banner: last summary sent + "⚠ N forwarded not yet mailed → Send now".
// Copy first: src/services/forwardSummaryService.ts, src/components/ForwardSummaryStatus.tsx
// Run from the BGL_BT_App folder:   node apply-changes-8.mjs frontend
import fs from "fs";
import path from "path";

const MARK = "[BTL-2026-10-27e]";
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

edit("src/pages/ApproverDashboard.tsx", (A) => {
  A.insertAfter(A.find(A.eq('import CnPanel from "../components/CnPanel";'), 0, "CnPanel import"),
`import { forwardNow, type ForwardSummaryMailResult } from "../services/forwardSummaryService";   // ${MARK}
import ForwardSummaryStatus from "../components/ForwardSummaryStatus";`);

  // old bulk import is no longer used
  for (let i = 0; i < Math.min(A.lines.length, 40); i++)
    if (A.lines[i].includes("forwardProposalsBulk, ")) { A.lines[i] = A.lines[i].replace("forwardProposalsBulk, ", ""); break; }

  A.insertBefore(A.find(A.starts("const toggleActuals=(activityId:string)=>"), 0, "toggleActuals"),
`  const [lastForwardMail, setLastForwardMail] = useState<ForwardSummaryMailResult | null>(null);   // ${MARK}`);

  const mid = A.find(A.has("Final Approver receives 1 digest email at midnight"), 0, "midnight note");
  A.lines[mid] = `                <span style={{ color:"#93c5fd",fontSize:11 }}>📧 ONE state-wise summary mail goes to the Final Approver immediately (copy to you)</span>`;

  const f0 = A.find(A.has("const result = await forwardProposalsBulk(Array.from(selectedIds), instance);"), mid, "bulk forward call");
  const f1 = A.find(A.has("loadProposals();"), f0, "reload after forward");
  A.replace(f0, f1,
`                    // ${MARK} forward + state-wise summary mail NOW (no midnight digest)
                    const result = await forwardNow(Array.from(selectedIds), instance);
                    setSelectedIds(new Set());
                    setLastForwardMail(result.mail);
                    const m = result.mail;
                    showToast(
                      \`✓ \${result.forwarded} proposal\${result.forwarded===1?"":"s"} forwarded\` +
                      (result.failed>0 ? \` · \${result.failed} failed\` : "") +
                      (result.skipped>0 ? \` · \${result.skipped} already forwarded\` : "") +
                      (m ? (m.sent ? \` · summary mailed to \${m.to.join(", ")}\` : " · ⚠ summary mail NOT sent — see banner") : ""),
                      result.failed===0 && (!m || m.sent));
                    if (result.failedDetails?.length) console.warn("[FORWARD-NOW] failures", result.failedDetails);
                    loadProposals();`);

  A.insertBefore(A.find(A.has("{isAdmin&&!isFinalApprover&&selectedIds.size>0&&("), 0, "bulk forward bar"),
`            {/* ${MARK} was the summary mailed? + send anything still waiting */}
            {isAdmin&&!isFinalApprover&&<ForwardSummaryStatus instance={instance} refreshKey={proposals} lastMail={lastForwardMail}/>}`);
});
console.log("\nDone. Next: npm run build");

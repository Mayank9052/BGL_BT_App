// apply-changes-4.mjs — BGauss BTL, 27.10.2026 (part 4)
// Run from the BGL_BT_App folder (after parts 1–3):   node apply-changes-4.mjs frontend
// Copy first: src/utils/pdfTable.ts, src/utils/dailyReportPdf.ts,
//             src/components/DownloadReportButton.tsx + DownloadReportButton.css
//
//   ApproverDashboard.tsx  — Review / View / Delete as icon buttons, meaning shown on hover
//   ApproverDashboard.css  — icon-button + tooltip styles, fixes duplicated .ap-reject-btn rules
//   AnalyticsDashboard.tsx — Daily Activity Report: ONE "Download ▾" menu (PPT · Excel · PDF in the
//                            report format, CSV = table) instead of 3 buttons + old menu
//   AnalyticsDashboard.css — busy chip
//   AdminDealerMapPage.tsx — "Incorrect? Override" for the RRERP Dealer Type, with reason
import fs from "fs";
import path from "path";

const MARK = "[BTL-2026-10-27]";
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : fs.existsSync("frontend/src") ? path.resolve("frontend") : path.resolve(".");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const need = (A, marker, what) => { if (!A.lines.join("\n").includes(marker)) throw new Error(`run ${what} first`); };

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
    if (!fs.existsSync(file)) throw new Error(`Not found: ${file}`);
    const src = fs.readFileSync(file, "utf8");
    if (src.includes(MARK)) { console.log(`= ${rel}: already patched, skipped`); return; }
    fs.writeFileSync(`${file}.bak-${stamp}`, src);
    fs.writeFileSync(file, src.replace(/\s*$/, "\n\n") + css + "\n");
    console.log(`✓ ${rel}: styles appended (backup: ${path.basename(file)}.bak-${stamp})`);
  } catch (e) { console.error(`✗ ${rel}: ${e.message}`); process.exitCode = 1; }
}

// Opening tag end, skipping ">" inside {...} (e.g. onClick={()=>x})
function tagEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

const SVG_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_REVIEW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
const SVG_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

// ════════════════════════════════════════════════════════════════════════════
// 1. ApproverDashboard.tsx — icon buttons with hover meaning
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/ApproverDashboard.tsx", (A) => {
  need(A, "[BTL-2026-10-26]", "apply-changes.mjs (part 1)");

  // Delete button (inserted by part 1) → icon button
  const dTitle = A.find(A.has('title="Delete proposal (Admin)"'), 0, "table Delete button");
  const d0 = dTitle - 1;
  if (!A.lines[d0].includes("{isSuperAdmin&&(")) throw new Error("ApproverDashboard: Delete button wrapper not found");
  const d1 = A.find(A.eq(")}"), dTitle, "Delete button end");
  A.replace(d0, d1,
`                          {isSuperAdmin&&(
                            <button type="button" className="ap-icon-btn ap-icon-btn--danger" aria-label="Delete proposal"
                              disabled={deletingId===p.id} onClick={()=>handleDeleteProposal(p)}>
                              {deletingId===p.id ? <span className="ap-spin-sm"/> : ${SVG_TRASH}}
                              <span className="ap-tip" role="tooltip">Delete proposal (Admin)</span>
                            </button>
                          )}`);

  // Action cell → flex group; Review / View buttons → icons + tooltip
  const t0 = A.find(A.eq("<td onClick={(e)=>e.stopPropagation()}>"), 0, "Action <td>");
  const t1 = A.find(A.eq("</td>"), t0, "Action </td>");
  A.lines[t0] = A.lines[t0].replace("<td onClick=", '<td className="ap-action-cell" onClick=') + '\n                          <div className="ap-action-group">';
  A.lines[t1] = "                          </div>\n" + A.lines[t1];

  let block = A.lines.slice(t0, t1 + 1).join("\n");
  let pos = 0, count = 0;
  for (;;) {
    const s = block.indexOf('<button className="ap-review-btn"', pos);
    if (s < 0) break;
    const gt = tagEnd(block, s);
    const close = block.indexOf("</button>", gt);
    if (gt < 0 || close < 0) throw new Error("ApproverDashboard: Review button markup not understood");
    const attrs = block.slice(s + '<button className="ap-review-btn"'.length, gt);
    const inner = block.slice(gt + 1, close).trim();
    const expr = /^\{([\s\S]+)\}$/.exec(inner);
    const labelJsx = expr ? `{${expr[1]}}` : inner;
    const labelAttr = expr ? `{String(${expr[1]})}` : JSON.stringify(inner);
    const icon = expr
      ? `{/review/i.test(String(${expr[1]})) ? ${SVG_REVIEW} : ${SVG_EYE}}`
      : (/review/i.test(inner) ? SVG_REVIEW : SVG_EYE);
    const rep = `<button type="button" className="ap-review-btn ap-icon-btn"${attrs} aria-label=${labelAttr}>${icon}<span className="ap-tip" role="tooltip">${labelJsx}</span></button>`;
    block = block.slice(0, s) + rep + block.slice(close + "</button>".length);
    pos = s + rep.length; count++;
  }
  if (!count) throw new Error("ApproverDashboard: no Review/View button found in the Action cell");
  A.lines.splice(t0, t1 - t0 + 1, ...block.split("\n"));
  A.insertBefore(t0, `                        {/* ${MARK} Review / View / Delete = icon buttons; meaning shows on hover */}`);
});

appendCss("src/pages/ApproverDashboard.css", `/* ═══ ${MARK} Action column: icon buttons + hover tooltip ═══ */
.ap-action-cell  { white-space: nowrap; width: 1%; }
.ap-action-group { display: inline-flex; align-items: center; gap: 6px; }
.ap-icon-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0 !important; margin: 0 !important;
  border-radius: 8px; border: 1px solid transparent; cursor: pointer; flex-shrink: 0;
  font-family: inherit; transition: background .15s, color .15s, box-shadow .15s, transform .1s;
}
.ap-icon-btn svg { width: 16px; height: 16px; display: block; }
.ap-review-btn.ap-icon-btn { background: #0a2540; color: #fff; }
.ap-review-btn.ap-icon-btn:hover { background: #1e3a5f; box-shadow: 0 2px 8px rgba(10,37,64,.30); }
.ap-icon-btn--danger { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
.ap-icon-btn--danger:hover:not(:disabled) { background: #dc2626; color: #fff; border-color: #dc2626; box-shadow: 0 2px 8px rgba(220,38,38,.30); }
.ap-icon-btn:active:not(:disabled) { transform: scale(.94); }
.ap-icon-btn:disabled { opacity: .55; cursor: wait; }
.ap-icon-btn:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }

/* tooltip — hidden until hover / keyboard focus; left-aligned so it is never cut off */
.ap-tip {
  position: absolute; left: 0; bottom: calc(100% + 8px); transform: translateY(4px);
  background: #0a2540; color: #fff; font-size: 11px; font-weight: 600; line-height: 1;
  padding: 6px 9px; border-radius: 6px; white-space: nowrap; pointer-events: none;
  opacity: 0; visibility: hidden; z-index: 30; box-shadow: 0 4px 12px rgba(0,0,0,.18);
  transition: opacity .12s ease, transform .12s ease, visibility .12s;
}
.ap-tip::after {
  content: ""; position: absolute; top: 100%; left: 10px;
  border: 5px solid transparent; border-top-color: #0a2540;
}
.ap-icon-btn:hover .ap-tip, .ap-icon-btn:focus-visible .ap-tip { opacity: 1; visibility: visible; transform: translateY(0); }
.ap-icon-btn--danger .ap-tip { background: #991b1b; }
.ap-icon-btn--danger .ap-tip::after { border-top-color: #991b1b; }
/* first row: show the tooltip BELOW so the dark table header never hides it */
.ap-table tbody tr:first-child .ap-tip { bottom: auto; top: calc(100% + 8px); transform: translateY(-4px); }
.ap-table tbody tr:first-child .ap-icon-btn:hover .ap-tip { transform: translateY(0); }
.ap-table tbody tr:first-child .ap-tip::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: #0a2540; }
.ap-table tbody tr:first-child .ap-icon-btn--danger .ap-tip::after { border-bottom-color: #991b1b; }
@media (hover: none) { .ap-tip { display: none; } }   /* touch screens: aria-label is enough */

/* ═══ ${MARK} fixes for rules that were defined twice in this file ═══ */
/* .ap-reject-btn was redefined (padding 10px 22px, margin-top 8px) and broke the Approve / Reject row */
.ap-btn-row .ap-reject-btn { flex: 1; padding: 9px; margin-top: 0; font-size: 13px; border-radius: 7px; background: #991b1b; }
.ap-btn-row .ap-reject-btn:hover:not(:disabled) { background: #7f1d1d; }
/* .ap-badge-revision was redefined bigger — keep the compact size inside the proposal table */
.ap-table .ap-badge-revision { padding: 2px 8px; border-radius: 10px; font-size: 10px; }`);

// ════════════════════════════════════════════════════════════════════════════
// 2. AnalyticsDashboard.tsx — one Download menu for the Daily Activity Report
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/AnalyticsDashboard.tsx", (A) => {
  need(A, "[BTL-2026-10-26b]", "apply-changes-2.mjs (part 2)");
  const s0 = A.find(A.has("{/* [BTL-2026-10-26b] Daily report — PPT / PDF / Excel, same format */}"), 0, "Daily report buttons");
  const wrap = s0 - 1;
  if (!A.lines[wrap].includes('<div style={{ marginLeft:"auto" }}>')) throw new Error("AnalyticsDashboard: download wrapper <div> not found");
  A.lines[wrap] = A.lines[wrap].replace('<div style={{ marginLeft:"auto" }}>', '<div style={{ marginLeft:"auto",display:"flex",alignItems:"center",gap:8 }}>');
  const r = A.find(A.has("rows={filteredDailySummary as any}"), s0, "summary DownloadReportButton rows");
  const e = A.find(A.eq("/>"), r, "summary DownloadReportButton end");
  A.replace(s0, e,
`            {/* ${MARK} ONE Download menu: PPT · Excel · PDF in the Project-Towns report format, CSV = this table */}
            {pptBusy && <span className="an-busy-chip">⏳ {pptBusy}</span>}
            <DownloadReportButton
              filename="Daily_Activity_Report"
              title="Daily Activity Sheet Summary"
              subtitle={dailyFrom || dailyTo ? \`\${dailyFrom || "…"} to \${dailyTo || "…"}\` : undefined}
              columns={dailySummaryExportColumns}
              rows={filteredDailySummary as any}
              disabled={!!pptBusy}
              custom={{
                ppt:  () => exportDailyReport("ppt"),
                xlsx: () => exportDailyReport("xlsx"),
                pdf:  () => exportDailyReport("pdf"),
              }}
            />`);
});

appendCss("src/pages/AnalyticsDashboard.css", `/* ═══ ${MARK} Daily report download ═══ */
.an-busy-chip {
  display: inline-flex; align-items: center; height: 36px; padding: 0 12px;
  background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 12px; font-weight: 600; color: #374151; white-space: nowrap;
  max-width: 280px; overflow: hidden; text-overflow: ellipsis;
}`);

// ════════════════════════════════════════════════════════════════════════════
// 3. AdminDealerMapPage.tsx — override an incorrect RRERP Dealer Type
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/AdminDealerMapPage.tsx", (A) => {
  need(A, "[BTL-2026-10-26c]", "apply-changes-3.mjs (part 3)");
  A.insertAfter(A.find(A.starts("const [statusBusy,"), 0, "statusBusy state"),
`  // ${MARK} Admin override of an incorrect RRERP Old / New (after cross-check, reason required)
  const [typeOverride,   setTypeOverride]   = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const overrideRef = useRef(false);   // read inside autoType (async) — never overwrite an overridden type`);

  const at = A.find(A.has("setForm((f) => ({ ...f, dealerType: t }));"), 0, "autoType setForm");
  A.lines[at] = A.lines[at].replace("setForm((f) => ({ ...f, dealerType: t }));", "if (!overrideRef.current) setForm((f) => ({ ...f, dealerType: t }));");

  const oc = A.find(A.has('setSelectedErpDealerCode(""); setTypeAuto(null);'), 0, "openCreate");
  A.lines[oc] = A.lines[oc] + ' overrideRef.current = false; setTypeOverride(false); setOverrideReason("");';

  A.insertBefore(A.find(A.has("if (row.dealerCode) autoType(row.dealerCode); else setTypeAuto(null);"), oc, "openEdit autoType"),
`    { const ov = row as unknown as { dealerTypeOverride?: boolean; dealerTypeOverrideReason?: string | null };
      overrideRef.current = !!ov.dealerTypeOverride; setTypeOverride(!!ov.dealerTypeOverride);
      setOverrideReason(ov.dealerTypeOverrideReason ?? ""); }`);

  A.insertBefore(A.find(A.has("autoType(d.customerCode);"), oc, "ERP pick autoType"),
`    overrideRef.current = false; setTypeOverride(false); setOverrideReason("");`);

  A.insertAfter(A.find(A.has('pick an active Commando or "No Commando".'), 0, "inactive Commando check"),
`    if (typeOverride && overrideReason.trim().length < 5) { setFormError("Give a reason (min 5 characters) for overriding the RRERP Dealer Type."); return; }`);

  A.insertAfter(A.find(A.has("commandoEmail: form.commandoEmail?.trim() || null,"), 0, "payload"),
`        dealerTypeOverride: typeOverride,                                   // ${MARK}
        dealerTypeOverrideReason: typeOverride ? overrideReason.trim() : null,`);

  const f0 = A.find(A.starts("<div><label style={labelStyle}>Dealer Type{typeAuto &&"), 0, "Dealer Type field");
  const f1 = A.find(A.has("</div></div>"), f0, "Dealer Type field end");
  const link = '{{ background: "none", border: "none", color: "#2563eb", fontSize: 10, fontWeight: 700, cursor: "pointer", padding: 0 }}';
  A.replace(f0, f1,
`                <div><label style={labelStyle}>Dealer Type
                    {typeAuto && !typeOverride && <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6, color: "#16a34a" }}>🔒 from RRERP</span>}
                    {typeOverride && <span style={{ fontWeight: 700, textTransform: "none", marginLeft: 6, color: "#b45309" }}>✎ overridden</span>}</label>
                  <select value={form.dealerType ?? "Old"} disabled={(!!typeAuto && !typeOverride) || typeLoading}
                    style={{ ...inputStyle,
                      background: typeOverride ? "#fffbeb" : typeAuto ? "#f0fdf4" : "#fff",
                      borderColor: typeOverride ? "#f59e0b" : "#e2e8f0",
                      cursor: typeAuto && !typeOverride ? "not-allowed" : "pointer" }}
                    onChange={(e) => setForm((f) => ({ ...f, dealerType: e.target.value }))}>
                    <option value="Old">Old</option><option value="New">New</option>
                  </select>
                  <div style={{ fontSize: 10, marginTop: 3, color: typeOverride ? "#92400e" : typeAuto ? "#166534" : "#9ca3af" }}>
                    {typeLoading ? "Checking RRERP…"
                      : typeOverride
                        ? <>RRERP says <b>{typeAuto?.type ?? "—"}</b>{typeAuto ? \` — \${typeAuto.reason}\` : ""} ·{" "}
                            <button type="button" style=${link}
                              onClick={() => { overrideRef.current = false; setTypeOverride(false); setOverrideReason("");
                                if (typeAuto) setForm((f) => ({ ...f, dealerType: typeAuto.type })); }}>↺ Use RRERP value</button></>
                      : typeAuto
                        ? <>{typeAuto.reason} ·{" "}
                            <button type="button" style=${link} title="Cross-checked and RRERP is wrong? Change it with a reason."
                              onClick={() => { overrideRef.current = true; setTypeOverride(true); }}>Incorrect? Override</button></>
                      : form.dealerCode
                        ? <button type="button" style=${link} onClick={() => autoType(form.dealerCode ?? "")}>Get Old / New from RRERP</button>
                        : "Manual dealer (no Dealer Code) — choose Old / New"}
                  </div>
                  {typeOverride && (
                    <textarea rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Reason — what was cross-checked (e.g. first RRERP sale bill 12.08.2026 is a demo invoice; first retail 05.10.2026)"
                      style={{ ...inputStyle, marginTop: 6, fontSize: 12, borderColor: overrideReason.trim().length >= 5 ? "#f59e0b" : "#ef4444", resize: "vertical" }}/>
                  )}
                  {typeOverride && <div style={{ fontSize: 10, color: "#92400e", marginTop: 2 }}>
                    Override is kept: the 12-hourly RRERP refresh will not change it, and the CAC limit follows this type.</div>}
                </div>`);

  const tv = A.find(A.eq('{r.dealerType ?? "—"}'), 0, "table Type cell");
  A.insertAfter(A.find(A.eq("</span>"), tv, "table Type badge end"),
`                  {(r as unknown as { dealerTypeOverride?: boolean }).dealerTypeOverride && (
                    <span title={\`Overridden by \${(r as unknown as { dealerTypeOverrideBy?: string }).dealerTypeOverrideBy ?? "Admin"}: \${(r as unknown as { dealerTypeOverrideReason?: string }).dealerTypeOverrideReason ?? ""}\`}
                      style={{ marginLeft: 4, fontSize: 9, fontWeight: 800, color: "#92400e", background: "#fef3c7",
                        border: "1px solid #fde68a", borderRadius: 4, padding: "0 4px", cursor: "help" }}>OVERRIDE</span>
                  )}`);
});

console.log("\nDone. Next: npm run build");

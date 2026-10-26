// apply-changes.mjs — BGauss BTL, 26.10.2026
// Run from the repo root:   node apply-changes.mjs
//   (or pass the frontend folder:  node apply-changes.mjs C:\path\to\BGL_BT_App\frontend)
//
// Patches 3 files in place (a .bak-<timestamp> copy is written first; safe to re-run):
//   src/pages/AnalyticsDashboard.tsx  — Daily Activity Report: custom date range, multi-select
//                                       State / Dealer / Activity filters, "Daily PPT" download
//   src/pages/ApproverDashboard.tsx   — Admin-only Delete (table + modal), Checker
//                                       "Send summary to Final Approver" button
//   src/services/proposalService.ts   — deleteProposal(), sendForwardSummary()
// Copy these new files first (from this package):
//   src/components/MultiSelectDropdown.tsx, src/utils/dailyReportPpt.ts, public/ppt-assets/*

import fs from "fs";
import path from "path";

const MARK = "[BTL-2026-10-26]";
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

// ════════════════════════════════════════════════════════════════════════════
// 1. AnalyticsDashboard.tsx
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/AnalyticsDashboard.tsx", (A) => {
  // imports
  A.insertAfter(A.find(A.eq('import "./AnalyticsDashboard.css";'), 0, "css import"),
`// ${MARK} multi-select filters + custom date range + Daily PPT
import MultiSelectDropdown from "../components/MultiSelectDropdown";
import { buildDailyReportPpt } from "../utils/dailyReportPpt";`);

  // row type: keep full (unfiltered) entries/media for the PPT's month-to-date figures
  A.replace(...(() => { const i = A.find(A.eq("dailyEntries: DailyEntry[]; media: ProofMedia[];"), 0, "DailySummaryRow fields"); return [i, i]; })(),
`  dailyEntries: DailyEntry[]; media: ProofMedia[];
  allEntries: DailyEntry[]; allMedia: ProofMedia[];   // ${MARK} unfiltered — PPT needs MTD`);

  // filter state → multi-select + date range (+ helpers)
  const s1 = A.find(A.starts("const [dailyStateFilter, setDailyStateFilter]"), 0, "dailyStateFilter state");
  const s2 = A.find(A.starts("const [dailyActivityTypeFilter, setDailyActivityTypeFilter]"), s1, "dailyActivityTypeFilter state");
  A.replace(s1, s2,
`  // ── ${MARK} Daily Activity Report filters: multi-select (empty = All) + custom date range ──
  const [dailyStateSel,   setDailyStateSel]   = useState<string[]>([]);
  const [dailyDealerSel,  setDailyDealerSel]  = useState<string[]>([]);
  const [dailyActTypeSel, setDailyActTypeSel] = useState<string[]>([]);
  const [dailyFrom,       setDailyFrom]       = useState("");   // yyyy-MM-dd, "" = no lower bound
  const [dailyTo,         setDailyTo]         = useState("");   // yyyy-MM-dd, "" = no upper bound
  const [pptBusy,         setPptBusy]         = useState<string | null>(null);
  const dailyRangeActive = !!(dailyFrom || dailyTo);
  const toLocalIso = (s: string) => {
    const d = new Date(s);
    if (isNaN(d.getTime())) return (s || "").slice(0, 10);
    return \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,"0")}-\${String(d.getDate()).padStart(2,"0")}\`;
  };
  const inDailyRange = (iso: string) => {
    const d = (iso || "").slice(0, 10);
    const lo = dailyFrom && dailyTo && dailyFrom > dailyTo ? dailyTo : dailyFrom;
    const hi = dailyFrom && dailyTo && dailyFrom > dailyTo ? dailyFrom : dailyTo;
    return (!lo || d >= lo) && (!hi || d <= hi);
  };
  const dailyRowMatches = useMemo(() => (row: DailySummaryRow) => {
    if (dailyStateSel.length   && !dailyStateSel.includes(row.state))         return false;
    if (dailyDealerSel.length  && !dailyDealerSel.includes(row.dealer))       return false;
    if (dailyActTypeSel.length && !dailyActTypeSel.includes(row.activityType)) return false;
    if (dailySearch) {
      const q = dailySearch.toLowerCase();
      return (row.dealer+row.location+row.state+row.bgMember).toLowerCase().includes(q);
    }
    return true;
  }, [dailyStateSel, dailyDealerSel, dailyActTypeSel, dailySearch]);`);

  // liveDailySummary: apply the date range to entries + media
  const e1 = A.find(A.eq("let entries: DailyEntry[] = [];"), 0, "let entries");
  A.replace(e1, e1 + 1,
`        let allEntries: DailyEntry[] = [];
        if (dailyData) { try { allEntries = JSON.parse(dailyData); } catch {} }
        // ${MARK} custom date range — rows, totals and the dealer sheet use only days inside the range
        const entries = allEntries.filter(e => inDailyRange(e.date));`);
  const m1 = A.find(A.starts("const media: ProofMedia[] = rawMedia.map("), e1, "media map");
  A.lines[m1] = A.lines[m1].replace("const media: ProofMedia[]", "const allMedia: ProofMedia[]");
  const m2 = A.find(A.has("latitude: m.latitude ?? null, longitude: m.longitude ?? null,"), m1, "media map end");
  const m3 = A.find(A.eq("}));"), m2, "media map close");
  A.insertAfter(m3,
`        const media = allMedia.filter(m => inDailyRange(toLocalIso(m.capturedAt)));
        if (dailyRangeActive && entries.length === 0 && media.length === 0) continue;   // ${MARK}`);
  const p1 = A.find(A.eq("dailyEntries: entries, media,"), m3, "row push");
  A.lines[p1] = A.lines[p1].replace("dailyEntries: entries, media,", "dailyEntries: entries, media, allEntries, allMedia,");
  const r1 = A.find(A.eq("return rows;"), p1, "return rows");
  const r2 = A.find(A.eq("}, [approved]);"), r1, "liveDailySummary deps");
  A.lines[r2] = A.lines[r2].replace("}, [approved]);", "}, [approved, dailyFrom, dailyTo]);");

  // KPI totals follow the same filters as the table
  const t1 = A.find(A.eq("const src = liveDailySummary;"), r2, "dsTotals src");
  A.lines[t1] = A.lines[t1].replace("const src = liveDailySummary;", "const src = liveDailySummary.filter(dailyRowMatches);");
  const t2 = A.find(A.eq("}, [liveDailySummary]);"), t1, "dsTotals deps");
  A.lines[t2] = A.lines[t2].replace("}, [liveDailySummary]);", "}, [liveDailySummary, dailyRowMatches]);");

  // filteredDailySummary + option lists
  const f1 = A.find(A.starts("const filteredDailySummary = useMemo(() => liveDailySummary.filter(row => {"), 0, "filteredDailySummary");
  const f2 = A.find(A.starts("}), [liveDailySummary, dailySearch,"), f1, "filteredDailySummary end");
  A.replace(f1, f2,
`  const filteredDailySummary = useMemo(
    () => liveDailySummary.filter(dailyRowMatches), [liveDailySummary, dailyRowMatches]);   // ${MARK}
  const dailyStateOptions = useMemo(
    () => Array.from(new Set(liveDailySummary.map(r => r.state).filter(Boolean))).sort(), [liveDailySummary]);
  const dailyDealerOptions = useMemo(() => Array.from(new Set(liveDailySummary
    .filter(r => !dailyStateSel.length || dailyStateSel.includes(r.state))
    .map(r => r.dealer).filter(Boolean))).sort(), [liveDailySummary, dailyStateSel]);`);

  // filter bar
  const b1 = A.find(A.starts("<select value={dailyStateFilter}"), f2, "daily state <select>");
  const b2 = A.find(A.has("Clear ✕</button>"), b1, "daily Clear button");
  const b3 = A.find(A.eq(")}"), b2, "daily Clear button close");
  A.replace(b1, b3,
`          {/* ${MARK} multi-select filters + custom date range */}
          <MultiSelectDropdown label="States" options={dailyStateOptions} value={dailyStateSel}
            onChange={(v)=>{ setDailyStateSel(v); setDailyDealerSel(prev=>prev.filter(d=>!v.length||liveDailySummary.some(r=>r.dealer===d&&v.includes(r.state)))); }} width={170}/>
          <MultiSelectDropdown label="Dealers" options={dailyDealerOptions} value={dailyDealerSel} onChange={setDailyDealerSel} width={200}/>
          <MultiSelectDropdown label="Activity Types" options={dailyActivityTypes.filter(t=>t!=="All")} value={dailyActTypeSel} onChange={setDailyActTypeSel} width={190}/>
          <div style={{ display:"flex",alignItems:"center",gap:6,height:36,padding:"0 8px",border:\`1.5px solid \${dailyRangeActive?"#2563eb":"#e2e8f0"}\`,
            borderRadius:8,background:dailyRangeActive?"#eff6ff":"#fff" }}>
            <span style={{ fontSize:11,color:"#64748b",fontWeight:700 }}>From</span>
            <input type="date" value={dailyFrom} max={dailyTo||undefined} onChange={e=>setDailyFrom(e.target.value)}
              style={{ border:"none",background:"transparent",fontSize:12,fontFamily:"inherit",outline:"none" }}/>
            <span style={{ fontSize:11,color:"#64748b",fontWeight:700 }}>To</span>
            <input type="date" value={dailyTo} min={dailyFrom||undefined} onChange={e=>setDailyTo(e.target.value)}
              style={{ border:"none",background:"transparent",fontSize:12,fontFamily:"inherit",outline:"none" }}/>
          </div>
          {(()=>{ const t=new Date(); const iso=(d:Date)=>\`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,"0")}-\${String(d.getDate()).padStart(2,"0")}\`;
            const y=new Date(t); y.setDate(t.getDate()-1);
            const chip=(lbl:string,f:string,to:string)=>(
              <button key={lbl} type="button" onClick={()=>{setDailyFrom(f);setDailyTo(to);}}
                style={{ height:28,padding:"0 10px",borderRadius:14,border:"1px solid #e2e8f0",fontSize:11,fontWeight:600,cursor:"pointer",
                  background:dailyFrom===f&&dailyTo===to?"#0a2540":"#fff",color:dailyFrom===f&&dailyTo===to?"#fff":"#374151" }}>{lbl}</button>);
            return (<>{chip("Today",iso(t),iso(t))}{chip("Yesterday",iso(y),iso(y))}{chip("MTD",iso(new Date(t.getFullYear(),t.getMonth(),1)),iso(t))}</>);
          })()}
          {(dailySearch||dailyStateSel.length>0||dailyDealerSel.length>0||dailyActTypeSel.length>0||dailyRangeActive)&&(
            <button onClick={()=>{setDailySearch("");setDailyStateSel([]);setDailyDealerSel([]);setDailyActTypeSel([]);setDailyFrom("");setDailyTo("");}}
              style={{ height:36,padding:"0 14px",background:"none",border:"1.5px solid #e2e8f0",
                borderRadius:8,fontSize:12,cursor:"pointer",color:"#64748b" }}>Clear ✕</button>
          )}`);

  // Daily PPT button, next to the Excel download
  const d1 = A.find(A.has('filename="Daily_Activity_Sheet_Summary"'), b1, "Daily_Activity_Sheet_Summary download");
  let d0 = d1; while (d0 > 0 && !A.lines[d0].trim().startsWith("<DownloadReportButton")) d0--;
  A.insertBefore(d0,
`            <button type="button" onClick={exportDailyPpt} disabled={!!pptBusy || filteredDailySummary.length===0}
              title="Daily report in the Project Towns PPT format: Daily Summary, Lead Report, dealer daily sheets and GPS photos"
              style={{ height:36,padding:"0 14px",marginRight:8,background:pptBusy?"#94a3b8":"#16a34a",color:"#fff",border:"none",
                borderRadius:8,fontSize:12,fontWeight:700,cursor:pptBusy?"wait":"pointer" }}>
              {pptBusy ? \`⏳ \${pptBusy}\` : "⬇ Daily PPT"}
            </button>`);

  // export handler (before the loading early-return)
  const L = A.find(A.eq("if (loading) return ("), 0, "if (loading) return (");
  A.insertBefore(L,
`  // ── ${MARK} Daily PPT — same format as "Project_Towns_<date>.pptx" ──
  // Report day = "To" date (or today). Uses the State / Dealer / Activity filters.
  const exportDailyPpt = async () => {
    const t = new Date();
    const today = \`\${t.getFullYear()}-\${String(t.getMonth()+1).padStart(2,"0")}-\${String(t.getDate()).padStart(2,"0")}\`;
    const reportDate = dailyTo || dailyFrom || today;
    setPptBusy("Preparing…");
    try {
      await buildDailyReportPpt({
        reportDate,
        activities: filteredDailySummary.map(r => ({
          dealer: r.dealer, location: r.location, state: r.state, zone: r.zone, bgMember: r.bgMember,
          activityType: r.activityType, entries: r.allEntries, media: r.allMedia,
        })),
        leadRows: leadReportExportRows.filter(lr => !dailyStateSel.length || dailyStateSel.includes(lr.state)),
        resolveUrl: resolveMediaUrl,
        assetBase: \`\${import.meta.env.BASE_URL ?? "/"}ppt-assets/\`,
        onProgress: (m) => setPptBusy(m),
      });
    } catch (e) {
      alert(\`PPT could not be created: \${e instanceof Error ? e.message : String(e)}\`);
    } finally {
      setPptBusy(null);
    }
  };
`);
});

// ════════════════════════════════════════════════════════════════════════════
// 2. ApproverDashboard.tsx
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/ApproverDashboard.tsx", (A) => {
  const i1 = A.find(A.has("forwardProposalToApprover, forwardProposalsBulk, notifyDealer, addActivityMedia,"), 0, "proposalService import");
  A.lines[i1] = A.lines[i1].replace("addActivityMedia,", `addActivityMedia, deleteProposal, sendForwardSummary, // ${MARK}`);

  const r1 = A.find(A.starts("const isForwardOnly"), 0, "isForwardOnly");
  A.insertAfter(r1,
`  // ── ${MARK} Delete = Admin role only (not Manager) ──
  const isSuperAdmin    = user?.role === "Admin";
  const [deletingId,     setDeletingId]     = useState<string|null>(null);
  const [summarySending, setSummarySending] = useState(false);`);

  const h1 = A.find(A.starts("const toggleActuals=(activityId:string)=>"), 0, "toggleActuals");
  A.insertBefore(h1,
`  // ── ${MARK} Admin: permanently delete a proposal (typed-token confirmation) ──
  const handleDeleteProposal = async (p: ProposalResponse) => {
    if (!isSuperAdmin || deletingId) return;
    const token = p.tokenNumber ?? p.id.slice(-6);
    const extra = p.status === "Approved"
      ? "\\n\\n⚠ This proposal is APPROVED — its post-activity data, photos, invoices and approval history will also be deleted."
      : "";
    const typed = window.prompt(
      \`Delete proposal \${token} — \${p.dealerName} (\${p.month} \${p.year})?\${extra}\\n\\nThis cannot be undone. Type the token number to confirm:\`);
    if (typed === null) return;
    if (typed.trim() !== token) { showToast("Token did not match — nothing was deleted.", false); return; }
    setDeletingId(p.id);
    try {
      await deleteProposal(p.id, instance);
      setProposals(prev => prev.filter(x => x.id !== p.id));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(p.id); return n; });
      setNotifySelectedIds(prev => { const n = new Set(prev); n.delete(p.id); return n; });
      if (selected?.id === p.id) closeModal();
      showToast(\`Proposal \${token} deleted.\`, true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed.", false);
    } finally { setDeletingId(null); }
  };

  // ── ${MARK} Checker: ONE summary mail to the Final Approver (individual forward mails are off) ──
  const forwardedPendingCount = proposals.filter(p => p.checkedByEmail && p.status === "Pending").length;
  const handleSendForwardSummary = async () => {
    if (summarySending) return;
    if (!window.confirm(\`Send ONE summary mail to the Final Approver covering \${forwardedPendingCount} forwarded proposal(s)?\`)) return;
    setSummarySending(true);
    try {
      const r = await sendForwardSummary(instance);
      showToast(\`Summary sent to Final Approver — \${r.proposals} proposal(s).\`, true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Summary mail failed.", false);
    } finally { setSummarySending(false); }
  };
`);

  const a1 = A.find(A.has(': <button className="ap-review-btn" onClick={()=>openModal(p)}>'), 0, "table Review/View button");
  A.insertAfter(a1,
`                          {isSuperAdmin&&(
                            <button type="button" title="Delete proposal (Admin)" disabled={deletingId===p.id}
                              onClick={()=>handleDeleteProposal(p)}
                              style={{ marginLeft:6,background:"#fee2e2",color:"#991b1b",border:"1px solid #fecaca",borderRadius:6,
                                padding:"4px 8px",fontSize:12,fontWeight:700,cursor:deletingId===p.id?"wait":"pointer" }}>
                              {deletingId===p.id?"…":"🗑"}
                            </button>
                          )}`);

  const c1 = A.find(A.has("<button onClick={closeModal}"), 0, "modal Close button");
  A.insertBefore(c1,
`              {isSuperAdmin&&<button onClick={()=>handleDeleteProposal(selected)} disabled={deletingId===selected.id}
                style={{ background:"#dc2626",border:"1px solid #ef4444",color:"#fff",borderRadius:7,padding:"6px 14px",fontSize:13,
                  cursor:deletingId===selected.id?"wait":"pointer",fontWeight:700 }}>
                {deletingId===selected.id?"Deleting…":"🗑 Delete"}</button>}`);

  const f1 = A.find(A.has('<button className="ap-refresh-btn" onClick={loadProposals}>'), 0, "Refresh button");
  A.insertAfter(f1,
`              {isChecker&&(
                <button type="button" onClick={handleSendForwardSummary} disabled={summarySending||forwardedPendingCount===0}
                  title="Send ONE summary mail to the Final Approver for all forwarded proposals pending approval"
                  style={{ height:32,padding:"0 12px",background:forwardedPendingCount?"#1e3a5f":"#cbd5e1",color:"#fff",border:"none",
                    borderRadius:6,fontSize:12,fontWeight:700,cursor:summarySending||!forwardedPendingCount?"not-allowed":"pointer" }}>
                  {summarySending?"Sending…":\`📤 Send summary to Final Approver (\${forwardedPendingCount})\`}
                </button>
              )}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. proposalService.ts
// ════════════════════════════════════════════════════════════════════════════
edit("src/services/proposalService.ts", (A) => {
  A.insertAfter(A.lines.length - 1,
`
// ── ${MARK} Admin: permanently delete a proposal (DELETE /api/proposals/{id}) ──
export async function deleteProposal(
  id: string,
  instance: IPublicClientApplication,
): Promise<void> {
  const token = await getAccessToken(instance);
  const res = await fetch(\`\${API_BASE_URL}/api/proposals/\${id}\`, {
    method: "DELETE",
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = JSON.parse(text)?.message ?? text; } catch {}
    throw new Error(msg || \`Delete failed (\${res.status})\`);
  }
}

// ── ${MARK} Checker: ONE summary mail to the Final Approver (POST /api/proposals/forward-summary) ──
export async function sendForwardSummary(
  instance: IPublicClientApplication,
  since?: string,
): Promise<{ sent: boolean; proposals: number }> {
  const token = await getAccessToken(instance);
  const qs = since ? \`?since=\${encodeURIComponent(since)}\` : "";
  const res = await fetch(\`\${API_BASE_URL}/api/proposals/forward-summary\${qs}\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = JSON.parse(text)?.message ?? text; } catch {}
    throw new Error(msg || \`Summary failed (\${res.status})\`);
  }
  return res.json();
}`);
});

console.log("\nDone. Next: npm i pptxgenjs@3.12.0 (if not already), then npm run build.");

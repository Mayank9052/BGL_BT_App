// apply-changes-3.mjs — BGauss BTL, 26.10.2026 (part 3)
// Run from the BGL_BT_App folder:   node apply-changes-3.mjs frontend
// Needs part 1 (apply-changes.mjs) already applied to ApproverDashboard / AnalyticsDashboard.
// Copy first: src/services/dealerStatusService.ts  (and src/components/MultiSelectDropdown.tsx from part 1)
//
//   ApproverDashboard.tsx  — multi-select Status / Month / Year / State / Dealer Status,
//                            Month+Year default = current month, Submitted From–To,
//                            Admin multi-select bulk Delete, hint for pending in other months
//   AnalyticsDashboard.tsx — multi-select Year / Month / Status / Dealer Status (default current
//                            month), Daily Activity Report ignores header month & defaults to MTD
//   AdminDealerMapPage.tsx — Active / Inactive per dealer, Old/New auto from RRERP (locked),
//                            inactive RSM/TSM/Commando flagged + blocked, "Refresh Old/New" button
//   RSMForm.tsx            — inactive dealers hidden from the dealer list
//   StaffDashboard.tsx     — Month + Year default = current month
import fs from "fs";
import path from "path";

const MARK = "[BTL-2026-10-26c]";
const V1   = "[BTL-2026-10-26]";
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

// ════════════════════════════════════════════════════════════════════════════
// 1. ApproverDashboard.tsx
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/ApproverDashboard.tsx", (A) => {
  need(A, V1, "apply-changes.mjs (part 1)");
  A.insertAfter(A.find(A.eq('import CnPanel from "../components/CnPanel";'), 0, "CnPanel import"),
`import MultiSelectDropdown from "../components/MultiSelectDropdown";   // ${MARK}
import { fetchDealerStatus, buildInactiveMatcher } from "../services/dealerStatusService";`);

  const s1 = A.find(A.starts("const [filterStatus,"), 0, "filterStatus state");
  const s2 = A.find(A.starts("const [filterState,"), s1, "filterState state");
  A.replace(s1, s2,
`  // ── ${MARK} multi-select filters (empty = All); Month & Year default to the current month ──
  const [statusSel,       setStatusSel]       = useState<string[]>([]);
  const [monthSel,        setMonthSel]        = useState<string[]>([MONTHS[new Date().getMonth()]]);
  const [yearSel,         setYearSel]         = useState<string[]>([String(CURRENT_YEAR)]);
  const [stateSel,        setStateSel]        = useState<string[]>([]);
  const [dealerStatusSel, setDealerStatusSel] = useState<string[]>([]);
  const [isDealerInactive, setIsDealerInactive] =
    useState<(code?: string | null, name?: string | null) => boolean>(() => () => false);
  const [deleteSel,       setDeleteSel]       = useState<Set<string>>(new Set());
  const [bulkDeleting,    setBulkDeleting]    = useState<string | null>(null);
  // single-status view used by the stat cards (click a card = only that status)
  const filterStatus = statusSel.length === 1 ? statusSel[0] : "All";
  const setFilterStatus = (s: string) => setStatusSel(s === "All" ? [] : [s]);
  useEffect(() => {
    fetchDealerStatus(instance).then((rows) => setIsDealerInactive(() => buildInactiveMatcher(rows))).catch(() => {});
  }, [instance]);`);

  const sd = A.find(A.starts("const [submittedDateFilter, setSubmittedDateFilter]"), 0, "submittedDateFilter state");
  A.replace(sd, sd,
`  const [submittedFrom, setSubmittedFrom] = useState("");   // ${MARK} Submitted date range (createdAt)
  const [submittedTo,   setSubmittedTo]   = useState("");`);

  const mo = A.find(A.starts("const months"), 0, "months memo");
  A.replace(mo, mo,
`  const months   = useMemo(()=>{ const s=new Set(proposals.map(p=>p.month).filter(Boolean)); s.add(MONTHS[new Date().getMonth()]); return MONTHS.filter(m=>s.has(m)); },[proposals]);`);
  const ye = A.find(A.starts("const years"), mo, "years memo");
  A.replace(ye, ye,
`  const years    = useMemo(()=>Array.from(new Set([...proposals.map(p=>String((p as any).year ?? "")).filter(Boolean), String(CURRENT_YEAR)])).sort(),[proposals]);`);

  const f1 = A.find(A.starts("const filtered = useMemo(()=>proposals.filter((p)=>{"), 0, "filtered memo");
  const f2 = A.find(A.starts("}),[proposals,filterStatus,filterMonth"), f1, "filtered memo end");
  A.replace(f1, f2,
`  const filtered = useMemo(()=>proposals.filter((p)=>{
    if (statusSel.length && !statusSel.includes(p.status)) return false;
    if (monthSel.length  && !monthSel.includes(p.month)) return false;
    if (yearSel.length   && !yearSel.includes(String((p as any).year ?? ""))) return false;
    if (stateSel.length  && !stateSel.includes(p.state)) return false;
    if (dealerStatusSel.length) {
      const st = isDealerInactive((p as any).dealerCode, p.dealerName) ? "Inactive" : "Active";
      if (!dealerStatusSel.includes(st)) return false;
    }
    if (fwdDateFilter) {
      if (!p.checkedAt) return false;
      if (isoDate(new Date(p.checkedAt)) !== fwdDateFilter) return false;
    }
    // Submitted column (createdAt) — From / To, inclusive
    if (submittedFrom || submittedTo) {
      if (!p.createdAt) return false;
      const d = isoDate(new Date(p.createdAt));
      if (submittedFrom && d < submittedFrom) return false;
      if (submittedTo   && d > submittedTo)   return false;
    }
    if (search){ const q=search.toLowerCase();
      return p.dealerName.toLowerCase().includes(q)||p.rsmName.toLowerCase().includes(q)||
            p.location.toLowerCase().includes(q)||(p.tokenNumber??"").toLowerCase().includes(q); }
    return true;
  }),[proposals,statusSel,monthSel,yearSel,stateSel,dealerStatusSel,isDealerInactive,search,fwdDateFilter,submittedFrom,submittedTo]);
  // Pending proposals hidden only by the Month / Year selection (shown as a hint)
  const pendingOutsidePeriod = useMemo(() => proposals.filter((p) => p.status === "Pending" && (
    (monthSel.length > 0 && !monthSel.includes(p.month)) ||
    (yearSel.length  > 0 && !yearSel.includes(String((p as any).year ?? ""))))).length,
    [proposals, monthSel, yearSel]);`);

  const j1 = A.find(A.starts('<select className="ap-select" value={filterStatus}'), 0, "status <select>");
  const j2 = A.find(A.has('<button className="ap-refresh-btn"'), j1, "Refresh button");
  A.replace(j1, j2 - 1,
`              {/* ${MARK} multi-select filters */}
              <MultiSelectDropdown label="Statuses" options={["Pending","Approved","Rejected","NeedsRevision"]} value={statusSel} onChange={setStatusSel} width={150}/>
              <MultiSelectDropdown label="Months" options={months} value={monthSel} onChange={setMonthSel} width={150}/>
              <MultiSelectDropdown label="Years" options={years} value={yearSel} onChange={setYearSel} width={120}/>
              <MultiSelectDropdown label="States" options={statesList.filter(s=>s!=="All")} value={stateSel} onChange={setStateSel} width={160}/>
              <MultiSelectDropdown label="Dealer Status" options={["Active","Inactive"]} value={dealerStatusSel} onChange={setDealerStatusSel} width={150}/>`);

  const k0 = A.find(A.has(">Submitted Date:</label>"), 0, "Submitted Date label");
  let k1 = k0 - 1;
  if (!A.lines[k1].trim().startsWith("<div")) throw new Error("ApproverDashboard: Submitted Date wrapper <div> not found");
  const k2 = A.find(A.has('setSubmittedDateFilter("")'), k0, "Submitted Date clear button");
  const k3 = A.find(A.eq("</div>"), k2, "Submitted Date wrapper end");
  const dateStyle = '{{ height:32,padding:"0 8px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12 }}';
  A.replace(k1, k3,
`              <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                <label style={{ fontSize:12,color:"#64748b",fontWeight:600 }}>Submitted:</label>
                <input type="date" value={submittedFrom} max={submittedTo||undefined} style=${dateStyle}
                  title="Submitted FROM (date the RSM submitted). Picking a date clears the Month / Year filter."
                  onChange={e=>{ setSubmittedFrom(e.target.value); if (e.target.value) { setMonthSel([]); setYearSel([]); } }}/>
                <span style={{ fontSize:12,color:"#64748b" }}>to</span>
                <input type="date" value={submittedTo} min={submittedFrom||undefined} style=${dateStyle}
                  title="Submitted TO (inclusive)"
                  onChange={e=>{ setSubmittedTo(e.target.value); if (e.target.value) { setMonthSel([]); setYearSel([]); } }}/>
                {(submittedFrom||submittedTo)&&<button onClick={()=>{setSubmittedFrom("");setSubmittedTo("");}}
                  style={{ background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:12 }}>✕</button>}
              </div>`);

  const cs = A.find(A.has("colSpan={isAdmin?(isChecker?17:16):12}"), 0, "empty-row colSpan");
  A.lines[cs] = A.lines[cs].replace("colSpan={isAdmin?(isChecker?17:16):12}", "colSpan={(isAdmin?(isChecker?17:16):12)+(isSuperAdmin?1:0)}");

  const th = A.find(A.has("<th>Action</th><th>Token</th>"), 0, "table header Action/Token");
  A.insertBefore(th,
`                  {isSuperAdmin&&(
                    <th style={{ width:40,textAlign:"center",padding:"8px 6px" }} title="Select proposals to delete (Admin)">
                      <input type="checkbox" checked={filtered.length>0&&filtered.every(p=>deleteSel.has(p.id))}
                        onChange={(e)=>setDeleteSel(e.target.checked?new Set(filtered.map(p=>p.id)):new Set())}
                        style={{ width:15,height:15,cursor:"pointer",accentColor:"#dc2626" }}/>
                      <div style={{ fontSize:9,color:"#dc2626" }}>🗑 all</div>
                    </th>
                  )}`);

  const td = A.find(A.eq("<td onClick={(e)=>e.stopPropagation()}>"), th, "Action <td>");
  A.insertBefore(td,
`                        {isSuperAdmin&&(
                          <td style={{ textAlign:"center",padding:"8px 6px" }} onClick={(e)=>e.stopPropagation()}>
                            <input type="checkbox" checked={deleteSel.has(p.id)} title="Select to delete"
                              onChange={()=>setDeleteSel(prev=>{ const n=new Set(prev); n.has(p.id)?n.delete(p.id):n.add(p.id); return n; })}
                              style={{ width:15,height:15,cursor:"pointer",accentColor:"#dc2626" }}/>
                          </td>
                        )}`);

  const tw = A.find(A.eq('<div className="ap-table-wrap">'), 0, "ap-table-wrap");
  A.insertBefore(tw,
`            {/* ${MARK} pending proposals outside the selected Month / Year */}
            {pendingOutsidePeriod>0&&(monthSel.length>0||yearSel.length>0)&&(
              <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"8px 14px",marginBottom:10,
                fontSize:12,color:"#92400e",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
                ⚠ {pendingOutsidePeriod} pending proposal{pendingOutsidePeriod!==1?"s":""} from other months / years {pendingOutsidePeriod!==1?"are":"is"} hidden by the Month / Year filter.
                <button onClick={()=>{setMonthSel([]);setYearSel([]);}}
                  style={{ background:"#f59e0b",color:"#fff",border:"none",borderRadius:6,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer" }}>
                  Show all months</button>
              </div>
            )}
            {/* ${MARK} Admin bulk delete */}
            {isSuperAdmin&&deleteSel.size>0&&(
              <div style={{ background:"#7f1d1d",borderRadius:10,padding:"12px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
                <span style={{ color:"#fee2e2",fontSize:13,fontWeight:700 }}>🗑 {deleteSel.size} proposal{deleteSel.size>1?"s":""} selected for deletion</span>
                <button onClick={handleBulkDelete} disabled={!!bulkDeleting}
                  style={{ background:"#fff",color:"#991b1b",border:"none",borderRadius:7,padding:"8px 18px",fontWeight:800,fontSize:13,
                    cursor:bulkDeleting?"wait":"pointer",opacity:bulkDeleting?0.7:1 }}>
                  {bulkDeleting ?? \`Delete \${deleteSel.size} permanently\`}
                </button>
                <button onClick={()=>setDeleteSel(new Set())} disabled={!!bulkDeleting}
                  style={{ background:"rgba(255,255,255,0.12)",color:"#fee2e2",border:"1px solid rgba(255,255,255,0.25)",borderRadius:7,padding:"8px 14px",fontSize:13,cursor:"pointer" }}>✕ Clear</button>
              </div>
            )}`);

  const h1 = A.find(A.starts("const toggleActuals=(activityId:string)=>"), 0, "toggleActuals");
  A.insertBefore(h1,
`  // ── ${MARK} Admin: delete many proposals (type DELETE to confirm) ──
  const handleBulkDelete = async () => {
    if (!isSuperAdmin || bulkDeleting || deleteSel.size === 0) return;
    const list = proposals.filter((p) => deleteSel.has(p.id));
    const approvedCount = list.filter((p) => p.status === "Approved").length;
    const typed = window.prompt(
      \`Permanently delete \${list.length} proposal(s)?\` +
      (approvedCount ? \`\\n\\n⚠ \${approvedCount} of them are APPROVED — their post-activity data, photos, invoices and approval history will also be deleted.\` : "") +
      "\\n\\nThis cannot be undone. Type DELETE to confirm:");
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== "DELETE") { showToast("Not confirmed — nothing was deleted.", false); return; }
    let ok = 0; const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      setBulkDeleting(\`Deleting \${i + 1}/\${list.length}…\`);
      try {
        await deleteProposal(p.id, instance);
        ok++;
        setProposals((prev) => prev.filter((x) => x.id !== p.id));
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(p.id); return n; });
        setNotifySelectedIds((prev) => { const n = new Set(prev); n.delete(p.id); return n; });
      } catch (err) {
        failed.push(\`\${p.tokenNumber ?? p.id}: \${err instanceof Error ? err.message : String(err)}\`);
      }
    }
    setDeleteSel(new Set()); setBulkDeleting(null);
    if (selected && list.some((p) => p.id === selected.id)) closeModal();
    showToast(failed.length ? \`\${ok} deleted, \${failed.length} failed — see browser console.\` : \`✓ \${ok} proposal\${ok !== 1 ? "s" : ""} deleted.\`, failed.length === 0);
    if (failed.length) console.warn("[BULK-DELETE] failures:\\n" + failed.join("\\n"));
  };
`);
});

// ════════════════════════════════════════════════════════════════════════════
// 2. AnalyticsDashboard.tsx
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/AnalyticsDashboard.tsx", (A) => {
  need(A, V1, "apply-changes.mjs (part 1)");
  A.insertAfter(A.find(A.eq('import "./AnalyticsDashboard.css";'), 0, "css import"),
`import { fetchDealerStatus, buildInactiveMatcher } from "../services/dealerStatusService";   // ${MARK}`);

  const s1 = A.find(A.starts("const [yearFilter, setYearFilter]"), 0, "yearFilter state");
  const s3 = A.find(A.starts("const [statusFilter, setStatusFilter]"), s1, "statusFilter state");
  A.replace(s1, s3,
`  // ── ${MARK} header filters: multi-select (empty = All); Month & Year default to the current month ──
  const [yearSel,   setYearSel]   = useState<string[]>([String(CURRENT_YEAR)]);
  const [monthSel,  setMonthSel]  = useState<string[]>([MONTHS[new Date().getMonth()]]);
  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [dealerStatusSel, setDealerStatusSel] = useState<string[]>([]);
  const [isDealerInactive, setIsDealerInactive] =
    useState<(code?: string | null, name?: string | null) => boolean>(() => () => false);
  useEffect(() => {
    fetchDealerStatus(instance).then((rows) => setIsDealerInactive(() => buildInactiveMatcher(rows))).catch(() => {});
  }, [instance]);
  // single-value views kept for the KPI cards / month bars (one selected = that value, else "All")
  const one = (a: string[]) => (a.length === 1 ? a[0] : "All");
  const yearFilter = one(yearSel), monthFilter = one(monthSel), statusFilter = one(statusSel);
  const setYearFilter   = (v: string) => setYearSel(v === "All" ? [] : [v]);
  const setMonthFilter  = (v: string) => setMonthSel(v === "All" ? [] : [v]);
  const setStatusFilter = (v: string) => setStatusSel(v === "All" ? [] : [v]);`);

  const y = A.find(A.has("(p as any).year !== yearFilter"), 0, "year filter line");
  A.replace(y, y, `    if (yearSel.length   && !yearSel.includes(String((p as any).year ?? ""))) return false;`);
  const m = A.find(A.has("p.month  !== monthFilter"), y, "month filter line");
  A.replace(m, m, `    if (monthSel.length  && !monthSel.includes(p.month)) return false;`);
  const st = A.find(A.has("p.status !== statusFilter"), m, "status filter line");
  A.replace(st, st,
`    if (statusSel.length && !statusSel.includes(p.status)) return false;
    if (dealerStatusSel.length && !dealerStatusSel.includes(isDealerInactive((p as any).dealerCode, p.dealerName) ? "Inactive" : "Active")) return false;`);
  const dp = A.find(A.has("}), [proposals, yearFilter, monthFilter, statusFilter, stateFilter"), st, "filtered deps");
  A.replace(dp, dp, `  }), [proposals, yearSel, monthSel, statusSel, dealerStatusSel, isDealerInactive, stateFilter, rsmFilter, dealerFilter, actFilter]);`);

  // Daily Activity Report has its own date range → it ignores the header Month / Year
  const ap = A.find(A.starts("const approved  = useMemo("), 0, "approved memo");
  A.insertAfter(ap,
`  // ${MARK} Daily Activity Report uses its own date range, so it ignores the header Month / Year / Status
  const approvedAnyPeriod = useMemo(() => proposals.filter((p) => p.status === "Approved" &&
    (!stateFilter || p.state === stateFilter) && (!rsmFilter || p.rsmName === rsmFilter) &&
    (!dealerFilter || p.dealerName === dealerFilter) &&
    (!dealerStatusSel.length || dealerStatusSel.includes(isDealerInactive((p as any).dealerCode, p.dealerName) ? "Inactive" : "Active"))),
    [proposals, stateFilter, rsmFilter, dealerFilter, dealerStatusSel, isDealerInactive]);`);
  const lp = A.find(A.eq("const approvedProposals = approved;"), ap, "liveDailySummary source");
  A.lines[lp] = A.lines[lp].replace("= approved;", "= approvedAnyPeriod;");
  const ld = A.find(A.eq("}, [approved, dailyFrom, dailyTo]);"), lp, "liveDailySummary deps");
  A.lines[ld] = A.lines[ld].replace("[approved, dailyFrom, dailyTo]", "[approvedAnyPeriod, dailyFrom, dailyTo]");

  // Daily report default = this month to date
  const df = A.find(A.starts("const [dailyFrom,"), 0, "dailyFrom state");
  A.lines[df] = A.lines[df].replace('useState("")', 'useState(() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-01`; })');
  const dt = A.find(A.starts("const [dailyTo,"), df, "dailyTo state");
  A.lines[dt] = A.lines[dt].replace('useState("")', 'useState(() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; })');

  // header selects → multi-select
  const h1 = A.find(A.starts('<select className="an-select" value={yearFilter}'), 0, "year <select>");
  const hN = A.find(A.has('<option value="NeedsRevision">Needs Revision</option>'), h1, "status options");
  const h2 = A.find(A.eq("</select>"), hN, "status </select>");
  A.replace(h1, h2,
`          {/* ${MARK} multi-select header filters */}
          <MultiSelectDropdown label="Years" options={Array.from(new Set([...years.filter(y=>y!=="All"), String(CURRENT_YEAR)])).sort()} value={yearSel} onChange={setYearSel} width={120}/>
          <MultiSelectDropdown label="Months" options={MONTHS} value={monthSel} onChange={setMonthSel} width={150}/>
          <MultiSelectDropdown label="Statuses" options={["Approved","Pending","Rejected","NeedsRevision"]} value={statusSel} onChange={setStatusSel} width={150}/>
          <MultiSelectDropdown label="Dealer Status" options={["Active","Inactive"]} value={dealerStatusSel} onChange={setDealerStatusSel} width={150}/>`);

  const cl = A.find(A.has('yearFilter !== "All" || monthFilter !== "All" || statusFilter !== "All"'), h1, "Clear all condition");
  A.lines[cl] = A.lines[cl].replace('yearFilter !== "All" || monthFilter !== "All" || statusFilter !== "All"',
    "yearSel.length > 0 || monthSel.length > 0 || statusSel.length > 0 || dealerStatusSel.length > 0");
  const cr = A.find(A.has('setYearFilter(String(CURRENT_YEAR)); setMonthFilter("All"); setStatusFilter("All");'), cl, "Clear all reset");
  A.lines[cr] = A.lines[cr].replace('setYearFilter(String(CURRENT_YEAR)); setMonthFilter("All"); setStatusFilter("All");',
    "setYearSel([]); setMonthSel([]); setStatusSel([]); setDealerStatusSel([]);");
});

// ════════════════════════════════════════════════════════════════════════════
// 3. AdminDealerMapPage.tsx
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/AdminDealerMapPage.tsx", (A) => {
  A.insertAfter(A.find(A.eq('import SearchableSelect from "../components/SearchableSelect";'), 0, "SearchableSelect import"),
`import { fetchDealerEligibility } from "../services/dealerService";                              // ${MARK}
import { setDealerMappingStatus, refreshDealerTypes } from "../services/dealerStatusService";`);

  A.insertAfter(A.find(A.starts("const [selectedErpDealerCode, setSelectedErpDealerCode]"), 0, "selectedErpDealerCode state"),
`  // ── ${MARK} Active / Inactive · Old/New from RRERP · inactive-staff checks ──
  const [statusView,  setStatusView]  = useState<"all" | "active" | "inactive">("all");
  const [typeAuto,    setTypeAuto]    = useState<{ type: "Old" | "New"; reason: string } | null>(null);
  const [typeLoading, setTypeLoading] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [notice,      setNotice]      = useState<string | null>(null);
  const [statusBusy,  setStatusBusy]  = useState<number | null>(null);
  const isRowActive = (r: DealerTeamMappingRow) => (r as unknown as { isActive?: boolean }).isActive !== false;
  const visibleRows = useMemo(() => rows.filter((r) =>
    statusView === "all" || (statusView === "active") === isRowActive(r)), [rows, statusView]);
  // Staff marked Inactive (Users → Staff). A name that an ACTIVE person also uses is not flagged.
  const inactiveStaff = useMemo(() => {
    const active = new Set<string>(), names = new Set<string>(), emails = new Set<string>();
    for (const s of staffUsers) { const n = titleCase((s.displayName ?? "").trim()).toLowerCase(); if (s.isActive && n) active.add(n); }
    for (const s of staffUsers) {
      if (s.isActive) continue;
      const n = titleCase((s.displayName ?? "").trim()).toLowerCase();
      if (n && !active.has(n)) names.add(n);
      const e = (s.email ?? "").trim().toLowerCase();
      if (e) emails.add(e);
    }
    return { names, emails };
  }, [staffUsers]);
  const isInactiveStaff = (name?: string | null, email?: string | null) =>
    (!!name && inactiveStaff.names.has(titleCase(name.trim()).toLowerCase())) ||
    (!!email && email.split(/[,;]/).some((e) => inactiveStaff.emails.has(e.trim().toLowerCase())));
  const inactiveBadge = (
    <span title="Inactive in Users → Staff — re-assign this dealer"
      style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#991b1b", background: "#fee2e2",
        border: "1px solid #fecaca", borderRadius: 4, padding: "0 5px" }}>INACTIVE</span>
  );
  // Old / New from RRERP (same rule as RSM Form and CAC limit) — the field is locked when found
  const autoType = async (code: string) => {
    if (!code) { setTypeAuto(null); return; }
    setTypeLoading(true);
    try {
      const e = await fetchDealerEligibility(code, instance);
      const t: "Old" | "New" = e.dealerType === "New" ? "New" : "Old";
      setTypeAuto({ type: t, reason: e.eligibilityReason });
      setForm((f) => ({ ...f, dealerType: t }));
    } catch { setTypeAuto(null); }
    finally { setTypeLoading(false); }
  };
  const handleStatus = async (row: DealerTeamMappingRow, active: boolean) => {
    if (!active && !window.confirm(\`Mark "\${row.dealerName}" INACTIVE?\\n\\nThe dealer will be hidden from the RSM Form and its dealer login(s) will be blocked.\`)) return;
    setStatusBusy(row.id); setError(null);
    try {
      const r = await setDealerMappingStatus(row.id, active, instance);
      setRows((prev) => prev.map((x) => (x.id === row.id ? ({ ...x, isActive: r.isActive } as DealerTeamMappingRow) : x)));
      setNotice(\`\${row.dealerName} is now \${active ? "Active" : "Inactive"}\` +
        (r.loginsUpdated ? \` · \${r.loginsUpdated} dealer login(s) \${active ? "re-activated" : "blocked"}\` : "") + ".");
    } catch (e) { setError(e instanceof Error ? e.message : "Status change failed."); }
    finally { setStatusBusy(null); }
  };
  const handleRefreshTypes = async () => {
    setRefreshing(true); setError(null);
    try {
      const r = await refreshDealerTypes(instance);
      setNotice(\`Old / New refreshed from RRERP (last \${r.windowMonths} months): \${r.checked} dealers checked, \${r.changed} changed.\`);
      await load(search || undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); }
    finally { setRefreshing(false); }
  };`);

  const oc = A.find(A.has('setDealerSourceMode("erp"); setSelectedErpDealerCode("");'), 0, "openCreate");
  A.lines[oc] = A.lines[oc].replace('setSelectedErpDealerCode("");', 'setSelectedErpDealerCode(""); setTypeAuto(null);');
  A.insertAfter(A.find(A.eq('setSelectedErpDealerCode(row.dealerCode ?? "");'), oc, "openEdit"),
`    if (row.dealerCode) autoType(row.dealerCode); else setTypeAuto(null);   // ${MARK}`);
  const sel0 = A.find(A.starts("const handleErpDealerSelect"), 0, "handleErpDealerSelect");
  A.insertAfter(A.find(A.eq('setSelectedErpDealerCode("");'), sel0, "ERP clear"), `      setTypeAuto(null);`);
  A.insertAfter(A.find(A.eq("setSelectedErpDealerCode(d.customerCode);"), sel0, "ERP pick"), `    autoType(d.customerCode);   // ${MARK} Old/New from RRERP`);

  A.insertAfter(A.find(A.has('setFormError("RSM name is required."); return;'), 0, "RSM required check"),
`    // ${MARK} inactive staff cannot be mapped
    if (isInactiveStaff(form.rsm, form.rsmEmail)) { setFormError(\`RSM "\${form.rsm}" is Inactive — pick an active RSM.\`); return; }
    if (form.tsm?.trim() && isInactiveStaff(form.tsm, form.tsmEmail)) { setFormError(\`TSM "\${form.tsm}" is Inactive — pick an active TSM or "No TSM".\`); return; }
    if (form.commando?.trim() && isInactiveStaff(form.commando, form.commandoEmail)) { setFormError(\`Commando "\${form.commando}" is Inactive — pick an active Commando or "No Commando".\`); return; }`);

  A.insertBefore(A.find(A.has("<button onClick={openCreate}"), 0, "Add Dealer Mapping button"),
`          <button onClick={handleRefreshTypes} disabled={refreshing} style={toolBtn("#f0fdf4", "#166534", "#bbf7d0", refreshing)}
            title="Re-calculate Old / New for every mapped dealer from RRERP (first sale / onboarding within the last 3 months = New). Also runs automatically every 12 h.">
            {refreshing ? "Refreshing…" : "↻ Old/New from RRERP"}</button>`);

  A.insertBefore(A.find(A.eq("{importResult && ("), 0, "importResult banner"),
`      {notice && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderLeft: "4px solid #16a34a", borderRadius: 8,
          padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#166534", display: "flex", alignItems: "center", gap: 10 }}>
          ✓ {notice}
          <button onClick={() => setNotice(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#6b7280", cursor: "pointer" }}>✕</button>
        </div>
      )}`);

  const sw = A.find(A.eq("<div style={{ marginBottom: 16 }}>"), 0, "search wrapper");
  A.lines[sw] = A.lines[sw].replace("<div style={{ marginBottom: 16 }}>", '<div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>');
  A.insertAfter(A.find(A.has("style={{ ...inputStyle, maxWidth: 400 }} />"), sw, "search input"),
`        <div style={{ display: "inline-flex", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          {(["all", "active", "inactive"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setStatusView(v)}
              style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                background: statusView === v ? (v === "inactive" ? "#991b1b" : v === "active" ? "#16a34a" : "#0a2540") : "#fff",
                color: statusView === v ? "#fff" : "#374151" }}>
              {v === "all" ? \`All (\${rows.length})\` : v === "active" ? \`Active (\${rows.filter(isRowActive).length})\` : \`Inactive (\${rows.filter((r) => !isRowActive(r)).length})\`}
            </button>
          ))}
        </div>`);

  const hd = A.find(A.has('"Eligibility", "Type", ""].map((h) => ('), 0, "table header");
  A.lines[hd] = A.lines[hd].replace('"Type", ""]', '"Type", "Status", ""]');
  for (let i = 0; i < A.lines.length; i++) if (A.lines[i].includes("colSpan={9}")) A.lines[i] = A.lines[i].replace("colSpan={9}", "colSpan={10}");
  const re = A.find(A.has(") : rows.length === 0 ? ("), hd, "empty check");
  A.lines[re] = A.lines[re].replace(") : rows.length === 0 ? (", ") : visibleRows.length === 0 ? (");
  const rm = A.find(A.has(") : rows.map((r, i) => ("), re, "rows.map");
  A.lines[rm] = A.lines[rm].replace(") : rows.map((r, i) => (", ") : visibleRows.map((r, i) => (");
  const tr = A.find(A.has("<tr key={r.id} style={{ background: i % 2 === 0"), rm, "row <tr>");
  A.lines[tr] = A.lines[tr].replace('borderBottom: "1px solid #f1f5f9" }}>', 'borderBottom: "1px solid #f1f5f9", opacity: isRowActive(r) ? 1 : 0.6 }}>');

  const rr = A.find(A.eq("<div style={{ fontWeight: 600 }}>{r.rsm}</div>"), tr, "RSM cell");
  A.lines[rr] = A.lines[rr].replace("{r.rsm}</div>", "{r.rsm}{isInactiveStaff(r.rsm, r.rsmEmail) && inactiveBadge}</div>");
  const rt = A.find(A.eq('<div>{r.tsm || <span style={{ color: "#cbd5e1" }}>—</span>}</div>'), rr, "TSM cell");
  A.lines[rt] = A.lines[rt].replace("</span>}</div>", "</span>}{!!r.tsm && isInactiveStaff(r.tsm, r.tsmEmail) && inactiveBadge}</div>");
  const rc = A.find(A.eq('<div>{r.commando || <span style={{ color: "#cbd5e1" }}>—</span>}</div>'), rt, "Commando cell");
  A.lines[rc] = A.lines[rc].replace("</span>}</div>", "</span>}{!!r.commando && isInactiveStaff(r.commando, r.commandoEmail) && inactiveBadge}</div>");

  const ac = A.find(A.eq('<div style={{ display: "flex", gap: 6 }}>'), rc, "actions cell");
  A.insertBefore(ac - 1,
`                <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "inline-flex", border: "1px solid #e2e8f0", borderRadius: 7, overflow: "hidden" }}>
                    <button type="button" disabled={statusBusy === r.id || isRowActive(r)} onClick={() => handleStatus(r, true)}
                      title="Dealer active — visible in RSM Form, dealer login allowed"
                      style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, border: "none",
                        cursor: isRowActive(r) ? "default" : "pointer",
                        background: isRowActive(r) ? "#16a34a" : "#fff", color: isRowActive(r) ? "#fff" : "#166534" }}>Active</button>
                    <button type="button" disabled={statusBusy === r.id || !isRowActive(r)} onClick={() => handleStatus(r, false)}
                      title="Dealer inactive (e.g. F&F done) — hidden from RSM Form, dealer login blocked"
                      style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, border: "none", borderLeft: "1px solid #e2e8f0",
                        cursor: !isRowActive(r) ? "default" : "pointer",
                        background: !isRowActive(r) ? "#dc2626" : "#fff", color: !isRowActive(r) ? "#fff" : "#991b1b" }}>Inactive</button>
                  </div>
                </td>`);

  const ft = A.find(A.has("</strong> without Commando"), ac, "footer counts");
  A.lines[ft] = A.lines[ft].replace("</strong> without Commando",
    '</strong> without Commando ·{" "}<strong style={{ color: "#991b1b" }}>{rows.filter((r) => !isRowActive(r)).length}</strong> inactive');

  const em = A.find(A.eq("<label style={labelStyle}>Dealer Email</label>"), ft, "Dealer Email label");
  A.insertBefore(em - 1,
`              {([["RSM", form.rsm, form.rsmEmail], ["TSM", form.tsm, form.tsmEmail], ["Commando", form.commando, form.commandoEmail]] as [string, string | null | undefined, string | null | undefined][])
                .filter(([, n, e]) => !!n?.trim() && isInactiveStaff(n, e))
                .map(([role, n]) => (
                  <div key={role} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "7px 12px",
                    fontSize: 12, color: "#991b1b", marginBottom: 10 }}>
                    ⚠ {role} "{n}" is <b>Inactive</b> — pick an active {role}{role !== "RSM" ? \` or "No \${role}"\` : ""} before saving.
                  </div>
                ))}`);

  const t1 = A.find(A.eq("<div><label style={labelStyle}>Dealer Type</label>"), em, "Dealer Type field");
  const t2 = A.find(A.has("</select></div>"), t1, "Dealer Type select end");
  A.replace(t1, t2,
`                <div><label style={labelStyle}>Dealer Type{typeAuto && <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6, color: "#16a34a" }}>🔒 from RRERP</span>}</label>
                  <select style={{ ...inputStyle, background: typeAuto ? "#f0fdf4" : "#fff", cursor: typeAuto ? "not-allowed" : "pointer" }}
                    value={form.dealerType ?? "Old"} disabled={!!typeAuto || typeLoading}
                    onChange={(e) => setForm((f) => ({ ...f, dealerType: e.target.value }))}>
                    <option value="Old">Old</option><option value="New">New</option>
                  </select>
                  <div style={{ fontSize: 10, color: typeAuto ? "#166534" : "#9ca3af", marginTop: 3 }}>
                    {typeLoading ? "Checking RRERP…"
                      : typeAuto ? typeAuto.reason
                      : form.dealerCode
                        ? <button type="button" onClick={() => autoType(form.dealerCode ?? "")}
                            style={{ background: "none", border: "none", color: "#2563eb", fontSize: 10, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                            Get Old / New from RRERP</button>
                        : "Manual dealer (no Dealer Code) — choose Old / New"}
                  </div></div>`);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. RSMForm.tsx — inactive dealers hidden
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/RSMForm.tsx", (A) => {
  A.insertAfter(A.find(A.has('from "../hooks/useDealerTeamLookup";'), 0, "useDealerTeamLookup import"),
`import { fetchDealerStatus, buildInactiveMatcher } from "../services/dealerStatusService";   // ${MARK}`);
  A.insertAfter(A.find(A.starts("const xlsxRef = useRef<HTMLInputElement>(null);"), 0, "xlsxRef"),
`  // ${MARK} dealers marked Inactive in Dealer Mapping are not offered
  const [isDealerInactive, setIsDealerInactive] =
    useState<(code?: string | null, name?: string | null) => boolean>(() => () => false);
  useEffect(() => {
    fetchDealerStatus(instance).then((rows) => setIsDealerInactive(() => buildInactiveMatcher(rows))).catch(() => {});
  }, [instance]);`);
  A.insertBefore(A.find(A.has("// Check if this dealer exists in the DB-backed mapping"), 0, "dealerOptions filter"),
`      if (isDealerInactive(d.customerCode, d.customerName)) return false;   // ${MARK} inactive dealer`);
});

// ════════════════════════════════════════════════════════════════════════════
// 5. StaffDashboard.tsx — Month / Year default = current month
// ════════════════════════════════════════════════════════════════════════════
edit("src/pages/StaffDashboard.tsx", (A) => {
  const mf = A.find(A.starts('const [monthFilter, setMonthFilter] = useState("All");'), 0, "monthFilter");
  A.lines[mf] = A.lines[mf].replace('useState("All");', `useState(MONTHS[new Date().getMonth()]);   // ${MARK} default = current month`);
  const yf = A.find(A.starts('const [yearFilter, setYearFilter] = useState("All");'), mf, "yearFilter");
  A.lines[yf] = A.lines[yf].replace('useState("All");', "useState(String(new Date().getFullYear()));");
  const mo = A.find(A.starts("const months = useMemo("), 0, "months memo");
  A.replace(mo, mo,
`  const months = useMemo(() => { const s = new Set([...proposals.map((p) => p.month), MONTHS[new Date().getMonth()]]); return ["All", ...MONTHS.filter((m) => s.has(m))]; }, [proposals]);`);
  const ye = A.find(A.starts("const years = useMemo("), mo, "years memo");
  A.replace(ye, ye,
`  const years = useMemo(() => ["All", ...Array.from(new Set([...proposals.map((p) => String((p as any).year ?? "")).filter(Boolean), String(new Date().getFullYear())])).sort()], [proposals]);`);
});

console.log("\nDone. Next: npm run build");

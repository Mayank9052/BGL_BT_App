// src/pages/DealerDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyDealerProposals, dealerSendBack } from "../services/proposalService";
import { getDealerUser, dealerLogout } from "../services/dealerAuthService";
import type { ProposalResponse, ActivityResponse } from "../services/proposalService";
import "./DashboardPage.css";

// ── Helpers ───────────────────────────────────────────────────────────────────
const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const inrCompact = (v: number): string => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
};
const fmtShort = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day:"2-digit", month:"short" });
};

type ActiveFilter = "All" | "Pending" | "Approved" | "Rejected";
interface DealerDashboardProps { onLogout?: () => void; }

export default function DealerDashboard({ onLogout }: DealerDashboardProps) {
  const navigate    = useNavigate();
  const [dealerUser] = useState(() => getDealerUser());

  const [proposals,       setProposals]       = useState<ProposalResponse[]>([]);
  const [loadingData,     setLoadingData]     = useState(true);
  const [dataError,       setDataError]       = useState<string|null>(null);
  const [activeFilter,    setActiveFilter]    = useState<ActiveFilter>("All");
  const [monthFilter,     setMonthFilter]     = useState("All");
  const [selected,        setSelected]        = useState<ProposalResponse|null>(null);
  const [showSendBack,    setShowSendBack]    = useState(false);
  const [sendBackNote,    setSendBackNote]    = useState("");
  const [sendBackLoading, setSendBackLoading] = useState(false);
  const [toast,           setToast]           = useState<{msg:string;ok:boolean}|null>(null);

  const dealerEmail = dealerUser?.email ?? "";

  const showToast = (msg: string, ok: boolean) => {
    setToast({msg,ok}); setTimeout(()=>setToast(null), 3500);
  };

  // Lock body scroll when full-page detail is open
  useEffect(() => {
    document.body.style.overflow = selected ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [selected]);

  useEffect(() => {
    if (!dealerUser) { onLogout?.(); navigate("/",{replace:true}); return; }
    let cancelled = false;
    setLoadingData(true);
    fetchMyDealerProposals()
      .then((data) => { if (!cancelled) setProposals(data); })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load your proposals.";
        setDataError(msg);
        if (msg.includes("401") || msg.includes("Not signed in")) {
          dealerLogout(); onLogout?.(); navigate("/",{replace:true});
        }
      })
      .finally(() => { if (!cancelled) setLoadingData(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const months = useMemo(
    ()=>["All",...Array.from(new Set(proposals.map((p)=>p.month)))],
    [proposals],
  );
  const filtered = useMemo(()=>
    proposals.filter((p)=>{
      if (activeFilter!=="All" && p.status!==activeFilter) return false;
      if (monthFilter!=="All"  && p.month!==monthFilter)   return false;
      return true;
    }),
  [proposals,activeFilter,monthFilter]);

  const stats = useMemo(()=>{
    const approved = filtered.filter((p)=>p.status==="Approved");
    const cacList  = filtered.filter((p)=>p.cac>0).map((p)=>p.cac);
    const cplList  = filtered.filter((p)=>p.cpl>0).map((p)=>p.cpl);
    return {
      total:           filtered.length,
      pending:         filtered.filter((p)=>p.status==="Pending").length,
      approved:        approved.length,
      rejected:        filtered.filter((p)=>p.status==="Rejected").length,
      totalBudget:     filtered.reduce((s,p)=>s+p.totalBudget,0),
      approvedBudget:  approved.reduce((s,p)=>s+p.totalBudget,0),
      totalLeadTarget: filtered.reduce((s,p)=>s+p.totalLeadTarget,0),
      avgCac: cacList.length>0 ? cacList.reduce((a,b)=>a+b,0)/cacList.length : 0,
      avgCpl: cplList.length>0 ? cplList.reduce((a,b)=>a+b,0)/cplList.length : 0,
      activitiesCount: filtered.reduce((s,p)=>s+p.activities.length,0),
    };
  },[filtered]);

  const activityBreakdown = useMemo(()=>{
    const map: Record<string,{
      activityType:string; count:number; leadTarget:number;
      retailTarget:number; budget:number;
      pending:number; approved:number; rejected:number;
    }> = {};
    for (const p of filtered) {
      for (const a of p.activities) {
        if (!map[a.activityType]) map[a.activityType]={
          activityType:a.activityType, count:0, leadTarget:0,
          retailTarget:0, budget:0, pending:0, approved:0, rejected:0,
        };
        const r=map[a.activityType];
        r.count++; r.leadTarget+=a.leadTarget; r.retailTarget+=a.retailTarget;
        r.budget+=a.budget+a.additionalBudget;
        if (p.status==="Pending")  r.pending++;
        if (p.status==="Approved") r.approved++;
        if (p.status==="Rejected") r.rejected++;
      }
    }
    return Object.values(map).sort((a,b)=>b.budget-a.budget);
  },[filtered]);

  const handleDealerSendBack = async ()=>{
    if (!selected||!sendBackNote.trim()) return;
    if (!dealerEmail) { showToast("Could not determine your email. Please contact support.",false); return; }
    setSendBackLoading(true);
    try {
      const updated = await dealerSendBack(selected.id,{
        dealerEmail, requestNote:sendBackNote.trim(),
      });
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); setShowSendBack(false); setSendBackNote("");
      showToast("Budget add-on request sent. You will be contacted shortly.",true);
    } catch(err) {
      showToast(err instanceof Error?err.message:"Failed to send request.",false);
    } finally { setSendBackLoading(false); }
  };

  const openDetail  = (p: ProposalResponse) => { setSelected(p); setShowSendBack(false); setSendBackNote(""); };
  const closeDetail = () => { setSelected(null); setShowSendBack(false); setSendBackNote(""); };
  const toggleFilter = (f: ActiveFilter) => setActiveFilter((cur)=>cur===f?"All":f);

  if (!dealerUser) return null;

  const statusBadge = (s:string) =>
    s==="Approved" ? "dash-badge dash-badge--approved"
    : s==="Rejected" ? "dash-badge dash-badge--rejected"
    : "dash-badge dash-badge--pending";

  const isSentBack   = (p:ProposalResponse) => !!(p as any).dealerSentBack;
  const sentBackNote = (p:ProposalResponse) => (p as any).dealerSendBackNote as string|null;
  const sentBackAt   = (p:ProposalResponse) => (p as any).dealerSentBackAt   as string|null;

  return (
    <div className="dash-root">

      {/* ── Page header ── */}
      <div style={{ marginBottom:20,display:"flex",alignItems:"flex-start",
        justifyContent:"space-between",flexWrap:"wrap",gap:12 }}>
        <div>
          <h1 style={{ fontSize:22,color:"#0a2540",margin:0,fontWeight:800 }}>
            {dealerUser.dealerName||dealerUser.displayName}
          </h1>
          <p style={{ fontSize:13,color:"#64748b",margin:"4px 0 0" }}>
            Dealer Code: <strong>{dealerUser.dealerCode??"—"}</strong>
            {" · "}Logged in as: <strong>{dealerEmail}</strong>
          </p>
        </div>
        {/* Quick action buttons */}
        <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
          <button onClick={()=>navigate("/dealer-proposal")}
            style={{ background:"#0a2540",color:"#fff",border:"none",
              padding:"10px 20px",borderRadius:8,fontWeight:600,fontSize:13,
              cursor:"pointer",display:"flex",alignItems:"center",gap:6 }}>
            📋 New Proposal
          </button>
        </div>
      </div>

      {loadingData?(
        <div className="dash-loading-inline">
          <div className="dash-spinner dash-spinner--sm"/><span>Loading your proposals…</span>
        </div>
      ):dataError?(
        <div className="dash-error-banner">⚠ {dataError}</div>
      ):proposals.length===0?(
        <div className="dash-empty">
          <span className="dash-empty-icon">📋</span>
          <p>No BTL proposals found for your dealership yet.</p>
          <p style={{ fontSize:12,color:"#94a3b8" }}>
            Your RSM will submit activity proposals on your behalf — they'll appear here once submitted.
          </p>
        </div>
      ):(
        <>
          {/* KPI cards */}
          <div className="dash-kpi-grid">
            <KpiCard icon="📄" label="Total Proposals" value={String(stats.total)}
              sub={`${stats.activitiesCount} activities`} accent="blue"
              active={activeFilter==="All"} onClick={()=>setActiveFilter("All")}/>
            <KpiCard icon="⏳" label="Pending" value={String(stats.pending)}
              sub="Awaiting approval" accent="amber"
              active={activeFilter==="Pending"} onClick={()=>toggleFilter("Pending")}/>
            <KpiCard icon="✅" label="Approved" value={String(stats.approved)}
              sub={`Budget: ${inrCompact(stats.approvedBudget)}`} accent="green"
              active={activeFilter==="Approved"} onClick={()=>toggleFilter("Approved")}/>
            <KpiCard icon="❌" label="Rejected" value={String(stats.rejected)}
              sub="" accent="red"
              active={activeFilter==="Rejected"} onClick={()=>toggleFilter("Rejected")}/>
            <KpiCard icon="💰" label="Total Budget" value={inrCompact(stats.totalBudget)}
              sub={`Avg CAC ₹${Math.round(stats.avgCac).toLocaleString("en-IN")}`}
              accent="purple" active={false} onClick={()=>setActiveFilter("All")}/>
            <KpiCard icon="📊" label="Avg CPL"
              value={`₹${Math.round(stats.avgCpl).toLocaleString("en-IN")}`}
              sub={`${stats.totalLeadTarget.toLocaleString("en-IN")} total leads`}
              accent="blue" active={false} onClick={()=>setActiveFilter("All")}/>
          </div>

          {/* Month + active filter bar */}
          <div className="dash-global-filter-bar">
            <div className="dash-global-filter-left">
              <span className="dash-filter-label">Month:</span>
              <select className="dash-filter-select dash-filter-select--inline"
                value={monthFilter} onChange={(e)=>setMonthFilter(e.target.value)}>
                {months.map((m)=>(<option key={m} value={m}>{m==="All"?"All Months":m}</option>))}
              </select>
            </div>
            {activeFilter!=="All"&&(
              <div style={{ fontSize:12,color:"#1e40af",fontWeight:600,
                background:"#eff6ff",border:"1px solid #bfdbfe",
                borderRadius:6,padding:"4px 12px",display:"flex",alignItems:"center",gap:8 }}>
                Filtering: {activeFilter}
                <button onClick={()=>setActiveFilter("All")}
                  style={{ background:"none",border:"none",color:"#6b7280",
                    cursor:"pointer",fontSize:14,padding:0,lineHeight:1 }}>✕</button>
              </div>
            )}
          </div>

          {/* Activity breakdown table */}
          {activityBreakdown.length>0&&(
            <section className="dash-section">
              <h2 className="dash-section-title">
                Activity Breakdown
                <span className="dash-count-chip">{activityBreakdown.length}</span>
              </h2>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr>
                    <th className="dash-th">Activity Type</th>
                    <th className="dash-th dash-th--right">Count</th>
                    <th className="dash-th dash-th--right">Lead Target</th>
                    <th className="dash-th dash-th--right">Retail Target</th>
                    <th className="dash-th dash-th--right">Budget (₹)</th>
                    <th className="dash-th dash-th--right">Pending</th>
                    <th className="dash-th dash-th--right">Approved</th>
                    <th className="dash-th dash-th--right">Rejected</th>
                  </tr></thead>
                  <tbody>
                    {activityBreakdown.map((row,i)=>(
                      <tr key={row.activityType} className={i%2===0?"dash-row-even":"dash-row-odd"}>
                        <td className="dash-td dash-dealer-name">{row.activityType}</td>
                        <td className="dash-td dash-td--right">{row.count}</td>
                        <td className="dash-td dash-td--right">{row.leadTarget}</td>
                        <td className="dash-td dash-td--right">{row.retailTarget}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{inr(row.budget)}</td>
                        <td className="dash-td dash-td--right">
                          {row.pending>0?<span className="dash-badge dash-badge--pending">{row.pending}</span>:<span className="dash-muted">—</span>}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.approved>0?<span className="dash-badge dash-badge--approved">{row.approved}</span>:<span className="dash-muted">—</span>}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.rejected>0?<span className="dash-badge dash-badge--rejected">{row.rejected}</span>:<span className="dash-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Proposals list */}
          <section className="dash-section">
            <h2 className="dash-section-title">
              Your Proposals
              <span className="dash-count-chip">{filtered.length}</span>
              {activeFilter!=="All"&&(
                <span style={{ fontSize:11,color:"#64748b",fontWeight:400,marginLeft:8 }}>
                  (filtered: {activeFilter})
                </span>
              )}
            </h2>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead><tr>
                  <th className="dash-th">Action</th>
                  <th className="dash-th">Token</th>
                  <th className="dash-th">Month</th>
                  <th className="dash-th">Activities</th>
                  <th className="dash-th dash-th--right">Lead</th>
                  <th className="dash-th dash-th--right">Retail</th>
                  <th className="dash-th dash-th--right">Budget (₹)</th>
                  <th className="dash-th">Submitted</th>
                  <th className="dash-th">Budget Request</th>
                  <th className="dash-th">Status</th>
                </tr></thead>
                <tbody>
                  {filtered.map((p,i)=>(
                    <tr key={p.id} className={i%2===0?"dash-row-even":"dash-row-odd"}
                      style={{ cursor:"pointer" }} onClick={()=>openDetail(p)}>
                      <td className="dash-td" onClick={(e)=>e.stopPropagation()}>
                        <button onClick={()=>openDetail(p)}
                          style={{ background:"#1e3a5f",color:"#fff",border:"none",
                            padding:"4px 12px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer" }}>
                          View
                        </button>
                      </td>
                      <td className="dash-td" style={{ fontFamily:"monospace",fontSize:12 }}>
                        {p.tokenNumber??"—"}
                      </td>
                      <td className="dash-td">{p.month}</td>
                      <td className="dash-td">
                        {p.activities.slice(0,2).map((a:ActivityResponse,ai:number)=>(
                          <span key={ai} className="dash-state-tag" style={{ marginRight:4 }}>
                            {a.activityType}
                          </span>
                        ))}
                        {p.activities.length>2&&<span className="dash-muted">+{p.activities.length-2}</span>}
                      </td>
                      <td className="dash-td dash-td--right">{p.totalLeadTarget}</td>
                      <td className="dash-td dash-td--right">{p.totalRetailTarget}</td>
                      <td className="dash-td dash-td--right dash-td--mono">{inr(p.totalBudget)}</td>
                      <td className="dash-td" style={{ fontSize:12,color:"#64748b" }}>{fmtDate(p.createdAt)}</td>
                      <td className="dash-td">
                        {isSentBack(p)?(
                          <span style={{ fontSize:11,color:"#92400e",background:"#fef9c3",
                            padding:"2px 8px",borderRadius:10,fontWeight:600 }}>↩ Sent</span>
                        ):p.status==="Approved"?(
                          <span style={{ fontSize:11,color:"#166534",background:"#f0fdf4",
                            padding:"2px 8px",borderRadius:10 }}>Can request</span>
                        ):<span className="dash-muted">—</span>}
                      </td>
                      <td className="dash-td">
                        <span className={statusBadge(p.status)}>
                          {p.status==="NeedsRevision"?"Needs Revision":p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ══════════ FULL-PAGE PROPOSAL DETAIL ══════════
          Same pattern as ApproverDashboard fullscreen modal:
          position:fixed, inset:0, flex column, scrollable body  */}
      {selected&&(
        <div style={{ position:"fixed",inset:0,zIndex:900,background:"#f1f5f9",
          display:"flex",flexDirection:"column",overflow:"hidden" }}>

          {/* ── Top bar ── */}
          <div style={{ background:"#0a2540",color:"#fff",padding:"0 24px",height:58,flexShrink:0,
            display:"flex",alignItems:"center",justifyContent:"space-between",
            boxShadow:"0 2px 8px rgba(0,0,0,0.2)" }}>
            <div style={{ display:"flex",alignItems:"center",gap:14,minWidth:0 }}>
              <span style={{ fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,
                flexShrink:0,color:"#fff",
                background:selected.status==="Approved"?"#16a34a"
                  :selected.status==="Rejected"?"#dc2626"
                  :selected.status==="NeedsRevision"?"#f59e0b":"#64748b" }}>
                {selected.status==="Approved"?"✓ Approved"
                  :selected.status==="Rejected"?"✕ Rejected"
                  :selected.status==="NeedsRevision"?"Needs Revision"
                  :"⏳ Pending"}
              </span>
              <div style={{ minWidth:0 }}>
                <span style={{ fontWeight:700,fontSize:16,color:"#fff" }}>
                  {selected.tokenNumber??selected.id.slice(-8)}
                </span>
                <span style={{ color:"#94a3b8",fontSize:12,marginLeft:12 }}>
                  {selected.dealerName} · {selected.location}, {selected.state} · {selected.month}
                </span>
              </div>
            </div>
            <button onClick={closeDetail}
              style={{ background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                color:"#fff",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer",fontWeight:600 }}>
              ✕ Close
            </button>
          </div>

          {/* ── Scrollable body ── */}
          <div style={{ flex:1,overflowY:"auto",padding:"24px 24px 40px" }}>
            <div style={{ maxWidth:1200,margin:"0 auto" }}>

              {/* Proposal info grid */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",
                gap:10,marginBottom:20 }}>
                {[
                  {label:"Token No.",    value:selected.tokenNumber??"—"},
                  {label:"Month",        value:selected.month},
                  {label:"Dealer",       value:selected.dealerName},
                  {label:"Location",     value:`${selected.location}, ${selected.state}`},
                  {label:"RSM / TSM",    value:selected.rsmName},
                  {label:"Commando",     value:selected.commandoName||"—"},
                  {label:"Eligibility",  value:selected.eligibility},
                  {label:"Dealer Type",  value:selected.type},
                  {label:"Vendor",       value:selected.vendorName||"—"},
                  {label:"Submitted by", value:selected.submittedByDisplayName??selected.submittedBy},
                ].map(({label,value})=>(
                  <div key={label} style={{ background:"#fff",border:"1px solid #e2e8f0",
                    borderRadius:8,padding:"10px 12px" }}>
                    <div style={{ fontSize:10,color:"#6b7280",fontWeight:700,
                      textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4 }}>{label}</div>
                    <div style={{ fontWeight:600,fontSize:13,color:"#0a2540",
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Status banner */}
              <div style={{
                background:selected.status==="Approved"?"#f0fdf4"
                  :selected.status==="Rejected"?"#fef2f2":"#fffbeb",
                border:`1px solid ${selected.status==="Approved"?"#bbf7d0"
                  :selected.status==="Rejected"?"#fecaca":"#fde68a"}`,
                borderLeft:`4px solid ${selected.status==="Approved"?"#16a34a"
                  :selected.status==="Rejected"?"#dc2626":"#f59e0b"}`,
                borderRadius:8,padding:"12px 16px",marginBottom:20,fontSize:13 }}>
                <strong style={{ color:selected.status==="Approved"?"#166534"
                  :selected.status==="Rejected"?"#991b1b":"#92400e" }}>
                  {selected.status==="Approved"?"✓ Approved"
                   :selected.status==="Rejected"?"✕ Rejected"
                   :selected.status==="NeedsRevision"?"↩ Needs Revision"
                   :"⏳ Pending Review"}
                </strong>
                {selected.approverNote&&(
                  <p style={{ margin:"4px 0 0",color:"#374151",fontSize:12 }}>{selected.approverNote}</p>
                )}
                {selected.decidedAt&&(
                  <p style={{ margin:"4px 0 0",color:"#6b7280",fontSize:11 }}>
                    {fmtDate(selected.decidedAt)}{selected.approvedBy&&` · ${selected.approvedBy}`}
                  </p>
                )}
              </div>

              {/* RSM remarks */}
              {selected.remarks&&(
                <div style={{ background:"#fffbeb",border:"1px solid #fde68a",
                  borderLeft:"3px solid #f59e0b",borderRadius:8,
                  padding:"10px 14px",marginBottom:16,fontSize:13 }}>
                  <span style={{ fontWeight:600,color:"#92400e",fontSize:11,
                    textTransform:"uppercase",letterSpacing:"0.04em",display:"block",marginBottom:4 }}>
                    RSM Remarks
                  </span>
                  <p style={{ margin:0,color:"#78350f" }}>{selected.remarks}</p>
                </div>
              )}

              {/* ── Activity plan cross-tab ── */}
              <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,
                overflow:"hidden",marginBottom:20 }}>
                <div style={{ background:"#0a2540",padding:"12px 16px" }}>
                  <span style={{ color:"#fff",fontWeight:700,fontSize:14 }}>
                    Activity Plan ({selected.activities.length})
                  </span>
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13,
                    minWidth:600 }}>
                    <thead>
                      <tr style={{ background:"#f8fafc",borderBottom:"2px solid #e2e8f0" }}>
                        <th style={{ padding:"9px 14px",textAlign:"left",fontSize:11,fontWeight:700,
                          color:"#374151",borderRight:"2px solid #e2e8f0",
                          minWidth:180,whiteSpace:"nowrap" }}>Parameter</th>
                        {selected.activities.map((a,i)=>(
                          <th key={a.id} style={{ padding:"9px 14px",textAlign:"left",
                            fontSize:12,color:"#0a2540",borderLeft:"1px solid #e2e8f0",
                            minWidth:150 }}>
                            <span style={{ fontWeight:700 }}>{String.fromCharCode(65+i)})</span>
                            {" "}{a.activityType}
                            {a.category&&(
                              <span style={{ marginLeft:6,fontSize:10,fontWeight:700,
                                padding:"1px 6px",borderRadius:3,
                                background:a.category==="ATL"?"#eff6ff":"#f0fdf4",
                                color:a.category==="ATL"?"#1e40af":"#166534" }}>
                                {a.category}
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {label:"No. of Days", even:true, render:(a:ActivityResponse)=>{
                          const d=a.startDate&&a.endDate
                            ?Math.round((new Date(a.endDate).getTime()-new Date(a.startDate).getTime())/(86400000))+1:0;
                          return `${d} days`;
                        }},
                        {label:"Dates", even:false, render:(a:ActivityResponse)=>
                          `${fmtShort(a.startDate)} – ${fmtDate(a.endDate)}`},
                        {label:"Expected Leads",  even:true,  render:(a:ActivityResponse)=>String(a.leadTarget)},
                        {label:"Expected Retail", even:false, render:(a:ActivityResponse)=>String(a.retailTarget)},
                        {label:"Budget",  even:true, render:(a:ActivityResponse)=>
                          inr(a.budget+a.additionalBudget)},
                        {label:"Add. Budget", even:false, render:(a:ActivityResponse)=>
                          a.additionalBudget>0?inr(a.additionalBudget):"—"},
                        {label:"BGauss Share", even:true, render:(a:ActivityResponse)=>
                          a.bgaussShare&&a.bgaussShare>0?`${a.bgaussShare}%`:"100%"},
                        {label:"CPL", even:false, render:(a:ActivityResponse)=>{
                          const cpl=a.leadTarget>0?Math.round((a.budget+a.additionalBudget)/a.leadTarget):0;
                          return inr(cpl);
                        }},
                      ].map(({label,even,render})=>(
                        <tr key={label}>
                          <td style={{ padding:"8px 14px",color:"#6b7280",fontSize:11,fontWeight:600,
                            borderBottom:"1px solid #f1f5f9",borderRight:"2px solid #e2e8f0",
                            background:even?"#f8fafc":"#fff",whiteSpace:"nowrap" }}>
                            {label}
                          </td>
                          {selected.activities.map((a)=>(
                            <td key={a.id} style={{ padding:"8px 14px",fontSize:13,
                              background:even?"#f8fafc":"#fff",
                              borderBottom:"1px solid #f1f5f9",borderLeft:"1px solid #e2e8f0" }}>
                              {render(a)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {/* CAC with over-limit highlight */}
                      <tr>
                        <td style={{ padding:"8px 14px",color:"#6b7280",fontSize:11,fontWeight:600,
                          borderBottom:"1px solid #f1f5f9",borderRight:"2px solid #e2e8f0",
                          background:"#f8fafc",whiteSpace:"nowrap" }}>CAC</td>
                        {selected.activities.map((a)=>{
                          const cac=a.retailTarget>0
                            ?Math.round((a.budget+a.additionalBudget)/a.retailTarget):0;
                          const over=cac>4000;
                          return <td key={a.id} style={{ padding:"8px 14px",fontSize:13,
                            background:"#f8fafc",borderBottom:"1px solid #f1f5f9",
                            borderLeft:"1px solid #e2e8f0",
                            color:over?"#dc2626":"inherit",fontWeight:over?700:400 }}>
                            {inr(cac)}
                            {over&&<em style={{ fontSize:10,marginLeft:4,fontStyle:"italic" }}>
                              (exceeds limit)</em>}
                          </td>;
                        })}
                      </tr>
                      {/* Footer total row */}
                      <tr style={{ background:"#0a2540" }}>
                        <td style={{ padding:"10px 14px",color:"#94a3b8",fontSize:11,
                          fontWeight:700,borderRight:"2px solid #1e3a5f",whiteSpace:"nowrap" }}>
                          Total
                        </td>
                        <td colSpan={selected.activities.length}
                          style={{ padding:"10px 14px",color:"#fff",fontSize:13 }}>
                          <strong>Budget:</strong> {inr(selected.totalBudget)}
                          &nbsp;·&nbsp;
                          <strong>CPL:</strong> {inr(Math.round(selected.cpl))}
                          &nbsp;·&nbsp;
                          <strong style={{ color:selected.cac>4000?"#fca5a5":"#fff" }}>
                            CAC:
                          </strong>{" "}
                          {inr(Math.round(selected.cac))}
                          {selected.cac>4000&&(
                            <em style={{ fontSize:11,marginLeft:6,color:"#fca5a5" }}>
                              (exceeds limit)
                            </em>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Already sent-back banner ── */}
              {isSentBack(selected)&&sentBackNote(selected)&&(
                <div style={{ background:"#fef9c3",border:"1px solid #fde68a",
                  borderLeft:"4px solid #f59e0b",borderRadius:8,
                  padding:"12px 16px",marginBottom:16,fontSize:13 }}>
                  <strong style={{ color:"#92400e" }}>
                    ↩ Budget add-on request sent
                    {sentBackAt(selected)&&(
                      <span style={{ fontWeight:400,color:"#78350f",marginLeft:8,fontSize:11 }}>
                        on {fmtDate(sentBackAt(selected))}
                      </span>
                    )}
                  </strong>
                  <p style={{ margin:"6px 0 0",color:"#78350f",fontSize:12,whiteSpace:"pre-wrap" }}>
                    {sentBackNote(selected)}
                  </p>
                  <p style={{ margin:"4px 0 0",color:"#92400e",fontSize:11 }}>
                    Sent from: <strong>{dealerEmail}</strong>
                  </p>
                </div>
              )}

              {/* ── Budget add-on request — Approved proposals only ── */}
              {selected.status==="Approved"&&(
                <div style={{ background:"#fff",border:"1px solid #e2e8f0",
                  borderRadius:10,padding:"20px",marginBottom:20 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",
                    alignItems:"flex-start",marginBottom:showSendBack?12:0 }}>
                    <div>
                      <p style={{ fontSize:14,fontWeight:700,color:"#0a2540",margin:0 }}>
                        Request Budget Addition
                      </p>
                      <p style={{ fontSize:12,color:"#6b7280",margin:"4px 0 0" }}>
                        Request will be sent from <strong>{dealerEmail}</strong>{" "}
                        to Mayank Maheshwari (CC: RSM)
                      </p>
                    </div>
                    {!isSentBack(selected)&&!showSendBack&&(
                      <button onClick={()=>setShowSendBack(true)}
                        style={{ background:"#92400e",color:"#fff",border:"none",
                          padding:"9px 18px",borderRadius:8,fontWeight:600,
                          fontSize:13,cursor:"pointer",whiteSpace:"nowrap" }}>
                        ↩ Request Addition
                      </button>
                    )}
                  </div>

                  {!isSentBack(selected)&&showSendBack&&(
                    <div style={{ background:"#fefce8",border:"1px solid #fde68a",
                      borderRadius:8,padding:16 }}>
                      <p style={{ fontSize:13,fontWeight:600,color:"#0a2540",margin:"0 0 4px" }}>
                        Describe the additional budget needed
                      </p>
                      <p style={{ fontSize:11,color:"#9ca3af",margin:"0 0 10px" }}>
                        Specify which activity, how much additional budget is required, and why.
                      </p>
                      <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",
                        borderRadius:6,padding:"8px 12px",marginBottom:12,fontSize:12 }}>
                        <span style={{ color:"#166534" }}>
                          📧 Sending from: <strong>{dealerEmail}</strong>
                          {" "}· Dealer: <strong>{dealerUser.dealerName||dealerUser.displayName}</strong>
                        </span>
                      </div>
                      <textarea rows={6} value={sendBackNote}
                        onChange={(e)=>setSendBackNote(e.target.value)}
                        placeholder={
                          "Example:\nRequesting ₹25,000 additional budget for Test Drive Camp (Activity A).\n\n"+
                          "Current approved budget: ₹45,000\nRequested additional: ₹25,000\n\n"+
                          "Reason: Venue rates increased due to festival season."
                        }
                        style={{ width:"100%",padding:"10px 12px",borderRadius:7,
                          border:"1px solid #d1d5db",fontSize:13,resize:"vertical",
                          boxSizing:"border-box" as const,minHeight:140 }}/>
                      <div style={{ display:"flex",gap:10,marginTop:12 }}>
                        <button onClick={handleDealerSendBack}
                          disabled={sendBackLoading||!sendBackNote.trim()}
                          style={{ background:"#92400e",color:"#fff",border:"none",
                            padding:"10px 22px",borderRadius:8,fontWeight:600,fontSize:14,
                            cursor:sendBackLoading||!sendBackNote.trim()?"not-allowed":"pointer",
                            opacity:sendBackLoading||!sendBackNote.trim()?0.6:1 }}>
                          {sendBackLoading?"Sending…":"📩 Send Request"}
                        </button>
                        <button onClick={()=>{setShowSendBack(false);setSendBackNote("");}}
                          style={{ background:"#f1f5f9",color:"#374151",
                            border:"1px solid #e2e8f0",padding:"10px 20px",
                            borderRadius:8,fontWeight:500,fontSize:14,cursor:"pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast&&(
        <div style={{ position:"fixed",bottom:24,right:24,zIndex:9999,
          background:toast.ok?"#166534":"#991b1b",color:"#fff",
          padding:"12px 20px",borderRadius:8,fontSize:14,fontWeight:600,
          boxShadow:"0 4px 20px rgba(0,0,0,0.25)",maxWidth:360 }}>
          {toast.ok?"✓":"✕"}&nbsp;{toast.msg}
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon,label,value,sub,accent,active,onClick }: {
  icon:string; label:string; value:string; sub:string;
  accent:"blue"|"amber"|"green"|"red"|"purple";
  active?:boolean; onClick:()=>void;
}) {
  return (
    <button type="button"
      className={[
        "dash-kpi-card","dash-kpi-card--clickable",`dash-kpi-card--${accent}`,
        active?"dash-kpi-card--active":"",
      ].filter(Boolean).join(" ")}
      onClick={onClick}
      title={active?"Click to clear filter":undefined}>
      <div className="dash-kpi-icon">{icon}</div>
      <div className="dash-kpi-body">
        <div className="dash-kpi-label">{label}</div>
        <div className="dash-kpi-value">{value}</div>
        {sub&&<div className="dash-kpi-sub">{sub}</div>}
      </div>
      {active&&<div className="dash-kpi-active-dot"/>}
    </button>
  );
}
// frontend/src/pages/ApproverDashboard.tsx
import { useState, useMemo, useEffect, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate } from "react-router-dom";
import {
  fetchProposals,
  decideProposal,
  updateProposal,
  type ActivityResponse,
  type ProposalResponse,
} from "../services/proposalService";
import "./ApproverDashboard.css";

/* ── helpers ──────────────────────────────────────────────────────────────── */
const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const num = (v: string | number) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const eligClass   = (e: string) => e === "Eligible" ? "ap-elig-yes" : e === "Not Eligible" ? "ap-elig-no" : "ap-elig-pend";
const statusClass = (s: string) => s === "Approved" ? "ap-badge ap-badge-approved" : s === "Rejected" ? "ap-badge ap-badge-rejected" : "ap-badge ap-badge-pending";

/* ── constants ────────────────────────────────────────────────────────────── */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ELIGIBILITY = ["Eligible","Not Eligible","Pending Approval"];
const LOC_TYPES   = ["Old","New"];
const ACT_TYPES   = [
  "Test Drive Camp","Canopy Activity","Mela / Exhibition","Road Show",
  "Digital Campaign","Influencer Activity","Corporate Connect",
  "Society Activation","Referral Program","Other",
];

/* ── editable types ───────────────────────────────────────────────────────── */
interface EditActivity {
  id?: string;
  activityType: string;
  target: string;
  startDate: string;
  endDate: string;
  budget: string;
  incentive: string;
  remarks: string;
}
interface EditableProposal {
  dealerName: string; location: string; state: string;
  type: string; rsmName: string; commandoName: string;
  month: string; eligibility: string; remarks: string;
  activities: EditActivity[];
}

function toEditable(p: ProposalResponse): EditableProposal {
  return {
    dealerName: p.dealerName, location: p.location, state: p.state,
    type: p.type, rsmName: p.rsmName, commandoName: p.commandoName,
    month: p.month, eligibility: p.eligibility, remarks: p.remarks ?? "",
    activities: p.activities.map((a: ActivityResponse) => ({
      id: a.id, activityType: a.activityType,
      target: String(a.target), startDate: a.startDate?.split("T")[0] ?? "",
      endDate: a.endDate?.split("T")[0] ?? "",
      budget: String(a.budget), incentive: String(a.incentive), remarks: a.remarks ?? "",
    })),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════════════════ */
export default function ApproverDashboard() {
  const { instance, accounts } = useMsal();
  const navigate = useNavigate();
  const account  = accounts[0];

  const [proposals,     setProposals]     = useState<ProposalResponse[]>([]);
  const [selected,      setSelected]      = useState<ProposalResponse | null>(null);
  const [editData,      setEditData]      = useState<EditableProposal | null>(null);
  const [isEditing,     setIsEditing]     = useState(false);
  const [note,          setNote]          = useState("");
  const [filterStatus,  setFilterStatus]  = useState<"All" | ProposalResponse["status"]>("All");
  const [filterMonth,   setFilterMonth]   = useState("All");
  const [search,        setSearch]        = useState("");
  const [loading,       setLoading]       = useState(true);
  const [fetchError,    setFetchError]    = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [saveLoading,   setSaveLoading]   = useState(false);
  const [toast,         setToast]         = useState<{ msg: string; ok: boolean } | null>(null);
  const [autoAction,    setAutoAction]    = useState<"Approved" | "Rejected" | null>(null);

  /* ── load ── */
  const loadProposals = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try   { setProposals(await fetchProposals(instance)); }
    catch (err) { setFetchError(err instanceof Error ? err.message : "Failed to load proposals."); }
    finally     { setLoading(false); }
  }, [instance]);

  useEffect(() => { loadProposals(); }, [loadProposals]);

  /* ── email deep-link ── */
  useEffect(() => {
    if (!proposals.length) return;
    const p = new URLSearchParams(window.location.search);
    const action = p.get("action"), id = p.get("id");
    if (!id || !action) return;
    const t = proposals.find((x) => x.id === id);
    if (!t || t.status !== "Pending") return;
    openDrawer(t);
    if (action === "approve") setAutoAction("Approved");
    if (action === "reject")  setAutoAction("Rejected");
    window.history.replaceState({}, "", "/approver");
  }, [proposals]);

  useEffect(() => {
    if (!autoAction || !selected) return;
    decide(autoAction); setAutoAction(null);
  }, [autoAction, selected]);

  /* ── derived ── */
  const months   = useMemo(() => ["All", ...Array.from(new Set(proposals.map((p) => p.month)))], [proposals]);
  const filtered = useMemo(() =>
    proposals.filter((p) => {
      if (filterStatus !== "All" && p.status !== filterStatus) return false;
      if (filterMonth  !== "All" && p.month  !== filterMonth)  return false;
      if (search) {
        const q = search.toLowerCase();
        return p.dealerName.toLowerCase().includes(q) || p.rsmName.toLowerCase().includes(q) ||
               p.location.toLowerCase().includes(q)   || p.id.toLowerCase().includes(q);
      }
      return true;
    }), [proposals, filterStatus, filterMonth, search]);

  const stats = useMemo(() => {
    const a = proposals.filter((p) => p.status === "Approved");
    return { total: proposals.length, pending: proposals.filter((p) => p.status==="Pending").length,
             approved: a.length, rejected: proposals.filter((p) => p.status==="Rejected").length,
             totalBudget: a.reduce((s,p)=>s+p.totalBudget,0) };
  }, [proposals]);

  /* ── live edit totals ── */
  const editTotals = useMemo(() => {
    if (!editData) return { totalBudget:0, totalTarget:0, cac:0 };
    const tb = editData.activities.reduce((s,a)=>s+num(a.budget)+num(a.incentive),0);
    const tt = editData.activities.reduce((s,a)=>s+num(a.target),0);
    return { totalBudget:tb, totalTarget:tt, cac: tt>0 ? tb/tt : 0 };
  }, [editData]);

  /* ── toast ── */
  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok }); setTimeout(()=>setToast(null), 3500);
  };

  /* ── drawer ── */
  const openDrawer = (p: ProposalResponse) => {
    setSelected(p); setEditData(toEditable(p)); setIsEditing(false); setNote(p.approverNote ?? "");
  };
  const closeDrawer = () => { setSelected(null); setEditData(null); setIsEditing(false); };

  /* ── edit helpers ── */
  const setF = (key: keyof Omit<EditableProposal,"activities">, v: string) =>
    setEditData((d) => d ? { ...d, [key]: v } : d);

  const setAF = (idx: number, key: keyof EditActivity, v: string) =>
    setEditData((d) => {
      if (!d) return d;
      return { ...d, activities: d.activities.map((a,i)=>i===idx?{...a,[key]:v}:a) };
    });

  const addRow = () =>
    setEditData((d) => d ? { ...d, activities:[...d.activities,
      { activityType:"",target:"",startDate:"",endDate:"",budget:"",incentive:"",remarks:"" }] } : d);

  const removeRow = (idx: number) =>
    setEditData((d) => (!d||d.activities.length<=1) ? d : { ...d, activities:d.activities.filter((_,i)=>i!==idx) });

  const startEdit = () => setIsEditing(true);
  const cancelEdit = () => { if (selected) setEditData(toEditable(selected)); setIsEditing(false); };

  /* ── save ── */
  const saveEdits = async () => {
    if (!selected || !editData) return;
    setSaveLoading(true);
    try {
      const payload = {
        ...editData,
        activities: editData.activities.map((a)=>({...a,target:num(a.target),budget:num(a.budget),incentive:num(a.incentive)})),
        ...editTotals,
      };
      const updated = await updateProposal(selected.id, payload, instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); setEditData(toEditable(updated)); setIsEditing(false);
      showToast("Proposal updated successfully.", true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed.", false);
    } finally { setSaveLoading(false); }
  };

  /* ── decide ── */
  const decide = async (action: "Approved"|"Rejected") => {
    if (!selected) return;
    setActionLoading(true);
    try {
      const updated = await decideProposal(selected.id,
        { status:action, approverNote:note.trim()||null, approvedBy:account?.username??null }, instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated);
      showToast(action==="Approved"?"Proposal approved.":"Proposal rejected.", action==="Approved");
      setNote("");
    } catch (err) {
      showToast(err instanceof Error?err.message:"Action failed.", false);
    } finally { setActionLoading(false); }
  };

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="ap-page">

      {/* topbar */}
      <header className="ap-topbar">
        <div className="ap-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="ap-brand-logo" />
          <span className="ap-brand-text">BGauss</span>
          <span className="ap-brand-div" />
          <span className="ap-brand-sub">Approver portal</span>
        </div>
        <div className="ap-topbar-right">
          {account?.name && <span className="ap-user">{account.name}</span>}
          <button className="ap-topbar-btn" onClick={()=>navigate("/dashboard")}>← Dashboard</button>
          <button className="ap-topbar-btn" onClick={()=>instance.logoutRedirect().catch(console.error)}>Sign out</button>
        </div>
      </header>

      <main className="ap-main">
        {loading && <div className="ap-loading"><div className="ap-spinner" /><p>Loading proposals…</p></div>}

        {!loading && fetchError && (
          <div className="ap-error-state">
            <p className="ap-error-msg">⚠ {fetchError}</p>
            <button className="ap-retry-btn" onClick={loadProposals}>Retry</button>
          </div>
        )}

        {!loading && !fetchError && (
          <>
            {/* stats */}
            <div className="ap-stats">
              <div className="ap-stat"><span className="ap-stat-val ap-navy">{stats.total}</span><span className="ap-stat-lbl">Total proposals</span></div>
              <div className="ap-stat"><span className="ap-stat-val ap-amber">{stats.pending}</span><span className="ap-stat-lbl">Pending review</span></div>
              <div className="ap-stat"><span className="ap-stat-val ap-green">{stats.approved}</span><span className="ap-stat-lbl">Approved</span></div>
              <div className="ap-stat"><span className="ap-stat-val ap-red">{stats.rejected}</span><span className="ap-stat-lbl">Rejected</span></div>
              <div className="ap-stat"><span className="ap-stat-val ap-navy">{inr(stats.totalBudget)}</span><span className="ap-stat-lbl">Approved budget</span></div>
            </div>

            {/* filters */}
            <div className="ap-filters">
              <input className="ap-search" placeholder="Search dealer, RSM, location…" value={search} onChange={(e)=>setSearch(e.target.value)} />
              <select className="ap-select" value={filterStatus} onChange={(e)=>setFilterStatus(e.target.value as any)}>
                {["All","Pending","Approved","Rejected"].map((s)=><option key={s} value={s}>{s==="All"?"All statuses":s}</option>)}
              </select>
              <select className="ap-select" value={filterMonth} onChange={(e)=>setFilterMonth(e.target.value)}>
                {months.map((m)=><option key={m} value={m}>{m==="All"?"All months":m}</option>)}
              </select>
              <button className="ap-refresh-btn" onClick={loadProposals}>↻ Refresh</button>
            </div>

            {/* table */}
            <div className="ap-table-wrap">
              <table className="ap-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Submitted</th><th>RSM / TSM</th><th>Dealer &amp; location</th>
                    <th>Month</th><th>Activities</th>
                    <th className="ap-num">Budget</th><th className="ap-num">Target</th><th className="ap-num">CAC</th>
                    <th>Eligibility</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0 && <tr><td colSpan={12} className="ap-empty">{proposals.length===0?"No proposals yet.":"No results match."}</td></tr>}
                  {filtered.map((p)=>(
                    <tr key={p.id} className="ap-row" onClick={()=>openDrawer(p)}>
                      <td><span className="ap-id-chip">{p.id.split("-").slice(-1)[0]}</span></td>
                      <td><span className="ap-cell-p">{fmtDate(p.createdAt)}</span><span className="ap-cell-m">{p.submittedBy}</span></td>
                      <td><span className="ap-cell-p">{p.rsmName}</span><span className="ap-cell-m">{p.commandoName}</span></td>
                      <td><span className="ap-cell-p">{p.dealerName}</span><span className="ap-cell-m">{p.location}, {p.state}</span></td>
                      <td>{p.month}</td>
                      <td>{p.activities.map((a:ActivityResponse,i:number)=><span key={i} className="ap-act-chip">{a.activityType}</span>)}</td>
                      <td className="ap-num ap-bold">{inr(p.totalBudget)}</td>
                      <td className="ap-num">{p.totalTarget}</td>
                      <td className="ap-num">{inr(p.cac)}</td>
                      <td><span className={`ap-elig ${eligClass(p.eligibility)}`}>{p.eligibility}</span></td>
                      <td><span className={statusClass(p.status)}>{p.status}</span></td>
                      <td onClick={(e)=>e.stopPropagation()}>
                        <button className="ap-review-btn" onClick={()=>openDrawer(p)}>{p.status==="Pending"?"Review":"View"}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════
          SIDE DRAWER
      ══════════════════════════════════════════════════════════ */}
      {selected && editData && (
        <div className="ap-overlay" onClick={closeDrawer}>
          <div className="ap-drawer" onClick={(e)=>e.stopPropagation()}>

            {/* ── drawer topbar ── */}
            <div className="ap-drawer-topbar">
              <div className="ap-drawer-topbar-left">
                <span className="ap-drawer-status-pill">
                  {selected.status === "Pending" ? "Pending review"
                   : selected.status === "Approved" ? "Approved" : "Rejected"}
                </span>
                {isEditing
                  ? <input className="ap-dtitle-input" value={editData.dealerName}
                      onChange={(e)=>setF("dealerName",e.target.value)} placeholder="Dealer name" />
                  : <h2 className="ap-drawer-title">{selected.dealerName}</h2>
                }
                <p className="ap-drawer-sub">
                  {isEditing
                    ? <span className="ap-loc-row">
                        <input className="ap-sm-input" value={editData.location}
                          onChange={(e)=>setF("location",e.target.value)} placeholder="City" style={{width:110}} />
                        <span className="ap-loc-sep">,</span>
                        <input className="ap-sm-input" value={editData.state}
                          onChange={(e)=>setF("state",e.target.value)} placeholder="State" style={{width:120}} />
                      </span>
                    : <>{selected.location}, {selected.state} &middot; {selected.month} &middot; <strong>{selected.submittedBy}</strong> · {fmtDate(selected.createdAt)}</>
                  }
                </p>
              </div>
              <div className="ap-drawer-topbar-right">
                {selected.status === "Pending" && !isEditing && (
                  <button className="ap-edit-trigger-btn" onClick={startEdit}>
                    ✏ Edit proposal
                  </button>
                )}
                {isEditing && (
                  <button className="ap-cancel-edit-btn" onClick={cancelEdit}>
                    ✕ Cancel
                  </button>
                )}
                <button className="ap-close-btn" onClick={closeDrawer}>✕</button>
              </div>
            </div>

            {/* ── edit mode banner ── */}
            {isEditing && (
              <div className="ap-edit-banner">
                ✏ Edit mode — modify any field below, then save changes before approving or rejecting.
              </div>
            )}

            {/* ── scrollable body ── */}
            <div className="ap-drawer-body">

              {/* meta grid — 4 col */}
              <div className="ap-meta-grid-4">
                {[
                  { key:"rsmName",      label:"RSM / TSM",  input:"text" },
                  { key:"commandoName", label:"Commando",   input:"text" },
                  { key:"type",         label:"Type",       input:"select", opts:LOC_TYPES },
                  { key:"eligibility",  label:"Eligibility",input:"select", opts:ELIGIBILITY },
                ].map(({ key, label, input, opts }) => (
                  <div key={key} className="ap-meta-cell">
                    <span className="ap-meta-lbl">{label}</span>
                    {isEditing ? (
                      input === "select"
                        ? <select className="ap-field-select"
                            value={(editData as any)[key]}
                            onChange={(e)=>setF(key as any, e.target.value)}>
                            {opts!.map((o)=><option key={o} value={o}>{o}</option>)}
                          </select>
                        : <input className="ap-field-input"
                            value={(editData as any)[key]}
                            onChange={(e)=>setF(key as any, e.target.value)} />
                    ) : (
                      key === "eligibility"
                        ? <span className={`ap-elig ${eligClass((selected as any)[key])}`}>{(selected as any)[key]}</span>
                        : <span className="ap-meta-val">{(selected as any)[key] || "—"}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* dealer / month row — 3 col */}
              <div className="ap-meta-grid-3">
                {[
                  { key:"dealerName", label:"Dealer name",   input:"text" },
                  { key:"location",   label:"City, State",   input:"text" },
                  { key:"month",      label:"Month",         input:"select", opts:MONTHS },
                ].map(({ key, label, input, opts }) => (
                  <div key={key} className="ap-meta-cell">
                    <span className="ap-meta-lbl">{label}</span>
                    {isEditing ? (
                      input === "select"
                        ? <select className="ap-field-select"
                            value={(editData as any)[key]}
                            onChange={(e)=>setF(key as any, e.target.value)}>
                            {opts!.map((o)=><option key={o} value={o}>{o}</option>)}
                          </select>
                        : <input className="ap-field-input"
                            value={(editData as any)[key]}
                            onChange={(e)=>setF(key as any, e.target.value)} />
                    ) : (
                      <span className="ap-meta-val">{(selected as any)[key] || "—"}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* remarks */}
              {isEditing ? (
                <div className="ap-remarks-edit">
                  <span className="ap-meta-lbl">RSM remarks</span>
                  <textarea className="ap-field-textarea" rows={2}
                    value={editData.remarks}
                    onChange={(e)=>setF("remarks",e.target.value)}
                    placeholder="RSM remarks…" />
                </div>
              ) : selected.remarks ? (
                <div className="ap-remarks">
                  <span className="ap-remarks-lbl">RSM remarks</span>
                  <p className="ap-remarks-text">{selected.remarks}</p>
                </div>
              ) : null}

              {/* activities section header */}
              <div className="ap-section-header">
                <span className="ap-sec-head">Activities</span>
                {isEditing && (
                  <button className="ap-add-row-btn" onClick={addRow}>
                    + Add row
                  </button>
                )}
              </div>

              {/* activity table */}
              <div className="ap-itbl-wrap">
                <div style={{overflowX:"auto"}}>
                  <table className="ap-itbl" style={{minWidth: isEditing ? 700 : "auto"}}>
                    <thead>
                      <tr>
                        <th style={{width:28}}>#</th>
                        <th>Activity type</th>
                        <th className="ap-num" style={{width:70}}>Target</th>
                        <th>Dates</th>
                        <th className="ap-num" style={{width:100}}>Budget (₹)</th>
                        <th className="ap-num" style={{width:100}}>Incentive (₹)</th>
                        <th className="ap-num" style={{width:100}}>Total (₹)</th>
                        {isEditing && <th style={{width:32}}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(isEditing ? editData.activities : selected.activities).map((a, i) =>
                        isEditing ? (
                          <tr key={i} className={i%2===0?"ap-erow-even":"ap-erow-odd"}>
                            <td className="ap-td-num" style={{color:"var(--color-text-tertiary)"}}>{i+1}</td>
                            <td className="ap-td">
                              <select className="ap-cell-select"
                                value={(a as EditActivity).activityType}
                                onChange={(e)=>setAF(i,"activityType",e.target.value)}>
                                <option value="">Select…</option>
                                {ACT_TYPES.map((t)=><option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td className="ap-td-num">
                              <input type="number" min={0} className="ap-cell-num"
                                value={(a as EditActivity).target}
                                onChange={(e)=>setAF(i,"target",e.target.value)} />
                            </td>
                            <td className="ap-td">
                              <div className="ap-date-pair">
                                <input type="date" className="ap-cell-date"
                                  value={(a as EditActivity).startDate}
                                  onChange={(e)=>setAF(i,"startDate",e.target.value)} />
                                <span className="ap-date-arrow">→</span>
                                <input type="date" className="ap-cell-date"
                                  value={(a as EditActivity).endDate}
                                  min={(a as EditActivity).startDate||undefined}
                                  onChange={(e)=>setAF(i,"endDate",e.target.value)} />
                              </div>
                            </td>
                            <td className="ap-td-num">
                              <input type="number" min={0} className="ap-cell-num"
                                value={(a as EditActivity).budget}
                                onChange={(e)=>setAF(i,"budget",e.target.value)} />
                            </td>
                            <td className="ap-td-num">
                              <input type="number" min={0} className="ap-cell-num"
                                value={(a as EditActivity).incentive}
                                onChange={(e)=>setAF(i,"incentive",e.target.value)} />
                            </td>
                            <td className="ap-td-num ap-bold">
                              {inr(num((a as EditActivity).budget)+num((a as EditActivity).incentive))}
                            </td>
                            <td className="ap-td" style={{textAlign:"center"}}>
                              <button className="ap-rm-btn"
                                onClick={()=>removeRow(i)}
                                disabled={editData.activities.length===1}>×</button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={i}>
                            <td className="ap-td-num" style={{color:"var(--color-text-tertiary)"}}>{i+1}</td>
                            <td className="ap-td ap-bold">{(a as ActivityResponse).activityType}</td>
                            <td className="ap-td-num">{(a as ActivityResponse).target}</td>
                            <td className="ap-td" style={{color:"var(--color-text-secondary)"}}>
                              {fmtDate((a as ActivityResponse).startDate)}
                              {(a as ActivityResponse).startDate !== (a as ActivityResponse).endDate &&
                                <> → {fmtDate((a as ActivityResponse).endDate)}</>}
                            </td>
                            <td className="ap-td-num">{inr((a as ActivityResponse).budget)}</td>
                            <td className="ap-td-num">{inr((a as ActivityResponse).incentive)}</td>
                            <td className="ap-td-num ap-bold">
                              {inr((a as ActivityResponse).budget+(a as ActivityResponse).incentive)}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* totals strip */}
              <div className="ap-summary">
                <div className="ap-sum-cell">
                  <span className="ap-sum-lbl">Total target</span>
                  <span className="ap-sum-val">
                    {isEditing ? Math.round(editTotals.totalTarget) : selected.totalTarget}
                  </span>
                </div>
                <div className="ap-sum-cell">
                  <span className="ap-sum-lbl">Total budget</span>
                  <span className="ap-sum-val ap-navy">
                    {inr(isEditing ? editTotals.totalBudget : selected.totalBudget)}
                  </span>
                </div>
                <div className="ap-sum-cell ap-sum-last">
                  <span className="ap-sum-lbl">CAC (auto)</span>
                  <span className="ap-sum-val ap-amber">
                    {inr(isEditing ? editTotals.cac : selected.cac)}
                  </span>
                </div>
              </div>

              {/* decision / action */}
              {selected.status === "Pending" ? (
                <div className="ap-action-box">
                  <p className="ap-sec-head" style={{marginBottom:10}}>Decision</p>
                  {isEditing && (
                    <div className="ap-edit-warning">
                      ⚠ Save your edits above before approving or rejecting.
                    </div>
                  )}
                  <textarea className="ap-note-input" rows={3}
                    placeholder="Add a note for the RSM (optional)…"
                    value={note} onChange={(e)=>setNote(e.target.value)}
                    disabled={isEditing} />
                  <div className="ap-btn-row">
                    <button className="ap-approve-btn"
                      disabled={actionLoading||isEditing}
                      onClick={()=>decide("Approved")}>
                      {actionLoading?"Processing…":"✓  Approve"}
                    </button>
                    <button className="ap-reject-btn"
                      disabled={actionLoading||isEditing}
                      onClick={()=>decide("Rejected")}>
                      {actionLoading?"Processing…":"✕  Reject"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`ap-decision-banner ${selected.status==="Approved"?"ap-decision-approved":"ap-decision-rejected"}`}>
                  <div className="ap-decision-head">
                    <strong>{selected.status}</strong>
                    {selected.decidedAt && (
                      <span className="ap-decision-date">
                        {fmtDate(selected.decidedAt)}
                        {selected.approvedBy && ` · ${selected.approvedBy}`}
                      </span>
                    )}
                  </div>
                  {selected.approverNote && <p className="ap-decision-note">{selected.approverNote}</p>}
                </div>
              )}

            </div>{/* /drawer-body */}

            {/* ── sticky save footer (edit mode only) ── */}
            {isEditing && (
              <div className="ap-save-footer">
                <span className="ap-save-footer-hint">Unsaved changes</span>
                <button className="ap-discard-btn" onClick={cancelEdit}>Discard</button>
                <button className="ap-save-btn" onClick={saveEdits} disabled={saveLoading}>
                  {saveLoading ? "Saving…" : "💾 Save changes"}
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className={`ap-toast ${toast.ok?"ap-toast-ok":"ap-toast-err"}`}>
          {toast.ok?"✓":"✕"}&nbsp;{toast.msg}
        </div>
      )}
    </div>
  );
}
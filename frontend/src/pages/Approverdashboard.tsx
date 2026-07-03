// src/pages/ApproverDashboard.tsx
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import {
  fetchProposals, fetchMyProposals, decideProposal, updateProposal,
  sendBackProposal, updateProposalActuals, uploadActivityMedia,
  forwardProposalToApprover, notifyDealer,
  type ActivityResponse, type ActivityMediaResponse, type ProposalResponse,
} from "../services/proposalService";
import { fetchActivityTypes, type ActivityType } from "../services/activityService";
import "./ApproverDashboard.css";

const inr     = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const num     = (v: string | number) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const eligClass   = (e: string) =>
  e === "Eligible" ? "ap-elig-yes" : e === "Not Eligible" ? "ap-elig-no" : "ap-elig-pend";
const statusClass = (s: string) =>
  s === "Approved"        ? "ap-badge ap-badge-approved"
  : s === "Rejected"      ? "ap-badge ap-badge-rejected"
  : s === "NeedsRevision" ? "ap-badge ap-badge-revision"
  : "ap-badge ap-badge-pending";

const API_BASE   = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const resolveUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
};

const MONTHS      = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ELIGIBILITY = ["Eligible","Not Eligible","Pending Approval"];
const LOC_TYPES   = ["Old","New"];
const BGAUSS_OPTS = ["100","70","50"];

// ── BGauss share read from backend safely ─────────────────────────────────────
// Backend stores 0/null when not set — treat that as 100%
const safeBgaussShare = (v: number | null | undefined): string => {
  if (v == null || v === 0) return "100";
  // Snap to nearest valid option
  if (v <= 50) return "50";
  if (v <= 70) return "70";
  return "100";
};

// ── Media helpers ─────────────────────────────────────────────────────────────
function mediaIcon(t: string | null) {
  if (!t) return "📎";
  if (t.startsWith("image/")) return "🖼";
  if (t.includes("pdf")) return "📄";
  if (t.startsWith("video/")) return "🎬";
  return "📎";
}
function isImage(t: string | null) { return !!t?.startsWith("image/"); }
function isVideo(t: string | null) { return !!t?.startsWith("video/"); }

function collectMedia(a: ActivityResponse) {
  const all: Array<{ id:string; url:string; name:string; type:string|null }> = [];
  const multiUrls = new Set((a.mediaFiles??[]).map((m) => m.fileUrl));
  if (a.mediaFileUrl && !multiUrls.has(a.mediaFileUrl))
    all.push({ id:`legacy-${a.id}`, url:resolveUrl(a.mediaFileUrl), name:a.mediaFileName??"Media file", type:a.mediaFileType??null });
  (a.mediaFiles??[]).forEach((m: ActivityMediaResponse) =>
    all.push({ id:m.id, url:resolveUrl(m.fileUrl), name:m.fileName, type:m.fileType }));
  return all;
}

function MediaViewer({ url, name, type, onClose }: { url:string; name:string; type:string|null; onClose:()=>void }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:10000,
      display:"flex",alignItems:"center",justifyContent:"center" }} onClick={onClose}>
      <div style={{ maxWidth:"92vw",maxHeight:"92vh",position:"relative" }} onClick={(e)=>e.stopPropagation()}>
        <button onClick={onClose} style={{ position:"absolute",top:-40,right:0,
          background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.2)",
          color:"#fff",fontSize:18,cursor:"pointer",borderRadius:6,width:32,height:32,
          display:"flex",alignItems:"center",justifyContent:"center" }}>✕</button>
        {isImage(type) ? <img src={url} alt={name} style={{ maxWidth:"88vw",maxHeight:"82vh",borderRadius:8,display:"block" }}/>
         : isVideo(type) ? <video src={url} controls autoPlay style={{ maxWidth:"88vw",maxHeight:"82vh",borderRadius:8 }}/>
         : <div style={{ background:"#fff",borderRadius:12,padding:"40px 56px",textAlign:"center",minWidth:300 }}>
             <div style={{ fontSize:52,marginBottom:14 }}>{mediaIcon(type)}</div>
             <p style={{ fontWeight:600,marginBottom:18,color:"#0a2540" }}>{name}</p>
             <a href={url} target="_blank" rel="noopener noreferrer"
               style={{ display:"inline-block",background:"#1e3a5f",color:"#fff",
                 padding:"11px 28px",borderRadius:8,textDecoration:"none",fontWeight:600 }}>
               Open / Download ↗
             </a>
           </div>}
        <div style={{ textAlign:"center",marginTop:10 }}>
          <a href={url} target="_blank" rel="noopener noreferrer"
            style={{ color:"#94a3b8",fontSize:11,textDecoration:"underline" }}>{name}</a>
        </div>
      </div>
    </div>
  );
}

function ActivityMediaStrip({ activity }: { activity: ActivityResponse }) {
  const [viewer, setViewer] = useState<{url:string;name:string;type:string|null}|null>(null);
  const all = collectMedia(activity);
  if (all.length === 0) return <span style={{ color:"#cbd5e1",fontSize:11 }}>—</span>;
  return (
    <>
      {viewer && <MediaViewer {...viewer} onClose={()=>setViewer(null)}/>}
      <div style={{ display:"flex",flexWrap:"wrap",gap:4 }}>
        {all.map((m) => (
          <button key={m.id} type="button" onClick={()=>setViewer(m)} title={m.name}
            style={{ display:"flex",alignItems:"center",gap:4,
              background:isImage(m.type)?"transparent":"#f1f5f9",
              border:"1px solid #e2e8f0",borderRadius:5,
              padding:isImage(m.type)?"2px":"3px 7px",cursor:"pointer",
              fontSize:11,color:"#1e3a5f",fontWeight:500,overflow:"hidden" }}>
            {isImage(m.type)
              ? <img src={m.url} alt={m.name} style={{ width:36,height:36,objectFit:"cover",borderRadius:3 }}/>
              : <><span style={{ fontSize:18 }}>{mediaIcon(m.type)}</span>
                  <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:100 }}>{m.name}</span></>}
          </button>
        ))}
      </div>
    </>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface EditMediaFile { id:string; fileUrl:string; fileName:string; fileType:string; }
interface EditActivity {
  id?:string; activityType:string; category:string; categoryLocked?:boolean;
  leadTarget:string; retailTarget:string; startDate:string; endDate:string;
  budget:string; additionalBudget:string; bgaussShare:string;
  vendorId:string; remarks:string; mediaFiles:EditMediaFile[];
}
interface EditableProposal {
  dealerName:string; location:string; state:string; type:string;
  rsmName:string; commandoName:string; month:string;
  eligibility:string; remarks:string; vendorId:string; vendorName:string;
  activities:EditActivity[];
}
interface ActualEntry {
  actualStartDate:string; actualEndDate:string;
  mediaFile:File|null; mediaFileUrl:string|null;
  mediaFileName:string|null; mediaFileType:string|null; uploading:boolean;
}

function toEditable(p: ProposalResponse): EditableProposal {
  return {
    dealerName:p.dealerName, location:p.location, state:p.state, type:p.type,
    rsmName:p.rsmName, commandoName:p.commandoName, month:p.month,
    eligibility:p.eligibility, remarks:p.remarks??"",
    vendorId:String(p.vendorId??""), vendorName:p.vendorName??"",
    activities: p.activities.map((a) => ({
      id:a.id, activityType:a.activityType, category:a.category??"",
      categoryLocked: false,
      leadTarget:String(a.leadTarget??0), retailTarget:String(a.retailTarget??0),
      startDate:a.startDate?.split("T")[0]??"", endDate:a.endDate?.split("T")[0]??"",
      budget:String(a.budget), additionalBudget:String(a.additionalBudget??0),
      // FIX: use safeBgaussShare so 0/null from DB shows as "100" not "0"
      bgaussShare: safeBgaussShare(a.bgaussShare as any),
      vendorId:String(a.vendorId??""),
      remarks:a.remarks??"",
      mediaFiles:(a.mediaFiles??[]).map((m)=>({id:m.id,fileUrl:m.fileUrl,fileName:m.fileName,fileType:m.fileType})),
    })),
  };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ApproverDashboard() {
  const { instance, accounts } = useMsal();
  const navigate  = useNavigate();
  const account   = accounts[0];
  const { user }  = useAuthStore();
  const isAdmin   = user?.role === "Admin" || user?.role === "Manager";

  const [proposals,        setProposals]        = useState<ProposalResponse[]>([]);
  const [selected,         setSelected]         = useState<ProposalResponse | null>(null);
  const [editData,         setEditData]         = useState<EditableProposal | null>(null);
  const [isEditing,        setIsEditing]        = useState(false);
  const [note,             setNote]             = useState("");
  const [sendBackNote,     setSendBackNote]     = useState("");
  const [showSendBack,     setShowSendBack]     = useState(false);
  const [filterStatus,     setFilterStatus]     = useState("All");
  const [filterMonth,      setFilterMonth]      = useState("All");
  const [search,           setSearch]           = useState("");
  const [loading,          setLoading]          = useState(true);
  const [fetchError,       setFetchError]       = useState<string|null>(null);
  const [actionLoading,    setActionLoading]    = useState(false);
  const [saveLoading,      setSaveLoading]      = useState(false);
  const [toast,            setToast]            = useState<{msg:string;ok:boolean}|null>(null);
  const [forwardLoading,   setForwardLoading]   = useState(false);
  const [dealerEmailInput, setDealerEmailInput] = useState("");
  const [dealerEmailMode,  setDealerEmailMode]  = useState<"dealer"|"vendor"|"custom">("dealer");
  const [showNotifyDealer, setShowNotifyDealer] = useState(false);
  const [notifyLoading,    setNotifyLoading]    = useState(false);
  const [actualsData,      setActualsData]      = useState<Record<string,ActualEntry>>({});
  const [actualsLoading,   setActualsLoading]   = useState(false);
  const [uploadingMedia,   setUploadingMedia]   = useState<Record<string,boolean>>({});
  const fileInputRefs  = useRef<Record<string,HTMLInputElement|null>>({});
  const actualsRefs    = useRef<Record<string,HTMLDivElement|null>>({});
  const scrollBodyRef  = useRef<HTMLDivElement|null>(null);
  // Which activity's Post-Activity panel is open (null = none)
  const [openActualsId, setOpenActualsId] = useState<string|null>(null);
  const [activityMasterList, setActivityMasterList] = useState<ActivityType[]>([]);

  // Bulk approve
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkNote,      setBulkNote]      = useState("");
  const [showBulkPanel, setShowBulkPanel] = useState(false);

  const showToast = (msg:string, ok:boolean) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3500); };

  const loadProposals = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      const data = isAdmin ? await fetchProposals(instance) : await fetchMyProposals(instance);
      setProposals(data);
    } catch (err) { setFetchError(err instanceof Error ? err.message : "Failed to load."); }
    finally { setLoading(false); }
  }, [instance, isAdmin]);

  useEffect(()=>{ loadProposals(); },[loadProposals]);

  useEffect(() => {
    fetchActivityTypes(instance).then(setActivityMasterList).catch(()=>{});
  }, [instance]);

  useEffect(() => {
    document.body.style.overflow = selected ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [selected]);

  const months          = useMemo(()=>["All",...Array.from(new Set(proposals.map((p)=>p.month)))],[proposals]);
  const filtered        = useMemo(()=>proposals.filter((p)=>{
    if (filterStatus!=="All"&&p.status!==filterStatus) return false;
    if (filterMonth!=="All"&&p.month!==filterMonth) return false;
    if (search){ const q=search.toLowerCase();
      return p.dealerName.toLowerCase().includes(q)||p.rsmName.toLowerCase().includes(q)||
             p.location.toLowerCase().includes(q)||(p.tokenNumber??"").toLowerCase().includes(q); }
    return true;
  }),[proposals,filterStatus,filterMonth,search]);
  const pendingFiltered = useMemo(()=>filtered.filter((p)=>p.status==="Pending"),[filtered]);

  const stats = useMemo(()=>{
    const approved=proposals.filter((p)=>p.status==="Approved");
    return { total:proposals.length, pending:proposals.filter((p)=>p.status==="Pending").length,
      approved:approved.length, rejected:proposals.filter((p)=>p.status==="Rejected").length,
      needsRevision:proposals.filter((p)=>p.status==="NeedsRevision").length,
      totalBudget:approved.reduce((s,p)=>s+p.totalBudget,0) };
  },[proposals]);

  const editTotals = useMemo(()=>{
    if (!editData) return {totalBudget:0,totalLeadTarget:0,totalRetailTarget:0,cac:0,cpl:0,totalBgauss:0};
    const tb  = editData.activities.reduce((s,a)=>s+num(a.budget)+num(a.additionalBudget),0);
    const tlt = editData.activities.reduce((s,a)=>s+num(a.leadTarget),0);
    const trt = editData.activities.reduce((s,a)=>s+num(a.retailTarget),0);
    const tbg = editData.activities.reduce((s,a)=>
      s+Math.round((num(a.budget)+num(a.additionalBudget))*(num(a.bgaussShare||"100")/100)),0);
    return { totalBudget:tb, totalLeadTarget:tlt, totalRetailTarget:trt,
      cac:trt>0?tb/trt:0, cpl:tlt>0?tb/tlt:0, totalBgauss:tbg };
  },[editData]);

  const initActuals = useCallback((p:ProposalResponse)=>{
    const init:Record<string,ActualEntry>={};
    p.activities.forEach((a)=>{
      init[a.id]={ actualStartDate:a.actualStartDate?.split("T")[0]??"",
        actualEndDate:a.actualEndDate?.split("T")[0]??"",
        mediaFile:null, mediaFileUrl:a.mediaFileUrl??null,
        mediaFileName:a.mediaFileName??null, mediaFileType:a.mediaFileType??null, uploading:false };
    });
    setActualsData(init);
  },[]);

  const setActualField=(id:string,key:"actualStartDate"|"actualEndDate",v:string)=>
    setActualsData((prev)=>({...prev,[id]:{...prev[id],[key]:v}}));

  const handleActualMedia = async (activityId:string,file:File)=>{
    setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],uploading:true,mediaFile:file}}));
    try {
      const r=await uploadActivityMedia(file,instance);
      setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],uploading:false,
        mediaFileUrl:r.url,mediaFileName:r.fileName,mediaFileType:r.fileType,mediaFile:file}}));
      showToast("File uploaded.",true);
    } catch(err){
      setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],uploading:false}}));
      showToast(err instanceof Error?err.message:"Upload failed.",false);
    }
  };

  const handleEditMediaUpload = async (idx:number,files:FileList)=>{
    const actId=editData?.activities[idx]?.id??String(idx);
    setUploadingMedia((prev)=>({...prev,[actId]:true}));
    try {
      const uploaded:EditMediaFile[]=[];
      for (const file of Array.from(files)){
        const d=await uploadActivityMedia(file,instance);
        uploaded.push({id:crypto.randomUUID(),fileUrl:d.url,fileName:d.fileName,fileType:d.fileType});
      }
      setEditData((d)=>d?{...d,activities:d.activities.map((a,i)=>
        i===idx?{...a,mediaFiles:[...a.mediaFiles,...uploaded]}:a)}:d);
      showToast("Uploaded.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Upload failed.",false); }
    finally { setUploadingMedia((prev)=>({...prev,[actId]:false})); }
  };

  const removeEditMedia=(idx:number,mediaId:string)=>
    setEditData((d)=>d?{...d,activities:d.activities.map((a,i)=>
      i===idx?{...a,mediaFiles:a.mediaFiles.filter((m)=>m.id!==mediaId)}:a)}:d);

  const saveActuals = async ()=>{
    if (!selected) return;
    setActualsLoading(true);
    try {
      const payload=selected.activities.map((a)=>{
        const d=actualsData[a.id];
        return { activityId:a.id, actualStartDate:d?.actualStartDate||null,
          actualEndDate:d?.actualEndDate||null, mediaFileUrl:d?.mediaFileUrl??null,
          mediaFileName:d?.mediaFileName??null, mediaFileType:d?.mediaFileType??null };
      });
      const updated=await updateProposalActuals(selected.id,payload,instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); initActuals(updated); showToast("Actuals saved.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Failed.",false); }
    finally { setActualsLoading(false); }
  };

  const openModal=(p:ProposalResponse)=>{
    setSelected(p); setEditData(toEditable(p)); setIsEditing(false); setShowSendBack(false);
    setNote(p.approverNote??""); setSendBackNote("");
    setShowNotifyDealer(false); setDealerEmailMode("dealer");
    setDealerEmailInput(p.dealerEmail??""); initActuals(p);
  };
  const closeModal=()=>{
    setSelected(null); setEditData(null); setIsEditing(false); setShowSendBack(false);
    setShowNotifyDealer(false); setDealerEmailInput(""); setActualsData({});
  };

  const setF=(key:keyof Omit<EditableProposal,"activities">,v:string)=>
    setEditData((d)=>d?{...d,[key]:v}:d);
  const setAF=(idx:number,key:keyof EditActivity,v:string)=>
    setEditData((d)=>d?{...d,activities:d.activities.map((a,i)=>i===idx?{...a,[key]:v}:a)}:d);
  const addRow=()=>setEditData((d)=>d?{...d,activities:[...d.activities,
    {activityType:"",category:"",leadTarget:"",retailTarget:"",startDate:"",endDate:"",
     budget:"",additionalBudget:"0",bgaussShare:"100",vendorId:"",remarks:"",mediaFiles:[],categoryLocked:false}]}:d);
  const removeRow=(idx:number)=>setEditData((d)=>(!d||d.activities.length<=1)?d:
    {...d,activities:d.activities.filter((_,i)=>i!==idx)});

  const saveEdits = async ()=>{
    if (!selected||!editData) return;
    setSaveLoading(true);
    try {
      const payload={
        dealerName:editData.dealerName, location:editData.location, state:editData.state,
        type:editData.type, rsmName:editData.rsmName, commandoName:editData.commandoName,
        month:editData.month, eligibility:editData.eligibility, remarks:editData.remarks,
        vendorId:editData.vendorId?Number(editData.vendorId):null, vendorName:editData.vendorName||null,
        activities:editData.activities.map((a)=>({
          activityType:a.activityType, category:a.category||null,
          leadTarget:num(a.leadTarget), retailTarget:num(a.retailTarget),
          startDate:a.startDate, endDate:a.endDate, budget:num(a.budget),
          additionalBudget:num(a.additionalBudget),
          // FIX: send as integer, never 0 — default to 100 if empty
          bgaussShare: num(a.bgaussShare) > 0 ? num(a.bgaussShare) : 100,
          vendorId:a.vendorId?Number(a.vendorId):null, remarks:a.remarks,
          mediaFiles:a.mediaFiles.map((m)=>({fileUrl:m.fileUrl,fileName:m.fileName,fileType:m.fileType})),
        })),
        totalBudget:editTotals.totalBudget, totalLeadTarget:Math.round(editTotals.totalLeadTarget),
        totalRetailTarget:Math.round(editTotals.totalRetailTarget), cac:editTotals.cac, cpl:editTotals.cpl,
      };
      const updated=await updateProposal(selected.id,payload as any,instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated);
      // Merge bgaussShare from our editData into toEditable result
      // because backend may return 0 if the column mapping is broken
      const editable = toEditable(updated);
      editable.activities = editable.activities.map((ea, idx) => ({
        ...ea,
        bgaussShare: (() => {
          // prefer what we saved (from payload), fallback to what backend returned
          const sent = payload.activities[idx]?.bgaussShare;
          const fromServer = safeBgaussShare((updated.activities[idx] as any)?.bgaussShare);
          // if server returned 0/null, use what we sent
          const serverVal = (updated.activities[idx] as any)?.bgaussShare;
          return (serverVal && serverVal > 0)
            ? fromServer
            : sent ? String(sent) : "100";
        })(),
      }));
      setEditData(editable);
      setIsEditing(false);
      showToast("Proposal updated.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Save failed.",false); }
    finally { setSaveLoading(false); }
  };

  const decide = async (action:"Approved"|"Rejected")=>{
    if (!selected) return;
    setActionLoading(true);
    try {
      const updated=await decideProposal(selected.id,
        {status:action,approverNote:note.trim()||null,approvedBy:account?.username??null},instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); initActuals(updated);
      showToast(action==="Approved"?"Approved.":"Rejected.",action==="Approved");
      setNote("");
    } catch(err){ showToast(err instanceof Error?err.message:"Failed.",false); }
    finally { setActionLoading(false); }
  };

  const handleSendBack = async ()=>{
    if (!selected) return;
    setActionLoading(true);
    try {
      const updated=await sendBackProposal(selected.id,
        {note:sendBackNote.trim()||null,sentBackBy:account?.username??null},instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); setShowSendBack(false); setSendBackNote("");
      showToast("Sent back for revision.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Failed.",false); }
    finally { setActionLoading(false); }
  };

  const handleForward = async ()=>{
    if (!selected) return;
    setForwardLoading(true);
    try {
      const updated=await forwardProposalToApprover(selected.id,instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); showToast("Forwarded to Vijay Maurya.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Forward failed.",false); }
    finally { setForwardLoading(false); }
  };

  const handleNotifyDealer = async ()=>{
    if (!selected||!dealerEmailInput.trim()) return;
    setNotifyLoading(true);
    try {
      const updated=await notifyDealer(selected.id,dealerEmailInput.trim(),instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); setShowNotifyDealer(false);
      showToast("Dealer notified successfully.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Notify failed.",false); }
    finally { setNotifyLoading(false); }
  };

  // ── Toggle Post-Activity panel for a specific activity ───────────────────
  const toggleActuals = (activityId: string) => {
    setOpenActualsId((prev) => prev === activityId ? null : activityId);
  };

  // ── Activity type auto-fill in edit mode (same as RSMForm) ────────────────
  const handleEditActivityTypeChange = (idx: number, value: string) => {
    const master = activityMasterList.find(
      (t) => t.activityName.toLowerCase() === value.toLowerCase()
    );
    setEditData((d) => d ? {
      ...d,
      activities: d.activities.map((a, i) => i === idx ? {
        ...a,
        activityType:   value,
        category:       master ? master.activityType : a.category,
        categoryLocked: !!master,
      } : a),
    } : d);
  };

  // ── Bulk helpers ──────────────────────────────────────────────────────────
  const allPendingSelected  = pendingFiltered.length>0 && pendingFiltered.every((p)=>selectedIds.has(p.id));
  const somePendingSelected = pendingFiltered.some((p)=>selectedIds.has(p.id));
  const toggleSelectAll = () => {
    if (allPendingSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(pendingFiltered.map((p)=>p.id)));
  };
  const toggleOne = (id:string, isPending:boolean) => {
    if (!isPending) return;
    setSelectedIds((prev)=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  };
  const handleBulkApprove = async () => {
    if (selectedIds.size===0) return;
    setBulkApproving(true);
    let ok=0, fail=0;
    for (const id of Array.from(selectedIds)) {
      try {
        const updated=await decideProposal(id,
          {status:"Approved",approverNote:bulkNote.trim()||null,approvedBy:account?.username??null},instance);
        setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
        ok++;
      } catch { fail++; }
    }
    setSelectedIds(new Set()); setShowBulkPanel(false); setBulkNote("");
    showToast(fail===0?`✓ ${ok} proposal${ok>1?"s":""} approved.`:`${ok} approved, ${fail} failed.`, fail===0);
    setBulkApproving(false);
  };

  const dealerSentBack     = (p:ProposalResponse) => (p as any).dealerSentBack;
  const dealerSendBackNote = (p:ProposalResponse) => (p as any).dealerSendBackNote;
  const calcBgAmt = (budget:number, add:number, share:number|null) =>
    Math.round((budget+add)*((share && share > 0 ? share : 100)/100));

  return (
    <div className="ap-page">
      <main className="ap-main">

        <div className="ap-page-header">
          <div>
            <h1 className="ap-page-title">{isAdmin?"Approver Portal":"My Proposals"}</h1>
            <p className="ap-page-sub">
              {isAdmin?"Review, edit, approve or reject RSM activity proposals."
                :"Track the status of your submitted proposals."}
            </p>
          </div>
          {!isAdmin&&<button className="ap-new-btn" onClick={()=>navigate("/rsm-form")}>+ New Proposal</button>}
        </div>

        {loading&&<div className="ap-loading"><div className="ap-spinner"/><p>Loading proposals…</p></div>}
        {!loading&&fetchError&&(
          <div className="ap-error-state">
            <p className="ap-error-msg">⚠ {fetchError}</p>
            <button className="ap-retry-btn" onClick={loadProposals}>Retry</button>
          </div>
        )}

        {!loading&&!fetchError&&(
          <>
            <div className={`ap-stats ap-stats--${isAdmin?"admin":"user"}`}>
              <StatCard label="Total"          value={stats.total}     color="navy"
                active={filterStatus==="All"}
                onClick={()=>setFilterStatus("All")}/>
              <StatCard label="Pending review" value={stats.pending}   color="amber"
                active={filterStatus==="Pending"}
                onClick={()=>setFilterStatus("Pending")}/>
              <StatCard label="Approved"       value={stats.approved}  color="green"
                active={filterStatus==="Approved"}
                onClick={()=>setFilterStatus("Approved")}/>
              <StatCard label="Rejected"       value={stats.rejected}  color="red"
                active={filterStatus==="Rejected"}
                onClick={()=>setFilterStatus("Rejected")}/>
              {isAdmin
                ?<StatCard label="Approved budget" value={inr(stats.totalBudget)} color="navy"
                    active={filterStatus==="Approved"}
                    onClick={()=>setFilterStatus("Approved")}/>
                :<StatCard label="Needs revision"  value={stats.needsRevision}    color="orange"
                    active={filterStatus==="NeedsRevision"}
                    onClick={()=>setFilterStatus("NeedsRevision")}/>}
            </div>

            <div className="ap-filters">
              <input className="ap-search" placeholder="Search dealer, RSM, location, token…"
                value={search} onChange={(e)=>setSearch(e.target.value)}/>
              <select className="ap-select" value={filterStatus} onChange={(e)=>setFilterStatus(e.target.value)}>
                {["All","Pending","Approved","Rejected","NeedsRevision"].map((s)=>(
                  <option key={s} value={s}>{s==="All"?"All statuses":s==="NeedsRevision"?"Needs revision":s}</option>
                ))}
              </select>
              <select className="ap-select" value={filterMonth} onChange={(e)=>setFilterMonth(e.target.value)}>
                {months.map((m)=><option key={m} value={m}>{m==="All"?"All months":m}</option>)}
              </select>
              <button className="ap-refresh-btn" onClick={loadProposals}>↻ Refresh</button>
            </div>

            {/* Bulk approve bar */}
            {isAdmin&&selectedIds.size>0&&(
              <div style={{ background:"#0a2540",borderRadius:10,padding:"12px 18px",
                marginBottom:12,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
                <span style={{ color:"#e2e8f0",fontSize:13,fontWeight:600 }}>
                  {selectedIds.size} proposal{selectedIds.size>1?"s":""} selected
                </span>
                {!showBulkPanel?(
                  <>
                    <button onClick={()=>setShowBulkPanel(true)}
                      style={{ background:"#16a34a",color:"#fff",border:"none",borderRadius:7,
                        padding:"8px 20px",fontWeight:700,fontSize:13,cursor:"pointer" }}>
                      ✓ Approve Selected
                    </button>
                    <button onClick={()=>{setSelectedIds(new Set());setShowBulkPanel(false);}}
                      style={{ background:"rgba(255,255,255,0.1)",color:"#e2e8f0",
                        border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,
                        padding:"8px 16px",fontSize:13,cursor:"pointer" }}>
                      ✕ Clear
                    </button>
                  </>
                ):(
                  <div style={{ display:"flex",gap:10,alignItems:"center",flex:1,flexWrap:"wrap" }}>
                    <input style={{ flex:1,minWidth:200,border:"1px solid rgba(255,255,255,0.2)",
                      borderRadius:7,padding:"7px 12px",fontSize:13,
                      background:"rgba(255,255,255,0.1)",color:"#fff",outline:"none" }}
                      placeholder="Approval note (optional)…"
                      value={bulkNote} onChange={(e)=>setBulkNote(e.target.value)}/>
                    <button onClick={handleBulkApprove} disabled={bulkApproving}
                      style={{ background:"#16a34a",color:"#fff",border:"none",borderRadius:7,
                        padding:"8px 20px",fontWeight:700,fontSize:13,
                        cursor:bulkApproving?"not-allowed":"pointer",opacity:bulkApproving?0.7:1 }}>
                      {bulkApproving?`Approving ${selectedIds.size}…`:`✓ Confirm approve ${selectedIds.size}`}
                    </button>
                    <button onClick={()=>setShowBulkPanel(false)}
                      style={{ background:"transparent",color:"#94a3b8",border:"none",fontSize:13,cursor:"pointer" }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Main table */}
            <div className="ap-table-wrap">
              <table className="ap-table">
                <thead>
                  <tr>
                    {isAdmin&&(
                      <th style={{ width:44,textAlign:"center",padding:"8px 6px" }}>
                        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
                          <input type="checkbox" checked={allPendingSelected}
                            ref={(el)=>{ if(el) el.indeterminate=!allPendingSelected&&somePendingSelected; }}
                            onChange={toggleSelectAll} title={`Select all ${pendingFiltered.length} pending`}
                            style={{ width:15,height:15,cursor:"pointer" }}/>
                          {pendingFiltered.length>0&&(
                            <span style={{ fontSize:9,color:"#64748b",whiteSpace:"nowrap" }}>
                              {pendingFiltered.length} pend.
                            </span>
                          )}
                        </div>
                      </th>
                    )}
                    <th>Action</th><th>Token</th><th>Submitted</th>
                    {isAdmin&&<th>RSM / TSM</th>}
                    <th>Dealer &amp; location</th><th>Month</th>
                    <th>Activities</th>
                    <th className="ap-num">Budget</th>
                    <th className="ap-num">Lead</th>
                    <th className="ap-num">Retail</th>
                    <th className="ap-num">CAC</th>
                    <th className="ap-num">CPL</th>
                    {isAdmin&&<th>Dealer Req.</th>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0&&(
                    <tr><td colSpan={isAdmin?16:12} className="ap-empty">
                      {proposals.length===0?"No proposals yet.":"No results match."}
                    </td></tr>
                  )}
                  {filtered.map((p)=>{
                    const isPending=p.status==="Pending";
                    const isChecked=selectedIds.has(p.id);
                    return (
                      <tr key={p.id} className={`ap-row${isChecked?" ap-row--selected":""}`}
                        onClick={()=>openModal(p)}>
                        {isAdmin&&(
                          <td style={{ textAlign:"center",padding:"8px 6px" }}
                            onClick={(e)=>e.stopPropagation()}>
                            {isPending
                              ?<input type="checkbox" checked={isChecked}
                                  onChange={()=>toggleOne(p.id,isPending)}
                                  style={{ width:15,height:15,cursor:"pointer",accentColor:"#16a34a" }}/>
                              :<span style={{ color:"#e2e8f0",fontSize:11 }}>—</span>}
                          </td>
                        )}
                        <td onClick={(e)=>e.stopPropagation()}>
                          <button className="ap-review-btn" onClick={()=>openModal(p)}>
                            {isAdmin?(isPending||p.status==="NeedsRevision"?"Review":"View"):"View"}
                          </button>
                        </td>
                        <td><span className="ap-id-chip">{p.tokenNumber??p.id.split("-").slice(-1)[0]}</span></td>
                        <td>
                          <span className="ap-cell-p">{fmtDate(p.createdAt)}</span>
                          {isAdmin&&<span className="ap-cell-m">{p.submittedByDisplayName??p.submittedBy}</span>}
                        </td>
                        {isAdmin&&<td>
                          <span className="ap-cell-p">{p.rsmName}</span>
                          <span className="ap-cell-m">{p.commandoName}</span>
                        </td>}
                        <td>
                          <span className="ap-cell-p">{p.dealerName}</span>
                          <span className="ap-cell-m">{p.location}, {p.state}</span>
                        </td>
                        <td>{p.month}</td>
                        <td>
                          {p.activities.slice(0,2).map((a,i)=>(
                            <span key={i} className="ap-act-chip">{a.activityType}</span>
                          ))}
                          {p.activities.length>2&&<span className="ap-act-chip ap-act-chip--more">+{p.activities.length-2}</span>}
                        </td>
                        <td className="ap-num ap-bold">{inr(p.totalBudget)}</td>
                        <td className="ap-num">{p.totalLeadTarget}</td>
                        <td className="ap-num">{p.totalRetailTarget}</td>
                        <td className="ap-num">{inr(p.cac)}</td>
                        <td className="ap-num">{inr(p.cpl)}</td>
                        {isAdmin&&<td>
                          {dealerSentBack(p)
                            ?<span style={{ fontSize:11,color:"#92400e",background:"#fef9c3",
                                padding:"2px 8px",borderRadius:10,fontWeight:600,cursor:"pointer" }}
                                onClick={(e)=>{ e.stopPropagation(); openModal(p); }}>↩ View request</span>
                            :<span style={{ color:"#cbd5e1",fontSize:11 }}>—</span>}
                        </td>}
                        <td><span className={statusClass(p.status)}>
                          {p.status==="NeedsRevision"?"Needs revision":p.status}
                        </span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* ══════════ FULLSCREEN MODAL ══════════ */}
      {selected&&editData&&(
        <div style={{ position:"fixed",inset:0,zIndex:900,background:"#f1f5f9",
          display:"flex",flexDirection:"column",overflow:"hidden" }}>

          {/* Top bar */}
          <div style={{ background:"#0a2540",color:"#fff",padding:"0 24px",height:58,flexShrink:0,
            display:"flex",alignItems:"center",justifyContent:"space-between",
            boxShadow:"0 2px 8px rgba(0,0,0,0.2)" }}>
            <div style={{ display:"flex",alignItems:"center",gap:14,minWidth:0 }}>
              <span style={{ fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,flexShrink:0,color:"#fff",
                background:selected.status==="Approved"?"#16a34a":selected.status==="Rejected"?"#dc2626"
                  :selected.status==="NeedsRevision"?"#f59e0b":"#64748b" }}>
                {selected.status==="NeedsRevision"?"Needs Revision":selected.status==="Pending"?"Pending Review":selected.status}
              </span>
              <div style={{ minWidth:0 }}>
                {isEditing
                  ?<input style={{ background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
                      color:"#fff",borderRadius:6,padding:"4px 10px",fontSize:15,fontWeight:600,width:200 }}
                      value={editData.dealerName} onChange={(e)=>setF("dealerName",e.target.value)}/>
                  :<span style={{ fontWeight:700,fontSize:16,color:"#fff" }}>{selected.dealerName}</span>}
                <span style={{ color:"#94a3b8",fontSize:12,marginLeft:12 }}>
                  {selected.location}, {selected.state} · {selected.month}
                  {selected.checkedByEmail&&<span style={{ marginLeft:8,color:"#86efac",fontSize:11 }}>✓ Forwarded</span>}
                </span>
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
              {isAdmin&&selected.status==="Pending"&&!isEditing&&(
                <button onClick={()=>setIsEditing(true)}
                  style={{ background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer",fontWeight:600 }}>
                  ✏ Edit
                </button>
              )}
              {isEditing&&(
                <button onClick={()=>{ setEditData(toEditable(selected)); setIsEditing(false); }}
                  style={{ background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",
                    color:"#94a3b8",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer" }}>
                  ✕ Cancel edit
                </button>
              )}
              <button onClick={closeModal}
                style={{ background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                  color:"#fff",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer",fontWeight:600 }}>
                ✕ Close
              </button>
            </div>
          </div>

          {isEditing&&(
            <div style={{ background:"#1e40af",color:"#fff",padding:"8px 24px",fontSize:13,flexShrink:0,
              display:"flex",alignItems:"center",gap:8 }}>
              ✏ Edit mode — modify fields below, then save before deciding.
            </div>
          )}

          {!isAdmin&&selected.status==="NeedsRevision"&&selected.approverNote&&(
            <div style={{ background:"#fef9c3",borderBottom:"1px solid #fde68a",flexShrink:0,
              padding:"10px 24px",fontSize:13,color:"#92400e" }}>
              <strong>Revision requested:</strong> {selected.approverNote}
              <button onClick={()=>navigate(`/rsm-form?edit=${selected.id}`)}
                style={{ marginLeft:14,background:"#92400e",color:"#fff",border:"none",
                  borderRadius:6,padding:"4px 12px",fontSize:12,cursor:"pointer",fontWeight:600 }}>
                ✏ Edit &amp; resubmit →
              </button>
            </div>
          )}

          {isAdmin&&dealerSentBack(selected)&&dealerSendBackNote(selected)&&(
            <div style={{ background:"#fef9c3",borderBottom:"1px solid #fde68a",flexShrink:0,
              padding:"10px 24px",fontSize:13,display:"flex",gap:12,alignItems:"flex-start" }}>
              <span style={{ fontSize:18 }}>↩</span>
              <div>
                <strong style={{ color:"#92400e" }}>
                  Dealer Budget Add-On Request
                  {(selected as any).dealerSentBackAt&&(
                    <span style={{ fontWeight:400,color:"#78350f",marginLeft:8,fontSize:11 }}>
                      · {fmtDate((selected as any).dealerSentBackAt)}
                    </span>
                  )}
                </strong>
                <p style={{ margin:"3px 0 0",color:"#78350f",fontSize:12,whiteSpace:"pre-wrap" }}>
                  {dealerSendBackNote(selected)}
                </p>
                {selected.dealerEmail&&(
                  <p style={{ margin:"3px 0 0",fontSize:11,color:"#92400e" }}>
                    Dealer: <a href={`mailto:${selected.dealerEmail}`} style={{ color:"#1e3a5f" }}>{selected.dealerEmail}</a>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Scrollable body ── */}
          <div ref={scrollBodyRef} style={{ flex:1,overflowY:"auto",padding:"24px 24px 40px" }}>
            <div style={{ maxWidth:1280,margin:"0 auto" }}>

              {/* Meta cards */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10,marginBottom:20 }}>
                {([
                  {key:"rsmName",      label:"RSM / TSM",   edit:"text"},
                  {key:"commandoName", label:"Commando",    edit:"text"},
                  {key:"type",         label:"Dealer Type", edit:"select", opts:LOC_TYPES},
                  {key:"eligibility",  label:"Eligibility", edit:"select", opts:ELIGIBILITY},
                  {key:"month",        label:"Month",       edit:"select", opts:MONTHS},
                  {key:"dealerName",   label:"Dealer Name", edit:"text"},
                  {key:"location",     label:"City",        edit:"text"},
                  {key:"state",        label:"State",       edit:"text"},
                ] as {key:string;label:string;edit:string;opts?:string[]}[]).map(({key,label,edit,opts})=>(
                  <div key={key} style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 12px" }}>
                    <div style={{ fontSize:10,color:"#6b7280",fontWeight:700,
                      textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4 }}>{label}</div>
                    {isAdmin&&isEditing?(
                      edit==="select"&&opts
                        ?<select style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,
                            padding:"5px 8px",fontSize:13,outline:"none",background:"#fff" }}
                            value={(editData as any)[key]}
                            onChange={(e)=>setF(key as any,e.target.value)}>
                            {opts.map((o)=><option key={o} value={o}>{o}</option>)}
                          </select>
                        :<input style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,
                            padding:"5px 8px",fontSize:13,outline:"none",boxSizing:"border-box" as const }}
                            value={(editData as any)[key]}
                            onChange={(e)=>setF(key as any,e.target.value)}/>
                    ):key==="eligibility"?(
                      <span className={`ap-elig ${eligClass((selected as any)[key])}`}>{(selected as any)[key]}</span>
                    ):(
                      <div style={{ fontWeight:600,fontSize:13,color:"#0a2540",
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                        {(selected as any)[key]||"—"}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* RSM Remarks */}
              {(selected.remarks||(isAdmin&&isEditing))&&(
                <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderLeft:"3px solid #f59e0b",
                  borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13 }}>
                  <span style={{ fontWeight:600,color:"#92400e",fontSize:11,textTransform:"uppercase",
                    letterSpacing:"0.04em",display:"block",marginBottom:4 }}>RSM Remarks</span>
                  {isAdmin&&isEditing
                    ?<textarea rows={2} style={{ width:"100%",border:"1px solid #fde68a",borderRadius:6,
                        padding:"6px 8px",fontSize:13,resize:"vertical",background:"#fff",outline:"none",
                        boxSizing:"border-box" as const }}
                        value={editData.remarks} onChange={(e)=>setF("remarks",e.target.value)}/>
                    :<p style={{ margin:0,color:"#78350f" }}>{selected.remarks}</p>}
                </div>
              )}

              {/* ── Activities table ── */}
              <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",marginBottom:20 }}>
                <div style={{ background:"#0a2540",padding:"12px 16px",display:"flex",
                  justifyContent:"space-between",alignItems:"center" }}>
                  <span style={{ color:"#fff",fontWeight:700,fontSize:14 }}>Activities ({selected.activities.length})</span>
                  {isAdmin&&isEditing&&(
                    <button onClick={addRow}
                      style={{ background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
                        color:"#fff",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontWeight:600 }}>
                      + Add row
                    </button>
                  )}
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:isEditing?1200:860 }}>
                    <thead>
                      <tr style={{ background:"#f8fafc",borderBottom:"2px solid #e2e8f0" }}>
                        <th style={{ padding:"9px 10px",textAlign:"left",  width:32,  fontSize:11,fontWeight:700,color:"#374151" }}>#</th>
                        <th style={{ padding:"9px 10px",textAlign:"left",  width:isEditing?175:155, fontSize:11,fontWeight:700,color:"#374151" }}>Activity Name</th>
                        <th style={{ padding:"9px 10px",textAlign:"left",  width:90,  fontSize:11,fontWeight:700,color:"#374151" }}>Type (ATL/BTL)</th>
                        <th style={{ padding:"9px 10px",textAlign:"right", width:70,  fontSize:11,fontWeight:700,color:"#374151" }}>Lead</th>
                        <th style={{ padding:"9px 10px",textAlign:"right", width:70,  fontSize:11,fontWeight:700,color:"#374151" }}>Retail</th>
                        <th style={{ padding:"9px 10px",textAlign:"left",  width:isEditing?245:170, fontSize:11,fontWeight:700,color:"#374151" }}>Dates</th>
                        <th style={{ padding:"9px 10px",textAlign:"right", width:110, fontSize:11,fontWeight:700,color:"#374151" }}>Budget (₹)</th>
                        <th style={{ padding:"9px 10px",textAlign:"right", width:100, fontSize:11,fontWeight:700,color:"#374151" }}>Add. Budget</th>
                        <th style={{ padding:"9px 10px",textAlign:"center",width:100, fontSize:11,fontWeight:700,color:"#374151" }}>BGauss Share</th>
                        <th style={{ padding:"9px 10px",textAlign:"right", width:110, fontSize:11,fontWeight:700,color:"#1e40af" }}>BGauss Amt</th>
                        <th style={{ padding:"9px 10px",textAlign:"right", width:100, fontSize:11,fontWeight:700,color:"#374151" }}>Total (₹)</th>
                        {/* NEW: Post-Activity column (view mode only, Approved proposals) */}
                        {!isEditing&&selected.status==="Approved"&&(
                          <th style={{ padding:"9px 10px",textAlign:"center",width:100,fontSize:11,fontWeight:700,color:"#16a34a" }}>
                            Post-Activity
                          </th>
                        )}
                        {!isEditing&&selected.status!=="Approved"&&(
                          <th style={{ padding:"9px 10px",textAlign:"left",width:150,fontSize:11,fontWeight:700,color:"#374151" }}>Media</th>
                        )}
                        {isAdmin&&isEditing&&<th style={{ width:36 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(isEditing?editData.activities:selected.activities).map((a,i)=>
                        isAdmin&&isEditing?([
                          /* ── EDIT ROW ── */
                          <tr key={`edit-${i}`} style={{ background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9",verticalAlign:"top" }}>
                            <td style={{ padding:"10px 10px",color:"#6b7280",fontSize:11,paddingTop:14 }}>{i+1}</td>

                            {/* Activity Name — auto-fills category */}
                            <td style={{ padding:"8px 8px" }}>
                              <input list={`al-${i}`}
                                style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,
                                  padding:"6px 8px",fontSize:12,outline:"none",boxSizing:"border-box" as const }}
                                value={(a as EditActivity).activityType}
                                onChange={(e)=>handleEditActivityTypeChange(i,e.target.value)}
                                placeholder="Select or type activity…"/>
                              <datalist id={`al-${i}`}>
                                {activityMasterList.map((t)=><option key={t.id} value={t.activityName}/>)}
                              </datalist>
                            </td>

                            {/* Category — auto-locked badge or editable select */}
                            <td style={{ padding:"8px 8px" }}>
                              {(a as EditActivity).categoryLocked ? (
                                <div style={{
                                  display:"flex",alignItems:"center",gap:4,
                                  background:(a as EditActivity).category==="ATL"?"#eff6ff":"#f0fdf4",
                                  border:`1.5px solid ${(a as EditActivity).category==="ATL"?"#bfdbfe":"#bbf7d0"}`,
                                  borderRadius:6,padding:"5px 8px",height:32,fontSize:12,fontWeight:700,
                                  color:(a as EditActivity).category==="ATL"?"#1e40af":"#166534",
                                  minWidth:62,whiteSpace:"nowrap",
                                }}>
                                  <span>{(a as EditActivity).category}</span>
                                  <span style={{ fontSize:10,color:"#9ca3af",marginLeft:"auto" }}
                                    title="Auto-filled from Activity Master">🔒</span>
                                </div>
                              ) : (
                                <select style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"6px 8px",
                                  fontSize:12,outline:"none",background:"#fff",width:84 }}
                                  value={(a as EditActivity).category}
                                  onChange={(e)=>setAF(i,"category",e.target.value)}>
                                  <option value="">—</option>
                                  <option value="ATL">ATL</option>
                                  <option value="BTL">BTL</option>
                                </select>
                              )}
                            </td>

                            <td style={{ padding:"8px 8px",textAlign:"right" }}>
                              <input type="number" min={0}
                                style={{ width:60,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }}
                                value={(a as EditActivity).leadTarget}
                                onChange={(e)=>setAF(i,"leadTarget",e.target.value)}/>
                            </td>
                            <td style={{ padding:"8px 8px",textAlign:"right" }}>
                              <input type="number" min={0}
                                style={{ width:60,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }}
                                value={(a as EditActivity).retailTarget}
                                onChange={(e)=>setAF(i,"retailTarget",e.target.value)}/>
                            </td>

                            <td style={{ padding:"8px 8px" }}>
                              <div style={{ display:"flex",gap:4,alignItems:"center" }}>
                                <input type="date"
                                  style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",width:120 }}
                                  value={(a as EditActivity).startDate}
                                  onChange={(e)=>setAF(i,"startDate",e.target.value)}/>
                                <span style={{ color:"#6b7280" }}>→</span>
                                <input type="date"
                                  style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",width:120 }}
                                  value={(a as EditActivity).endDate}
                                  min={(a as EditActivity).startDate||undefined}
                                  onChange={(e)=>setAF(i,"endDate",e.target.value)}/>
                              </div>
                            </td>

                            <td style={{ padding:"8px 8px",textAlign:"right" }}>
                              <input type="number" min={0}
                                style={{ width:90,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }}
                                value={(a as EditActivity).budget}
                                onChange={(e)=>setAF(i,"budget",e.target.value)}/>
                            </td>
                            <td style={{ padding:"8px 8px",textAlign:"right" }}>
                              <input type="number" min={0}
                                style={{ width:90,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }}
                                value={(a as EditActivity).additionalBudget}
                                onChange={(e)=>setAF(i,"additionalBudget",e.target.value)}/>
                            </td>

                            {/* BGauss Share dropdown */}
                            <td style={{ padding:"8px 8px",textAlign:"center" }}>
                              <select style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"5px 8px",
                                fontSize:12,outline:"none",background:"#fff",width:80 }}
                                value={(a as EditActivity).bgaussShare}
                                onChange={(e)=>setAF(i,"bgaussShare",e.target.value)}>
                                {BGAUSS_OPTS.map((o)=><option key={o} value={o}>{o}%</option>)}
                              </select>
                            </td>

                            {/* BGauss Amt auto-calc */}
                            <td style={{ padding:"8px 8px",textAlign:"right" }}>
                              <div style={{ fontSize:12,fontWeight:600,color:"#1e40af",
                                background:"#eff6ff",border:"1px solid #bfdbfe",
                                borderRadius:6,padding:"5px 8px",whiteSpace:"nowrap" }}>
                                {inr(Math.round(
                                  (num((a as EditActivity).budget)+num((a as EditActivity).additionalBudget))
                                  *(num((a as EditActivity).bgaussShare||"100")/100)
                                ))}
                              </div>
                            </td>

                            <td style={{ padding:"8px 8px",textAlign:"right",fontWeight:700,color:"#0a2540",paddingTop:14 }}>
                              {inr(num((a as EditActivity).budget)+num((a as EditActivity).additionalBudget))}
                            </td>

                            <td style={{ padding:"8px 8px",textAlign:"center",paddingTop:14 }}>
                              <button onClick={()=>removeRow(i)} disabled={editData.activities.length===1}
                                style={{ background:"#fee2e2",border:"none",color:"#991b1b",width:24,height:24,
                                  borderRadius:"50%",cursor:"pointer",fontWeight:700,fontSize:14,
                                  display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto" }}>×</button>
                            </td>
                          </tr>,

                          /* ── MEDIA SUB-ROW ── */
                          <tr key={`media-${i}`} style={{ background:i%2===0?"#fff":"#f8fafc",borderBottom:"2px solid #f1f5f9" }}>
                            <td></td>
                            <td colSpan={10} style={{ padding:"0 8px 10px" }}>
                              <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                                <label style={{ display:"inline-flex",alignItems:"center",gap:5,
                                  background:"#f1f5f9",border:"1px dashed #cbd5e1",borderRadius:6,
                                  padding:"4px 10px",cursor:"pointer",fontSize:11,color:"#1e3a5f",
                                  fontWeight:600,whiteSpace:"nowrap" }}>
                                  {uploadingMedia[(a as EditActivity).id??String(i)]
                                    ?"⏳ Uploading…"
                                    :`📎 Upload files${(a as EditActivity).mediaFiles.length>0?` (${(a as EditActivity).mediaFiles.length} attached)`:""}`}
                                  <input type="file" multiple accept="image/*,application/pdf,video/*"
                                    style={{ display:"none" }}
                                    disabled={!!uploadingMedia[(a as EditActivity).id??String(i)]}
                                    onChange={(e)=>{ if(e.target.files) handleEditMediaUpload(i,e.target.files); e.target.value=""; }}/>
                                </label>
                                {(a as EditActivity).mediaFiles.map((m)=>{
                                  const fu=resolveUrl(m.fileUrl);
                                  return (
                                    <div key={m.id} style={{ display:"flex",alignItems:"center",gap:4,
                                      background:"#f8fafc",border:"1px solid #e2e8f0",
                                      borderRadius:5,padding:"2px 6px",fontSize:11,maxWidth:160 }}>
                                      {isImage(m.fileType)
                                        ?<a href={fu} target="_blank" rel="noopener noreferrer">
                                            <img src={fu} alt={m.fileName} style={{ width:22,height:22,objectFit:"cover",borderRadius:3 }}/>
                                          </a>
                                        :<a href={fu} target="_blank" rel="noopener noreferrer"
                                            style={{ fontSize:16 }}>{mediaIcon(m.fileType)}</a>}
                                      <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:90,color:"#374151",fontSize:10 }}>
                                        {m.fileName}
                                      </span>
                                      <button type="button" onClick={()=>removeEditMedia(i,m.id)}
                                        style={{ background:"none",border:"none",color:"#9ca3af",cursor:"pointer",fontSize:13,padding:"0 2px",flexShrink:0 }}>×</button>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                            <td></td>
                          </tr>
                        ]):(
                          /* ── VIEW ROW ── */
                          <tr key={`view-${i}`} style={{ background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9" }}>
                            <td style={{ padding:"8px 10px",color:"#6b7280",fontSize:11 }}>{i+1}</td>
                            <td style={{ padding:"8px 10px",fontWeight:600,color:"#0a2540" }}>
                              {(a as ActivityResponse).activityType}
                            </td>
                            <td style={{ padding:"8px 10px" }}>
                              {(a as ActivityResponse).category?(
                                <span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:4,
                                  background:(a as ActivityResponse).category==="ATL"?"#eff6ff":"#f0fdf4",
                                  color:(a as ActivityResponse).category==="ATL"?"#1e40af":"#166534",
                                  border:`1px solid ${(a as ActivityResponse).category==="ATL"?"#bfdbfe":"#bbf7d0"}` }}>
                                  {(a as ActivityResponse).category}
                                </span>
                              ):<span style={{ color:"#cbd5e1" }}>—</span>}
                            </td>
                            <td style={{ padding:"8px 10px",textAlign:"right" }}>{(a as ActivityResponse).leadTarget}</td>
                            <td style={{ padding:"8px 10px",textAlign:"right" }}>{(a as ActivityResponse).retailTarget}</td>
                            <td style={{ padding:"8px 10px",color:"#475569",fontSize:12 }}>
                              {fmtDate((a as ActivityResponse).startDate)} → {fmtDate((a as ActivityResponse).endDate)}
                            </td>
                            <td style={{ padding:"8px 10px",textAlign:"right" }}>{inr((a as ActivityResponse).budget)}</td>
                            <td style={{ padding:"8px 10px",textAlign:"right",color:"#6b7280" }}>
                              {inr((a as ActivityResponse).additionalBudget)}
                            </td>
                            <td style={{ padding:"8px 10px",textAlign:"center" }}>
                              <span style={{ fontSize:11,fontWeight:600,background:"#eff6ff",
                                color:"#1e40af",padding:"2px 8px",borderRadius:4 }}>
                                {(a as ActivityResponse).bgaussShare && (a as ActivityResponse).bgaussShare > 0
                                  ? `${(a as ActivityResponse).bgaussShare}%` : "100%"}
                              </span>
                            </td>
                            <td style={{ padding:"8px 10px",textAlign:"right",color:"#1e40af",fontWeight:600,fontSize:12 }}>
                              {inr(calcBgAmt((a as ActivityResponse).budget,(a as ActivityResponse).additionalBudget,(a as ActivityResponse).bgaussShare))}
                            </td>
                            <td style={{ padding:"8px 10px",textAlign:"right",fontWeight:700,color:"#0a2540" }}>
                              {inr((a as ActivityResponse).budget+(a as ActivityResponse).additionalBudget)}
                            </td>

                            {/* NEW: Post-Activity button (Approved only) / Media column (others) */}
                            {selected.status==="Approved" ? (
                              <td style={{ padding:"8px 10px",textAlign:"center" }}>
                                <button
                                  onClick={()=>toggleActuals((a as ActivityResponse).id)}
                                  style={{
                                    background: openActualsId===(a as ActivityResponse).id ? "#0a2540" : "#16a34a",
                                    color:"#fff",border:"none",borderRadius:6,
                                    padding:"5px 12px",fontSize:11,fontWeight:700,
                                    cursor:"pointer",whiteSpace:"nowrap",
                                    boxShadow:"0 1px 3px rgba(0,0,0,0.15)",
                                    display:"flex",alignItems:"center",gap:4,margin:"0 auto",
                                  }}>
                                  📋 {openActualsId===(a as ActivityResponse).id ? "Close ▲" : "Post-Activity ▼"}
                                </button>
                              </td>
                            ) : (
                              <td style={{ padding:"8px 10px" }}>
                                <ActivityMediaStrip activity={a as ActivityResponse}/>
                              </td>
                            )}
                          </tr>
                        )
                      )}
                      {/* ── Inline Post-Activity accordion rows (Approved, view mode) ── */}
                      {!isEditing && selected.status==="Approved" && selected.activities.map((a)=>{
                        const d = actualsData[a.id];
                        if (openActualsId !== a.id || !d) return null;
                        return (
                          <tr key={`actuals-${a.id}`}>
                            <td colSpan={12} style={{ padding:0,background:"#f0fdf4",borderBottom:"2px solid #bbf7d0" }}>
                              <div style={{ padding:"16px 20px" }}>
                                {/* Header */}
                                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
                                  <span style={{ background:"#16a34a",color:"#fff",borderRadius:4,
                                    padding:"1px 7px",fontSize:11,fontWeight:700 }}>📋</span>
                                  <span style={{ fontWeight:700,fontSize:13,color:"#0a2540" }}>
                                    Post-Activity — {a.activityType}
                                  </span>
                                  {a.category&&(
                                    <span style={{ fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:3,
                                      background:a.category==="ATL"?"#eff6ff":"#dcfce7",
                                      color:a.category==="ATL"?"#1e40af":"#166534" }}>{a.category}</span>
                                  )}
                                  <span style={{ fontSize:11,color:"#6b7280",marginLeft:"auto" }}>
                                    Planned: {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                                  </span>
                                </div>

                                {/* Fields */}
                                <div style={{ display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-start",marginBottom:14 }}>
                                  {/* Actual Start Date */}
                                  <div style={{ display:"flex",flexDirection:"column",gap:4,minWidth:160 }}>
                                    <label style={{ fontSize:11,fontWeight:600,color:"#374151",textTransform:"uppercase",letterSpacing:"0.04em" }}>
                                      Actual Start Date
                                    </label>
                                    <input type="date" value={d.actualStartDate}
                                      onChange={(e)=>setActualField(a.id,"actualStartDate",e.target.value)}
                                      style={{ border:"1px solid #bbf7d0",borderRadius:7,padding:"8px 10px",
                                        fontSize:13,outline:"none",background:"#fff",
                                        boxSizing:"border-box" as const }}/>
                                  </div>

                                  {/* Actual End Date */}
                                  <div style={{ display:"flex",flexDirection:"column",gap:4,minWidth:160 }}>
                                    <label style={{ fontSize:11,fontWeight:600,color:"#374151",textTransform:"uppercase",letterSpacing:"0.04em" }}>
                                      Actual End Date
                                    </label>
                                    <input type="date" value={d.actualEndDate}
                                      min={d.actualStartDate||undefined}
                                      onChange={(e)=>setActualField(a.id,"actualEndDate",e.target.value)}
                                      style={{ border:"1px solid #bbf7d0",borderRadius:7,padding:"8px 10px",
                                        fontSize:13,outline:"none",background:"#fff",
                                        boxSizing:"border-box" as const }}/>
                                  </div>

                                  {/* Media upload */}
                                  <div style={{ display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:200 }}>
                                    <label style={{ fontSize:11,fontWeight:600,color:"#374151",textTransform:"uppercase",letterSpacing:"0.04em" }}>
                                      Upload Proof / Media
                                    </label>
                                    {d.mediaFileName ? (
                                      <div style={{ display:"flex",alignItems:"center",gap:8,
                                        background:"#fff",border:"1px solid #bbf7d0",borderRadius:7,padding:"8px 10px" }}>
                                        <span style={{ fontSize:18 }}>
                                          {d.mediaFileType?.startsWith("image")?"🖼":d.mediaFileType?.includes("pdf")?"📄":"🎬"}
                                        </span>
                                        <span style={{ fontSize:12,color:"#374151",flex:1,
                                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                                          {d.mediaFileName}
                                        </span>
                                        {d.mediaFileUrl&&(
                                          <a href={resolveUrl(d.mediaFileUrl)} target="_blank" rel="noreferrer"
                                            style={{ fontSize:11,color:"#1e40af",fontWeight:600,whiteSpace:"nowrap" }}>
                                            View ↗
                                          </a>
                                        )}
                                        <label style={{ fontSize:11,color:"#6b7280",cursor:"pointer",
                                          background:"#f1f5f9",borderRadius:5,padding:"3px 8px",whiteSpace:"nowrap" }}>
                                          Replace
                                          <input type="file" accept="image/*,.pdf,.mp4,.mov,.avi" style={{ display:"none" }}
                                            onChange={(e)=>{const f=e.target.files?.[0];if(f)handleActualMedia(a.id,f);e.target.value="";}}/>
                                        </label>
                                      </div>
                                    ) : (
                                      <label style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                                        background:"#fff",border:"2px dashed #86efac",borderRadius:7,padding:"12px 16px",
                                        cursor:"pointer",fontSize:12,color:"#16a34a",fontWeight:600 }}>
                                        {d.uploading
                                          ?<><span className="ap-spin-sm" style={{ marginRight:4 }}/> Uploading…</>
                                          :<>📎 Upload proof / media file</>}
                                        <input type="file" accept="image/*,.pdf,.mp4,.mov,.avi" style={{ display:"none" }}
                                          disabled={d.uploading}
                                          onChange={(e)=>{const f=e.target.files?.[0];if(f)handleActualMedia(a.id,f);e.target.value="";}}/>
                                      </label>
                                    )}
                                  </div>
                                </div>

                                {/* Last saved */}
                                {(a.actualStartDate||a.actualEndDate)&&(
                                  <div style={{ fontSize:11,color:"#166534",marginBottom:12,
                                    background:"#dcfce7",borderRadius:5,padding:"4px 10px",display:"inline-block" }}>
                                    ✓ Last saved: {fmtDate(a.actualStartDate)} → {fmtDate(a.actualEndDate)}
                                  </div>
                                )}

                                {/* Save button */}
                                <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                                  <button onClick={saveActuals} disabled={actualsLoading}
                                    style={{ background:"#16a34a",color:"#fff",border:"none",
                                      padding:"9px 22px",borderRadius:7,fontWeight:700,fontSize:13,
                                      cursor:actualsLoading?"not-allowed":"pointer",opacity:actualsLoading?0.7:1 }}>
                                    {actualsLoading?"Saving…":"💾 Save Actuals"}
                                  </button>
                                  <button onClick={()=>setOpenActualsId(null)}
                                    style={{ background:"#f1f5f9",color:"#374151",border:"1px solid #e2e8f0",
                                      padding:"9px 18px",borderRadius:7,fontSize:13,cursor:"pointer" }}>
                                    Close
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary footer */}
                <div style={{ background:"#0a2540",padding:"10px 16px",display:"flex",gap:20,flexWrap:"wrap" }}>
                  {[
                    {label:"Lead",        value:isEditing?Math.round(editTotals.totalLeadTarget):selected.totalLeadTarget},
                    {label:"Retail",      value:isEditing?Math.round(editTotals.totalRetailTarget):selected.totalRetailTarget},
                    {label:"Total budget",value:inr(isEditing?editTotals.totalBudget:selected.totalBudget), hi:true},
                    {label:"BGauss budget",value:inr(isEditing
                      ?editTotals.totalBgauss
                      :selected.activities.reduce((s,a)=>s+calcBgAmt(a.budget,a.additionalBudget,a.bgaussShare),0)
                    ), blue:true},
                    {label:"CAC",         value:inr(isEditing?editTotals.cac:selected.cac)},
                    {label:"CPL",         value:inr(isEditing?editTotals.cpl:selected.cpl)},
                  ].map(({label,value,hi,blue})=>(
                    <div key={label}>
                      <div style={{ fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em" }}>{label}</div>
                      <div style={{ fontSize:14,fontWeight:700,color:hi?"#86efac":blue?"#93c5fd":"#e2e8f0" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {selected.cacWarning&&(
                <div style={{ background:"#fefce8",border:"1px solid #fde68a",borderLeft:"3px solid #f59e0b",
                  borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#92400e" }}>
                  ⚠ {selected.cacWarning}
                </div>
              )}

              {/* Post-Activity actuals now open inline per-row via 📋 Post-Activity button in the table above */}

              {/* Admin decision panel */}
              {isAdmin&&selected.status==="Pending"&&!isEditing&&(
                <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"20px",marginBottom:20 }}>
                  <p style={{ fontWeight:700,fontSize:14,color:"#0a2540",marginBottom:16 }}>Actions</p>
                  <div style={{ marginBottom:20,paddingBottom:20,borderBottom:"1px solid #e2e8f0" }}>
                    <p style={{ fontSize:13,color:"#6b7280",margin:"0 0 10px" }}>
                      Forward to <strong>Vijay Maurya</strong> for final approval:
                    </p>
                    {selected.checkedByEmail&&(
                      <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,
                        padding:"8px 14px",fontSize:13,color:"#166534",marginBottom:10 }}>
                        ✓ Already forwarded by {selected.checkedByEmail}
                        {selected.checkedAt&&` on ${fmtDate(selected.checkedAt)}`}
                      </div>
                    )}
                    <button onClick={handleForward} disabled={forwardLoading}
                      style={{ background:"#1e3a5f",color:"#fff",border:"none",padding:"10px 22px",
                        borderRadius:8,fontWeight:600,fontSize:14,
                        cursor:forwardLoading?"not-allowed":"pointer",opacity:forwardLoading?0.7:1 }}>
                      {forwardLoading?"Forwarding…":"📤 Forward to Final Approver"}
                    </button>
                  </div>
                  <p style={{ fontSize:13,color:"#6b7280",margin:"0 0 8px" }}>Final decision:</p>
                  <textarea className="ap-note-input" rows={3}
                    placeholder="Add a note for Mayank &amp; RSM (optional)…"
                    value={note} onChange={(e)=>setNote(e.target.value)}/>
                  <div className="ap-btn-row">
                    <button className="ap-approve-btn" disabled={actionLoading} onClick={()=>decide("Approved")}>
                      {actionLoading?"Processing…":"✓  Approve"}</button>
                    <button className="ap-reject-btn" disabled={actionLoading} onClick={()=>decide("Rejected")}>
                      {actionLoading?"Processing…":"✕  Reject"}</button>
                  </div>
                  <div className="ap-sendback-row">
                    <button className="ap-sendback-trigger" onClick={()=>setShowSendBack((v)=>!v)}>
                      ↩ Send back for revision
                    </button>
                  </div>
                  {showSendBack&&(
                    <div className="ap-sendback-box">
                      <p className="ap-sendback-label">Explain what needs to be revised:</p>
                      <textarea className="ap-note-input" rows={3}
                        placeholder="e.g. Please increase target for Road Show…"
                        value={sendBackNote} onChange={(e)=>setSendBackNote(e.target.value)}/>
                      <div className="ap-btn-row">
                        <button className="ap-sendback-btn" disabled={actionLoading} onClick={handleSendBack}>
                          {actionLoading?"Sending…":"↩ Send for revision"}</button>
                        <button className="ap-discard-btn"
                          onClick={()=>{setShowSendBack(false);setSendBackNote("");}}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notify Dealer */}
              {isAdmin&&selected.status==="Approved"&&(
                <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"20px",marginBottom:20 }}>
                  <p style={{ fontWeight:700,fontSize:14,color:"#0a2540",marginBottom:8 }}>Notify Dealer</p>
                  <p style={{ fontSize:12,color:"#6b7280",margin:"0 0 14px" }}>Send the approved activity plan to the dealer.</p>
                  {selected.dealerNotified&&(
                    <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,
                      padding:"8px 14px",fontSize:13,color:"#166534",marginBottom:12 }}>
                      ✓ Dealer notified
                      {selected.dealerEmail&&<span style={{ color:"#6b7280" }}> ({selected.dealerEmail})</span>}
                    </div>
                  )}
                  {!showNotifyDealer?(
                    <button onClick={()=>{
                      setShowNotifyDealer(true);
                      if(selected.dealerEmail){setDealerEmailMode("dealer");setDealerEmailInput(selected.dealerEmail);}
                      else{setDealerEmailMode("custom");setDealerEmailInput("");}
                    }} style={{ background:"#0a2540",color:"#fff",border:"none",padding:"10px 22px",
                        borderRadius:8,fontWeight:600,fontSize:14,cursor:"pointer" }}>
                      {selected.dealerNotified?"📧 Send Again":"📧 Notify Dealer"}
                    </button>
                  ):(
                    <div style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:16 }}>
                      <p style={{ fontSize:12,fontWeight:600,color:"#374151",marginBottom:10 }}>Select recipient:</p>
                      <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:14 }}>
                        {selected.dealerEmail&&(
                          <label style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                            background:dealerEmailMode==="dealer"?"#eff6ff":"#fff",
                            border:`1px solid ${dealerEmailMode==="dealer"?"#3b82f6":"#e2e8f0"}`,
                            borderRadius:8,cursor:"pointer",fontSize:13 }}>
                            <input type="radio" name="emailMode" value="dealer" checked={dealerEmailMode==="dealer"}
                              onChange={()=>{setDealerEmailMode("dealer");setDealerEmailInput(selected.dealerEmail??"");}}/>
                            <div>
                              <span style={{ fontWeight:600,color:"#0a2540" }}>Dealer (previously used)</span>
                              <span style={{ color:"#6b7280",marginLeft:8,fontSize:12 }}>{selected.dealerEmail}</span>
                            </div>
                          </label>
                        )}
                        {selected.vendorName&&(
                          <label style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                            background:dealerEmailMode==="vendor"?"#eff6ff":"#fff",
                            border:`1px solid ${dealerEmailMode==="vendor"?"#3b82f6":"#e2e8f0"}`,
                            borderRadius:8,cursor:"pointer",fontSize:13 }}>
                            <input type="radio" name="emailMode" value="vendor" checked={dealerEmailMode==="vendor"}
                              onChange={()=>{setDealerEmailMode("vendor");setDealerEmailInput("");}}/>
                            <div>
                              <span style={{ fontWeight:600,color:"#0a2540" }}>Vendor: {selected.vendorName}</span>
                              <span style={{ color:"#9ca3af",marginLeft:8,fontSize:11 }}>(enter email below)</span>
                            </div>
                          </label>
                        )}
                        <label style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                          background:dealerEmailMode==="custom"?"#eff6ff":"#fff",
                          border:`1px solid ${dealerEmailMode==="custom"?"#3b82f6":"#e2e8f0"}`,
                          borderRadius:8,cursor:"pointer",fontSize:13 }}>
                          <input type="radio" name="emailMode" value="custom" checked={dealerEmailMode==="custom"}
                            onChange={()=>{setDealerEmailMode("custom");setDealerEmailInput("");}}/>
                          <span style={{ fontWeight:600,color:"#0a2540" }}>Enter email manually</span>
                        </label>
                      </div>
                      <div style={{ marginBottom:14 }}>
                        <label style={{ fontSize:12,color:"#374151",fontWeight:600,display:"block",marginBottom:4 }}>
                          {dealerEmailMode==="dealer"?"Confirm dealer email *":dealerEmailMode==="vendor"?"Vendor email *":"Email address *"}
                        </label>
                        <input type="email" value={dealerEmailInput} onChange={(e)=>setDealerEmailInput(e.target.value)}
                          placeholder="recipient@example.com"
                          style={{ width:"100%",padding:"9px 12px",borderRadius:7,border:"1px solid #d1d5db",
                            fontSize:13,boxSizing:"border-box" as const }}/>
                        <p style={{ fontSize:11,color:"#9ca3af",marginTop:4 }}>
                          CC: Mayank Maheshwari + RSM ({selected.submittedBy})
                        </p>
                      </div>
                      <div style={{ display:"flex",gap:10 }}>
                        <button onClick={handleNotifyDealer} disabled={notifyLoading||!dealerEmailInput.trim()}
                          style={{ background:"#0a2540",color:"#fff",border:"none",padding:"10px 22px",borderRadius:8,
                            fontWeight:600,fontSize:14,
                            cursor:notifyLoading||!dealerEmailInput.trim()?"not-allowed":"pointer",
                            opacity:notifyLoading||!dealerEmailInput.trim()?0.6:1 }}>
                          {notifyLoading?"Sending…":"📧 Send to Dealer"}
                        </button>
                        <button onClick={()=>setShowNotifyDealer(false)}
                          style={{ background:"#f1f5f9",color:"#374151",border:"1px solid #e2e8f0",
                            padding:"10px 20px",borderRadius:8,fontWeight:500,fontSize:14,cursor:"pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* RSM decision banner */}
              {!isAdmin&&selected.status!=="Pending"&&(
                <div style={{
                  background:selected.status==="Approved"?"#f0fdf4":selected.status==="Rejected"?"#fef2f2":"#fef9c3",
                  border:`1px solid ${selected.status==="Approved"?"#bbf7d0":selected.status==="Rejected"?"#fecaca":"#fde68a"}`,
                  borderLeft:`4px solid ${selected.status==="Approved"?"#16a34a":selected.status==="Rejected"?"#dc2626":"#f59e0b"}`,
                  borderRadius:10,padding:"16px 20px" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
                    <strong style={{ fontSize:14,
                      color:selected.status==="Approved"?"#166534":selected.status==="Rejected"?"#991b1b":"#92400e" }}>
                      {selected.status==="NeedsRevision"?"Revision requested":selected.status}
                    </strong>
                    {selected.decidedAt&&(
                      <span style={{ fontSize:12,color:"#6b7280" }}>
                        {fmtDate(selected.decidedAt)}{selected.approvedBy&&` · ${selected.approvedBy}`}
                      </span>
                    )}
                  </div>
                  {selected.approverNote&&<p style={{ margin:"4px 0 0",fontSize:13,color:"#374151" }}>{selected.approverNote}</p>}
                  {selected.status==="NeedsRevision"&&(
                    <button onClick={()=>navigate(`/rsm-form?edit=${selected.id}`)}
                      style={{ marginTop:12,background:"#f59e0b",color:"#fff",border:"none",
                        borderRadius:7,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer" }}>
                      ✏ Edit &amp; resubmit →
                    </button>
                  )}
                </div>
              )}

              {/* Admin finalised banner */}
              {isAdmin&&(selected.status==="Approved"||selected.status==="Rejected")&&(
                <div style={{
                  background:selected.status==="Approved"?"#f0fdf4":"#fef2f2",
                  border:`1px solid ${selected.status==="Approved"?"#bbf7d0":"#fecaca"}`,
                  borderLeft:`4px solid ${selected.status==="Approved"?"#16a34a":"#dc2626"}`,
                  borderRadius:10,padding:"14px 18px" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                    <strong style={{ fontSize:14,color:selected.status==="Approved"?"#166534":"#991b1b" }}>
                      {selected.status}
                    </strong>
                    {selected.decidedAt&&(
                      <span style={{ fontSize:12,color:"#6b7280" }}>
                        {fmtDate(selected.decidedAt)}{selected.approvedBy&&` · ${selected.approvedBy}`}
                      </span>
                    )}
                  </div>
                  {selected.approverNote&&<p style={{ margin:"4px 0 0",fontSize:13,color:"#374151" }}>{selected.approverNote}</p>}
                </div>
              )}

            </div>
          </div>

          {/* Sticky save footer */}
          {isAdmin&&isEditing&&(
            <div style={{ background:"#fff",borderTop:"2px solid #e2e8f0",padding:"12px 24px",flexShrink:0,
              display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12 }}>
              <span style={{ fontSize:12,color:"#f59e0b",fontWeight:600 }}>⚠ Unsaved changes</span>
              <button onClick={()=>{ setEditData(toEditable(selected)); setIsEditing(false); }}
                style={{ background:"#f1f5f9",color:"#374151",border:"1px solid #e2e8f0",
                  borderRadius:7,padding:"9px 20px",fontWeight:500,fontSize:14,cursor:"pointer" }}>
                Discard
              </button>
              <button onClick={saveEdits} disabled={saveLoading}
                style={{ background:"#0a2540",color:"#fff",border:"none",
                  borderRadius:7,padding:"9px 24px",fontWeight:600,fontSize:14,
                  cursor:saveLoading?"not-allowed":"pointer",opacity:saveLoading?0.7:1 }}>
                {saveLoading?"Saving…":"💾 Save changes"}
              </button>
            </div>
          )}
        </div>
      )}

      {toast&&(
        <div className={`ap-toast ${toast.ok?"ap-toast-ok":"ap-toast-err"}`}>
          {toast.ok?"✓":"✕"}&nbsp;{toast.msg}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, onClick, active }: {
  label:string; value:string|number; color:string;
  onClick?:()=>void; active?:boolean;
}) {
  return (
    <div
      className={`ap-stat${onClick ? " ap-stat--clickable" : ""}${active ? " ap-stat--active" : ""}`}
      onClick={onClick}
      title={onClick ? `Filter by: ${label}` : undefined}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <span className={`ap-stat-val ap-${color}`}>{value}</span>
      <span className="ap-stat-lbl">{label}</span>
      {active && <span className="ap-stat-active-dot"/>}
    </div>
  );
}
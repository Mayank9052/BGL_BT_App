// src/pages/ApproverDashboard.tsx
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import {
  fetchProposals, fetchMyProposals, decideProposal, updateProposal,
  sendBackProposal, updateProposalActuals, uploadActivityMedia,
  forwardProposalToApprover, notifyDealer, addActivityMedia,
  type ActivityResponse, type ActivityMediaResponse, type ProposalResponse,
} from "../services/proposalService";
import {
  fetchActivityTypes, groupActivityTypes,
  type ActivityType, type ActivityGroup,
} from "../services/activityService";
import "./ApproverDashboard.css";
import { fetchDealerUsers } from "../services/dealerAuthService";

// ─── Formatters ───────────────────────────────────────────────────────────────
const inr     = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const num     = (v: string | number) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", timeStyle: "short" });
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
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR + 1].map(String);
// ── NEW: local-date ISO helper (matches RSMForm's fix — avoids the UTC
// shift bug where toISOString() could roll a date back by one day) ──
const isoDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const TODAY_ISO = isoDate(new Date());

const safeBgaussShare = (v: number | null | undefined): string => {
  if (v == null || v === 0) return "100";
  if (v <= 50) return "50";
  if (v <= 70) return "70";
  return "100";
};

// ─── GPS helper — never blocks UI ────────────────────────────────────────────
function captureGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      ()  => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}
const mapsUrl = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;

// ─── Media helpers ────────────────────────────────────────────────────────────
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
  const multiUrls = new Set((a.mediaFiles??[]).map((m: ActivityMediaResponse) => m.fileUrl));
  if (a.mediaFileUrl && !multiUrls.has(a.mediaFileUrl))
    all.push({ id:`legacy-${a.id}`, url:resolveUrl(a.mediaFileUrl), name:a.mediaFileName??"Media file", type:a.mediaFileType??null });
  (a.mediaFiles??[]).forEach((m: ActivityMediaResponse) =>
    all.push({ id:m.id, url:resolveUrl(m.fileUrl), name:m.fileName, type:m.fileType }));
  return all;
}

function MediaViewer({ url, name, type, onClose }: { url:string; name:string; type:string|null; onClose:()=>void }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:10000,
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

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════
interface EditMediaFile { id:string; fileUrl:string; fileName:string; fileType:string; }
interface EditActivity {
  id?:string; activityType:string; category:string; categoryLocked?:boolean;
  subcategory:string; qty:string; leadTarget:string; salesPercent:string;
  retailTarget:string; retailLocked:boolean; startDate:string; endDate:string;
  budget:string; additionalBudget:string; bgaussShare:string;
  vendorId:string; remarks:string; mediaFiles:EditMediaFile[];
}
interface EditableProposal {
  dealerName:string; location:string; state:string; type:string;
  rsmName:string; tsmName:string; commandoName:string; month:string; year:string;
  eligibility:string; remarks:string; vendorId:string; vendorName:string;
  activities:EditActivity[]; checkerRemarks:string;
}

// Post-Activity v2
interface ProofMedia {
  id:string; fileUrl:string; fileName:string; fileType:string;
  capturedAt:string; latitude?:number|null; longitude?:number|null;
}
interface DailyEntry {
  date:string; enquiryPlanned:number; enquiryActual:number;
  testDrivePlanned:number; testDriveActual:number;
  bookingActual:number; retailActual:number; leadsPunched:number;
}
interface ActualEntry {
  actualStartDate:string; actualEndDate:string;
  mediaFile:File|null; mediaFileUrl:string|null;
  mediaFileName:string|null; mediaFileType:string|null;
  uploading:boolean;       // invoice upload spinner (legacy single)
  proofUploading:boolean;  // photo proof upload spinner
  invoiceUploading:boolean; // multi-invoice upload spinner
  proofMedia:ProofMedia[];
  invoiceMedia:ProofMedia[]; // multiple invoices/bills
  dailyEntries:DailyEntry[];
}

function toEditable(p: ProposalResponse): EditableProposal {
  return {
    dealerName:p.dealerName, location:p.location, state:p.state, type:p.type,
    rsmName:p.rsmName, tsmName:(p as any).tsmName??"", commandoName:p.commandoName??"", month:p.month,
    year:(p as any).year??String(CURRENT_YEAR),
    eligibility:p.eligibility, remarks:p.remarks??"",
    vendorId:String(p.vendorId??""), vendorName:p.vendorName??"", checkerRemarks:"",
    activities:p.activities.map((a)=>({
      id:a.id, activityType:a.activityType, category:a.category??"", categoryLocked:false,
      subcategory:(a as any).subcategory??"", qty:String((a as any).qty??1),
      leadTarget:String(a.leadTarget??0),
      salesPercent:String((a as any).salesPercent??""),
      retailTarget:String(a.retailTarget??0),
      retailLocked:!!((a as any).salesPercent)&&parseFloat(String((a as any).salesPercent??0))>0,
      startDate:a.startDate?.split("T")[0]??"", endDate:a.endDate?.split("T")[0]??"",
      budget:String(a.budget), additionalBudget:String(a.additionalBudget??0),
      bgaussShare:safeBgaussShare(a.bgaussShare as any),
      vendorId:String(a.vendorId??""), remarks:a.remarks??"",
      mediaFiles:(a.mediaFiles??[]).map((m:ActivityMediaResponse)=>({
        id:m.id,fileUrl:m.fileUrl,fileName:m.fileName,fileType:m.fileType,
      })),
    })),
  };
}

function buildDailyEntries(start?: string|null, end?: string|null): DailyEntry[] {
  if (!start||!end) return [];
  const entries:DailyEntry[]=[];
  const s=new Date(start), e=new Date(end), today=new Date();
  const cap=e<today?e:today;
  for (const d=new Date(s);d<=cap;d.setDate(d.getDate()+1)) {
    entries.push({ date:d.toISOString().split("T")[0],
      enquiryPlanned:0,enquiryActual:0,testDrivePlanned:0,testDriveActual:0,
      bookingActual:0,retailActual:0,leadsPunched:0 });
  }
  return entries;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function ApproverDashboard() {
  const { instance, accounts } = useMsal();
  const navigate  = useNavigate();
  const account   = accounts[0];
  const { user }  = useAuthStore();
  const isAdmin   = user?.role === "Admin" || user?.role === "Manager";
  const myEmail         = (account?.username ?? user?.email ?? "").toLowerCase();
  const FINAL_APPROVER  = "vijay.maurya@bgauss.com";
  const isFinalApprover = myEmail === FINAL_APPROVER;
  const isForwardOnly   = isAdmin && !isFinalApprover;

  // ── State ──────────────────────────────────────────────────────────────────
  const [proposals,        setProposals]        = useState<ProposalResponse[]>([]);
  const [selected,         setSelected]         = useState<ProposalResponse|null>(null);
  const [editData,         setEditData]         = useState<EditableProposal|null>(null);
  const [isEditing,        setIsEditing]        = useState(false);
  const [note,             setNote]             = useState("");
  const [sendBackNote,     setSendBackNote]     = useState("");
  const [showSendBack,     setShowSendBack]     = useState(false);
  const [filterStatus,     setFilterStatus]     = useState("All");
  const [filterMonth,      setFilterMonth]      = useState("All");
  const [filterYear,       setFilterYear]       = useState("All");
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
  const [dealerEmailFetching, setDealerEmailFetching] = useState(false);
  const [actualsData,      setActualsData]      = useState<Record<string,ActualEntry>>({});
  const [actualsLoading,   setActualsLoading]   = useState(false);
  const [uploadingMedia,   setUploadingMedia]   = useState<Record<string,boolean>>({});
  const [openActualsId,    setOpenActualsId]    = useState<string|null>(null);
  const [openActualsPanel, setOpenActualsPanel] = useState<Record<string,"photos"|"invoices"|"history">>({});
  const toggleActualsPanel = (activityId:string, panel:"photos"|"invoices"|"history") =>
    setOpenActualsPanel(prev => ({
      ...prev,
      [activityId]: prev[activityId] === panel ? undefined as any : panel
    }));
  const [mediaViewer,      setMediaViewer]      = useState<{url:string;name:string;type:string}|null>(null);
  const [activityMasterList, setActivityMasterList] = useState<ActivityType[]>([]);
  const [activityGroups,     setActivityGroups]     = useState<ActivityGroup[]>([]);
  // Bulk approve
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkNote,      setBulkNote]      = useState("");
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  // Budget Addition
  const [showBudgetAddPanel, setShowBudgetAddPanel] = useState(false);
  const [budgetAddAmounts,   setBudgetAddAmounts]   = useState<Record<string,string>>({});
  const [budgetAddNote,      setBudgetAddNote]      = useState("");
  const [budgetAddLoading,   setBudgetAddLoading]   = useState(false);

  const scrollBodyRef = useRef<HTMLDivElement|null>(null);
  const showToast = (msg:string, ok:boolean) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3500); };

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadProposals = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      // Retry once on failure (handles transient DB connection timeouts)
      let data: ProposalResponse[];
      try {
        data = isAdmin ? await fetchProposals(instance) : await fetchMyProposals(instance);
      } catch (firstErr) {
        // Wait 2s and retry once
        await new Promise(r => setTimeout(r, 2000));
        data = isAdmin ? await fetchProposals(instance) : await fetchMyProposals(instance);
      }
      setProposals(data);
    } catch (err) { setFetchError(err instanceof Error ? err.message : "Failed to load. Please click Refresh to try again."); }
    finally { setLoading(false); }
  }, [instance, isAdmin]);

  useEffect(()=>{ loadProposals(); },[loadProposals]);
  useEffect(()=>{
    fetchActivityTypes(instance)
      .then((types)=>{ setActivityMasterList(types); setActivityGroups(groupActivityTypes(types)); })
      .catch(()=>{});
  },[instance]);
  useEffect(()=>{
    document.body.style.overflow = selected ? "hidden" : "";
    return ()=>{ document.body.style.overflow=""; };
  },[selected]);

  // ── Computed ───────────────────────────────────────────────────────────────
  const months   = useMemo(()=>["All",...Array.from(new Set(proposals.map((p)=>p.month)))],[proposals]);
  const years    = useMemo(()=>["All",...Array.from(new Set(proposals.map((p)=>(p as any).year).filter(Boolean))).sort()],[proposals]);
  const filtered = useMemo(()=>proposals.filter((p)=>{
    if (filterStatus!=="All"&&p.status!==filterStatus) return false;
    if (filterMonth!=="All"&&p.month!==filterMonth) return false;
    if (filterYear!=="All"&&(p as any).year!==filterYear) return false;
    if (search){ const q=search.toLowerCase();
      return p.dealerName.toLowerCase().includes(q)||p.rsmName.toLowerCase().includes(q)||
             p.location.toLowerCase().includes(q)||(p.tokenNumber??"").toLowerCase().includes(q); }
    return true;
  }),[proposals,filterStatus,filterMonth,filterYear,search]);
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
    const tb =editData.activities.reduce((s,a)=>s+num(a.budget)+num(a.additionalBudget),0);
    const tlt=editData.activities.reduce((s,a)=>s+num(a.leadTarget),0);
    const trt=editData.activities.reduce((s,a)=>s+num(a.retailTarget),0);
    const tbg=editData.activities.reduce((s,a)=>
      s+Math.round((num(a.budget)+num(a.additionalBudget))*(num(a.bgaussShare||"100")/100)),0);
    return { totalBudget:tb,totalLeadTarget:tlt,totalRetailTarget:trt,
      cac:trt>0?tbg/trt:0,cpl:tlt>0?tbg/tlt:0,totalBgauss:tbg };
  },[editData]);

  // ── NEW: activity dates in edit mode must fall within editData's
  // Month + Year window — mirrors RSMForm's activityDateRange logic ──
  const editActivityDateRange = useMemo(() => {
    if (!editData) return { min: TODAY_ISO, max: "" };
    const monthIdx = MONTHS.indexOf(editData.month);
    const year = parseInt(editData.year) || CURRENT_YEAR;
    if (monthIdx < 0 || !editData.month) return { min: TODAY_ISO, max: "" };
    const firstDay  = new Date(year, monthIdx, 1);
    const lastDay   = new Date(year, monthIdx + 1, 0);
    const todayDate = new Date();
    const minDate   = firstDay > todayDate ? firstDay : todayDate;
    return { min: isoDate(minDate), max: isoDate(lastDay) };
  }, [editData?.month, editData?.year]);

  // ── initActuals ────────────────────────────────────────────────────────────
  const initActuals = useCallback((p:ProposalResponse)=>{
    const init:Record<string,ActualEntry>={};
    p.activities.forEach((a)=>{
      init[a.id]={
        actualStartDate:a.actualStartDate?.split("T")[0]??"",
        actualEndDate:a.actualEndDate?.split("T")[0]??"",
        mediaFile:null, mediaFileUrl:a.mediaFileUrl??null,
        mediaFileName:a.mediaFileName??null, mediaFileType:a.mediaFileType??null,
        uploading:false,
        proofUploading:false,
        invoiceUploading:false,
        // Load existing invoices from mediaFiles where fileType is pdf or non-image/video
        invoiceMedia:(a.mediaFiles??[])
          .filter((m)=>m.fileType?.includes("pdf")||
            (!m.fileType?.startsWith("image/")&&!m.fileType?.startsWith("video/")))
          .map((m)=>({
            id:m.id,fileUrl:m.fileUrl,fileName:m.fileName,fileType:m.fileType,
            capturedAt:m.capturedAt??new Date().toISOString(),
            latitude:null, longitude:null,
          })),
        proofMedia:(a.mediaFiles??[])
          .filter((m)=>m.fileType?.startsWith("image/")||m.fileType?.startsWith("video/"))
          .map((m)=>({
          id:m.id,fileUrl:m.fileUrl,fileName:m.fileName,fileType:m.fileType,
          capturedAt:m.capturedAt??new Date().toISOString(),
          latitude:m.latitude??null, longitude:m.longitude??null,
        })),
        dailyEntries:(()=>{
          // Load saved daily data from server if available, else build blank entries
          const serverDaily = (a as any).dailyData;
          if (serverDaily) {
            try {
              const parsed = JSON.parse(serverDaily) as DailyEntry[];
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            } catch {}
          }
          return buildDailyEntries(a.actualStartDate??a.startDate,a.actualEndDate??a.endDate);
        })(),
      };
    });
    setActualsData(init);
  },[]);

  // ── initBudgetAdd ──────────────────────────────────────────────────────────
  const initBudgetAdd = useCallback((p:ProposalResponse)=>{
    const init:Record<string,string>={};
    p.activities.forEach((a)=>{ init[a.id]=String(a.additionalBudget??0); });
    setBudgetAddAmounts(init); setBudgetAddNote("");
  },[]);

  // ── Daily entries helpers ──────────────────────────────────────────────────
  const setActualField=(id:string,key:"actualStartDate"|"actualEndDate",v:string)=>
    setActualsData((prev)=>({...prev,[id]:{...prev[id],[key]:v}}));

  const setDailyField=(activityId:string,date:string,key:keyof DailyEntry,v:number)=>
    setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],
      dailyEntries:prev[activityId].dailyEntries.map((e)=>e.date===date?{...e,[key]:v}:e)}}));

  const rebuildDailyEntries=(activityId:string,startDate:string,endDate:string)=>{
    const fresh=buildDailyEntries(startDate,endDate);
    setActualsData((prev)=>{
      const existing=prev[activityId]?.dailyEntries??[];
      const merged=fresh.map((ne)=>existing.find((e)=>e.date===ne.date)??ne);
      return {...prev,[activityId]:{...prev[activityId],dailyEntries:merged}};
    });
  };

  // ── Proof upload with GPS ──────────────────────────────────────────────────
  const handleProofUpload=async(activityId:string,files:FileList)=>{
    // ── DEBUG CHECKPOINT 1: function called ──────────────────────────────────
    console.log("[PROOF-UPLOAD] ▶ handleProofUpload called", {
      activityId,
      fileCount: files.length,
      fileNames: Array.from(files).map(f=>f.name),
      selectedId: selected?.id ?? "NULL — selected is null!",
    });

    const proposalId = selected?.id;
    if (!proposalId) {
      console.error("[PROOF-UPLOAD] ✖ BLOCKED — selected?.id is null. Modal must be open with a proposal.");
      showToast("Error: No proposal selected. Please close and reopen.", false);
      return;
    }

    // ── FIX: Copy FileList → plain Array IMMEDIATELY before any await ──────────
    // FileList becomes empty after e.target.value="" clears the input.
    // GPS capture takes 6-8s, by which time the FileList reference is stale.
    const fileArray = Array.from(files);
    console.log("[PROOF-UPLOAD] 📋 Copied to array immediately:", fileArray.map(f=>f.name));

    setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],proofUploading:true}}));

    try {
      // ── GPS captured AFTER copying files (so FileList invalidation doesn't matter) ──
      console.log("[PROOF-UPLOAD] 📍 Capturing GPS…");
      const geo=await captureGeo();
      const capturedAt=new Date().toISOString();
      console.log("[PROOF-UPLOAD] 📍 GPS result:", geo ?? "null (no GPS / denied)");

      for (const file of fileArray){  // ← use fileArray, not Array.from(files)
        // ── DEBUG CHECKPOINT 3: uploading file to storage ────────────────────
        console.log("[PROOF-UPLOAD] ⬆ STEP 1 — uploading to /api/media/upload:", file.name, file.type, file.size, "bytes");
        let uploaded: {url:string; fileName:string; fileType:string};
        try {
          uploaded = await uploadActivityMedia(file, instance);
          console.log("[PROOF-UPLOAD] ✔ STEP 1 done — storage URL:", uploaded.url);
        } catch(uploadErr) {
          console.error("[PROOF-UPLOAD] ✖ STEP 1 FAILED — /api/media/upload error:", uploadErr);
          throw uploadErr;
        }

        // ── DEBUG CHECKPOINT 4: saving to DB ────────────────────────────────
        console.log("[PROOF-UPLOAD] 💾 STEP 2 — saving to DB via /api/proposals/.../media", {
          proposalId, activityId,
          fileUrl: uploaded.url,
          capturedAt,
          latitude: geo?.lat ?? null,
          longitude: geo?.lng ?? null,
        });
        let saved: import("../services/proposalService").ActivityMediaResponse;
        try {
          saved = await addActivityMedia(proposalId, activityId, {
            fileUrl: uploaded.url,
            fileName: uploaded.fileName,
            fileType: uploaded.fileType,
            capturedAt,
            latitude: geo?.lat ?? null,
            longitude: geo?.lng ?? null,
          }, instance);
          console.log("[PROOF-UPLOAD] ✔ STEP 2 done — saved to DB with id:", saved.id);
        } catch(dbErr) {
          console.error("[PROOF-UPLOAD] ✖ STEP 2 FAILED — addActivityMedia DB error:", dbErr);
          throw dbErr;
        }

        // ── DEBUG CHECKPOINT 5: adding to UI state ───────────────────────────
        const proof:ProofMedia={
          id: saved.id,
          fileUrl: saved.fileUrl,
          fileName: saved.fileName,
          fileType: saved.fileType,
          capturedAt: saved.capturedAt ?? capturedAt,
          latitude: saved.latitude ?? geo?.lat ?? null,
          longitude: saved.longitude ?? geo?.lng ?? null,
        };
        console.log("[PROOF-UPLOAD] ✔ STEP 3 — added to UI state:", proof);
        setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],
          proofMedia:[...prev[activityId].proofMedia,proof]}}));
      }

      console.log("[PROOF-UPLOAD] ✅ All files uploaded successfully");
      showToast(geo?"Photo(s) saved with GPS 📍":"Photo(s) saved (no GPS)",true);

    } catch(err){
      console.error("[PROOF-UPLOAD] ✖ CAUGHT ERROR:", err);
      showToast(err instanceof Error ? err.message : "Upload failed.", false);
    } finally {
      console.log("[PROOF-UPLOAD] 🔚 finally — resetting proofUploading to false");
      setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],proofUploading:false}}));
    }
  };

  const removeProof=(activityId:string,id:string)=>
    setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],
      proofMedia:prev[activityId].proofMedia.filter((m)=>m.id!==id)}}));

  // ── Multi-invoice upload ───────────────────────────────────────────────────
  const handleInvoiceUpload=async(activityId:string,files:FileList)=>{
    const proposalId=selected?.id;
    if(!proposalId) return;
    const fileArray=Array.from(files);
    setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],invoiceUploading:true}}));
    try {
      for(const file of fileArray){
        const uploaded=await uploadActivityMedia(file,instance);
        const saved=await addActivityMedia(proposalId,activityId,{
          fileUrl:uploaded.url,fileName:uploaded.fileName,fileType:uploaded.fileType,
          capturedAt:new Date().toISOString(),latitude:null,longitude:null,
        },instance);
        const inv:ProofMedia={
          id:saved.id,fileUrl:saved.fileUrl,fileName:saved.fileName,fileType:saved.fileType,
          capturedAt:saved.capturedAt??new Date().toISOString(),latitude:null,longitude:null,
        };
        setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],
          invoiceMedia:[...prev[activityId].invoiceMedia,inv]}}));
      }
      showToast(`${fileArray.length} invoice${fileArray.length>1?"s":""} uploaded.`,true);
    } catch(err){ showToast(err instanceof Error?err.message:"Upload failed.",false); }
    finally { setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],invoiceUploading:false}})); }
  };

  const removeInvoice=(activityId:string,id:string)=>
    setActualsData((prev)=>({...prev,[activityId]:{...prev[activityId],
      invoiceMedia:prev[activityId].invoiceMedia.filter((m)=>m.id!==id)}}));

  const handleActualMedia=async(activityId:string,file:File)=>{
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

  const handleEditMediaUpload=async(idx:number,files:FileList)=>{
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

  // ── Save actuals ───────────────────────────────────────────────────────────
  const saveActuals=async()=>{
    if (!selected) return;
    setActualsLoading(true);
    try {
      const payload=selected.activities.map((a)=>{
        const d=actualsData[a.id];
        return {
          activityId:a.id,
          actualStartDate:d?.actualStartDate||null,
          actualEndDate:d?.actualEndDate||null,
          mediaFileUrl:d?.mediaFileUrl??null,
          mediaFileName:d?.mediaFileName??null,
          mediaFileType:d?.mediaFileType??null,
          dailyData: d?.dailyEntries?.length ? JSON.stringify(d.dailyEntries) : null,
        };
      });
      const updated=await updateProposalActuals(selected.id,payload,instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); initActuals(updated); showToast("Actuals saved.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Failed.",false); }
    finally { setActualsLoading(false); }
  };

  // ── Modal open/close ───────────────────────────────────────────────────────
  const openModal=(p:ProposalResponse)=>{
    setSelected(p); setEditData(toEditable(p)); setIsEditing(false); setShowSendBack(false);
    setNote(p.approverNote??""); setSendBackNote("");
    setShowNotifyDealer(false); setDealerEmailMode("dealer");
    setDealerEmailInput(p.dealerEmail??"");
    initActuals(p); initBudgetAdd(p); setOpenActualsId(null);
    setShowBudgetAddPanel(false);
  };
  const closeModal=()=>{
    setSelected(null); setEditData(null); setIsEditing(false); setShowSendBack(false);
    setShowNotifyDealer(false); setDealerEmailInput(""); setActualsData({}); setOpenActualsId(null);
    setShowBudgetAddPanel(false);
  };

  // ── Edit helpers ───────────────────────────────────────────────────────────
  const setF=(key:keyof Omit<EditableProposal,"activities">,v:string)=>
    setEditData((d)=>{
      if (!d) return d;
      const next = { ...d, [key]: v };
      // ── NEW: changing Month invalidates existing activity dates that may
      // now fall outside the new Month+Year window — clear them so the
      // Checker must re-pick dates within range, same as RSMForm.
      if (key === "month") {
        next.activities = next.activities.map((a) => ({ ...a, startDate: "", endDate: "" }));
      }
      return next;
    });
  const setAF=(idx:number,key:keyof EditActivity,v:string)=>
    setEditData((d)=>d?{...d,activities:d.activities.map((a,i)=>i===idx?{...a,[key]:v}:a)}:d);
  const addRow=()=>setEditData((d)=>d?{...d,activities:[...d.activities,
    {activityType:"",category:"",categoryLocked:false,subcategory:"",qty:"1",
     leadTarget:"",salesPercent:"",retailTarget:"",retailLocked:false,startDate:"",endDate:"",
     budget:"",additionalBudget:"0",bgaussShare:"100",vendorId:"",remarks:"",mediaFiles:[]}]}:d);
  const removeRow=(idx:number)=>setEditData((d)=>(!d||d.activities.length<=1)?d:
    {...d,activities:d.activities.filter((_,i)=>i!==idx)});

  const handleEditActivityNameChange=(idx:number,activityName:string)=>{
    const group=activityGroups.find((g)=>g.activityName.toLowerCase()===activityName.toLowerCase());
    setEditData((d)=>d?{...d,activities:d.activities.map((a,i)=>i===idx?{
      ...a,activityType:activityName,category:group?group.activityType:a.category,
      categoryLocked:!!group,subcategory:"",qty:"1",
    }:a)}:d);
  };
  const handleEditSubcategoryChange=(idx:number,_activityName:string,subcategory:string)=>
    setEditData((d)=>d?{...d,activities:d.activities.map((a,i)=>
      i===idx?{...a,subcategory,qty:"1"}:a)}:d);

  // ── Save edits ─────────────────────────────────────────────────────────────
  const saveEdits=async()=>{
    if (!selected||!editData) return;
    // ── Reject out-of-window dates before saving ──
    const { min, max } = editActivityDateRange;
    const outOfRange = editData.activities.find(a =>
      (a.startDate && a.startDate < min) ||
      (max && a.startDate && a.startDate > max) ||
      (max && a.endDate && a.endDate > max)
    );
    if (outOfRange) {
      showToast(`All activity dates must fall within ${editData.month} ${editData.year}.`, false);
      return;
    }
    setSaveLoading(true);
    try {
      const payload={
        dealerName:editData.dealerName,location:editData.location,state:editData.state,
        type:editData.type,rsmName:editData.rsmName,tsmName:editData.tsmName||"",
        commandoName:editData.commandoName||null,checkerRemarks:editData.checkerRemarks||"",
        month:editData.month,year:editData.year,eligibility:editData.eligibility,remarks:editData.remarks,
        vendorId:editData.vendorId?Number(editData.vendorId):null,vendorName:editData.vendorName||null,
        activities:editData.activities.map((a)=>({
          activityType:a.activityType,category:a.category||null,
          subcategory:a.subcategory||null,qty:num(a.qty)||1,
          leadTarget:num(a.leadTarget),retailTarget:num(a.retailTarget),
          startDate:a.startDate,endDate:a.endDate,budget:num(a.budget),
          additionalBudget:num(a.additionalBudget),
          bgaussShare:num(a.bgaussShare)>0?num(a.bgaussShare):100,
          salesPercent:a.salesPercent.trim()?parseFloat(a.salesPercent):null,
          vendorId:a.vendorId?Number(a.vendorId):null,remarks:a.remarks,
          mediaFiles:a.mediaFiles.map((m)=>({fileUrl:m.fileUrl,fileName:m.fileName,fileType:m.fileType})),
        })),
        totalBudget:editTotals.totalBudget,totalLeadTarget:Math.round(editTotals.totalLeadTarget),
        totalRetailTarget:Math.round(editTotals.totalRetailTarget),cac:editTotals.cac,cpl:editTotals.cpl,
      };
      const updated=await updateProposal(selected.id,payload as any,instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated);
      const editable=toEditable(updated);
      editable.activities=editable.activities.map((ea,idx)=>({
        ...ea,bgaussShare:(()=>{
          const sent=payload.activities[idx]?.bgaussShare;
          const sv=(updated.activities[idx] as any)?.bgaussShare;
          return (sv&&sv>0)?safeBgaussShare(sv):sent?String(sent):"100";
        })(),
      }));
      setEditData(editable); setIsEditing(false); showToast("Proposal updated.",true);
      // Reload all proposals to ensure server state is in sync (prevents stale data)
      setTimeout(() => loadProposals(), 500);
    } catch(err){ showToast(err instanceof Error?err.message:"Save failed.",false); }
    finally { setSaveLoading(false); }
  };

  // ── Decide / Send back / Forward / Notify ──────────────────────────────────
  const decide=async(action:"Approved"|"Rejected")=>{
    if (!selected) return; setActionLoading(true);
    try {
      const updated=await decideProposal(selected.id,
        {status:action,approverNote:note.trim()||null,approvedBy:account?.username??null},instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); initActuals(updated);
      showToast(action==="Approved"?"Approved.":"Rejected.",action==="Approved"); setNote("");
    } catch(err){ showToast(err instanceof Error?err.message:"Failed.",false); }
    finally { setActionLoading(false); }
  };

  const handleSendBack=async()=>{
    if (!selected) return; setActionLoading(true);
    try {
      const updated=await sendBackProposal(selected.id,
        {note:sendBackNote.trim()||null,sentBackBy:account?.username??null},instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); setShowSendBack(false); setSendBackNote("");
      showToast("Sent back for revision.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Failed.",false); }
    finally { setActionLoading(false); }
  };

  const handleForward=async()=>{
    if (!selected) return; setForwardLoading(true);
    try {
      const updated=await forwardProposalToApprover(selected.id,instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); showToast("Forwarded to Final Approver.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Forward failed.",false); }
    finally { setForwardLoading(false); }
  };

  const handleNotifyDealer=async()=>{
    if (!selected||!dealerEmailInput.trim()) return; setNotifyLoading(true);
    try {
      const updated=await notifyDealer(selected.id,dealerEmailInput.trim(),instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); setShowNotifyDealer(false); showToast("Dealer notified.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Notify failed.",false); }
    finally { setNotifyLoading(false); }
  };

  // ── Budget Addition submit ─────────────────────────────────────────────────
  const handleBudgetAddSubmit=async()=>{
    if (!selected) return; setBudgetAddLoading(true);
    try {
      const updatedActivities=selected.activities.map((a)=>({
        activityType:a.activityType,category:a.category??null,
        subcategory:(a as any).subcategory??null,qty:(a as any).qty??1,
        leadTarget:a.leadTarget,retailTarget:a.retailTarget,
        startDate:a.startDate,endDate:a.endDate,budget:a.budget,
        additionalBudget:num(budgetAddAmounts[a.id]??"0"),
        bgaussShare:a.bgaussShare>0?a.bgaussShare:100,
        salesPercent:(a as any).salesPercent??null,
        vendorId:a.vendorId??null,remarks:a.remarks??"",
        mediaFiles:(a.mediaFiles??[]).map((m:ActivityMediaResponse)=>({
          fileUrl:m.fileUrl,fileName:m.fileName,fileType:m.fileType,
        })),
      }));
      const totalBudget=updatedActivities.reduce((s,a)=>s+a.budget+a.additionalBudget,0);
      const totalBgauss=updatedActivities.reduce((s,a)=>
        s+Math.round((a.budget+a.additionalBudget)*((a.bgaussShare??100)/100)),0);
      const payload={
        dealerName:selected.dealerName,location:selected.location,state:selected.state,
        type:selected.type,rsmName:selected.rsmName,tsmName:(selected as any).tsmName??"",
        commandoName:selected.commandoName??null,month:selected.month,
        eligibility:selected.eligibility,remarks:selected.remarks??"",
        vendorId:selected.vendorId??null,vendorName:selected.vendorName??null,
        checkerRemarks:budgetAddNote
          ?`[Budget Addition Request from Dealer] ${budgetAddNote}`
          :"[Budget Addition Request from Dealer] Additional budget added as per dealer request.",
        activities:updatedActivities,totalBudget,
        totalLeadTarget:selected.totalLeadTarget,totalRetailTarget:selected.totalRetailTarget,
        cac:selected.totalRetailTarget>0?totalBgauss/selected.totalRetailTarget:0,
        cpl:selected.totalLeadTarget>0?totalBgauss/selected.totalLeadTarget:0,
      };
      const updated=await updateProposal(selected.id,payload as any,instance);
      setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p));
      setSelected(updated); initBudgetAdd(updated);
      showToast("Additional budget saved.",true);
      const forwarded=await forwardProposalToApprover(updated.id,instance);
      setProposals((prev)=>prev.map((p)=>p.id===forwarded.id?forwarded:p));
      setSelected(forwarded); setShowBudgetAddPanel(false);
      showToast("Budget addition forwarded to Final Approver for re-approval.",true);
    } catch(err){ showToast(err instanceof Error?err.message:"Failed to submit.",false); }
    finally { setBudgetAddLoading(false); }
  };

  // ── Bulk approve ───────────────────────────────────────────────────────────
  const toggleActuals=(activityId:string)=>
    setOpenActualsId((prev)=>prev===activityId?null:activityId);
  const allPendingSelected =pendingFiltered.length>0&&pendingFiltered.every((p)=>selectedIds.has(p.id));
  const somePendingSelected=pendingFiltered.some((p)=>selectedIds.has(p.id));
  const toggleSelectAll=()=>{
    if (allPendingSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(pendingFiltered.map((p)=>p.id)));
  };
  const toggleOne=(id:string,isPending:boolean)=>{
    if (!isPending) return;
    setSelectedIds((prev)=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  };
  const handleBulkApprove=async()=>{
    if (selectedIds.size===0) return; setBulkApproving(true);
    let ok=0,fail=0;
    for (const id of Array.from(selectedIds)){
      try {
        const updated=await decideProposal(id,
          {status:"Approved",approverNote:bulkNote.trim()||null,approvedBy:account?.username??null},instance);
        setProposals((prev)=>prev.map((p)=>p.id===updated.id?updated:p)); ok++;
      } catch { fail++; }
    }
    setSelectedIds(new Set()); setShowBulkPanel(false); setBulkNote("");
    showToast(fail===0?`✓ ${ok} proposal${ok>1?"s":""} approved.`:`${ok} approved, ${fail} failed.`,fail===0);
    setBulkApproving(false);
  };

  const dealerSentBack    =(p:ProposalResponse)=>(p as any).dealerSentBack;
  const dealerSendBackNote=(p:ProposalResponse)=>(p as any).dealerSendBackNote;
  const calcBgAmt=(budget:number,add:number,share:number|null)=>
    Math.round((budget+add)*((share&&share>0?share:100)/100));

  // Live additional budget for an activity:
  // when Budget Addition panel is open → use what Mayank typed
  // otherwise → use the saved server value
  const liveAdd = (activityId: string, savedAdd: number): number =>
    showBudgetAddPanel ? num(budgetAddAmounts[activityId] ?? String(savedAdd)) : savedAdd;

  // Live totals for the footer/CAC banner that respond to Budget Addition panel
  const liveBudgetTotals = () => {
    const acts = selected?.activities ?? [];
    const tBudget = acts.reduce((s, a) => s + a.budget + liveAdd(a.id, a.additionalBudget), 0);
    const tBgauss = acts.reduce((s, a) =>
      s + calcBgAmt(a.budget, liveAdd(a.id, a.additionalBudget), a.bgaussShare), 0);
    const tRetail = selected?.totalRetailTarget ?? 0;
    const tLead   = selected?.totalLeadTarget   ?? 0;
    return {
      totalBudget:  tBudget,
      totalBgauss:  tBgauss,
      cac:          tRetail > 0 ? tBgauss / tRetail : 0,
      cpl:          tLead   > 0 ? tBgauss / tLead   : 0,
    };
  };

  const activityNameOptions=activityGroups.map((g)=>g.activityName);

  return (
    <div className="ap-page">
      <main className="ap-main">
        <div className="ap-page-header">
          <div>
            <h1 className="ap-page-title">{isAdmin?"Approver Portal":"My Proposals"}</h1>
            <p className="ap-page-sub">{isAdmin?"Review, edit, approve or reject RSM activity proposals.":"Track the status of your submitted proposals."}</p>
          </div>
          {!isAdmin&&<button className="ap-new-btn" onClick={()=>navigate("/rsm-form")}>+ New Proposal</button>}
        </div>
        {loading&&<div className="ap-loading"><div className="ap-spinner"/><p>Loading proposals…</p></div>}
        {!loading&&fetchError&&(<div className="ap-error-state"><p className="ap-error-msg">⚠ {fetchError}</p><button className="ap-retry-btn" onClick={loadProposals}>Retry</button></div>)}
        {!loading&&!fetchError&&(
          <>
            <div className={`ap-stats ap-stats--${isAdmin?"admin":"user"}`}>
              <StatCard label="Total" value={stats.total} color="navy" active={filterStatus==="All"} onClick={()=>setFilterStatus("All")}/>
              <StatCard label="Pending review" value={stats.pending} color="amber" active={filterStatus==="Pending"} onClick={()=>setFilterStatus("Pending")}/>
              <StatCard label="Approved" value={stats.approved} color="green" active={filterStatus==="Approved"} onClick={()=>setFilterStatus("Approved")}/>
              <StatCard label="Rejected" value={stats.rejected} color="red" active={filterStatus==="Rejected"} onClick={()=>setFilterStatus("Rejected")}/>
              {isAdmin?<StatCard label="Approved budget" value={inr(stats.totalBudget)} color="navy" active={filterStatus==="Approved"} onClick={()=>setFilterStatus("Approved")}/>
                :<StatCard label="Needs revision" value={stats.needsRevision} color="orange" active={filterStatus==="NeedsRevision"} onClick={()=>setFilterStatus("NeedsRevision")}/>}
            </div>
            <div className="ap-filters">
              <input className="ap-search" placeholder="Search dealer, RSM, location, token…" value={search} onChange={(e)=>setSearch(e.target.value)}/>
              <select className="ap-select" value={filterStatus} onChange={(e)=>setFilterStatus(e.target.value)}>
                {["All","Pending","Approved","Rejected","NeedsRevision"].map((s)=>(
                  <option key={s} value={s}>{s==="All"?"All statuses":s==="NeedsRevision"?"Needs revision":s}</option>
                ))}
              </select>
              <select className="ap-select" value={filterMonth} onChange={(e)=>setFilterMonth(e.target.value)}>
                {months.map((m)=><option key={m} value={m}>{m==="All"?"All months":m}</option>)}
              </select>
              <select className="ap-select" value={filterYear} onChange={(e)=>setFilterYear(e.target.value)}>
                {years.map((y)=><option key={y} value={y}>{y==="All"?"All years":y}</option>)}
              </select>
              <button className="ap-refresh-btn" onClick={loadProposals}>↻ Refresh</button>
            </div>
            {/* Bulk Forward — for Checker (Manager) who is not the final approver */}
            {isAdmin&&!isFinalApprover&&selectedIds.size>0&&(
              <div style={{ background:"#1e3a5f",borderRadius:10,padding:"12px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
                <span style={{ color:"#e2e8f0",fontSize:13,fontWeight:600 }}>{selectedIds.size} proposal{selectedIds.size>1?"s":""} selected</span>
                <button onClick={async()=>{
                  let ok=0,fail=0;
                  for(const id of Array.from(selectedIds)){
                    try{ await forwardProposalToApprover(id,instance); ok++; }catch{ fail++; }
                  }
                  setSelectedIds(new Set());
                  showToast(fail===0?`✓ ${ok} proposal${ok>1?"s":""} forwarded.`:`${ok} forwarded, ${fail} failed.`,fail===0);
                  loadProposals();
                }} style={{ background:"#fff",color:"#1e3a5f",border:"none",borderRadius:7,padding:"8px 20px",fontWeight:700,fontSize:13,cursor:"pointer" }}>
                  📤 Forward Selected to Final Approver
                </button>
                <button onClick={()=>setSelectedIds(new Set())} style={{ background:"rgba(255,255,255,0.1)",color:"#e2e8f0",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,padding:"8px 16px",fontSize:13,cursor:"pointer" }}>✕ Clear</button>
              </div>
            )}
            {isAdmin&&isFinalApprover&&selectedIds.size>0&&(
              <div style={{ background:"#0a2540",borderRadius:10,padding:"12px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
                <span style={{ color:"#e2e8f0",fontSize:13,fontWeight:600 }}>{selectedIds.size} proposal{selectedIds.size>1?"s":""} selected</span>
                {!showBulkPanel?(
                  <>
                    <button onClick={()=>setShowBulkPanel(true)} style={{ background:"#16a34a",color:"#fff",border:"none",borderRadius:7,padding:"8px 20px",fontWeight:700,fontSize:13,cursor:"pointer" }}>✓ Approve Selected</button>
                    <button onClick={()=>{setSelectedIds(new Set());setShowBulkPanel(false);}} style={{ background:"rgba(255,255,255,0.1)",color:"#e2e8f0",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,padding:"8px 16px",fontSize:13,cursor:"pointer" }}>✕ Clear</button>
                  </>
                ):(
                  <div style={{ display:"flex",gap:10,alignItems:"center",flex:1,flexWrap:"wrap" }}>
                    <input style={{ flex:1,minWidth:200,border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,padding:"7px 12px",fontSize:13,background:"rgba(255,255,255,0.1)",color:"#fff",outline:"none" }} placeholder="Approval note (optional)…" value={bulkNote} onChange={(e)=>setBulkNote(e.target.value)}/>
                    <button onClick={handleBulkApprove} disabled={bulkApproving} style={{ background:"#16a34a",color:"#fff",border:"none",borderRadius:7,padding:"8px 20px",fontWeight:700,fontSize:13,cursor:bulkApproving?"not-allowed":"pointer",opacity:bulkApproving?0.7:1 }}>{bulkApproving?`Approving ${selectedIds.size}…`:`✓ Confirm approve ${selectedIds.size}`}</button>
                    <button onClick={()=>setShowBulkPanel(false)} style={{ background:"transparent",color:"#94a3b8",border:"none",fontSize:13,cursor:"pointer" }}>Cancel</button>
                  </div>
                )}
              </div>
            )}
            <div className="ap-table-wrap">
              <table className="ap-table">
                <thead><tr>
                  {isAdmin&&(
                    <th style={{ width:44,textAlign:"center",padding:"8px 6px" }}>
                      <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
                        <input type="checkbox" checked={allPendingSelected}
                          ref={(el)=>{ if(el) el.indeterminate=!allPendingSelected&&somePendingSelected; }}
                          onChange={toggleSelectAll} style={{ width:15,height:15,cursor:"pointer" }}/>
                        {pendingFiltered.length>0&&<span style={{ fontSize:9,color:"#64748b",whiteSpace:"nowrap" }}>{pendingFiltered.length} pend.</span>}
                      </div>
                    </th>
                  )}
                  <th>Action</th><th>Token</th><th>Submitted</th>
                  {isAdmin&&<th>RSM / TSM</th>}
                  <th>Dealer &amp; location</th><th>Month</th><th>Year</th><th>Activities</th>
                  <th className="ap-num">Budget</th><th className="ap-num">Lead</th><th className="ap-num">Retail</th>
                  <th className="ap-num">CAC</th><th className="ap-num">CPL</th>
                  {isAdmin&&<th>Dealer Req.</th>}
                  <th>Status</th>
                </tr></thead>
                <tbody>
                  {filtered.length===0&&(<tr><td colSpan={isAdmin?16:12} className="ap-empty">{proposals.length===0?"No proposals yet.":"No results match."}</td></tr>)}
                  {filtered.map((p)=>{
                    const isPending=p.status==="Pending"; const isChecked=selectedIds.has(p.id);
                    return (
                      <tr key={p.id}
                        className={`ap-row${isChecked?" ap-row--selected":""}${p.status==="NeedsRevision"?" ap-row--revision":""}`}
                        style={p.status==="NeedsRevision"?{borderLeft:"4px solid #f59e0b",background:"#fffbeb"}:{}}
                        onClick={()=>openModal(p)}>
                        {isAdmin&&(
                          <td style={{ textAlign:"center",padding:"8px 6px" }} onClick={(e)=>e.stopPropagation()}>
                            {isPending?<input type="checkbox" checked={isChecked} onChange={()=>toggleOne(p.id,isPending)} style={{ width:15,height:15,cursor:"pointer",accentColor:"#16a34a" }}/>:<span style={{ color:"#e2e8f0",fontSize:11 }}>—</span>}
                          </td>
                        )}
                        <td onClick={(e)=>e.stopPropagation()}>
                          {!isAdmin && p.status==="NeedsRevision"
                            ? <button className="ap-review-btn" style={{background:"#f59e0b",color:"#fff",fontWeight:700}} onClick={()=>{ window.location.href=`/rsm-form?edit=${p.id}`; }}>✏ Edit</button>
                            : <button className="ap-review-btn" onClick={()=>openModal(p)}>{isAdmin?(isPending||p.status==="NeedsRevision"?"Review":"View"):"View"}</button>}
                        </td>
                        <td><span className="ap-id-chip">{p.tokenNumber??p.id.split("-").slice(-1)[0]}</span></td>
                        <td><span className="ap-cell-p">{fmtDate(p.createdAt)}</span>{isAdmin&&<span className="ap-cell-m">{p.submittedByDisplayName??p.submittedBy}</span>}</td>
                        {isAdmin&&<td><span className="ap-cell-p">{p.rsmName}</span><span className="ap-cell-m">{(p as any).tsmName||p.commandoName}</span></td>}
                        <td><span className="ap-cell-p">{p.dealerName}</span><span className="ap-cell-m">{p.location}, {p.state}</span></td>
                        <td>{p.month}</td><td>{p.year}</td>
                        <td>{p.activities.slice(0,2).map((a,i)=><span key={i} className="ap-act-chip">{a.activityType}</span>)}{p.activities.length>2&&<span className="ap-act-chip ap-act-chip--more">+{p.activities.length-2}</span>}</td>
                        <td className="ap-num ap-bold">{inr(p.totalBudget)}</td>
                        <td className="ap-num">{p.totalLeadTarget}</td>
                        <td className="ap-num">{p.totalRetailTarget}</td>
                        <td className="ap-num">{inr(p.cac)}</td>
                        <td className="ap-num">{inr(p.cpl)}</td>
                        {isAdmin&&<td>{dealerSentBack(p)?<span style={{ fontSize:11,color:"#92400e",background:"#fef9c3",padding:"2px 8px",borderRadius:10,fontWeight:600,cursor:"pointer" }} onClick={(e)=>{ e.stopPropagation(); openModal(p); }}>↩ View request</span>:<span style={{ color:"#cbd5e1",fontSize:11 }}>—</span>}</td>}
                        <td><span className={statusClass(p.status)}>{p.status==="NeedsRevision"?"Needs revision":p.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* Lightbox */}
      {mediaViewer&&<MediaViewer url={mediaViewer.url} name={mediaViewer.name} type={mediaViewer.type} onClose={()=>setMediaViewer(null)}/>}

      {/* ══════════ FULLSCREEN MODAL ══════════ */}
      {selected&&editData&&(
        <div style={{ position:"fixed",inset:0,zIndex:900,background:"#f1f5f9",display:"flex",flexDirection:"column",overflow:"hidden" }}>
          {/* Top bar */}
          <div style={{ background:"#0a2540",color:"#fff",padding:"0 24px",height:58,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 8px rgba(0,0,0,0.2)" }}>
            <div style={{ display:"flex",alignItems:"center",gap:14,minWidth:0 }}>
              <span style={{ fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,flexShrink:0,color:"#fff",
                background:selected.status==="Approved"?"#16a34a":selected.status==="Rejected"?"#dc2626":selected.status==="NeedsRevision"?"#f59e0b":"#64748b" }}>
                {selected.status==="NeedsRevision"?"Needs Revision":selected.status==="Pending"?"Pending Review":selected.status}
              </span>
              <div style={{ minWidth:0 }}>
                {isEditing?<input style={{ background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:6,padding:"4px 10px",fontSize:15,fontWeight:600,width:200 }} value={editData.dealerName} onChange={(e)=>setF("dealerName",e.target.value)}/>
                  :<span style={{ fontWeight:700,fontSize:16,color:"#fff" }}>{selected.dealerName}</span>}
                <span style={{ color:"#94a3b8",fontSize:12,marginLeft:12 }}>{selected.location}, {selected.state} · {selected.month}{selected.checkedByEmail&&<span style={{ marginLeft:8,color:"#86efac",fontSize:11 }}>✓ Forwarded</span>}</span>
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
              {isAdmin&&selected.status==="Pending"&&!isEditing&&<button onClick={()=>setIsEditing(true)} style={{ background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer",fontWeight:600 }}>✏ Edit</button>}
              {isEditing&&<button onClick={()=>{ setEditData(toEditable(selected)); setIsEditing(false); }} style={{ background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"#94a3b8",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer" }}>✕ Cancel edit</button>}
              <button onClick={closeModal} style={{ background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:7,padding:"6px 14px",fontSize:13,cursor:"pointer",fontWeight:600 }}>✕ Close</button>
            </div>
          </div>
          {isEditing&&<div style={{ background:"#1e40af",color:"#fff",padding:"8px 24px",fontSize:13,flexShrink:0 }}>✏ Edit mode — modify fields below, then save before deciding.</div>}
          {!isAdmin&&selected.status==="NeedsRevision"&&selected.approverNote&&(
            <div style={{ background:"#fef9c3",borderBottom:"1px solid #fde68a",flexShrink:0,padding:"10px 24px",fontSize:13,color:"#92400e" }}>
              <strong>Revision requested:</strong> {selected.approverNote}
              <button onClick={()=>navigate(`/rsm-form?edit=${selected.id}`)} style={{ marginLeft:14,background:"#92400e",color:"#fff",border:"none",borderRadius:6,padding:"4px 12px",fontSize:12,cursor:"pointer",fontWeight:600 }}>✏ Edit &amp; resubmit →</button>
            </div>
          )}
          {isAdmin&&dealerSentBack(selected)&&dealerSendBackNote(selected)&&(
            <div style={{ background:"#fef9c3",borderBottom:"1px solid #fde68a",flexShrink:0,padding:"10px 24px",fontSize:13,display:"flex",gap:12,alignItems:"flex-start" }}>
              <span style={{ fontSize:18 }}>↩</span>
              <div>
                <strong style={{ color:"#92400e" }}>Dealer Budget Add-On Request{(selected as any).dealerSentBackAt&&<span style={{ fontWeight:400,color:"#78350f",marginLeft:8,fontSize:11 }}>· {fmtDate((selected as any).dealerSentBackAt)}</span>}</strong>
                <p style={{ margin:"3px 0 0",color:"#78350f",fontSize:12,whiteSpace:"pre-wrap" }}>{dealerSendBackNote(selected)}</p>
                {selected.dealerEmail&&<p style={{ margin:"3px 0 0",fontSize:11,color:"#92400e" }}>Dealer: <a href={`mailto:${selected.dealerEmail}`} style={{ color:"#1e3a5f" }}>{selected.dealerEmail}</a></p>}
              </div>
            </div>
          )}

          {/* Scrollable body */}
          <div ref={scrollBodyRef} style={{ flex:1,overflowY:"auto",padding:"24px 24px 40px" }}>
            <div style={{ maxWidth:1280,margin:"0 auto" }}>

              {/* Meta cards */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10,marginBottom:20 }}>
                {([{key:"rsmName",label:"RSM Name",edit:"text"},{key:"tsmName",label:"TSM Name",edit:"text"},
                  {key:"commandoName",label:"Commando",edit:"text"},{key:"type",label:"Dealer Type",edit:"select",opts:LOC_TYPES},
                  {key:"eligibility",label:"Eligibility",edit:"select",opts:ELIGIBILITY},{key:"month",label:"Month",edit:"select",opts:MONTHS},
                  {key:"year",label:"Year",edit:"select",opts:YEARS},
                  {key:"dealerName",label:"Dealer Name",edit:"text"},{key:"location",label:"City",edit:"text"},{key:"state",label:"State",edit:"text"},
                ] as {key:string;label:string;edit:string;opts?:string[]}[]).map(({key,label,edit,opts})=>(
                  <div key={key} style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 12px" }}>
                    <div style={{ fontSize:10,color:"#6b7280",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4 }}>{label}</div>
                    {isAdmin&&isEditing&&key==="year"?(
                      // ── NEW: Year is locked in edit mode — it's fixed at
                      // submission time and shouldn't be changed by the Checker,
                      // since RSMForm already enforces year on the Maker side.
                      <div style={{ display:"flex",alignItems:"center",gap:8,background:"#f8fafc",
                        border:"1.5px solid #e2e8f0",borderRadius:6,padding:"6px 8px",fontSize:13,
                        color:"#0a2540",minHeight:30 }}>
                        <span style={{ flex:1 }}>{(editData as any)[key] || "—"}</span>
                        <span style={{ fontSize:11,color:"#9ca3af" }} title="Year is locked and cannot be changed here">🔒</span>
                      </div>
                    ):isAdmin&&isEditing?(
                      edit==="select"&&opts?<select style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 8px",fontSize:13,outline:"none",background:"#fff" }} value={(editData as any)[key]} onChange={(e)=>setF(key as any,e.target.value)}>{opts.map((o)=><option key={o} value={o}>{o}</option>)}</select>
                      :<input style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 8px",fontSize:13,outline:"none",boxSizing:"border-box" as const }} value={(editData as any)[key]} onChange={(e)=>setF(key as any,e.target.value)}/>
                    ):key==="eligibility"?<span className={`ap-elig ${eligClass((selected as any)[key])}`}>{(selected as any)[key]}</span>
                    :<div style={{ fontWeight:600,fontSize:13,color:"#0a2540",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{(selected as any)[key]||"—"}</div>}
                  </div>
                ))}
              </div>

              {/* RSM Remarks */}
              {(selected.remarks||(isAdmin&&isEditing))&&(
                <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderLeft:"3px solid #f59e0b",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13 }}>
                  <span style={{ fontWeight:600,color:"#92400e",fontSize:11,textTransform:"uppercase",letterSpacing:"0.04em",display:"block",marginBottom:4 }}>RSM Remarks</span>
                  {isAdmin&&isEditing?<textarea rows={2} style={{ width:"100%",border:"1px solid #fde68a",borderRadius:6,padding:"6px 8px",fontSize:13,resize:"vertical",background:"#fff",outline:"none",boxSizing:"border-box" as const }} value={editData.remarks} onChange={(e)=>setF("remarks",e.target.value)}/>
                  :<p style={{ margin:0,color:"#78350f" }}>{selected.remarks}</p>}
                </div>
              )}

              {/* Checker Notes */}
              {isAdmin&&isEditing&&(
                <div style={{ marginBottom:16,background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:8,padding:"12px 14px" }}>
                  <label style={{ fontSize:12,fontWeight:700,color:"#92400e",display:"block",marginBottom:6 }}>📝 Checker Notes (shown to Maker when saved)</label>
                  <textarea rows={2} placeholder="Describe what you changed and why…"
                    style={{ width:"100%",fontSize:13,border:"1px solid #fde68a",borderRadius:6,padding:"6px 8px",resize:"vertical",background:"#fff",boxSizing:"border-box" as const }}
                    value={editData.checkerRemarks}
                    onChange={(e)=>setEditData((prev)=>prev?{...prev,checkerRemarks:e.target.value}:prev)}/>
                </div>
              )}

              {/* Activities table */}
              <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",marginBottom:20 }}>
                <div style={{ background:"#0a2540",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <span style={{ color:"#fff",fontWeight:700,fontSize:14 }}>Activities ({selected.activities.length})</span>
                  {isAdmin&&isEditing&&<button onClick={addRow} style={{ background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontWeight:600 }}>+ Add row</button>}
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:isEditing?1400:960 }}>
                    <thead>
                      <tr style={{ background:"#f8fafc",borderBottom:"2px solid #e2e8f0" }}>
                        <th style={{ padding:"9px 10px",textAlign:"left",width:32,fontSize:11,fontWeight:700,color:"#374151" }}>#</th>
                        <th style={{ padding:"9px 10px",textAlign:"left",width:isEditing?170:160,fontSize:11,fontWeight:700,color:"#374151" }}>Activity Name</th>
                        <th style={{ padding:"9px 10px",textAlign:"left",width:90,fontSize:11,fontWeight:700,color:"#374151" }}>Type</th>
                        <th style={{ padding:"9px 10px",textAlign:"left",width:isEditing?155:145,fontSize:11,fontWeight:700,color:"#374151" }}>Subcategory</th>
                        <th style={{ padding:"9px 10px",textAlign:"center",width:60,fontSize:11,fontWeight:700,color:"#374151" }}>QTY</th>
                        <th style={{ padding:"9px 10px",textAlign:"right",width:68,fontSize:11,fontWeight:700,color:"#374151" }}>Lead</th>
                        <th style={{ padding:"9px 10px",textAlign:"center",width:72,fontSize:11,fontWeight:700,color:"#374151" }}>Sales%</th>
                        <th style={{ padding:"9px 10px",textAlign:"right",width:68,fontSize:11,fontWeight:700,color:"#374151" }}>Retail</th>
                        <th style={{ padding:"9px 10px",textAlign:"left",width:isEditing?250:170,fontSize:11,fontWeight:700,color:"#374151" }}>Dates</th>
                        <th style={{ padding:"9px 10px",textAlign:"right",width:105,fontSize:11,fontWeight:700,color:"#374151" }}>Budget (₹)</th>
                        <th style={{ padding:"9px 10px",textAlign:"right",width:100,fontSize:11,fontWeight:700,color:"#374151" }}>Add. Budget</th>
                        <th style={{ padding:"9px 10px",textAlign:"center",width:100,fontSize:11,fontWeight:700,color:"#374151" }}>BGauss%</th>
                        <th style={{ padding:"9px 10px",textAlign:"right",width:105,fontSize:11,fontWeight:700,color:"#1e40af" }}>BGauss Amt</th>
                        <th style={{ padding:"9px 10px",textAlign:"right",width:95,fontSize:11,fontWeight:700,color:"#374151" }}>Total (₹)</th>
                        {!isEditing&&selected.status==="Approved"&&<th style={{ padding:"9px 10px",textAlign:"center",width:120,fontSize:11,fontWeight:700,color:"#16a34a" }}>Post-Activity</th>}
                        {!isEditing&&selected.status!=="Approved"&&<th style={{ padding:"9px 10px",textAlign:"left",width:140,fontSize:11,fontWeight:700,color:"#374151" }}>Media</th>}
                        {isAdmin&&isEditing&&<th style={{ width:36 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(isEditing?editData.activities:selected.activities).map((a,i)=>
                        isAdmin&&isEditing?([
                          <tr key={`edit-${i}`} style={{ background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9",verticalAlign:"top" }}>
                            <td style={{ padding:"10px",color:"#6b7280",fontSize:11,paddingTop:14 }}>{i+1}</td>
                            <td style={{ padding:"8px" }}>
                              <input list={`al-${i}`} style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"6px 8px",fontSize:12,outline:"none",boxSizing:"border-box" as const }} value={(a as EditActivity).activityType} onChange={(e)=>handleEditActivityNameChange(i,e.target.value)} placeholder="Select activity name…"/>
                              <datalist id={`al-${i}`}>{activityNameOptions.map((n)=><option key={n} value={n}/>)}</datalist>
                            </td>
                            <td style={{ padding:"8px" }}>
                              {(a as EditActivity).categoryLocked?
                                <div style={{ display:"flex",alignItems:"center",gap:4,background:(a as EditActivity).category==="ATL"?"#eff6ff":"#f0fdf4",border:`1.5px solid ${(a as EditActivity).category==="ATL"?"#bfdbfe":"#bbf7d0"}`,borderRadius:6,padding:"5px 8px",height:32,fontSize:12,fontWeight:700,color:(a as EditActivity).category==="ATL"?"#1e40af":"#166534",minWidth:62,whiteSpace:"nowrap" }}><span>{(a as EditActivity).category}</span><span style={{ fontSize:10,color:"#9ca3af",marginLeft:"auto" }}>🔒</span></div>
                                :<select style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"6px 8px",fontSize:12,outline:"none",background:"#fff",width:84 }} value={(a as EditActivity).category} onChange={(e)=>setAF(i,"category",e.target.value)}><option value="">—</option><option value="ATL">ATL</option><option value="BTL">BTL</option></select>}
                            </td>
                            <td style={{ padding:"8px" }}>
                              {(()=>{ const grp=activityGroups.find(g=>g.activityName.toLowerCase()===(a as EditActivity).activityType.toLowerCase()); const subs=grp?.subcategories??[];
                                return subs.length>0?<select style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none",background:"#fff" }} value={(a as EditActivity).subcategory} onChange={(e)=>handleEditSubcategoryChange(i,(a as EditActivity).activityType,e.target.value)}><option value="">Select subcategory…</option>{subs.map((s)=><option key={s.subcategory} value={s.subcategory}>{s.subcategory}</option>)}</select>
                                :<input type="text" style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none",background:(a as EditActivity).activityType?"#fff":"#f9fafb" }} placeholder={(a as EditActivity).activityType?"Type subcategory…":"Select name first"} disabled={!(a as EditActivity).activityType} value={(a as EditActivity).subcategory} onChange={(e)=>setAF(i,"subcategory",e.target.value)}/>;
                              })()}
                            </td>
                            <td style={{ padding:"8px",textAlign:"center" }}>
                              {(()=>{ const grp=activityGroups.find(g=>g.activityName.toLowerCase()===(a as EditActivity).activityType.toLowerCase()); const sub=grp?.subcategories.find(s=>s.subcategory===(a as EditActivity).subcategory); const maxQty=sub?.maxQty??5;
                                return <select style={{ width:52,textAlign:"center",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 4px",fontSize:12,outline:"none",background:"#fff" }} value={(a as EditActivity).qty} onChange={(e)=>setAF(i,"qty",e.target.value)} disabled={!(a as EditActivity).subcategory&&(grp?.subcategories.length??0)>0}>{Array.from({length:maxQty},(_,k)=>String(k+1)).map(q=><option key={q} value={q}>{q}</option>)}</select>;
                              })()}
                            </td>
                            <td style={{ padding:"8px",textAlign:"right" }}><input type="number" min={0} style={{ width:58,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }} value={(a as EditActivity).leadTarget} onChange={(e)=>{ const lead=e.target.value; const pct=(a as EditActivity).salesPercent.trim(); const retail=pct&&parseFloat(pct)>0?String(Math.round(parseFloat(lead||"0")*parseFloat(pct)/100)):""; setEditData(d=>d?{...d,activities:d.activities.map((act,k)=>k===i?{...act,leadTarget:lead,retailTarget:retail||act.retailTarget,retailLocked:!!(retail)}:act)}:d); }}/></td>
                            <td style={{ padding:"8px",textAlign:"center" }}><input type="number" min={0} max={100} step="0.1" style={{ width:58,textAlign:"center",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 4px",fontSize:12,outline:"none" }} placeholder="e.g. 3" value={(a as EditActivity).salesPercent} onChange={(e)=>{ const pct=e.target.value; const lead=(a as EditActivity).leadTarget; const retail=pct&&parseFloat(pct)>0&&lead?String(Math.round(parseFloat(lead)*parseFloat(pct)/100)):""; setEditData(d=>d?{...d,activities:d.activities.map((act,k)=>k===i?{...act,salesPercent:pct,retailTarget:retail||act.retailTarget,retailLocked:!!(retail)}:act)}:d); }}/></td>
                            <td style={{ padding:"8px",textAlign:"right" }}>{(a as EditActivity).retailLocked?<div title="Auto-calculated" style={{ display:"flex",alignItems:"center",gap:4,background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:6,padding:"4px 6px",fontSize:12,fontWeight:600,color:"#1e40af",width:58,height:30,justifyContent:"space-between" }}><span>{(a as EditActivity).retailTarget||"0"}</span><span style={{ fontSize:9,color:"#93c5fd" }}>🔒</span></div>:<input type="number" min={0} style={{ width:58,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }} value={(a as EditActivity).retailTarget} onChange={(e)=>setAF(i,"retailTarget",e.target.value)}/>}</td>
                            <td style={{ padding:"8px" }}>
                              <div style={{ display:"flex",gap:4,alignItems:"center" }}>
                                <input type="date" lang="en-GB"
                                  style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",width:118 }}
                                  value={(a as EditActivity).startDate}
                                  min={editActivityDateRange.min}
                                  max={editActivityDateRange.max || undefined}
                                  onChange={(e)=>setAF(i,"startDate",e.target.value)}/>
                                <span style={{ color:"#6b7280" }}>→</span>
                                <input type="date" lang="en-GB"
                                  style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",width:118 }}
                                  value={(a as EditActivity).endDate}
                                  min={(a as EditActivity).startDate || editActivityDateRange.min}
                                  max={editActivityDateRange.max || undefined}
                                  onChange={(e)=>setAF(i,"endDate",e.target.value)}/>
                              </div>
                              {editActivityDateRange.max && (
                                <div style={{ fontSize:9,color:"#9ca3af",marginTop:2 }}>
                                  Must fall within {editData.month} {editData.year}
                                </div>
                              )}
                            </td>
                            <td style={{ padding:"8px",textAlign:"right" }}><input type="number" min={0} style={{ width:90,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }} value={(a as EditActivity).budget} onChange={(e)=>setAF(i,"budget",e.target.value)}/></td>
                            <td style={{ padding:"8px",textAlign:"right" }}><input type="number" min={0} style={{ width:88,textAlign:"right",border:"1px solid #d1d5db",borderRadius:6,padding:"5px 6px",fontSize:12,outline:"none" }} value={(a as EditActivity).additionalBudget} onChange={(e)=>setAF(i,"additionalBudget",e.target.value)}/></td>
                            <td style={{ padding:"8px",textAlign:"center" }}><select style={{ border:"1px solid #d1d5db",borderRadius:6,padding:"5px 8px",fontSize:12,outline:"none",background:"#fff",width:80 }} value={(a as EditActivity).bgaussShare} onChange={(e)=>setAF(i,"bgaussShare",e.target.value)}>{BGAUSS_OPTS.map(o=><option key={o} value={o}>{o}%</option>)}</select></td>
                            <td style={{ padding:"8px",textAlign:"right" }}><div style={{ fontSize:12,fontWeight:600,color:"#1e40af",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,padding:"5px 8px",whiteSpace:"nowrap" }}>{inr(Math.round((num((a as EditActivity).budget)+num((a as EditActivity).additionalBudget))*(num((a as EditActivity).bgaussShare||"100")/100)))}</div></td>
                            <td style={{ padding:"8px",textAlign:"right",fontWeight:700,color:"#0a2540",paddingTop:14 }}>{inr(num((a as EditActivity).budget)+num((a as EditActivity).additionalBudget))}</td>
                            <td style={{ padding:"8px",textAlign:"center",paddingTop:14 }}><button onClick={()=>removeRow(i)} disabled={editData.activities.length===1} style={{ background:"#fee2e2",border:"none",color:"#991b1b",width:24,height:24,borderRadius:"50%",cursor:"pointer",fontWeight:700,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto" }}>×</button></td>
                          </tr>,
                          <tr key={`media-${i}`} style={{ background:i%2===0?"#fff":"#f8fafc",borderBottom:"2px solid #f1f5f9" }}>
                            <td></td>
                            <td colSpan={12} style={{ padding:"0 8px 10px" }}>
                              <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                                <label style={{ display:"inline-flex",alignItems:"center",gap:5,background:"#f1f5f9",border:"1px dashed #cbd5e1",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11,color:"#1e3a5f",fontWeight:600,whiteSpace:"nowrap" }}>
                                  {uploadingMedia[(a as EditActivity).id??String(i)]?"⏳ Uploading…":`📎 Upload files${(a as EditActivity).mediaFiles.length>0?` (${(a as EditActivity).mediaFiles.length} attached)`:""}`}
                                  <input type="file" multiple accept="image/*,application/pdf,video/*" style={{ display:"none" }} disabled={!!uploadingMedia[(a as EditActivity).id??String(i)]} onChange={(e)=>{ if(e.target.files) handleEditMediaUpload(i,e.target.files); e.target.value=""; }}/>
                                </label>
                                {(a as EditActivity).mediaFiles.map((m)=>{ const fu=resolveUrl(m.fileUrl); return (
                                  <div key={m.id} style={{ display:"flex",alignItems:"center",gap:4,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:5,padding:"2px 6px",fontSize:11,maxWidth:160 }}>
                                    {isImage(m.fileType)?<a href={fu} target="_blank" rel="noopener noreferrer"><img src={fu} alt={m.fileName} style={{ width:22,height:22,objectFit:"cover",borderRadius:3 }}/></a>:<a href={fu} target="_blank" rel="noopener noreferrer" style={{ fontSize:16 }}>{mediaIcon(m.fileType)}</a>}
                                    <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:90,color:"#374151",fontSize:10 }}>{m.fileName}</span>
                                    <button type="button" onClick={()=>removeEditMedia(i,m.id)} style={{ background:"none",border:"none",color:"#9ca3af",cursor:"pointer",fontSize:13,padding:"0 2px",flexShrink:0 }}>×</button>
                                  </div>
                                );})}
                              </div>
                            </td>
                            <td></td>
                          </tr>
                        ]):(
                          <tr key={`view-${i}`} style={{ background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9" }}>
                            <td style={{ padding:"8px 10px",color:"#6b7280",fontSize:11 }}>{i+1}</td>
                            <td style={{ padding:"8px 10px",fontWeight:600,color:"#0a2540" }}>{(a as ActivityResponse).activityType}</td>
                            <td style={{ padding:"8px 10px" }}>{(a as ActivityResponse).category?<span style={{ fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:4,background:(a as ActivityResponse).category==="ATL"?"#eff6ff":"#f0fdf4",color:(a as ActivityResponse).category==="ATL"?"#1e40af":"#166534",border:`1px solid ${(a as ActivityResponse).category==="ATL"?"#bfdbfe":"#bbf7d0"}` }}>{(a as ActivityResponse).category}</span>:<span style={{ color:"#cbd5e1" }}>—</span>}</td>
                            <td style={{ padding:"8px 10px",fontSize:12,color:"#374151" }}>{(a as any).subcategory||<span style={{ color:"#cbd5e1" }}>—</span>}</td>
                            <td style={{ padding:"8px 10px",textAlign:"center",fontSize:12,fontWeight:600 }}>{(a as any).qty??1}</td>
                            <td style={{ padding:"8px 10px",textAlign:"right" }}>{(a as ActivityResponse).leadTarget}</td>
                            <td style={{ padding:"8px 10px",textAlign:"center",fontSize:12 }}>{(a as any).salesPercent?`${(a as any).salesPercent}%`:<span style={{ color:"#cbd5e1" }}>—</span>}</td>
                            <td style={{ padding:"8px 10px",textAlign:"right" }}>{(a as ActivityResponse).retailTarget}</td>
                            <td style={{ padding:"8px 10px",color:"#475569",fontSize:12 }}>{fmtDate((a as ActivityResponse).startDate)} → {fmtDate((a as ActivityResponse).endDate)}</td>
                            <td style={{ padding:"8px 10px",textAlign:"right" }}>{inr((a as ActivityResponse).budget)}</td>
                            <td style={{ padding:"8px 10px",textAlign:"right",color:showBudgetAddPanel?"#f59e0b":"#6b7280",fontWeight:showBudgetAddPanel?700:400 }}>
                              {(()=>{
                                const lv=liveAdd((a as ActivityResponse).id,(a as ActivityResponse).additionalBudget);
                                const saved=(a as ActivityResponse).additionalBudget;
                                return (
                                  <>
                                    {inr(lv)}
                                    {showBudgetAddPanel&&lv!==saved&&(
                                      <div style={{ fontSize:9,color:"#9ca3af",fontWeight:400 }}>(was {inr(saved)})</div>
                                    )}
                                  </>
                                );
                              })()}
                            </td>
                            <td style={{ padding:"8px 10px",textAlign:"center" }}><span style={{ fontSize:11,fontWeight:600,background:"#eff6ff",color:"#1e40af",padding:"2px 8px",borderRadius:4 }}>{(a as ActivityResponse).bgaussShare>0?`${(a as ActivityResponse).bgaussShare}%`:"100%"}</span></td>
                            <td style={{ padding:"8px 10px",textAlign:"right",color:"#1e40af",fontWeight:600,fontSize:12 }}>
                              {inr(calcBgAmt((a as ActivityResponse).budget,liveAdd((a as ActivityResponse).id,(a as ActivityResponse).additionalBudget),(a as ActivityResponse).bgaussShare))}
                            </td>
                            <td style={{ padding:"8px 10px",textAlign:"right",fontWeight:700,color:"#0a2540" }}>
                              {inr((a as ActivityResponse).budget+liveAdd((a as ActivityResponse).id,(a as ActivityResponse).additionalBudget))}
                            </td>
                            {selected.status==="Approved"?<td style={{ padding:"8px 10px",textAlign:"center" }}><button onClick={()=>toggleActuals((a as ActivityResponse).id)} style={{ background:openActualsId===(a as ActivityResponse).id?"#0a2540":"#16a34a",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4,margin:"0 auto" }}>📋 {openActualsId===(a as ActivityResponse).id?"Close ▲":"Post-Activity ▼"}</button></td>
                            :<td style={{ padding:"8px 10px" }}><ActivityMediaStrip activity={a as ActivityResponse}/></td>}
                          </tr>
                        )
                      )}

                      {/* ══ POST-ACTIVITY ACCORDION v2 ══ */}
                      {!isEditing&&selected.status==="Approved"&&selected.activities.map((a)=>{
                        const d=actualsData[a.id];
                        if (openActualsId!==a.id||!d) return null;
                        const pctColor=(actual:number,planned:number)=>{ if(!actual) return ""; const r=planned>0?actual/planned:1; return r>=0.9?"#d1fae5":r>=0.6?"#fef3c7":"#fee2e2"; };
                        return (
                          <tr key={`actuals-${a.id}`}>
                            <td colSpan={14} style={{ padding:0,background:"#f0fdf4",borderBottom:"2px solid #bbf7d0" }}>
                              <div style={{ padding:"14px 20px" }}>
                                {/* Header row */}
                                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap" }}>
                                  <span style={{ background:"#16a34a",color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700 }}>📋 Post-Activity</span>
                                  <span style={{ fontWeight:700,fontSize:14,color:"#0a2540" }}>{a.activityType}</span>
                                  {a.category&&<span style={{ fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:3,background:a.category==="ATL"?"#eff6ff":"#dcfce7",color:a.category==="ATL"?"#1e40af":"#166534" }}>{a.category}</span>}
                                  <span style={{ fontSize:11,color:"#6b7280",marginLeft:"auto" }}>Planned: {fmtDate(a.startDate)} → {fmtDate(a.endDate)}</span>
                                </div>

                                {/* ── Actual Dates + compact action bar in one row ── */}
                                <div style={{ display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12,background:"#ecfdf5",borderRadius:8,padding:"10px 12px",border:"1px solid #bbf7d0" }}>
                                  <div>
                                    <label style={{ fontSize:10,fontWeight:700,color:"#374151",textTransform:"uppercase",letterSpacing:"0.04em",display:"block",marginBottom:4 }}>Actual Start</label>
                                    <input type="date" value={d.actualStartDate} onChange={(e)=>{ setActualField(a.id,"actualStartDate",e.target.value); rebuildDailyEntries(a.id,e.target.value,d.actualEndDate); }} style={{ border:"1px solid #bbf7d0",borderRadius:6,padding:"6px 9px",fontSize:12,outline:"none",background:"#fff" }}/>
                                  </div>
                                  <div>
                                    <label style={{ fontSize:10,fontWeight:700,color:"#374151",textTransform:"uppercase",letterSpacing:"0.04em",display:"block",marginBottom:4 }}>Actual End</label>
                                    <input type="date" value={d.actualEndDate} min={d.actualStartDate||undefined} onChange={(e)=>{ setActualField(a.id,"actualEndDate",e.target.value); rebuildDailyEntries(a.id,d.actualStartDate,e.target.value); }} style={{ border:"1px solid #bbf7d0",borderRadius:6,padding:"6px 9px",fontSize:12,outline:"none",background:"#fff" }}/>
                                  </div>
                                  {(a.actualStartDate||a.actualEndDate)&&(
                                    <div style={{ fontSize:11,color:"#166534",fontWeight:600 }}>✓ {fmtDate(a.actualStartDate)} → {fmtDate(a.actualEndDate)}</div>
                                  )}

                                  {/* ── Toggle buttons ── */}
                                  <div style={{ display:"flex",gap:7,marginLeft:"auto",flexWrap:"wrap",alignItems:"center" }}>
                                    <button onClick={()=>toggleActualsPanel(a.id,"photos")}
                                      style={{ display:"flex",alignItems:"center",gap:5,
                                        background:openActualsPanel[a.id]==="photos"?"#16a34a":"#fff",
                                        color:openActualsPanel[a.id]==="photos"?"#fff":"#166534",
                                        border:"1.5px solid #16a34a",borderRadius:7,
                                        padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap" }}>
                                      📸 Photos{d.proofMedia.length>0&&<span style={{ background:"rgba(0,0,0,0.15)",borderRadius:10,padding:"0px 6px",fontSize:10,fontWeight:800,marginLeft:2 }}>{d.proofMedia.length}</span>}
                                      <span style={{ fontSize:9,opacity:0.7 }}>{openActualsPanel[a.id]==="photos"?"▲":"▼"}</span>
                                    </button>
                                    <button onClick={()=>toggleActualsPanel(a.id,"invoices")}
                                      style={{ display:"flex",alignItems:"center",gap:5,
                                        background:openActualsPanel[a.id]==="invoices"?"#1e3a5f":"#fff",
                                        color:openActualsPanel[a.id]==="invoices"?"#fff":"#374151",
                                        border:"1.5px solid #e2e8f0",borderRadius:7,
                                        padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap" }}>
                                      🧾 Invoices{d.invoiceMedia.length>0&&<span style={{ background:"rgba(0,0,0,0.15)",borderRadius:10,padding:"0px 6px",fontSize:10,fontWeight:800,marginLeft:2 }}>{d.invoiceMedia.length}</span>}
                                      <span style={{ fontSize:9,opacity:0.7 }}>{openActualsPanel[a.id]==="invoices"?"▲":"▼"}</span>
                                    </button>
                                    <button onClick={()=>{ if(d.actualStartDate&&d.actualEndDate) toggleActualsPanel(a.id,"history"); }}
                                      disabled={!d.actualStartDate||!d.actualEndDate}
                                      title={!d.actualStartDate||!d.actualEndDate?"Select actual start & end dates first":"View date-wise history"}
                                      style={{ display:"flex",alignItems:"center",gap:5,
                                        background:openActualsPanel[a.id]==="history"?"#0a2540":"#fff",
                                        color:openActualsPanel[a.id]==="history"?"#fff":(!d.actualStartDate||!d.actualEndDate)?"#cbd5e1":"#374151",
                                        border:`1.5px solid ${(!d.actualStartDate||!d.actualEndDate)?"#e2e8f0":"#0a2540"}`,
                                        borderRadius:7,padding:"5px 12px",fontSize:12,fontWeight:700,
                                        cursor:(!d.actualStartDate||!d.actualEndDate)?"not-allowed":"pointer",
                                        opacity:(!d.actualStartDate||!d.actualEndDate)?0.45:1,whiteSpace:"nowrap" }}>
                                      📊 History{d.dailyEntries.length>0&&<span style={{ background:"rgba(0,0,0,0.15)",borderRadius:10,padding:"0px 6px",fontSize:10,fontWeight:800,marginLeft:2 }}>{d.dailyEntries.length}d</span>}
                                      <span style={{ fontSize:9,opacity:0.7 }}>{openActualsPanel[a.id]==="history"?"▲":"▼"}</span>
                                    </button>
                                    <div style={{ width:"1px",height:24,background:"#d1d5db",margin:"0 2px" }}/>
                                    <button onClick={saveActuals} disabled={actualsLoading}
                                      style={{ background:"#16a34a",color:"#fff",border:"none",
                                        padding:"5px 16px",borderRadius:7,fontWeight:700,
                                        fontSize:12,cursor:actualsLoading?"not-allowed":"pointer",
                                        opacity:actualsLoading?0.7:1,whiteSpace:"nowrap" }}>
                                      {actualsLoading?"Saving…":"💾 Save"}
                                    </button>
                                    <button onClick={()=>{ setOpenActualsId(null); setOpenActualsPanel(prev=>({...prev,[a.id]:undefined as any})); }}
                                      style={{ background:"#f1f5f9",color:"#374151",border:"1px solid #e2e8f0",
                                        padding:"5px 10px",borderRadius:7,fontSize:12,cursor:"pointer" }}>✕</button>
                                  </div>
                                </div>

                                {/* ══ PHOTOS PANEL ══ */}
                                {openActualsPanel[a.id]==="photos"&&(
                                  <div style={{ background:"#fff",border:"1px solid #bbf7d0",borderRadius:9,padding:"12px 14px",marginBottom:10 }}>
                                    <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap" }}>
                                      <span style={{ fontSize:13,fontWeight:700,color:"#0a2540" }}>📸 Activity Proof / Photos</span>
                                      <span style={{ fontSize:11,color:"#6b7280" }}>GPS + timestamp auto-captured</span>
                                      <label style={{ marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:6,
                                        background:d.proofUploading?"#f1f5f9":"#16a34a",
                                        color:d.proofUploading?"#6b7280":"#fff",
                                        border:d.proofUploading?"1px dashed #d1d5db":"none",
                                        borderRadius:7,padding:"5px 13px",cursor:d.proofUploading?"not-allowed":"pointer",
                                        fontSize:12,fontWeight:700,whiteSpace:"nowrap" }}>
                                        {d.proofUploading?"⏳ Uploading…":"＋ Add Photos"}
                                        <input type="file" multiple accept="image/*,video/*,.pdf" style={{ display:"none" }} disabled={d.proofUploading} onChange={(e)=>{
                                          console.log("[PROOF-INPUT] onChange fired, files:", e.target.files?.length ?? 0, "activityId:", a.id);
                                          if(e.target.files&&e.target.files.length) handleProofUpload(a.id,e.target.files);
                                          e.target.value="";
                                        }}/>
                                      </label>
                                    </div>
                                    {d.proofMedia.length===0?(
                                      <div style={{ border:"2px dashed #bbf7d0",borderRadius:8,padding:"18px",textAlign:"center",color:"#6b7280",fontSize:12 }}>
                                        <div style={{ fontSize:26,marginBottom:4 }}>📷</div>No photos uploaded yet.
                                      </div>
                                    ):(
                                      <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                                        {d.proofMedia.map((m,pi)=>{
                                          const url=m.fileUrl.startsWith("http")?m.fileUrl:`${API_BASE}${m.fileUrl}`;
                                          const uploadTime=new Date(m.capturedAt).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true});
                                          return (
                                            <div key={m.id} style={{ display:"flex",alignItems:"center",gap:8,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:7,padding:"6px 10px" }}>
                                              <div style={{ width:38,height:38,flexShrink:0,borderRadius:5,overflow:"hidden",background:"#dcfce7",border:"1px solid #bbf7d0",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }} onClick={()=>setMediaViewer({url,name:m.fileName,type:m.fileType})}>
                                                {isImage(m.fileType)?<img src={url} alt={m.fileName} style={{ width:"100%",height:"100%",objectFit:"cover" }}/>:isVideo(m.fileType)?<video src={url} muted style={{ width:"100%",height:"100%",objectFit:"cover" }}/>:<span style={{ fontSize:20 }}>{mediaIcon(m.fileType)}</span>}
                                              </div>
                                              <div style={{ flex:1,minWidth:0 }}>
                                                <div style={{ fontSize:11,fontWeight:600,color:"#0a2540",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>#{pi+1} · {m.fileName}</div>
                                                <div style={{ fontSize:10,color:"#6b7280",marginTop:1 }}>🕐 {uploadTime}{m.latitude!=null&&m.longitude!=null&&<a href={mapsUrl(m.latitude!,m.longitude!)} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} style={{ marginLeft:8,color:"#16a34a",textDecoration:"none",fontWeight:600,fontSize:10 }}>📍 GPS</a>}{(m.latitude==null||m.longitude==null)&&<span style={{ marginLeft:8,color:"#9ca3af",fontSize:10 }}>No GPS</span>}</div>
                                              </div>
                                              <div style={{ display:"flex",gap:5,flexShrink:0 }}>
                                                <button type="button" onClick={()=>setMediaViewer({url,name:m.fileName,type:m.fileType})} style={{ background:"#eff6ff",border:"1px solid #bfdbfe",color:"#1e40af",borderRadius:5,padding:"3px 7px",fontSize:10,fontWeight:600,cursor:"pointer" }}>View</button>
                                                <button type="button" onClick={()=>removeProof(a.id,m.id)} style={{ background:"#fee2e2",border:"none",color:"#991b1b",borderRadius:5,padding:"3px 7px",fontSize:10,fontWeight:600,cursor:"pointer" }}>✕</button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* ══ INVOICES PANEL ══ */}
                                {openActualsPanel[a.id]==="invoices"&&(
                                  <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:9,padding:"12px 14px",marginBottom:10 }}>
                                    <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap" }}>
                                      <span style={{ fontSize:13,fontWeight:700,color:"#0a2540" }}>🧾 Invoice / Bill Upload</span>
                                      <span style={{ fontSize:11,color:"#6b7280" }}>PDF / image · multiple files supported</span>
                                      <label style={{ marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:6,
                                        background:d.invoiceUploading?"#f1f5f9":"#1e3a5f",
                                        color:d.invoiceUploading?"#6b7280":"#fff",
                                        border:d.invoiceUploading?"1px dashed #d1d5db":"none",
                                        borderRadius:7,padding:"5px 13px",cursor:d.invoiceUploading?"not-allowed":"pointer",
                                        fontSize:12,fontWeight:700,whiteSpace:"nowrap" }}>
                                        {d.invoiceUploading?"⏳ Uploading…":"＋ Add Invoice"}
                                        <input type="file" multiple accept="application/pdf,image/*" style={{ display:"none" }} disabled={d.invoiceUploading} onChange={(e)=>{ if(e.target.files&&e.target.files.length) handleInvoiceUpload(a.id,e.target.files); e.target.value=""; }}/>
                                      </label>
                                    </div>
                                    {d.invoiceMedia.length===0?(
                                      <div style={{ border:"2px dashed #e2e8f0",borderRadius:8,padding:"18px",textAlign:"center",color:"#9ca3af",fontSize:12 }}>
                                        <div style={{ fontSize:22,marginBottom:4 }}>🧾</div>No invoices uploaded yet.
                                      </div>
                                    ):(
                                      <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                                        {d.invoiceMedia.map((inv,ii)=>{
                                          const url=inv.fileUrl.startsWith("http")?inv.fileUrl:`${API_BASE}${inv.fileUrl}`;
                                          const icon=inv.fileType?.includes("pdf")?"📄":inv.fileType?.startsWith("image/")?"🖼":"📎";
                                          return (
                                            <div key={inv.id} style={{ display:"flex",alignItems:"center",gap:8,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:7,padding:"6px 10px" }}>
                                              <span style={{ fontSize:18,flexShrink:0 }}>{icon}</span>
                                              <div style={{ flex:1,minWidth:0 }}>
                                                <div style={{ fontSize:11,fontWeight:600,color:"#0a2540",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>#{ii+1} · {inv.fileName}</div>
                                                <div style={{ fontSize:10,color:"#6b7280",marginTop:1 }}>{new Date(inv.capturedAt).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true})}</div>
                                              </div>
                                              <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize:11,color:"#2563eb",fontWeight:600,textDecoration:"none",flexShrink:0 }}>View ↗</a>
                                              <button type="button" onClick={()=>removeInvoice(a.id,inv.id)} style={{ background:"#fee2e2",border:"none",color:"#991b1b",borderRadius:5,padding:"3px 7px",fontSize:10,fontWeight:600,cursor:"pointer",flexShrink:0 }}>✕</button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* ══ HISTORY PANEL — only when both dates selected ══ */}
                                {openActualsPanel[a.id]==="history"&&d.actualStartDate&&d.actualEndDate&&(
                                  <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:9,overflow:"hidden",marginBottom:10 }}>
                                    <div style={{ background:"#0a2540",padding:"9px 14px",display:"flex",alignItems:"center",gap:10 }}>
                                      <span style={{ color:"#fff",fontWeight:700,fontSize:13 }}>📊 Daily Activity History</span>
                                      <span style={{ color:"#94a3b8",fontSize:11 }}>{fmtDate(d.actualStartDate)} → {fmtDate(d.actualEndDate)}</span>
                                      {d.dailyEntries.length>0&&<span style={{ marginLeft:"auto",fontSize:11,color:"#86efac",fontWeight:600 }}>{d.dailyEntries.length} day{d.dailyEntries.length!==1?"s":""}</span>}
                                    </div>
                                    {d.dailyEntries.length===0?(
                                      <div style={{ padding:"24px",textAlign:"center",color:"#9ca3af",fontSize:13 }}>No entries yet for this date range.</div>
                                    ):(
                                      <div style={{ overflowX:"auto" }}>
                                        <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:660 }}>
                                          <thead>
                                            <tr style={{ background:"#1e293b" }}>
                                              <th style={{ padding:"8px 10px",textAlign:"left",color:"#e2e8f0",fontSize:10,fontWeight:700,width:95 }}>Date</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#93c5fd",fontSize:10,fontWeight:700 }}>Enquiry<br/>Plan</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#6ee7b7",fontSize:10,fontWeight:700 }}>Enquiry<br/>Actual</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#93c5fd",fontSize:10,fontWeight:700 }}>Test Drive<br/>Plan</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#6ee7b7",fontSize:10,fontWeight:700 }}>Test Drive<br/>Actual</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#c4b5fd",fontSize:10,fontWeight:700 }}>Booking</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#fbbf24",fontSize:10,fontWeight:700 }}>Retail</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#a5b4fc",fontSize:10,fontWeight:700 }}>LMS Leads<br/>Punched</th>
                                              <th style={{ padding:"8px 8px",textAlign:"center",color:"#e2e8f0",fontSize:10,fontWeight:700 }}>Media</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {d.dailyEntries.map((entry,ei)=>{
                                              const pctC=(actual:number,planned:number)=>{ if(!actual) return ""; const r=planned>0?actual/planned:1; return r>=0.9?"#d1fae5":r>=0.6?"#fef3c7":"#fee2e2"; };
                                              const entryDate=entry.date;
                                              const photosOnDay=d.proofMedia.filter(m=>m.capturedAt.startsWith(entryDate));
                                              const invoicesOnDay=d.invoiceMedia.filter(m=>m.capturedAt.startsWith(entryDate));
                                              const hasAnyData=entry.enquiryActual>0||entry.testDriveActual>0||entry.bookingActual>0||entry.retailActual>0||entry.leadsPunched>0||photosOnDay.length>0||invoicesOnDay.length>0;
                                              return (
                                                <tr key={entry.date} style={{ background:ei%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9",opacity:hasAnyData?1:0.5 }}>
                                                  <td style={{ padding:"5px 10px",fontWeight:600,color:"#374151",whiteSpace:"nowrap",fontSize:11 }}>{entry.date}</td>
                                                  <td style={{ padding:"4px 5px",textAlign:"center" }}>
                                                    <input type="number" min={0} style={{ width:48,textAlign:"center",border:"1px solid #e2e8f0",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:"#f8fafc" }} value={entry.enquiryPlanned||""} placeholder="0" onChange={(e)=>setDailyField(a.id,entry.date,"enquiryPlanned",parseInt(e.target.value)||0)}/>
                                                  </td>
                                                  <td style={{ padding:"4px 5px",textAlign:"center" }}>
                                                    <input type="number" min={0} style={{ width:48,textAlign:"center",border:"1px solid #bbf7d0",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:pctC(entry.enquiryActual,entry.enquiryPlanned)||"#fff",fontWeight:entry.enquiryActual>0?700:400 }} value={entry.enquiryActual||""} placeholder="0" onChange={(e)=>setDailyField(a.id,entry.date,"enquiryActual",parseInt(e.target.value)||0)}/>
                                                  </td>
                                                  <td style={{ padding:"4px 5px",textAlign:"center" }}>
                                                    <input type="number" min={0} style={{ width:48,textAlign:"center",border:"1px solid #e2e8f0",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:"#f8fafc" }} value={entry.testDrivePlanned||""} placeholder="0" onChange={(e)=>setDailyField(a.id,entry.date,"testDrivePlanned",parseInt(e.target.value)||0)}/>
                                                  </td>
                                                  <td style={{ padding:"4px 5px",textAlign:"center" }}>
                                                    <input type="number" min={0} style={{ width:48,textAlign:"center",border:"1px solid #bbf7d0",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:pctC(entry.testDriveActual,entry.testDrivePlanned)||"#fff",fontWeight:entry.testDriveActual>0?700:400 }} value={entry.testDriveActual||""} placeholder="0" onChange={(e)=>setDailyField(a.id,entry.date,"testDriveActual",parseInt(e.target.value)||0)}/>
                                                  </td>
                                                  <td style={{ padding:"4px 5px",textAlign:"center" }}>
                                                    <input type="number" min={0} style={{ width:48,textAlign:"center",border:"1px solid #e9d5ff",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:entry.bookingActual>0?"#fdf4ff":"#fff",fontWeight:entry.bookingActual>0?700:400,color:entry.bookingActual>0?"#7c3aed":"inherit" }} value={entry.bookingActual||""} placeholder="0" onChange={(e)=>setDailyField(a.id,entry.date,"bookingActual",parseInt(e.target.value)||0)}/>
                                                  </td>
                                                  <td style={{ padding:"4px 5px",textAlign:"center" }}>
                                                    <input type="number" min={0} style={{ width:48,textAlign:"center",border:"1px solid #fde68a",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:entry.retailActual>0?"#fef9c3":"#fff",fontWeight:entry.retailActual>0?700:400,color:entry.retailActual>0?"#92400e":"inherit" }} value={entry.retailActual||""} placeholder="0" onChange={(e)=>setDailyField(a.id,entry.date,"retailActual",parseInt(e.target.value)||0)}/>
                                                  </td>
                                                  <td style={{ padding:"4px 5px",textAlign:"center" }}>
                                                    <input type="number" min={0} style={{ width:48,textAlign:"center",border:"1px solid #c7d2fe",borderRadius:4,padding:"3px",fontSize:11,outline:"none",background:entry.leadsPunched>0?"#eef2ff":"#fff",fontWeight:entry.leadsPunched>0?700:400,color:entry.leadsPunched>0?"#4338ca":"inherit" }} value={entry.leadsPunched||""} placeholder="0" onChange={(e)=>setDailyField(a.id,entry.date,"leadsPunched",parseInt(e.target.value)||0)}/>
                                                  </td>
                                                  {/* Media thumbnails for this date */}
                                                  <td style={{ padding:"4px 8px",textAlign:"center" }}>
                                                    <div style={{ display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center",alignItems:"center" }}>
                                                      {photosOnDay.slice(0,2).map(m=>{
                                                        const url=m.fileUrl.startsWith("http")?m.fileUrl:`${API_BASE}${m.fileUrl}`;
                                                        return (
                                                          <div key={m.id} style={{ width:26,height:26,borderRadius:3,overflow:"hidden",cursor:"pointer",border:"1px solid #bbf7d0",flexShrink:0 }} onClick={()=>setMediaViewer({url,name:m.fileName,type:m.fileType})}>
                                                            {isImage(m.fileType)?<img src={url} alt={m.fileName} style={{ width:"100%",height:"100%",objectFit:"cover" }}/>:<span style={{ fontSize:14,lineHeight:"26px",display:"block",textAlign:"center" }}>{mediaIcon(m.fileType)}</span>}
                                                          </div>
                                                        );
                                                      })}
                                                      {photosOnDay.length>2&&<span style={{ fontSize:9,color:"#16a34a",fontWeight:700 }}>+{photosOnDay.length-2}</span>}
                                                      {invoicesOnDay.length>0&&<span style={{ fontSize:10,background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:3,padding:"1px 4px",color:"#374151",whiteSpace:"nowrap" }}>🧾{invoicesOnDay.length}</span>}
                                                      {photosOnDay.length===0&&invoicesOnDay.length===0&&<span style={{ color:"#e2e8f0",fontSize:10 }}>—</span>}
                                                    </div>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            <tr style={{ background:"#0a2540",borderTop:"2px solid #1e3a5f" }}>
                                              <td style={{ padding:"7px 10px",fontWeight:800,color:"#fbbf24",fontSize:11 }}>TOTAL</td>
                                              {(["enquiryPlanned","enquiryActual","testDrivePlanned","testDriveActual","bookingActual","retailActual","leadsPunched"] as (keyof DailyEntry)[]).map((key,ki)=>(
                                                <td key={key} style={{ padding:"7px 6px",textAlign:"center",fontWeight:700,fontSize:12,color:[0,2].includes(ki)?"#93c5fd":[1,3].includes(ki)?"#6ee7b7":ki===4?"#c4b5fd":ki===5?"#fbbf24":"#a5b4fc" }}>{d.dailyEntries.reduce((s,e)=>s+((e as any)[key] as number),0)}</td>
                                              ))}
                                              <td style={{ padding:"7px 8px",textAlign:"center" }}>
                                                <span style={{ fontSize:10,color:"#94a3b8" }}>
                                                  {d.proofMedia.length>0&&`📸${d.proofMedia.length} `}{d.invoiceMedia.length>0&&`🧾${d.invoiceMedia.length}`}
                                                </span>
                                              </td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    )}
                                    <div style={{ padding:"7px 14px",fontSize:11,color:"#6b7280",background:"#f8fafc",borderTop:"1px solid #e2e8f0" }}>
                                      ℹ Green ≥90% · Yellow ≥60% · Red &lt;60% · Dim rows = no data yet
                                    </div>
                                  </div>
                                )}

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
                  {(()=>{
                    const lt = isEditing ? editTotals : (showBudgetAddPanel ? liveBudgetTotals() : null);
                    const footerTotalBudget  = lt ? lt.totalBudget : selected.totalBudget;
                    const footerBgauss       = lt ? lt.totalBgauss : selected.activities.reduce((s,a)=>s+calcBgAmt(a.budget,a.additionalBudget,a.bgaussShare),0);
                    const footerCac          = lt ? lt.cac : (selected.totalRetailTarget>0 ? footerBgauss/selected.totalRetailTarget : 0);
                    const footerCpl          = lt ? lt.cpl : (selected.totalLeadTarget>0   ? footerBgauss/selected.totalLeadTarget   : 0);
                    const rows = [
                      {label:"Lead",         value: isEditing?Math.round(editTotals.totalLeadTarget):selected.totalLeadTarget},
                      {label:"Retail",       value: isEditing?Math.round(editTotals.totalRetailTarget):selected.totalRetailTarget},
                      {label:"Total budget", value: inr(footerTotalBudget), hi:true},
                      {label:"BGauss budget",value: inr(footerBgauss), blue:true},
                      {label:"CAC",          value: inr(footerCac), blue:true,
                        warn: footerCac > (selected.allowedCac ?? 4000) && selected.totalRetailTarget > 0},
                      {label:"CPL",          value: inr(footerCpl), blue:true},
                    ];
                    return rows.map(({label,value,hi,blue,warn})=>(
                      <div key={label}>
                        <div style={{ fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em" }}>{label}</div>
                        <div style={{ fontSize:14,fontWeight:700,color:warn?"#fca5a5":hi?"#86efac":blue?"#93c5fd":"#e2e8f0" }}>{value}</div>
                        {warn&&<div style={{ fontSize:8,color:"#fca5a5" }}>⚠ over limit</div>}
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* CAC banner + Decision panel */}
              {(()=>{
                const _lt    = isEditing ? editTotals : (showBudgetAddPanel ? liveBudgetTotals() : null);
                const bgAmt  = _lt ? _lt.totalBgauss : selected.activities.reduce((s,a)=>s+calcBgAmt(a.budget,a.additionalBudget,a.bgaussShare),0);
                const retail = isEditing ? editTotals.totalRetailTarget : selected.totalRetailTarget;
                const liveCAC = retail>0?bgAmt/retail:0;
                const allowedCac=selected.allowedCac??4000;
                const cacExceedsLimit=liveCAC>allowedCac&&retail>0;
                return (
                  <>
                    {cacExceedsLimit?(<div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderLeft:"4px solid #ef4444",borderRadius:8,padding:"12px 16px",marginBottom:16,fontSize:13 }}><div style={{ fontWeight:700,color:"#991b1b",marginBottom:4,fontSize:14 }}>⚠ CAC Limit Exceeded — Deviation Approval Required</div><div style={{ color:"#7f1d1d" }}>Live CAC <strong>₹{Math.round(liveCAC).toLocaleString("en-IN")}</strong> exceeds allowed <strong>₹{allowedCac.toLocaleString("en-IN")}/vehicle</strong> for a <strong>{selected.type} dealer</strong>.</div><div style={{ color:"#991b1b",fontSize:12,marginTop:6,fontWeight:500 }}>🔒 Approve / Reject / Send back disabled. <strong>Forward</strong> for deviation approval.</div></div>):selected.cacWarning?(<div style={{ background:"#fefce8",border:"1px solid #fde68a",borderLeft:"3px solid #f59e0b",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#92400e" }}>⚠ {selected.cacWarning}</div>):null}
                    {isAdmin&&selected.status==="Pending"&&!isEditing&&(
                      <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"20px",marginBottom:20 }}>
                        <p style={{ fontWeight:700,fontSize:14,color:"#0a2540",marginBottom:4 }}>Actions</p>
                        <p style={{ fontSize:12,color:"#64748b",marginBottom:16 }}>{isForwardOnly?"You are reviewing as Manager. Forward for final decision.":"You are the Final Approver. Review and decide."}</p>
                        {!isFinalApprover&&(
                          <div style={{ marginBottom:20,paddingBottom:20,borderBottom:"1px solid #e2e8f0" }}>
                            <p style={{ fontSize:13,color:"#6b7280",margin:"0 0 10px" }}>Forward to <strong>Final Approver</strong>{cacExceedsLimit&&<span style={{ marginLeft:6,fontSize:12,color:"#ef4444",fontWeight:600 }}>← Required (CAC exceeds limit)</span>}:</p>
                            {selected.checkedByEmail&&<div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"8px 14px",fontSize:13,color:"#166534",marginBottom:10 }}>✓ Already forwarded by {selected.checkedByEmail}{selected.checkedAt&&` on ${fmtDate(selected.checkedAt)}`}</div>}
                            <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
                              <button onClick={handleForward} disabled={forwardLoading} style={{ background:cacExceedsLimit?"#dc2626":"#1e3a5f",color:"#fff",border:"none",padding:"10px 22px",borderRadius:8,fontWeight:600,fontSize:14,cursor:forwardLoading?"not-allowed":"pointer",opacity:forwardLoading?0.7:1 }}>{forwardLoading?"Forwarding…":cacExceedsLimit?"📤 Forward for Deviation Approval (Required)":"📤 Forward to Final Approver"}</button>
                              <button style={{ background:"#dc2626",color:"#fff",border:"none",padding:"10px 22px",borderRadius:8,fontWeight:600,fontSize:14,cursor:"pointer" }} onClick={async()=>{ const reason=window.prompt("Reason for rejection (shown to Maker):"); if(!reason||!reason.trim()) return; try { setActionLoading(true); await decideProposal(selected.id,{status:"Rejected",approverNote:reason.trim(),approvedBy:account?.username??null},instance); setProposals(prev=>prev.map(p=>p.id===selected.id?{...p,status:"Rejected",approverNote:reason.trim()}:p)); setSelected(prev=>prev?{...prev,status:"Rejected",approverNote:reason.trim()}:null); showToast("Proposal rejected.",true); } catch { showToast("Rejection failed.",false); } finally { setActionLoading(false); } }}>✕ Reject Proposal</button>
                            </div>
                          </div>
                        )}
                        <div className="ap-sendback-row" style={{ marginBottom:isForwardOnly?0:16 }}>
                          <button className="ap-sendback-trigger" disabled={cacExceedsLimit} onClick={()=>setShowSendBack(v=>!v)}>↩ Send back for revision</button>
                        </div>
                        {showSendBack&&(<div className="ap-sendback-box"><p className="ap-sendback-label">Explain what needs to be revised:</p><textarea className="ap-note-input" rows={3} placeholder="e.g. Please increase target for Road Show…" value={sendBackNote} onChange={(e)=>setSendBackNote(e.target.value)}/><div className="ap-btn-row"><button className="ap-sendback-btn" disabled={actionLoading} onClick={handleSendBack}>{actionLoading?"Sending…":"↩ Send for revision"}</button><button className="ap-discard-btn" onClick={()=>{setShowSendBack(false);setSendBackNote("");}}>Cancel</button></div></div>)}
                        {isFinalApprover&&(
                          <div style={{ marginTop:20,paddingTop:20,borderTop:"1px solid #e2e8f0",opacity:cacExceedsLimit?0.4:1,pointerEvents:cacExceedsLimit?"none":"auto" }}>
                            {cacExceedsLimit&&<div style={{ background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:7,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#64748b",textAlign:"center",fontWeight:500 }}>🔒 Approve / Reject locked — CAC exceeds limit</div>}
                            <p style={{ fontSize:13,color:"#6b7280",margin:"0 0 8px" }}>Final decision:</p>
                            <textarea className="ap-note-input" rows={3} placeholder="Add a note for RSM (optional)…" value={note} onChange={(e)=>setNote(e.target.value)} disabled={cacExceedsLimit}/>
                            <div className="ap-btn-row">
                              <button className="ap-approve-btn" disabled={actionLoading||cacExceedsLimit} onClick={()=>decide("Approved")}>{actionLoading?"Processing…":"✓  Approve"}</button>
                              <button className="ap-reject-btn" disabled={actionLoading||cacExceedsLimit} onClick={()=>decide("Rejected")}>{actionLoading?"Processing…":"✕  Reject"}</button>
                            </div>
                          </div>
                        )}
                        {isForwardOnly&&(<div style={{ marginTop:16,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"12px 16px",fontSize:12,color:"#64748b" }}><span style={{ fontSize:16,marginRight:6 }}>ℹ️</span>After forwarding, <strong>Final Approver</strong> will give the final decision.</div>)}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* ══ BUDGET ADDITION PANEL — activates when dealer sent a request ══ */}
              {isAdmin&&selected.status==="Approved"&&dealerSentBack(selected)&&(
                <div style={{ background:"#fff",border:"2px solid #f59e0b",borderRadius:10,padding:"20px",marginBottom:20,boxShadow:"0 2px 12px rgba(245,158,11,0.12)" }}>
                  <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10 }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                        <span style={{ background:"#f59e0b",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:11,fontWeight:700 }}>↩ DEALER BUDGET REQUEST</span>
                        {(selected as any).dealerSentBackAt&&<span style={{ fontSize:11,color:"#6b7280" }}>{fmtDate((selected as any).dealerSentBackAt)}</span>}
                      </div>
                      <p style={{ fontSize:14,fontWeight:700,color:"#0a2540",margin:0 }}>Additional Budget / Special Approval</p>
                      <p style={{ fontSize:12,color:"#6b7280",margin:"4px 0 0" }}>Dealer has requested additional budget. Fill amounts below then submit for re-approval.</p>
                    </div>
                    <button onClick={()=>{ setShowBudgetAddPanel(v=>!v); if(!showBudgetAddPanel) initBudgetAdd(selected); }}
                      style={{ background:showBudgetAddPanel?"#f1f5f9":"#f59e0b",color:showBudgetAddPanel?"#374151":"#fff",border:showBudgetAddPanel?"1px solid #e2e8f0":"none",padding:"9px 18px",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer",whiteSpace:"nowrap" }}>
                      {showBudgetAddPanel?"▲ Collapse":"▼ Review & Fill Budget"}
                    </button>
                  </div>
                  {dealerSendBackNote(selected)&&(
                    <div style={{ background:"#fef9c3",border:"1px solid #fde68a",borderLeft:"4px solid #f59e0b",borderRadius:8,padding:"12px 16px",marginBottom:16,fontSize:13 }}>
                      <span style={{ fontWeight:700,color:"#92400e",fontSize:11,textTransform:"uppercase",letterSpacing:"0.04em",display:"block",marginBottom:4 }}>Dealer's Request</span>
                      <p style={{ margin:0,color:"#78350f",whiteSpace:"pre-wrap" }}>{dealerSendBackNote(selected)}</p>
                      {selected.dealerEmail&&<p style={{ margin:"6px 0 0",fontSize:11,color:"#92400e" }}>From: <a href={`mailto:${selected.dealerEmail}`} style={{ color:"#1e3a5f",fontWeight:600 }}>{selected.dealerEmail}</a></p>}
                    </div>
                  )}
                  {showBudgetAddPanel&&(
                    <div>
                      <p style={{ fontSize:12,fontWeight:700,color:"#374151",margin:"0 0 10px",textTransform:"uppercase",letterSpacing:"0.04em" }}>Additional Budget per Activity</p>
                      <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:16 }}>
                        {selected.activities.map((a,i)=>{
                          const currentAdd=a.additionalBudget??0;
                          const newAdd=num(budgetAddAmounts[a.id]??"0");
                          const diff=newAdd-currentAdd;
                          return (
                            <div key={a.id} style={{ display:"flex",alignItems:"center",gap:14,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"12px 16px",flexWrap:"wrap" }}>
                              <div style={{ flex:1,minWidth:160 }}>
                                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                                  <span style={{ fontWeight:700,color:"#0a2540",fontSize:13 }}>{String.fromCharCode(65+i)}) {a.activityType}</span>
                                  {a.category&&<span style={{ fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:3,background:a.category==="ATL"?"#eff6ff":"#f0fdf4",color:a.category==="ATL"?"#1e40af":"#166534" }}>{a.category}</span>}
                                </div>
                                <div style={{ fontSize:11,color:"#6b7280",marginTop:2 }}>Base: {inr(a.budget)}{currentAdd>0&&<span style={{ color:"#92400e",marginLeft:8 }}>+ Current add: {inr(currentAdd)}</span>}</div>
                              </div>
                              <div style={{ display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end" }}>
                                <label style={{ fontSize:10,color:"#6b7280",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em" }}>Additional Budget (₹)</label>
                                <input type="number" min={0} step={1000}
                                  style={{ width:120,textAlign:"right",border:"2px solid #f59e0b",borderRadius:7,padding:"7px 10px",fontSize:14,fontWeight:700,outline:"none",color:"#92400e",background:"#fffbeb" }}
                                  value={budgetAddAmounts[a.id]??"0"}
                                  onChange={(e)=>setBudgetAddAmounts(prev=>({...prev,[a.id]:e.target.value}))}/>
                              </div>
                              <div style={{ display:"flex",flexDirection:"column",gap:3,alignItems:"flex-end",minWidth:120 }}>
                                <span style={{ fontSize:10,color:"#6b7280",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em" }}>New Total</span>
                                <span style={{ fontSize:14,fontWeight:700,color:"#0a2540" }}>{inr(a.budget+newAdd)}</span>
                                {diff>0&&<span style={{ fontSize:11,color:"#16a34a",fontWeight:600 }}>+{inr(diff)} added</span>}
                                {diff<0&&<span style={{ fontSize:11,color:"#dc2626",fontWeight:600 }}>{inr(diff)} reduced</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {(()=>{
                        const totalNewAdd=selected.activities.reduce((s,a)=>s+num(budgetAddAmounts[a.id]??"0"),0);
                        const totalNewBudget=selected.activities.reduce((s,a)=>s+a.budget+num(budgetAddAmounts[a.id]??"0"),0);
                        const totalOldAdd=selected.activities.reduce((s,a)=>s+(a.additionalBudget??0),0);
                        const netNew=totalNewAdd-totalOldAdd;
                        return (
                          <div style={{ background:"#0a2540",borderRadius:8,padding:"12px 16px",display:"flex",gap:24,flexWrap:"wrap",marginBottom:16 }}>
                            {[{label:"Old Budget",val:inr(selected.totalBudget),c:"#e2e8f0"},{label:"Additional",val:`+${inr(totalNewAdd)}`,c:totalNewAdd>0?"#fbbf24":"#e2e8f0"},{label:"New Total Budget",val:inr(totalNewBudget),c:"#86efac"},...(netNew!==0?[{label:"Net Change",val:`${netNew>0?"+":""}${inr(netNew)}`,c:netNew>0?"#fbbf24":"#fca5a5"}]:[])].map(({label,val,c})=>(
                              <div key={label}><div style={{ fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em" }}>{label}</div><div style={{ fontSize:14,fontWeight:700,color:c }}>{val}</div></div>
                            ))}
                          </div>
                        );
                      })()}
                      <div style={{ marginBottom:16 }}>
                        <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:4 }}>📝 Note to Final Approver (optional)</label>
                        <textarea rows={2} placeholder="Explain why this additional budget is justified…" style={{ width:"100%",border:"1px solid #d1d5db",borderRadius:7,padding:"8px 10px",fontSize:13,resize:"vertical",outline:"none",boxSizing:"border-box" as const }} value={budgetAddNote} onChange={(e)=>setBudgetAddNote(e.target.value)}/>
                      </div>
                      <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
                        <button onClick={handleBudgetAddSubmit} disabled={budgetAddLoading} style={{ background:budgetAddLoading?"#9ca3af":"#f59e0b",color:"#fff",border:"none",padding:"11px 24px",borderRadius:8,fontWeight:700,fontSize:14,cursor:budgetAddLoading?"not-allowed":"pointer",opacity:budgetAddLoading?0.8:1 }}>{budgetAddLoading?"Submitting…":"📤 Save & Submit for Re-Approval"}</button>
                        <button onClick={()=>{setShowBudgetAddPanel(false);initBudgetAdd(selected);}} style={{ background:"#f1f5f9",color:"#374151",border:"1px solid #e2e8f0",padding:"11px 20px",borderRadius:8,fontWeight:500,fontSize:14,cursor:"pointer" }}>Cancel</button>
                        <span style={{ fontSize:11,color:"#6b7280" }}>Will be forwarded to Final Approver. Dealer notified after approval.</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notify Dealer */}
              {isAdmin&&selected.status==="Approved"&&(
                <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"20px",marginBottom:20 }}>
                  <p style={{ fontWeight:700,fontSize:14,color:"#0a2540",marginBottom:8 }}>Notify Dealer</p>
                  {selected.dealerNotified&&<div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"8px 14px",fontSize:13,color:"#166534",marginBottom:12 }}>✓ Dealer notified{selected.dealerEmail&&<span style={{ color:"#6b7280" }}> ({selected.dealerEmail})</span>}</div>}
                  {!showNotifyDealer?(<button onClick={async()=>{
                    setShowNotifyDealer(true);
                    // Priority: previously used email → look up by DealerName from dealer logins
                    if(selected.dealerEmail){
                      setDealerEmailMode("dealer"); setDealerEmailInput(selected.dealerEmail);
                    } else {
                      setDealerEmailMode("custom"); setDealerEmailInput("");
                      // Auto-fetch from dealer accounts by matching DealerName
                      setDealerEmailFetching(true);
                      try {
                        const dealers = await fetchDealerUsers(instance);
                        const match = dealers.find(d =>
                          d.dealerName?.trim().toLowerCase() === selected.dealerName?.trim().toLowerCase()
                          || d.dealerCode === (selected as any).dealerCode
                        );
                        if (match?.email) {
                          setDealerEmailInput(match.email);
                          setDealerEmailMode("dealer");
                        }
                      } catch {} finally { setDealerEmailFetching(false); }
                    }
                  }} style={{ background:"#0a2540",color:"#fff",border:"none",padding:"10px 22px",borderRadius:8,fontWeight:600,fontSize:14,cursor:"pointer" }}>{selected.dealerNotified?"📧 Send Again":"📧 Notify Dealer"}</button>):(
                    <div style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:16 }}>
                      <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:14 }}>
                        {selected.dealerEmail&&(<label style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:dealerEmailMode==="dealer"?"#eff6ff":"#fff",border:`1px solid ${dealerEmailMode==="dealer"?"#3b82f6":"#e2e8f0"}`,borderRadius:8,cursor:"pointer",fontSize:13 }}><input type="radio" name="emailMode" value="dealer" checked={dealerEmailMode==="dealer"} onChange={()=>{setDealerEmailMode("dealer");setDealerEmailInput(selected.dealerEmail??"");}}/><div><span style={{ fontWeight:600,color:"#0a2540" }}>Dealer (previously used)</span> <span style={{ color:"#6b7280",fontSize:12 }}>{selected.dealerEmail}</span></div></label>)}
                        <label style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:dealerEmailMode==="custom"?"#eff6ff":"#fff",border:`1px solid ${dealerEmailMode==="custom"?"#3b82f6":"#e2e8f0"}`,borderRadius:8,cursor:"pointer",fontSize:13 }}><input type="radio" name="emailMode" value="custom" checked={dealerEmailMode==="custom"} onChange={()=>{setDealerEmailMode("custom");setDealerEmailInput("");}}/><span style={{ fontWeight:600,color:"#0a2540" }}>Enter email manually</span></label>
                      </div>
                      {dealerEmailFetching && (
                        <div style={{ fontSize:12,color:"#2563eb",padding:"6px 0",marginBottom:6 }}>
                          ⏳ Looking up dealer email…
                        </div>
                      )}
                      <input type="email" value={dealerEmailInput} onChange={(e)=>setDealerEmailInput(e.target.value)} placeholder="recipient@example.com" style={{ width:"100%",padding:"9px 12px",borderRadius:7,border:`1px solid ${dealerEmailInput?"#16a34a":"#d1d5db"}`,fontSize:13,boxSizing:"border-box" as const,marginBottom:14 }}/>
                      {dealerEmailInput && !dealerEmailFetching && (
                        <div style={{ fontSize:11,color:"#16a34a",marginBottom:10,fontWeight:500 }}>
                          ✓ Email auto-fetched from dealer account
                        </div>
                      )}
                      <div style={{ display:"flex",gap:10 }}>
                        <button onClick={handleNotifyDealer} disabled={notifyLoading||!dealerEmailInput.trim()} style={{ background:"#0a2540",color:"#fff",border:"none",padding:"10px 22px",borderRadius:8,fontWeight:600,fontSize:14,cursor:notifyLoading||!dealerEmailInput.trim()?"not-allowed":"pointer",opacity:notifyLoading||!dealerEmailInput.trim()?0.6:1 }}>{notifyLoading?"Sending…":"📧 Send to Dealer"}</button>
                        <button onClick={()=>setShowNotifyDealer(false)} style={{ background:"#f1f5f9",color:"#374151",border:"1px solid #e2e8f0",padding:"10px 20px",borderRadius:8,fontWeight:500,fontSize:14,cursor:"pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* RSM / Admin finalised banners */}
              {!isAdmin&&selected.status!=="Pending"&&(
                <div style={{ background:selected.status==="Approved"?"#f0fdf4":selected.status==="Rejected"?"#fef2f2":"#fef9c3",border:`1px solid ${selected.status==="Approved"?"#bbf7d0":selected.status==="Rejected"?"#fecaca":"#fde68a"}`,borderLeft:`4px solid ${selected.status==="Approved"?"#16a34a":selected.status==="Rejected"?"#dc2626":"#f59e0b"}`,borderRadius:10,padding:"16px 20px" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}><strong style={{ fontSize:14,color:selected.status==="Approved"?"#166634":selected.status==="Rejected"?"#991b1b":"#92400e" }}>{selected.status==="NeedsRevision"?"Revision requested":selected.status}</strong>{selected.decidedAt&&<span style={{ fontSize:12,color:"#6b7280" }}>{fmtDate(selected.decidedAt)}{selected.approvedBy&&` · ${selected.approvedBy}`}</span>}</div>
                  {selected.approverNote&&<p style={{ margin:"4px 0 0",fontSize:13,color:"#374151" }}>{selected.approverNote}</p>}
                  {selected.status==="NeedsRevision"&&<button onClick={()=>navigate(`/rsm-form?edit=${selected.id}`)} style={{ marginTop:12,background:"#f59e0b",color:"#fff",border:"none",borderRadius:7,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer" }}>✏ Edit &amp; resubmit →</button>}
                </div>
              )}
              {isAdmin&&(selected.status==="Approved"||selected.status==="Rejected")&&(
                <div style={{ background:selected.status==="Approved"?"#f0fdf4":"#fef2f2",border:`1px solid ${selected.status==="Approved"?"#bbf7d0":"#fecaca"}`,borderLeft:`4px solid ${selected.status==="Approved"?"#16a34a":"#dc2626"}`,borderRadius:10,padding:"14px 18px" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}><strong style={{ fontSize:14,color:selected.status==="Approved"?"#166634":"#991b1b" }}>{selected.status}</strong>{selected.decidedAt&&<span style={{ fontSize:12,color:"#6b7280" }}>{fmtDate(selected.decidedAt)}{selected.approvedBy&&` · ${selected.approvedBy}`}</span>}</div>
                  {selected.approverNote&&<p style={{ margin:"4px 0 0",fontSize:13,color:"#374151" }}>{selected.approverNote}</p>}
                </div>
              )}

            </div>
          </div>

          {/* Sticky save footer */}
          {isAdmin&&isEditing&&(
            <div style={{ background:"#fff",borderTop:"2px solid #e2e8f0",padding:"12px 24px",flexShrink:0,display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12 }}>
              <span style={{ fontSize:12,color:"#f59e0b",fontWeight:600 }}>⚠ Unsaved changes</span>
              <button onClick={()=>{ setEditData(toEditable(selected)); setIsEditing(false); }} style={{ background:"#f1f5f9",color:"#374151",border:"1px solid #e2e8f0",borderRadius:7,padding:"9px 20px",fontWeight:500,fontSize:14,cursor:"pointer" }}>Discard</button>
              <button onClick={saveEdits} disabled={saveLoading} style={{ background:"#0a2540",color:"#fff",border:"none",borderRadius:7,padding:"9px 24px",fontWeight:600,fontSize:14,cursor:saveLoading?"not-allowed":"pointer",opacity:saveLoading?0.7:1 }}>{saveLoading?"Saving…":"💾 Save changes"}</button>
            </div>
          )}
        </div>
      )}

      {toast&&(<div className={`ap-toast ${toast.ok?"ap-toast-ok":"ap-toast-err"}`}>{toast.ok?"✓":"✕"}&nbsp;{toast.msg}</div>)}
    </div>
  );
}

function StatCard({ label, value, color, onClick, active }: {
  label:string; value:string|number; color:string; onClick?:()=>void; active?:boolean;
}) {
  return (
    <div className={`ap-stat${onClick?" ap-stat--clickable":""}${active?" ap-stat--active":""}`}
      onClick={onClick} style={{ cursor:onClick?"pointer":"default" }}>
      <span className={`ap-stat-val ap-${color}`}>{value}</span>
      <span className="ap-stat-lbl">{label}</span>
      {active&&<span className="ap-stat-active-dot"/>}
    </div>
  );
}
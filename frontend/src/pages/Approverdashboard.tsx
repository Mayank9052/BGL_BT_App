import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import {
  fetchProposals, fetchMyProposals, decideProposal, updateProposal,
  sendBackProposal, updateProposalActuals, uploadActivityMedia,
  type ActivityResponse, type ProposalResponse,
} from "../services/proposalService";
import "./ApproverDashboard.css";

const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const num = (v: string | number) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const eligClass = (e: string) =>
  e === "Eligible" ? "ap-elig-yes" : e === "Not Eligible" ? "ap-elig-no" : "ap-elig-pend";

const statusClass = (s: string) =>
  s === "Approved"        ? "ap-badge ap-badge-approved"
  : s === "Rejected"      ? "ap-badge ap-badge-rejected"
  : s === "NeedsRevision" ? "ap-badge ap-badge-revision"
  : "ap-badge ap-badge-pending";

const MONTHS      = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ELIGIBILITY = ["Eligible","Not Eligible","Pending Approval"];
const LOC_TYPES   = ["Old","New"];
const ACT_TYPES   = [
  "Test Drive Camp","Canopy Activity","Mela / Exhibition","Road Show",
  "Digital Campaign","Influencer Activity","Corporate Connect",
  "Society Activation","Referral Program","Other",
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface EditActivity {
  id?: string; activityType: string; target: string;
  startDate: string; endDate: string; budget: string;
  incentive: string; remarks: string;
}
interface EditableProposal {
  dealerName: string; location: string; state: string; type: string;
  rsmName: string; commandoName: string; month: string;
  eligibility: string; remarks: string; activities: EditActivity[];
}
interface ActualEntry {
  actualStartDate: string;
  actualEndDate:   string;
  mediaFile:       File | null;
  mediaFileUrl:    string | null;
  mediaFileName:   string | null;
  mediaFileType:   string | null;
  uploading:       boolean;
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function ApproverDashboard() {
  const { instance, accounts } = useMsal();
  const navigate  = useNavigate();
  const account   = accounts[0];
  const { user }  = useAuthStore();
  const isAdmin   = user?.role === "Admin" || user?.role === "Manager";

  // ── Core state ──────────────────────────────────────────────────────────────
  const [proposals,     setProposals]     = useState<ProposalResponse[]>([]);
  const [selected,      setSelected]      = useState<ProposalResponse | null>(null);
  const [editData,      setEditData]      = useState<EditableProposal | null>(null);
  const [isEditing,     setIsEditing]     = useState(false);
  const [note,          setNote]          = useState("");
  const [sendBackNote,  setSendBackNote]  = useState("");
  const [showSendBack,  setShowSendBack]  = useState(false);
  const [filterStatus,  setFilterStatus]  = useState<string>("All");
  const [filterMonth,   setFilterMonth]   = useState("All");
  const [search,        setSearch]        = useState("");
  const [loading,       setLoading]       = useState(true);
  const [fetchError,    setFetchError]    = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [saveLoading,   setSaveLoading]   = useState(false);
  const [toast,         setToast]         = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Actuals state ────────────────────────────────────────────────────────────
  const [actualsData,    setActualsData]    = useState<Record<string, ActualEntry>>({});
  const [actualsLoading, setActualsLoading] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Load proposals ───────────────────────────────────────────────────────────
  const loadProposals = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      const data = isAdmin
        ? await fetchProposals(instance)
        : await fetchMyProposals(instance);
      setProposals(data);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load.");
    } finally { setLoading(false); }
  }, [instance, isAdmin]);

  useEffect(() => { loadProposals(); }, [loadProposals]);

  // ── Derived data ─────────────────────────────────────────────────────────────
  const months = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.month)))],
    [proposals]
  );

  const filtered = useMemo(() =>
    proposals.filter((p) => {
      if (filterStatus !== "All" && p.status !== filterStatus) return false;
      if (filterMonth  !== "All" && p.month  !== filterMonth)  return false;
      if (search) {
        const q = search.toLowerCase();
        return p.dealerName.toLowerCase().includes(q) ||
               p.rsmName.toLowerCase().includes(q)    ||
               p.location.toLowerCase().includes(q)   ||
               p.id.toLowerCase().includes(q);
      }
      return true;
    }), [proposals, filterStatus, filterMonth, search]);

  const stats = useMemo(() => {
    const approved = proposals.filter((p) => p.status === "Approved");
    return {
      total:         proposals.length,
      pending:       proposals.filter((p) => p.status === "Pending").length,
      approved:      approved.length,
      rejected:      proposals.filter((p) => p.status === "Rejected").length,
      needsRevision: proposals.filter((p) => p.status === "NeedsRevision").length,
      totalBudget:   approved.reduce((s, p) => s + p.totalBudget, 0),
    };
  }, [proposals]);

  const editTotals = useMemo(() => {
    if (!editData) return { totalBudget: 0, totalTarget: 0, cac: 0 };
    const tb = editData.activities.reduce((s, a) => s + num(a.budget) + num(a.incentive), 0);
    const tt = editData.activities.reduce((s, a) => s + num(a.target), 0);
    return { totalBudget: tb, totalTarget: tt, cac: tt > 0 ? tb / tt : 0 };
  }, [editData]);

  // ── Toast ────────────────────────────────────────────────────────────────────
  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500);
  };

  // ── Actuals helpers ──────────────────────────────────────────────────────────
  const initActuals = useCallback((p: ProposalResponse) => {
    const init: Record<string, ActualEntry> = {};
    p.activities.forEach((a) => {
      init[a.id] = {
        actualStartDate: a.actualStartDate?.split("T")[0] ?? "",
        actualEndDate:   a.actualEndDate?.split("T")[0]   ?? "",
        mediaFile:       null,
        mediaFileUrl:    a.mediaFileUrl    ?? null,
        mediaFileName:   a.mediaFileName   ?? null,
        mediaFileType:   a.mediaFileType   ?? null,
        uploading:       false,
      };
    });
    setActualsData(init);
  }, []);

  const setActualField = (
    activityId: string,
    key: "actualStartDate" | "actualEndDate",
    value: string
  ) => {
    setActualsData((prev) => ({
      ...prev,
      [activityId]: { ...prev[activityId], [key]: value },
    }));
  };

  const handleMediaSelect = async (activityId: string, file: File) => {
    setActualsData((prev) => ({
      ...prev,
      [activityId]: { ...prev[activityId], uploading: true, mediaFile: file },
    }));
    try {
      const result = await uploadActivityMedia(file, instance);
      setActualsData((prev) => ({
        ...prev,
        [activityId]: {
          ...prev[activityId],
          uploading:     false,
          mediaFileUrl:  result.url,
          mediaFileName: result.fileName,
          mediaFileType: result.fileType,
          mediaFile:     file,
        },
      }));
      showToast("File uploaded successfully.", true);
    } catch (err) {
      setActualsData((prev) => ({
        ...prev,
        [activityId]: { ...prev[activityId], uploading: false },
      }));
      showToast(err instanceof Error ? err.message : "Upload failed.", false);
    }
  };

  const saveActuals = async () => {
    if (!selected) return;
    setActualsLoading(true);
    try {
      const payload = selected.activities.map((a) => {
        const d = actualsData[a.id];
        return {
          activityId:      a.id,
          actualStartDate: d?.actualStartDate || null,
          actualEndDate:   d?.actualEndDate   || null,
          mediaFileUrl:    d?.mediaFileUrl    ?? null,
          mediaFileName:   d?.mediaFileName   ?? null,
          mediaFileType:   d?.mediaFileType   ?? null,
        };
      });
      const updated = await updateProposalActuals(selected.id, payload, instance);
      setProposals((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelected(updated);
      initActuals(updated);
      showToast("Actuals saved successfully.", true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save actuals.", false);
    } finally {
      setActualsLoading(false);
    }
  };

  // ── Drawer helpers ───────────────────────────────────────────────────────────
  const openDrawer = (p: ProposalResponse) => {
    setSelected(p); setEditData(toEditable(p));
    setIsEditing(false); setShowSendBack(false);
    setNote(p.approverNote ?? ""); setSendBackNote("");
    initActuals(p);
  };

  const closeDrawer = () => {
    setSelected(null); setEditData(null);
    setIsEditing(false); setShowSendBack(false);
    setActualsData({});
  };

  // ── Edit helpers ─────────────────────────────────────────────────────────────
  const setF  = (key: keyof Omit<EditableProposal,"activities">, v: string) =>
    setEditData((d) => d ? { ...d, [key]: v } : d);
  const setAF = (idx: number, key: keyof EditActivity, v: string) =>
    setEditData((d) => {
      if (!d) return d;
      return { ...d, activities: d.activities.map((a, i) => i === idx ? { ...a, [key]: v } : a) };
    });

  const addRow = () =>
    setEditData((d) => d ? { ...d, activities: [...d.activities,
      { activityType:"",target:"",startDate:"",endDate:"",budget:"",incentive:"",remarks:"" }] } : d);

  const removeRow = (idx: number) =>
    setEditData((d) => (!d || d.activities.length <= 1) ? d :
      { ...d, activities: d.activities.filter((_, i) => i !== idx) });

  const saveEdits = async () => {
    if (!selected || !editData) return;
    setSaveLoading(true);
    try {
      const payload = {
        ...editData,
        activities: editData.activities.map((a) => ({
          ...a, target: num(a.target), budget: num(a.budget), incentive: num(a.incentive),
        })),
        ...editTotals,
      };
      const updated = await updateProposal(selected.id, payload, instance);
      setProposals((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelected(updated); setEditData(toEditable(updated)); setIsEditing(false);
      showToast("Proposal updated.", true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed.", false);
    } finally { setSaveLoading(false); }
  };

  // ── Decision helpers ─────────────────────────────────────────────────────────
  const decide = async (action: "Approved" | "Rejected") => {
    if (!selected) return;
    setActionLoading(true);
    try {
      const updated = await decideProposal(selected.id,
        { status: action, approverNote: note.trim() || null, approvedBy: account?.username ?? null },
        instance);
      setProposals((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelected(updated);
      initActuals(updated);
      showToast(action === "Approved" ? "Proposal approved." : "Proposal rejected.", action === "Approved");
      setNote("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed.", false);
    } finally { setActionLoading(false); }
  };

  const handleSendBack = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      const updated = await sendBackProposal(selected.id,
        { note: sendBackNote.trim() || null, sentBackBy: account?.username ?? null },
        instance);
      setProposals((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelected(updated); setShowSendBack(false); setSendBackNote("");
      showToast("Sent back for revision. RSM has been notified.", true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send back.", false);
    } finally { setActionLoading(false); }
  };

  const pageTitle = isAdmin ? "Approver Portal" : "My Proposals";

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="ap-page">
      <main className="ap-main">

        {/* Page header */}
        <div className="ap-page-header">
          <div>
            <h1 className="ap-page-title">{pageTitle}</h1>
            <p className="ap-page-sub">
              {isAdmin
                ? "Review, edit, approve or reject RSM activity proposals."
                : "Track the status of your submitted proposals."}
            </p>
          </div>
          {!isAdmin && (
            <button className="ap-new-btn" onClick={() => navigate("/rsm-form")}>
              + New Proposal
            </button>
          )}
        </div>

        {loading && (
          <div className="ap-loading">
            <div className="ap-spinner" />
            <p>Loading proposals…</p>
          </div>
        )}

        {!loading && fetchError && (
          <div className="ap-error-state">
            <p className="ap-error-msg">⚠ {fetchError}</p>
            <button className="ap-retry-btn" onClick={loadProposals}>Retry</button>
          </div>
        )}

        {!loading && !fetchError && (
          <>
            {/* Stats */}
            <div className={`ap-stats ap-stats--${isAdmin ? "admin" : "user"}`}>
              <StatCard label="Total"          value={stats.total}     color="navy" />
              <StatCard label="Pending review" value={stats.pending}   color="amber" />
              <StatCard label="Approved"       value={stats.approved}  color="green" />
              <StatCard label="Rejected"       value={stats.rejected}  color="red" />
              {isAdmin
                ? <StatCard label="Approved budget" value={inr(stats.totalBudget)} color="navy" />
                : <StatCard label="Needs revision"  value={stats.needsRevision}    color="orange" />
              }
            </div>

            {/* Filters */}
            <div className="ap-filters">
              <input className="ap-search" placeholder="Search dealer, RSM, location…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="ap-select" value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}>
                {["All","Pending","Approved","Rejected","NeedsRevision"].map((s) => (
                  <option key={s} value={s}>
                    {s === "All" ? "All statuses" : s === "NeedsRevision" ? "Needs revision" : s}
                  </option>
                ))}
              </select>
              <select className="ap-select" value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>{m === "All" ? "All months" : m}</option>
                ))}
              </select>
              <button className="ap-refresh-btn" onClick={loadProposals}>↻ Refresh</button>
            </div>

            {/* Table */}
            <div className="ap-table-wrap">
              <table className="ap-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Token</th>
                    <th>Submitted</th>
                    {isAdmin && <th>RSM / TSM</th>}
                    <th>Dealer &amp; location</th>
                    <th>Month</th>
                    <th>Activities</th>
                    <th className="ap-num">Budget</th>
                    <th className="ap-num">Target</th>
                    <th className="ap-num">CAC</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={isAdmin ? 11 : 10} className="ap-empty">
                      {proposals.length === 0 ? "No proposals yet." : "No results match."}
                    </td></tr>
                  )}
                  {filtered.map((p) => (
                    <tr key={p.id} className="ap-row" onClick={() => openDrawer(p)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="ap-review-btn" onClick={() => openDrawer(p)}>
                          {isAdmin
                            ? (p.status === "Pending" || p.status === "NeedsRevision" ? "Review" : "View")
                            : "View"}
                        </button>
                      </td>
                      <td>
                        <span className="ap-id-chip">{p.tokenNumber ?? p.id.split("-").slice(-1)[0]}</span>
                      </td>
                      <td>
                        <span className="ap-cell-p">{fmtDate(p.createdAt)}</span>
                        {isAdmin && <span className="ap-cell-m">{p.submittedByDisplayName ?? p.submittedBy}</span>}
                      </td>
                      {isAdmin && (
                        <td>
                          <span className="ap-cell-p">{p.rsmName}</span>
                          <span className="ap-cell-m">{p.commandoName}</span>
                        </td>
                      )}
                      <td>
                        <span className="ap-cell-p">{p.dealerName}</span>
                        <span className="ap-cell-m">{p.location}, {p.state}</span>
                      </td>
                      <td>{p.month}</td>
                      <td>
                        {p.activities.slice(0, 2).map((a: ActivityResponse, i: number) => (
                          <span key={i} className="ap-act-chip">{a.activityType}</span>
                        ))}
                        {p.activities.length > 2 && (
                          <span className="ap-act-chip ap-act-chip--more">
                            +{p.activities.length - 2}
                          </span>
                        )}
                      </td>
                      <td className="ap-num ap-bold">{inr(p.totalBudget)}</td>
                      <td className="ap-num">{p.totalTarget}</td>
                      <td className="ap-num">{inr(p.cac)}</td>
                      <td>
                        <span className={statusClass(p.status)}>
                          {p.status === "NeedsRevision" ? "Needs revision" : p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* ══════════════════════ DRAWER ══════════════════════ */}
      {selected && editData && (
        <div className="ap-overlay" onClick={closeDrawer}>
          <div className="ap-drawer" onClick={(e) => e.stopPropagation()}>

            {/* Drawer header */}
            <div className="ap-drawer-topbar">
              <div className="ap-drawer-topbar-left">
                <span className={`ap-drawer-status-pill ap-pill-${selected.status.toLowerCase()}`}>
                  {selected.status === "NeedsRevision" ? "Needs revision"
                   : selected.status === "Pending"     ? "Pending review"
                   : selected.status}
                </span>
                {isEditing
                  ? <input className="ap-dtitle-input" value={editData.dealerName}
                      onChange={(e) => setF("dealerName", e.target.value)} placeholder="Dealer name" />
                  : <h2 className="ap-drawer-title">{selected.dealerName}</h2>
                }
                <p className="ap-drawer-sub">
                  {isEditing
                    ? <span className="ap-loc-row">
                        <input className="ap-sm-input" value={editData.location}
                          onChange={(e) => setF("location", e.target.value)}
                          placeholder="City" style={{ width: 110 }} />
                        <span className="ap-loc-sep">,</span>
                        <input className="ap-sm-input" value={editData.state}
                          onChange={(e) => setF("state", e.target.value)}
                          placeholder="State" style={{ width: 120 }} />
                      </span>
                    : <>{selected.location}, {selected.state} · {selected.month} · <strong>{selected.submittedByDisplayName ?? selected.submittedBy}</strong> · {fmtDate(selected.createdAt)}</>
                  }
                </p>
              </div>
              <div className="ap-drawer-topbar-right">
                {isAdmin && selected.status === "Pending" && !isEditing && (
                  <button className="ap-edit-trigger-btn" onClick={() => setIsEditing(true)}>
                    ✏ Edit
                  </button>
                )}
                {isEditing && (
                  <button className="ap-cancel-edit-btn"
                    onClick={() => { setEditData(toEditable(selected)); setIsEditing(false); }}>
                    ✕ Cancel
                  </button>
                )}
                <button className="ap-close-btn" onClick={closeDrawer}>✕</button>
              </div>
            </div>

            {isEditing && (
              <div className="ap-edit-banner">
                ✏ Edit mode — modify fields below, then save before deciding.
              </div>
            )}

            {/* Revision note banner for RSM */}
            {!isAdmin && selected.status === "NeedsRevision" && selected.approverNote && (
              <div className="ap-revision-banner">
                <strong>Revision requested:</strong> {selected.approverNote}
                <button className="ap-goto-edit-btn"
                  onClick={() => navigate(`/rsm-form?edit=${selected.id}`)}>
                  ✏ Edit &amp; resubmit →
                </button>
              </div>
            )}

            <div className="ap-drawer-body">

              {/* Meta grid row 1 */}
              <div className="ap-meta-grid-4">
                {([
                  { key: "rsmName",      label: "RSM / TSM",  input: "text"   as const, opts: [] as string[] },
                  { key: "commandoName", label: "Commando",    input: "text"   as const, opts: [] as string[] },
                  { key: "type",         label: "Type",        input: "select" as const, opts: LOC_TYPES },
                  { key: "eligibility",  label: "Eligibility", input: "select" as const, opts: ELIGIBILITY },
                ]).map(({ key, label, input, opts }) => (
                  <div key={key} className="ap-meta-cell">
                    <span className="ap-meta-lbl">{label}</span>
                    {isAdmin && isEditing ? (
                      input === "select"
                        ? <select className="ap-field-select"
                            value={(editData as any)[key]}
                            onChange={(e) => setF(key as any, e.target.value)}>
                            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        : <input className="ap-field-input"
                            value={(editData as any)[key]}
                            onChange={(e) => setF(key as any, e.target.value)} />
                    ) : (
                      key === "eligibility"
                        ? <span className={`ap-elig ${eligClass((selected as any)[key])}`}>{(selected as any)[key]}</span>
                        : <span className="ap-meta-val">{(selected as any)[key] || "—"}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Meta grid row 2 */}
              <div className="ap-meta-grid-3">
                {([
                  { key: "dealerName", label: "Dealer name", input: "text"   as const, opts: [] as string[] },
                  { key: "location",   label: "City, State", input: "text"   as const, opts: [] as string[] },
                  { key: "month",      label: "Month",       input: "select" as const, opts: MONTHS },
                ]).map(({ key, label, input, opts }) => (
                  <div key={key} className="ap-meta-cell">
                    <span className="ap-meta-lbl">{label}</span>
                    {isAdmin && isEditing ? (
                      input === "select"
                        ? <select className="ap-field-select"
                            value={(editData as any)[key]}
                            onChange={(e) => setF(key as any, e.target.value)}>
                            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        : <input className="ap-field-input"
                            value={(editData as any)[key]}
                            onChange={(e) => setF(key as any, e.target.value)} />
                    ) : (
                      <span className="ap-meta-val">{(selected as any)[key] || "—"}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Remarks */}
              {isAdmin && isEditing ? (
                <div className="ap-remarks-edit">
                  <span className="ap-meta-lbl">RSM remarks</span>
                  <textarea className="ap-field-textarea" rows={2}
                    value={editData.remarks}
                    onChange={(e) => setF("remarks", e.target.value)} />
                </div>
              ) : selected.remarks ? (
                <div className="ap-remarks">
                  <span className="ap-remarks-lbl">RSM remarks</span>
                  <p className="ap-remarks-text">{selected.remarks}</p>
                </div>
              ) : null}

              {/* Activities table */}
              <div className="ap-section-header">
                <span className="ap-sec-head">Activities</span>
                {isAdmin && isEditing && (
                  <button className="ap-add-row-btn" onClick={addRow}>+ Add row</button>
                )}
              </div>

              <div className="ap-itbl-wrap">
                <div style={{ overflowX: "auto" }}>
                  <table className="ap-itbl" style={{ minWidth: isEditing ? 700 : "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}>#</th>
                        <th>Activity type</th>
                        <th className="ap-num" style={{ width: 70 }}>Target</th>
                        <th>Dates</th>
                        <th className="ap-num" style={{ width: 100 }}>Budget (₹)</th>
                        <th className="ap-num" style={{ width: 100 }}>Incentive (₹)</th>
                        <th className="ap-num" style={{ width: 100 }}>Total (₹)</th>
                        {isAdmin && isEditing && <th style={{ width: 32 }}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(isEditing ? editData.activities : selected.activities).map((a, i) =>
                        isAdmin && isEditing ? (
                          <tr key={i} className={i % 2 === 0 ? "ap-erow-even" : "ap-erow-odd"}>
                            <td className="ap-td-num" style={{ color: "var(--color-text-tertiary)" }}>{i + 1}</td>
                            <td className="ap-td">
                              <select className="ap-cell-select"
                                value={(a as EditActivity).activityType}
                                onChange={(e) => setAF(i, "activityType", e.target.value)}>
                                <option value="">Select…</option>
                                {ACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td className="ap-td-num">
                              <input type="number" min={0} className="ap-cell-num"
                                value={(a as EditActivity).target}
                                onChange={(e) => setAF(i, "target", e.target.value)} />
                            </td>
                            <td className="ap-td">
                              <div className="ap-date-pair">
                                <input type="date" className="ap-cell-date"
                                  value={(a as EditActivity).startDate}
                                  onChange={(e) => setAF(i, "startDate", e.target.value)} />
                                <span className="ap-date-arrow">→</span>
                                <input type="date" className="ap-cell-date"
                                  value={(a as EditActivity).endDate}
                                  min={(a as EditActivity).startDate || undefined}
                                  onChange={(e) => setAF(i, "endDate", e.target.value)} />
                              </div>
                            </td>
                            <td className="ap-td-num">
                              <input type="number" min={0} className="ap-cell-num"
                                value={(a as EditActivity).budget}
                                onChange={(e) => setAF(i, "budget", e.target.value)} />
                            </td>
                            <td className="ap-td-num">
                              <input type="number" min={0} className="ap-cell-num"
                                value={(a as EditActivity).incentive}
                                onChange={(e) => setAF(i, "incentive", e.target.value)} />
                            </td>
                            <td className="ap-td-num ap-bold">
                              {inr(num((a as EditActivity).budget) + num((a as EditActivity).incentive))}
                            </td>
                            <td className="ap-td" style={{ textAlign: "center" }}>
                              <button className="ap-rm-btn"
                                onClick={() => removeRow(i)}
                                disabled={editData.activities.length === 1}>×</button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={i}>
                            <td className="ap-td-num" style={{ color: "var(--color-text-tertiary)" }}>{i + 1}</td>
                            <td className="ap-td ap-bold">{(a as ActivityResponse).activityType}</td>
                            <td className="ap-td-num">{(a as ActivityResponse).target}</td>
                            <td className="ap-td" style={{ color: "var(--color-text-secondary)" }}>
                              {fmtDate((a as ActivityResponse).startDate)}
                              {(a as ActivityResponse).startDate !== (a as ActivityResponse).endDate &&
                                <> → {fmtDate((a as ActivityResponse).endDate)}</>}
                            </td>
                            <td className="ap-td-num">{inr((a as ActivityResponse).budget)}</td>
                            <td className="ap-td-num">{inr((a as ActivityResponse).incentive)}</td>
                            <td className="ap-td-num ap-bold">
                              {inr((a as ActivityResponse).budget + (a as ActivityResponse).incentive)}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
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

              <div className="ap-cac-warning">
                ⚠ {selected.cacWarning}
              </div>

              {/* ══ POST-APPROVAL ACTUALS PANEL ══ */}
              {selected.status === "Approved" && (
                <div className="ap-actuals-box">
                  <div className="ap-section-header" style={{ marginBottom: 14 }}>
                    <span className="ap-sec-head">Post-Activity Actuals</span>
                    <span className="ap-actuals-badge">Approved ✓</span>
                  </div>
                  <p className="ap-actuals-hint">
                    Enter actual dates and upload proof/media for each activity.
                  </p>

                  <div className="ap-actuals-list">
                    {selected.activities.map((a, i) => {
                      const d = actualsData[a.id];
                      if (!d) return null;
                      return (
                        <div key={a.id} className="ap-actual-row">

                          {/* Activity label */}
                          <div className="ap-actual-label">
                            <span className="ap-actual-num">{i + 1}</span>
                            <span className="ap-actual-type">{a.activityType}</span>
                            <span className="ap-actual-planned">
                              Planned: {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                            </span>
                          </div>

                          <div className="ap-actual-fields">

                            {/* Actual Start Date */}
                            <div className="ap-actual-field">
                              <label className="ap-actual-flbl">Actual Start Date</label>
                              <input type="date" className="ap-actual-input"
                                value={d.actualStartDate}
                                onChange={(e) => setActualField(a.id, "actualStartDate", e.target.value)} />
                            </div>

                            {/* Actual End Date */}
                            <div className="ap-actual-field">
                              <label className="ap-actual-flbl">Actual End Date</label>
                              <input type="date" className="ap-actual-input"
                                value={d.actualEndDate}
                                min={d.actualStartDate || undefined}
                                onChange={(e) => setActualField(a.id, "actualEndDate", e.target.value)} />
                            </div>

                            {/* Media upload */}
                            <div className="ap-actual-field ap-actual-field--media">
                              <label className="ap-actual-flbl">Proof / Media</label>

                              {d.mediaFileName ? (
                                <div className="ap-media-uploaded">
                                  <span className="ap-media-icon">
                                    {d.mediaFileType?.startsWith("image") ? "🖼" :
                                     d.mediaFileType?.includes("pdf")     ? "📄" :
                                     d.mediaFileType?.includes("video")   ? "🎬" : "📎"}
                                  </span>
                                  <span className="ap-media-name" title={d.mediaFileName}>
                                    {d.mediaFileName}
                                  </span>
                                  {d.mediaFileUrl && (
                                    <a href={d.mediaFileUrl} target="_blank"
                                      rel="noreferrer" className="ap-media-view">
                                      View
                                    </a>
                                  )}
                                  <label className="ap-media-replace"
                                    htmlFor={`media-${a.id}`}>
                                    Replace
                                    <input
                                      id={`media-${a.id}`}
                                      ref={(el) => { fileInputRefs.current[a.id] = el; }}
                                      type="file"
                                      accept="image/*,.pdf,.mp4,.mov,.avi"
                                      style={{ display: "none" }}
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) handleMediaSelect(a.id, f);
                                        e.target.value = "";
                                      }} />
                                  </label>
                                </div>
                              ) : (
                                <label
                                  className={`ap-media-upload-btn ${d.uploading ? "ap-media-upload-btn--loading" : ""}`}
                                  htmlFor={`media-${a.id}`}>
                                  {d.uploading ? (
                                    <span className="ap-media-uploading">
                                      <span className="ap-spin-sm" /> Uploading…
                                    </span>
                                  ) : (
                                    <span>📎 Upload file</span>
                                  )}
                                  <input
                                    id={`media-${a.id}`}
                                    ref={(el) => { fileInputRefs.current[a.id] = el; }}
                                    type="file"
                                    accept="image/*,.pdf,.mp4,.mov,.avi"
                                    style={{ display: "none" }}
                                    disabled={d.uploading}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) handleMediaSelect(a.id, f);
                                      e.target.value = "";
                                    }} />
                                </label>
                              )}
                            </div>
                          </div>

                          {/* Show existing actual dates if saved */}
                          {(a.actualStartDate || a.actualEndDate) && (
                            <div className="ap-actual-saved">
                              <span className="ap-actual-saved-lbl">Last saved:</span>
                              <span>{fmtDate(a.actualStartDate)} → {fmtDate(a.actualEndDate)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Save actuals button */}
                  <div className="ap-actuals-footer">
                    <button className="ap-save-actuals-btn"
                      onClick={saveActuals}
                      disabled={actualsLoading}>
                      {actualsLoading ? "Saving…" : "💾 Save Actuals"}
                    </button>
                  </div>
                </div>
              )}

              {/* ══ ADMIN DECISION PANEL ══ */}
              {isAdmin && selected.status === "Pending" && !isEditing && (
                <div className="ap-action-box">
                  <p className="ap-sec-head" style={{ marginBottom: 10 }}>Decision</p>

                  <textarea className="ap-note-input" rows={3}
                    placeholder="Add a note for the RSM (optional)…"
                    value={note} onChange={(e) => setNote(e.target.value)} />

                  <div className="ap-btn-row">
                    <button className="ap-approve-btn"
                      disabled={actionLoading} onClick={() => decide("Approved")}>
                      {actionLoading ? "Processing…" : "✓  Approve"}
                    </button>
                    <button className="ap-reject-btn"
                      disabled={actionLoading} onClick={() => decide("Rejected")}>
                      {actionLoading ? "Processing…" : "✕  Reject"}
                    </button>
                  </div>

                  <div className="ap-sendback-row">
                    <button className="ap-sendback-trigger"
                      onClick={() => setShowSendBack((v) => !v)}>
                      ↩ Send back for revision
                    </button>
                  </div>

                  {showSendBack && (
                    <div className="ap-sendback-box">
                      <p className="ap-sendback-label">Explain what needs to be revised:</p>
                      <textarea className="ap-note-input" rows={3}
                        placeholder="e.g. Please increase target for Road Show activity…"
                        value={sendBackNote}
                        onChange={(e) => setSendBackNote(e.target.value)} />
                      <div className="ap-btn-row">
                        <button className="ap-sendback-btn"
                          disabled={actionLoading} onClick={handleSendBack}>
                          {actionLoading ? "Sending…" : "↩ Send for revision"}
                        </button>
                        <button className="ap-discard-btn"
                          onClick={() => { setShowSendBack(false); setSendBackNote(""); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══ RSM VIEW — decision result ══ */}
              {!isAdmin && selected.status !== "Pending" && (
                <div className={`ap-decision-banner ${
                  selected.status === "Approved"      ? "ap-decision-approved"
                  : selected.status === "Rejected"    ? "ap-decision-rejected"
                  : "ap-decision-revision"}`}>
                  <div className="ap-decision-head">
                    <strong>
                      {selected.status === "NeedsRevision" ? "Revision requested" : selected.status}
                    </strong>
                    {selected.decidedAt && (
                      <span className="ap-decision-date">
                        {fmtDate(selected.decidedAt)}
                        {selected.approvedBy && ` · ${selected.approvedBy}`}
                      </span>
                    )}
                  </div>
                  {selected.approverNote && (
                    <p className="ap-decision-note">{selected.approverNote}</p>
                  )}
                  {selected.status === "NeedsRevision" && (
                    <button className="ap-goto-edit-btn"
                      onClick={() => navigate(`/rsm-form?edit=${selected.id}`)}>
                      ✏ Edit &amp; resubmit →
                    </button>
                  )}
                </div>
              )}

              {/* ══ ADMIN — finalised banner ══ */}
              {isAdmin && (selected.status === "Approved" || selected.status === "Rejected") && (
                <div className={`ap-decision-banner ${
                  selected.status === "Approved" ? "ap-decision-approved" : "ap-decision-rejected"}`}>
                  <div className="ap-decision-head">
                    <strong>{selected.status}</strong>
                    {selected.decidedAt && (
                      <span className="ap-decision-date">
                        {fmtDate(selected.decidedAt)}
                        {selected.approvedBy && ` · ${selected.approvedBy}`}
                      </span>
                    )}
                  </div>
                  {selected.approverNote && (
                    <p className="ap-decision-note">{selected.approverNote}</p>
                  )}
                </div>
              )}

            </div>

            {/* Sticky save footer (edit mode) */}
            {isAdmin && isEditing && (
              <div className="ap-save-footer">
                <span className="ap-save-footer-hint">Unsaved changes</span>
                <button className="ap-discard-btn"
                  onClick={() => { setEditData(toEditable(selected)); setIsEditing(false); }}>
                  Discard
                </button>
                <button className="ap-save-btn" onClick={saveEdits} disabled={saveLoading}>
                  {saveLoading ? "Saving…" : "💾 Save changes"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`ap-toast ${toast.ok ? "ap-toast-ok" : "ap-toast-err"}`}>
          {toast.ok ? "✓" : "✕"}&nbsp;{toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="ap-stat">
      <span className={`ap-stat-val ap-${color}`}>{value}</span>
      <span className="ap-stat-lbl">{label}</span>
    </div>
  );
}

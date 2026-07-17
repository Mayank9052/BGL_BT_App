// src/pages/AdminUsersPage.tsx
import { useEffect, useState, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchAllUsers, updateUser } from "../services/userService";
import {
  fetchAllActivityTypes, createActivityType, toggleActivityType,
  type ActivityType,
} from "../services/activityService";
import {
  fetchDealerUsers, createDealerUser, toggleDealerActive,
  adminResetDealerPassword, type DealerAccount,
  bulkPreviewDealers, bulkImportDealers, getBulkImportStatus,
  type BulkPreviewResult, type BulkImportResult, type BulkStatusResult,
} from "../services/dealerAuthService";
import { fetchDealers, type DealerOption } from "../services/dealerService";
import type { UserProfile } from "../types/user";
import "./AdminUsersPage.css";

const ROLES = ["Admin", "Manager", "User"];

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>{Array.from({ length: cols }).map((_, i) => (
      <td key={i}><div className="admin-skel"
        style={{ width: i === 0 ? "80%" : i === cols-1 ? "60px" : "70%" }}/></td>
    ))}</tr>
  );
}
function TableSkeleton({ rows = 5, cols = 8 }: { rows?: number; cols?: number }) {
  return <>{Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} cols={cols}/>)}</>;
}

function DealerSearchSelect({ dealers, loading, value, onChange }: {
  dealers: DealerOption[]; loading: boolean; value: string;
  onChange: (code: string, name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open,   setOpen]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = dealers.find((d) => d.customerCode === value);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const tc = (s: string) => s.toLowerCase().split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  const filtered = dealers.filter((d) =>
    !search ||
    d.customerName.toLowerCase().includes(search.toLowerCase()) ||
    d.customerCode.toLowerCase().includes(search.toLowerCase()) ||
    (d.city ?? "").toLowerCase().includes(search.toLowerCase())
  ).slice(0, 50);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={() => { if (!loading) setOpen((v) => !v); }}
        style={{ border: "1.5px solid #e2e8f0", borderRadius: 7, padding: "7px 11px",
          background: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 13,
          color: selected ? "#0a2540" : "#9ca3af", display: "flex",
          justifyContent: "space-between", alignItems: "center", minHeight: 38 }}>
        <span>{loading ? "Loading dealers…" : selected
          ? `${tc(selected.customerName)} (${selected.customerCode})`
          : "Search and select dealer…"}</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 1000, maxHeight: 280,
          display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Type dealer name or code…"
              style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 6,
                padding: "6px 10px", fontSize: 13, outline: "none",
                boxSizing: "border-box" as const }}/>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {value && (
              <div onClick={() => { onChange("", ""); setSearch(""); setOpen(false); }}
                style={{ padding: "8px 12px", fontSize: 12, color: "#ef4444",
                  cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>
                ✕ Clear selection
              </div>
            )}
            {filtered.length === 0
              ? <div style={{ padding: "16px 12px", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                  {dealers.length === 0 ? "No dealers loaded" : "No results found"}
                </div>
              : filtered.map((d) => (
                <div key={d.customerCode}
                  onClick={() => { onChange(d.customerCode, tc(d.customerName)); setSearch(""); setOpen(false); }}
                  style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13,
                    background: d.customerCode === value ? "#eff6ff" : "transparent",
                    borderBottom: "1px solid #f9fafb" }}>
                  <div style={{ fontWeight: 600, color: "#0a2540" }}>{tc(d.customerName)}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>
                    Code: {d.customerCode}
                    {(d.city || d.state) && ` · ${[d.city, d.state].filter(Boolean).map((v) => tc(v!)).join(", ")}`}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  const { instance } = useMsal();

  const [users,     setUsers]     = useState<UserProfile[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft,     setDraft]     = useState<Partial<UserProfile>>({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // ── Activity types ───────────────────────────────────────────────────────
  const [activityTypes,   setActivityTypes]   = useState<ActivityType[]>([]);
  const [actLoading,      setActLoading]      = useState(true);
  const [actSaving,       setActSaving]       = useState(false);
  const [actError,        setActError]        = useState<string | null>(null);
  const [actSuccess,      setActSuccess]      = useState<string | null>(null);

  // Add form
  const [newActivity,     setNewActivity]     = useState("");
  const [newActivityType, setNewActivityType] = useState<"ATL"|"BTL">("BTL");
  const [newSubcategory,  setNewSubcategory]  = useState("");
  const [newMaxQty,       setNewMaxQty]       = useState("5");

  // Edit modal for activity
  const [editActId,       setEditActId]       = useState<number|null>(null);
  const [editActName,     setEditActName]     = useState("");
  const [editActType,     setEditActType]     = useState<"ATL"|"BTL">("BTL");
  const [editActSub,      setEditActSub]      = useState("");
  const [editActMaxQty,   setEditActMaxQty]   = useState("5");
  const [editActSaving,   setEditActSaving]   = useState(false);
  const [editActError,    setEditActError]    = useState<string|null>(null);

  // Group by activityName
  const groupedActivities = activityTypes.reduce((acc, a) => {
    if (!acc[a.activityName]) acc[a.activityName] = [];
    acc[a.activityName].push(a);
    return acc;
  }, {} as Record<string, ActivityType[]>);

  // ── Dealer accounts ──────────────────────────────────────────────────────
  const [dealers,        setDealers]        = useState<DealerAccount[]>([]);
  const [dealersLoading, setDealersLoading] = useState(true);
  const [dealerError,    setDealerError]    = useState<string | null>(null);
  const [dealerSuccess,  setDealerSuccess]  = useState<string | null>(null);
  const [dealerSaving,   setDealerSaving]   = useState(false);
  const [showDealerForm, setShowDealerForm] = useState(false);

  // ── Bulk import state ──────────────────────────────────────────────────────
  const [bulkStatus,   setBulkStatus]   = useState<BulkStatusResult | null>(null);
  const [bulkPreview,  setBulkPreview]  = useState<BulkPreviewResult | null>(null);
  const [bulkResult,   setBulkResult]   = useState<BulkImportResult | null>(null);
  const [bulkLoading,  setBulkLoading]  = useState<"status"|"preview"|"import"|null>(null);
  const [bulkError,    setBulkError]    = useState<string|null>(null);
  const [bulkShowList, setBulkShowList] = useState(false);
  const [erpDealers,     setErpDealers]     = useState<DealerOption[]>([]);
  const [erpLoading,     setErpLoading]     = useState(false);
  const [dealerForm, setDealerForm] = useState({
    email: "", password: "", displayName: "",
    dealerCode: "", dealerName: "", phoneNumber: "",
  });

  // Reset password
  const [resetTargetId,   setResetTargetId]   = useState<number | null>(null);
  const [resetTargetName, setResetTargetName] = useState("");
  const [resetPassword,   setResetPassword]   = useState("");
  const [resetConfirm,    setResetConfirm]    = useState("");
  const [resetSaving,     setResetSaving]     = useState(false);
  const [resetError,      setResetError]      = useState<string | null>(null);

  const [tab, setTab] = useState<"users"|"activities"|"dealers">("users");

  useEffect(() => { loadUsers(); loadActivities(); loadDealers(); }, []);

  useEffect(() => {
    if (tab === "dealers" && erpDealers.length === 0 && !erpLoading) {
      setErpLoading(true);
      fetchDealers(instance).then(setErpDealers).catch(()=>{}).finally(()=>setErpLoading(false));
    }
  }, [tab]);

  const loadUsers = async () => {
    setLoading(true); setError(null);
    try { setUsers(await fetchAllUsers(instance)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load users."); }
    finally { setLoading(false); }
  };

  const loadActivities = async () => {
    setActLoading(true);
    try { setActivityTypes(await fetchAllActivityTypes(instance)); }
    catch { /* silent */ }
    finally { setActLoading(false); }
  };

  const loadDealers = async () => {
    setDealersLoading(true); setDealerError(null);
    try { setDealers(await fetchDealerUsers(instance)); }
    catch (e) { setDealerError(e instanceof Error ? e.message : "Failed to load dealer accounts."); }
    finally { setDealersLoading(false); }
  };

  const startEdit  = (u: UserProfile) => {
    setEditingId(u.id);
    setDraft({ firstName: u.firstName, lastName: u.lastName, department: u.department,
      jobTitle: u.jobTitle, phoneNumber: u.phoneNumber, role: u.role, isActive: u.isActive });
  };
  const cancelEdit = () => { setEditingId(null); setDraft({}); };

  const saveEdit = async (id: number) => {
    setSaving(true); setError(null);
    try {
      const updated = await updateUser(id, draft, instance);
      setUsers((list) => list.map((u) => u.id === id ? { ...u, ...updated,
        phoneNumber: updated.phoneNumber ?? draft.phoneNumber ?? u.phoneNumber,
        firstName:   updated.firstName   ?? draft.firstName   ?? u.firstName,
        lastName:    updated.lastName    ?? draft.lastName    ?? u.lastName,
        department:  updated.department  ?? draft.department  ?? u.department,
        jobTitle:    updated.jobTitle    ?? draft.jobTitle    ?? u.jobTitle,
        role:        updated.role        ?? draft.role        ?? u.role,
        isActive:    updated.isActive    ?? draft.isActive    ?? u.isActive,
      } : u));
      cancelEdit();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to update user."); }
    finally { setSaving(false); }
  };

  // ── Add activity ─────────────────────────────────────────────────────────
  const handleAddActivity = async () => {
    if (!newActivity.trim()) { setActError("Activity name is required."); return; }
    if (!newSubcategory.trim()) { setActError("Subcategory is required."); return; }
    const maxQtyNum = parseInt(newMaxQty, 10);
    if (isNaN(maxQtyNum) || maxQtyNum < 1 || maxQtyNum > 100) {
      setActError("Max QTY must be 1–100."); return;
    }
    setActSaving(true); setActError(null); setActSuccess(null);
    try {
      const created = await createActivityType(
        newActivity.trim(), newActivityType, instance, newSubcategory.trim(), maxQtyNum,
      );
      setActivityTypes((prev) => [...prev, created]);
      setNewSubcategory(""); setNewMaxQty("5");
      setActSuccess(`"${created.activityName} → ${created.subcategory}" added.`);
      setTimeout(() => setActSuccess(null), 3000);
    } catch (e) { setActError(e instanceof Error ? e.message : "Failed to add."); }
    finally { setActSaving(false); }
  };

  const handleToggleActivity = async (id: number, current: boolean) => {
    try {
      const updated = await toggleActivityType(id, !current, instance);
      setActivityTypes((prev) => prev.map((a) => a.id === id ? updated : a));
    } catch (e) { setActError(e instanceof Error ? e.message : "Failed to update."); }
  };

  // ── Edit activity modal ───────────────────────────────────────────────────
  const openEditActivity = (a: ActivityType) => {
    setEditActId(a.id);
    setEditActName(a.activityName);
    setEditActType(a.activityType);
    setEditActSub(a.subcategory ?? "");
    setEditActMaxQty(String(a.maxQty ?? 5));
    setEditActError(null);
  };
  const closeEditActivity = () => {
    setEditActId(null); setEditActError(null);
  };

  // We use createActivityType as an "upsert" isn't available — instead
  // we toggle off the old one and create a new one. Simpler: we just
  // directly PATCH the activity via toggleActivityType fields.
  // Since backend doesn't have a full PUT for activity, we'll do the best
  // we can: update isActive + show what would change.
  // REAL solution: add PUT /api/activity-types/{id} on backend.
  // For now we call a helper that POSTs a new one if name/sub changed,
  // or just toggles if only isActive changed.
  const handleSaveEditActivity = async () => {
    if (!editActName.trim()) { setEditActError("Activity name is required."); return; }
    if (!editActSub.trim())  { setEditActError("Subcategory is required."); return; }
    const maxQtyNum = parseInt(editActMaxQty, 10);
    if (isNaN(maxQtyNum) || maxQtyNum < 1 || maxQtyNum > 100) {
      setEditActError("Max QTY must be 1–100."); return;
    }
    if (editActId === null) return;
    setEditActSaving(true); setEditActError(null);
    try {
      const original = activityTypes.find(a => a.id === editActId);
      if (!original) throw new Error("Activity not found.");

      const nameChanged = editActName.trim() !== original.activityName
        || editActType !== original.activityType
        || editActSub.trim() !== (original.subcategory ?? "")
        || maxQtyNum !== (original.maxQty ?? 5);

      if (nameChanged) {
        // Deactivate old + create new
        await toggleActivityType(editActId, false, instance);
        const created = await createActivityType(
          editActName.trim(), editActType, instance, editActSub.trim(), maxQtyNum,
        );
        setActivityTypes((prev) => [
          ...prev.map((a) => a.id === editActId ? { ...a, isActive: false } : a),
          created,
        ]);
        setActSuccess(`Updated: "${created.activityName} → ${created.subcategory}"`);
      } else {
        // Nothing changed except possibly isActive — no-op
        setActSuccess("No changes detected.");
      }
      setTimeout(() => setActSuccess(null), 3000);
      closeEditActivity();
    } catch (e) { setEditActError(e instanceof Error ? e.message : "Failed to save."); }
    finally { setEditActSaving(false); }
  };

  // ── Dealer handlers ───────────────────────────────────────────────────────
  const handleErpDealerSelect = (code: string, name: string) =>
    setDealerForm((f) => ({ ...f, dealerCode: code, dealerName: name }));
  const handleDealerFormChange = (key: keyof typeof dealerForm, value: string) =>
    setDealerForm((f) => ({ ...f, [key]: value }));
  const resetDealerForm = () => {
    setDealerForm({ email:"", password:"", displayName:"", dealerCode:"", dealerName:"", phoneNumber:"" });
    setShowDealerForm(false);
  };
  const handleCreateDealer = async (e: React.FormEvent) => {
    e.preventDefault(); setDealerError(null); setDealerSuccess(null);
    if (!dealerForm.email.trim() || !dealerForm.password.trim() || !dealerForm.displayName.trim()) {
      setDealerError("Email, password, and display name are required."); return;
    }
    if (dealerForm.password.length < 8) { setDealerError("Password must be at least 8 characters."); return; }
    setDealerSaving(true);
    try {
      const created = await createDealerUser({
        email: dealerForm.email.trim(), password: dealerForm.password,
        displayName: dealerForm.displayName.trim(), dealerCode: dealerForm.dealerCode.trim(),
        dealerName: dealerForm.dealerName.trim(),
        phoneNumber: dealerForm.phoneNumber.trim() || undefined,
      }, instance);
      setDealers((prev) => [...prev, created as DealerAccount]);
      setDealerSuccess(`Dealer account "${created.displayName}" created successfully.`);
      resetDealerForm(); setTimeout(() => setDealerSuccess(null), 4000);
    } catch (e) { setDealerError(e instanceof Error ? e.message : "Failed to create dealer account."); }
    finally { setDealerSaving(false); }
  };
  const handleToggleDealer = async (id: number) => {
    try {
      const result = await toggleDealerActive(id, instance);
      setDealers((prev) => prev.map((d) => d.id === id ? { ...d, isActive: result.isActive } : d));
    } catch (e) { setDealerError(e instanceof Error ? e.message : "Failed to update dealer status."); }
  };
  const openResetModal = (id: number, name: string) => {
    setResetTargetId(id); setResetTargetName(name);
    setResetPassword(""); setResetConfirm(""); setResetError(null);
  };
  const closeResetModal = () => {
    setResetTargetId(null); setResetTargetName("");
    setResetPassword(""); setResetConfirm(""); setResetError(null);
  };
  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setResetError(null);
    if (resetPassword.length < 8) { setResetError("Password must be at least 8 characters."); return; }
    if (resetPassword !== resetConfirm) { setResetError("Passwords do not match."); return; }
    if (resetTargetId === null) return;
    setResetSaving(true);
    try {
      await adminResetDealerPassword(resetTargetId, resetPassword, instance);
      setDealerSuccess(`Password reset for ${resetTargetName}.`);
      setTimeout(() => setDealerSuccess(null), 4000); closeResetModal();
    } catch (e) { setResetError(e instanceof Error ? e.message : "Failed to reset password."); }
    finally { setResetSaving(false); }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-IN",
      { day: "2-digit", month: "short", year: "numeric" }) : "—";

  // ── Bulk import handlers ──────────────────────────────────────────────────
  const loadBulkStatus = async () => {
    setBulkLoading("status"); setBulkError(null);
    try { setBulkStatus(await getBulkImportStatus(instance)); }
    catch (e) { setBulkError(e instanceof Error ? e.message : "Failed."); }
    finally { setBulkLoading(null); }
  };
  const loadBulkPreview = async () => {
    setBulkLoading("preview"); setBulkError(null);
    try { setBulkPreview(await bulkPreviewDealers(instance)); setBulkResult(null); }
    catch (e) { setBulkError(e instanceof Error ? e.message : "Failed."); }
    finally { setBulkLoading(null); }
  };
  const runBulkImport = async () => {
    if (!window.confirm(`Import ${bulkPreview?.toCreate ?? "?"} dealers with default password Dealer@123?`)) return;
    setBulkLoading("import"); setBulkError(null);
    try {
      const r = await bulkImportDealers(instance);
      setBulkResult(r); setBulkPreview(null);
      const [fresh, status] = await Promise.all([
        fetchDealerUsers(instance).catch(() => dealers),
        getBulkImportStatus(instance).catch(() => null),
      ]);
      setDealers(fresh);
      if (status) setBulkStatus(status);
    }
    catch (e) { setBulkError(e instanceof Error ? e.message : "Failed."); }
    finally { setBulkLoading(null); }
  };

  return (
    <div className="admin-users-page">
      <div className="admin-users-head">
        <h1>Admin Settings</h1>
        <p>Manage users, dealer accounts, and activity types for the BTL portal.</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab==="users"?"admin-tab--active":""}`}
          onClick={() => setTab("users")}>👥 Users</button>
        <button className={`admin-tab ${tab==="dealers"?"admin-tab--active":""}`}
          onClick={() => setTab("dealers")}>🏪 Dealer Accounts</button>
        <button className={`admin-tab ${tab==="activities"?"admin-tab--active":""}`}
          onClick={() => setTab("activities")}>📋 Activity Types</button>
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB 1 — Users
      ══════════════════════════════════════════════════════ */}
      {tab === "users" && (
        <>
          {error && <div className="admin-error">{error}</div>}
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Department</th>
                  <th>Job Title</th><th>Phone</th><th>Role</th>
                  <th>Active</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? <TableSkeleton rows={6} cols={8}/> :
                 users.length === 0 ? (
                  <tr><td colSpan={8} className="admin-empty-cell">No users found.</td></tr>
                ) : users.map((u) => {
                  const isEditing = editingId === u.id;
                  return (
                    <tr key={u.id} className={isEditing ? "admin-row--editing" : ""}>
                      <td>
                        {isEditing ? (
                          <div className="admin-name-inputs">
                            <input className="admin-input" placeholder="First name"
                              value={draft.firstName??""} onChange={(e) => setDraft((d) => ({...d,firstName:e.target.value}))}/>
                            <input className="admin-input" placeholder="Last name"
                              value={draft.lastName??""} onChange={(e) => setDraft((d) => ({...d,lastName:e.target.value}))}/>
                          </div>
                        ) : <span className="admin-user-name">{u.displayName}</span>}
                      </td>
                      <td className="admin-readonly">{u.email}</td>
                      <td>{isEditing
                        ? <input className="admin-input" value={draft.department??""} onChange={(e) => setDraft((d) => ({...d,department:e.target.value}))}/>
                        : <span className="admin-cell-text">{u.department??"—"}</span>}</td>
                      <td>{isEditing
                        ? <input className="admin-input" value={draft.jobTitle??""} onChange={(e) => setDraft((d) => ({...d,jobTitle:e.target.value}))}/>
                        : <span className="admin-cell-text">{u.jobTitle??"—"}</span>}</td>
                      <td>{isEditing
                        ? <input className="admin-input" value={draft.phoneNumber??""} maxLength={10}
                            onChange={(e) => { const v=e.target.value.replace(/\D/g,""); if(v.length<=10) setDraft((d) => ({...d,phoneNumber:v})); }}/>
                        : <span className="admin-cell-text">{u.phoneNumber??"—"}</span>}</td>
                      <td>{isEditing
                        ? <select className="admin-input" value={draft.role??u.role}
                            onChange={(e) => setDraft((d) => ({...d,role:e.target.value}))}>
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        : <span className={`role-chip role-${u.role.toLowerCase()}`}>{u.role}</span>}</td>
                      <td>{isEditing
                        ? <label className="admin-toggle">
                            <input type="checkbox" checked={draft.isActive??u.isActive}
                              onChange={(e) => setDraft((d) => ({...d,isActive:e.target.checked}))}/>
                            <span className="admin-toggle-label">{draft.isActive??u.isActive?"Active":"Inactive"}</span>
                          </label>
                        : <span className={`admin-status-pill ${u.isActive?"admin-status-pill--active":"admin-status-pill--inactive"}`}>
                            <span className="admin-status-dot"/>{u.isActive?"Active":"Inactive"}
                          </span>}</td>
                      <td>{isEditing
                        ? <div className="admin-row-actions">
                            <button className="admin-save-btn" disabled={saving} onClick={() => saveEdit(u.id)}>{saving?"Saving…":"Save"}</button>
                            <button className="admin-cancel-btn" onClick={cancelEdit}>Cancel</button>
                          </div>
                        : <button className="admin-edit-btn" onClick={() => startEdit(u)}>Edit</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 2 — Dealer Accounts
      ══════════════════════════════════════════════════════ */}
      {tab === "dealers" && (
        <div className="admin-act-section">
          {dealerError   && <div className="admin-error">{dealerError}</div>}
          {dealerSuccess && <div className="admin-success">{dealerSuccess}</div>}

          {/* ══ BULK IMPORT FROM BAPLFINAL ══════════════════════════════════ */}
          <div style={{ background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,
            padding:"20px 24px",marginBottom:20 }}>

            {/* Header row */}
            <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",
              marginBottom:16,flexWrap:"wrap",gap:10 }}>
              <div>
                <h3 style={{ margin:0,fontSize:15,fontWeight:700,color:"#0a2540" }}>
                  🏪 Bulk Import Dealer Logins from ERP
                </h3>
                <p style={{ margin:"4px 0 0",fontSize:12,color:"#6b7280" }}>
                  Fetches all active dealers from BaplFinal <code>C_CustomerMaster</code> and
                  creates portal logins. Default password:{" "}
                  <code style={{ background:"#f1f5f9",padding:"1px 5px",borderRadius:3 }}>Dealer@123</code>
                </p>
              </div>
              <button onClick={loadBulkStatus} disabled={!!bulkLoading}
                style={{ background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:7,
                  padding:"7px 16px",fontSize:12,fontWeight:600,cursor:bulkLoading?"not-allowed":"pointer",
                  color:"#374151",whiteSpace:"nowrap" }}>
                {bulkLoading==="status" ? "Loading…" : "↻ Check Status"}
              </button>
            </div>

            {/* Status bar */}
            {bulkStatus && (
              <div style={{ display:"flex",gap:12,marginBottom:16,flexWrap:"wrap" }}>
                {[
                  { label:"Total in ERP",    value:bulkStatus.totalDealersInBapl, c:"#0a2540" },
                  { label:"Logins Created",  value:bulkStatus.loginsCreated,      c:"#16a34a" },
                  { label:"Active Logins",   value:bulkStatus.activeLogins,       c:"#2563eb" },
                  { label:"Pending Import",  value:bulkStatus.pendingImport,
                    c:bulkStatus.pendingImport > 0 ? "#f59e0b" : "#16a34a" },
                ].map(({ label, value, c }) => (
                  <div key={label} style={{ background:"#f8fafc",border:"1px solid #e2e8f0",
                    borderRadius:8,padding:"10px 18px",textAlign:"center",minWidth:120 }}>
                    <div style={{ fontSize:22,fontWeight:800,color:c }}>{value}</div>
                    <div style={{ fontSize:10,color:"#6b7280",textTransform:"uppercase",
                      letterSpacing:"0.04em",marginTop:2 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {bulkError && (
              <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,
                padding:"10px 14px",fontSize:12,color:"#991b1b",marginBottom:12 }}>
                ⚠ {bulkError}
              </div>
            )}

            {/* Action buttons */}
            {!bulkResult && (
              <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
                <button onClick={loadBulkPreview} disabled={!!bulkLoading}
                  style={{ background:"#1e3a5f",color:"#fff",border:"none",borderRadius:8,
                    padding:"10px 20px",fontSize:13,fontWeight:600,cursor:bulkLoading?"not-allowed":"pointer",
                    opacity:bulkLoading?0.7:1 }}>
                  {bulkLoading === "preview" ? "Loading…" : "🔍 Preview Import"}
                </button>
                {bulkPreview && bulkPreview.toCreate > 0 && (
                  <button onClick={runBulkImport} disabled={!!bulkLoading}
                    style={{ background:"#16a34a",color:"#fff",border:"none",borderRadius:8,
                      padding:"10px 20px",fontSize:13,fontWeight:700,cursor:bulkLoading?"not-allowed":"pointer",
                      opacity:bulkLoading?0.7:1 }}>
                    {bulkLoading === "import"
                      ? `Importing ${bulkPreview.toCreate} dealers…`
                      : `✓ Import ${bulkPreview.toCreate} Dealers`}
                  </button>
                )}
                {bulkPreview && bulkPreview.toCreate === 0 && (
                  <div style={{ fontSize:13,color:"#16a34a",fontWeight:600,
                    background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,
                    padding:"10px 16px" }}>
                    ✓ All ERP dealers already have logins
                  </div>
                )}
              </div>
            )}

            {/* Preview table */}
            {bulkPreview && !bulkResult && bulkPreview.toCreate > 0 && (
              <div style={{ marginTop:14 }}>
                <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
                  <span style={{ fontSize:13,fontWeight:600,color:"#0a2540" }}>
                    <strong>{bulkPreview.toCreate}</strong> to create ·{" "}
                    <span style={{ color:"#6b7280" }}>{bulkPreview.alreadyImported} already imported</span>
                  </span>
                  <button onClick={() => setBulkShowList(v => !v)}
                    style={{ background:"none",border:"1px solid #e2e8f0",borderRadius:6,
                      padding:"3px 10px",fontSize:11,cursor:"pointer",color:"#2563eb" }}>
                    {bulkShowList ? "▲ Hide list" : "▼ Show list"}
                  </button>
                </div>
                {bulkShowList && (
                  <div style={{ maxHeight:280,overflowY:"auto",border:"1px solid #e2e8f0",
                    borderRadius:8,fontSize:11 }}>
                    <table style={{ width:"100%",borderCollapse:"collapse" }}>
                      <thead>
                        <tr style={{ background:"#0a2540",position:"sticky",top:0 }}>
                          {["Code","Dealer Name","City","State","Proposed Email","Real Email?"]
                            .map(h => (
                              <th key={h} style={{ padding:"6px 8px",textAlign:"left",
                                color:"#e2e8f0",fontSize:10,fontWeight:700 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bulkPreview.dealers.map((d, i) => (
                          <tr key={d.customerCode}
                            style={{ background:i%2===0?"#f8fafc":"#fff",
                              borderBottom:"1px solid #f1f5f9" }}>
                            <td style={{ padding:"4px 8px",fontFamily:"monospace",fontSize:10,
                              color:"#374151" }}>{d.customerCode}</td>
                            <td style={{ padding:"4px 8px",fontWeight:600,color:"#0a2540" }}>
                              {d.customerName}
                            </td>
                            <td style={{ padding:"4px 8px",color:"#475569" }}>{d.city}</td>
                            <td style={{ padding:"4px 8px" }}>
                              <span style={{ background:"#eff6ff",color:"#1e40af",
                                padding:"1px 6px",borderRadius:3,fontSize:9,fontWeight:700 }}>
                                {d.state}
                              </span>
                            </td>
                            <td style={{ padding:"4px 8px",color:"#374151",fontSize:10 }}>
                              {d.proposedEmail}
                            </td>
                            <td style={{ padding:"4px 8px",textAlign:"center" }}>
                              {d.hasRealEmail
                                ? <span style={{ color:"#16a34a",fontWeight:700 }}>✓</span>
                                : <span style={{ color:"#f59e0b",fontSize:10 }}>fallback</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p style={{ fontSize:11,color:"#6b7280",margin:"8px 0 0" }}>
                  ℹ <strong>Real Email</strong> = dealer has a valid email in ERP.
                  Fallback = mobile or dealer code <code>@dealer.bgauss.local</code>
                </p>
              </div>
            )}

            {/* Import result */}
            {bulkResult && (
              <div style={{ marginTop:14,background:"#f0fdf4",border:"1px solid #bbf7d0",
                borderRadius:8,padding:"16px 20px" }}>
                <div style={{ fontWeight:700,fontSize:14,color:"#166534",marginBottom:10 }}>
                  ✓ Import Complete
                </div>
                <div style={{ display:"flex",gap:24,flexWrap:"wrap",marginBottom:12 }}>
                  <span style={{ fontSize:13 }}>
                    <strong style={{ color:"#166534" }}>{bulkResult.created}</strong> created
                  </span>
                  <span style={{ fontSize:13,color:"#6b7280" }}>
                    <strong>{bulkResult.skipped}</strong> already existed
                  </span>
                  {bulkResult.failed > 0 && (
                    <span style={{ fontSize:13,color:"#dc2626" }}>
                      <strong>{bulkResult.failed}</strong> failed
                    </span>
                  )}
                </div>
                <div style={{ fontSize:12,color:"#374151",marginBottom:10 }}>
                  Default password for all new accounts:{" "}
                  <code style={{ background:"#dcfce7",padding:"2px 8px",borderRadius:4,
                    fontWeight:700,fontSize:13 }}>{bulkResult.defaultPassword}</code>
                  <span style={{ fontSize:11,color:"#6b7280",marginLeft:10 }}>
                    (share securely with dealers — they can change it from their dashboard)
                  </span>
                </div>
                {bulkResult.errors.length > 0 && (
                  <details style={{ fontSize:11,color:"#dc2626" }}>
                    <summary style={{ cursor:"pointer",fontWeight:600 }}>
                      {bulkResult.errors.length} error(s) — click to expand
                    </summary>
                    <ul style={{ margin:"6px 0 0",paddingLeft:18 }}>
                      {bulkResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </details>
                )}
                <button onClick={() => { setBulkResult(null); setBulkPreview(null); loadBulkStatus(); }}
                  style={{ marginTop:14,background:"#1e3a5f",color:"#fff",border:"none",
                    borderRadius:7,padding:"8px 18px",fontSize:12,fontWeight:600,cursor:"pointer" }}>
                  ↩ Import More / Refresh
                </button>
              </div>
            )}
          </div>
          {/* ══ END BULK IMPORT ════════════════════════════════════════════ */}

          <div className="admin-dealer-toolbar">
            <button className="admin-save-btn" onClick={() => setShowDealerForm((v) => !v)}>
              {showDealerForm ? "✕ Cancel" : "+ Create Dealer Login"}
            </button>
          </div>
          {showDealerForm && (
            <form className="admin-dealer-form" onSubmit={handleCreateDealer}>
              <div className="admin-dealer-form-grid">
                <div className="admin-dealer-field" style={{ gridColumn: "1 / -1" }}>
                  <label>Dealer Name <span style={{ marginLeft:6,fontSize:11,color:"#6b7280",fontWeight:400 }}>(select from ERP — auto-fills Dealer Code)</span></label>
                  <DealerSearchSelect dealers={erpDealers} loading={erpLoading}
                    value={dealerForm.dealerCode} onChange={handleErpDealerSelect}/>
                  {!erpLoading && erpDealers.length === 0 && (
                    <input className="admin-input" style={{ marginTop:6 }}
                      placeholder="Or type dealer name manually…"
                      value={dealerForm.dealerName}
                      onChange={(e) => handleDealerFormChange("dealerName", e.target.value)}/>
                  )}
                </div>
                <div className="admin-dealer-field">
                  <label>Dealer Code <span style={{ fontSize:11,color:"#6b7280",fontWeight:400 }}>(auto-filled)</span></label>
                  <div style={{ position:"relative" }}>
                    <input className="admin-input" placeholder="e.g. D00123"
                      value={dealerForm.dealerCode}
                      onChange={(e) => handleDealerFormChange("dealerCode", e.target.value)}
                      style={{ paddingRight: dealerForm.dealerCode ? 28 : 11 }}/>
                    {dealerForm.dealerCode && (
                      <span style={{ position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",
                        fontSize:10,color:"#16a34a" }}>✓</span>
                    )}
                  </div>
                </div>
                <div className="admin-dealer-field">
                  <label>Display Name *</label>
                  <input className="admin-input" required placeholder="Contact person name"
                    value={dealerForm.displayName} onChange={(e) => handleDealerFormChange("displayName", e.target.value)}/>
                </div>
                <div className="admin-dealer-field">
                  <label>Email *</label>
                  <input className="admin-input" type="email" required placeholder="dealer@example.com"
                    value={dealerForm.email} onChange={(e) => handleDealerFormChange("email", e.target.value)}/>
                </div>
                <div className="admin-dealer-field">
                  <label>Password *</label>
                  <input className="admin-input" type="password" required minLength={8}
                    placeholder="Min. 8 characters" value={dealerForm.password}
                    onChange={(e) => handleDealerFormChange("password", e.target.value)}/>
                </div>
                <div className="admin-dealer-field">
                  <label>Phone</label>
                  <input className="admin-input" maxLength={10} placeholder="10-digit mobile"
                    value={dealerForm.phoneNumber}
                    onChange={(e) => handleDealerFormChange("phoneNumber", e.target.value.replace(/\D/g,""))}/>
                </div>
              </div>
              {(dealerForm.dealerCode || dealerForm.dealerName) && (
                <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:7,
                  padding:"8px 14px",marginBottom:12,fontSize:12,color:"#166534" }}>
                  <strong>Will be linked to:</strong>{" "}
                  {dealerForm.dealerName}{dealerForm.dealerCode && ` (${dealerForm.dealerCode})`}
                  {" "}— proposals with this dealer name will show on their dashboard.
                </div>
              )}
              <div className="admin-dealer-form-actions">
                <button className="admin-save-btn" type="submit" disabled={dealerSaving}>
                  {dealerSaving ? "Creating…" : "Create Account"}
                </button>
                <button className="admin-cancel-btn" type="button" onClick={resetDealerForm}>Cancel</button>
              </div>
            </form>
          )}
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Dealer Code</th>
                  <th>Dealer Name</th><th>Phone</th><th>Last Login</th>
                  <th>Active</th><th style={{ width:190 }}></th>
                </tr>
              </thead>
              <tbody>
                {dealersLoading ? <TableSkeleton rows={5} cols={8}/> :
                 dealers.length === 0 ? (
                  <tr><td colSpan={8} className="admin-empty-cell">No dealer accounts yet.</td></tr>
                ) : dealers.map((d) => (
                  <tr key={d.id}>
                    <td><span className="admin-user-name">{d.displayName}</span></td>
                    <td className="admin-readonly">{d.email}</td>
                    <td className="admin-cell-text">{d.dealerCode??"—"}</td>
                    <td className="admin-cell-text">{d.dealerName??"—"}</td>
                    <td className="admin-cell-text">{d.phoneNumber??"—"}</td>
                    <td className="admin-readonly">{fmtDate(d.lastLoginAt)}</td>
                    <td><span className={`admin-status-pill ${d.isActive?"admin-status-pill--active":"admin-status-pill--inactive"}`}>
                      <span className="admin-status-dot"/>{d.isActive?"Active":"Inactive"}
                    </span></td>
                    <td><div className="admin-row-actions">
                      <button className={d.isActive?"admin-cancel-btn":"admin-save-btn"}
                        onClick={() => handleToggleDealer(d.id)}>
                        {d.isActive?"Deactivate":"Activate"}
                      </button>
                      <button className="admin-reset-btn"
                        onClick={() => openResetModal(d.id, d.displayName)}>🔑 Reset</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 3 — Activity Types
      ══════════════════════════════════════════════════════ */}
      {tab === "activities" && (
        <div className="admin-act-section">
          {actError   && <div className="admin-error">{actError}</div>}
          {actSuccess && <div className="admin-success">{actSuccess}</div>}

          {/* ── Add form — ALL IN ONE ROW ── */}
          <div style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,
            padding:"14px 16px",marginBottom:20 }}>
            <p style={{ fontSize:12,fontWeight:700,color:"#0a2540",margin:"0 0 10px" }}>
              + Add Activity
            </p>
            {/* Single flex row: Name | Type | Subcategory | MaxQty | Add */}
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end" }}>

              {/* Activity Name */}
              <div style={{ display:"flex",flexDirection:"column",gap:3,flex:"2 1 180px" }}>
                <label style={{ fontSize:10,fontWeight:700,color:"#6b7280",
                  textTransform:"uppercase",letterSpacing:"0.05em" }}>Activity Name *</label>
                <input className="admin-input"
                  placeholder="e.g. Digital, Gift…"
                  value={newActivity}
                  onChange={(e) => setNewActivity(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddActivity()}
                  style={{ height:36 }}/>
              </div>

              {/* ATL/BTL */}
              <div style={{ display:"flex",flexDirection:"column",gap:3,flex:"0 0 88px" }}>
                <label style={{ fontSize:10,fontWeight:700,color:"#6b7280",
                  textTransform:"uppercase",letterSpacing:"0.05em" }}>Type *</label>
                <select className="admin-input"
                  value={newActivityType}
                  onChange={(e) => setNewActivityType(e.target.value as "ATL"|"BTL")}
                  style={{ height:36 }}>
                  <option value="ATL">ATL</option>
                  <option value="BTL">BTL</option>
                </select>
              </div>

              {/* Subcategory */}
              <div style={{ display:"flex",flexDirection:"column",gap:3,flex:"2 1 180px" }}>
                <label style={{ fontSize:10,fontWeight:700,color:"#6b7280",
                  textTransform:"uppercase",letterSpacing:"0.05em" }}>Subcategory *</label>
                <input className="admin-input"
                  placeholder="e.g. Facebook, LED TV…"
                  value={newSubcategory}
                  onChange={(e) => setNewSubcategory(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddActivity()}
                  style={{ height:36 }}/>
              </div>

              {/* Max QTY */}
              <div style={{ display:"flex",flexDirection:"column",gap:3,flex:"0 0 88px" }}>
                <label style={{ fontSize:10,fontWeight:700,color:"#6b7280",
                  textTransform:"uppercase",letterSpacing:"0.05em" }}>Max QTY *</label>
                <input className="admin-input" type="number" min={1} max={100}
                  placeholder="5" value={newMaxQty}
                  onChange={(e) => setNewMaxQty(e.target.value)}
                  style={{ height:36 }}/>
              </div>

              {/* Add button */}
              <button className="admin-save-btn"
                onClick={handleAddActivity}
                disabled={actSaving || !newActivity.trim() || !newSubcategory.trim()}
                style={{ height:36,flexShrink:0,whiteSpace:"nowrap" }}>
                {actSaving ? "Adding…" : "+ Add"}
              </button>
            </div>
            <p style={{ fontSize:11,color:"#9ca3af",margin:"8px 0 0" }}>
              Tip: same activity name + different subcategory = multiple subcategory rows (e.g. Gift → LED TV, Gift → Fan)
              · <strong>ATL</strong> = Above The Line · <strong>BTL</strong> = Below The Line
            </p>
          </div>

          {/* ── Activity types table ── */}
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th style={{ width:44 }}>#</th>
                  <th>Activity Name</th>
                  <th style={{ width:80 }}>Type</th>
                  <th>Subcategory</th>
                  <th style={{ width:80,textAlign:"center" }}>Max QTY</th>
                  <th style={{ width:110 }}>Status</th>
                  <th style={{ width:160 }}></th>
                </tr>
              </thead>
              <tbody>
                {actLoading ? <TableSkeleton rows={8} cols={7}/> :
                 activityTypes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="admin-empty-cell">
                      No activity types yet. Use the form above to add one.
                    </td>
                  </tr>
                ) : (
                  Object.entries(groupedActivities)
                    .sort(([a],[b]) => a.localeCompare(b))
                    .flatMap(([actName, rows]) =>
                      rows.map((a, subIdx) => (
                        <tr key={a.id} style={{
                          background: subIdx % 2 === 0 ? "#fff" : "#f8fafc",
                          borderTop: subIdx === 0 ? "2px solid #e2e8f0" : "1px solid #f1f5f9",
                        }}>
                          {/* # */}
                          <td className="admin-readonly" style={{ verticalAlign:"middle" }}>
                            {subIdx === 0
                              ? <span>{Object.keys(groupedActivities).sort().indexOf(actName)+1}</span>
                              : <span style={{ color:"#cbd5e1" }}>↳</span>}
                          </td>

                          {/* Activity Name */}
                          <td style={{ verticalAlign:"middle" }}>
                            {subIdx === 0
                              ? <span className="admin-user-name">{a.activityName}</span>
                              : <span style={{ color:"#9ca3af",fontSize:12 }}>{a.activityName}</span>}
                          </td>

                          {/* Type — show badge on every row */}
                          <td style={{ verticalAlign:"middle" }}>
                            <span style={{
                              fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:4,display:"inline-block",
                              background: a.activityType==="ATL"?"#eff6ff":"#f0fdf4",
                              color: a.activityType==="ATL"?"#1e40af":"#166534",
                              border:`1px solid ${a.activityType==="ATL"?"#bfdbfe":"#bbf7d0"}`,
                              opacity: subIdx === 0 ? 1 : 0.5,
                            }}>{a.activityType||"—"}</span>
                          </td>

                          {/* Subcategory */}
                          <td>
                            {a.subcategory
                              ? <span style={{ fontSize:12,fontWeight:500,color:"#1e3a5f",
                                  background:"#f1f5f9",border:"1px solid #e2e8f0",
                                  borderRadius:5,padding:"2px 9px",display:"inline-block" }}>
                                  {a.subcategory}
                                </span>
                              : <span style={{ color:"#cbd5e1",fontSize:12 }}>—</span>}
                          </td>

                          {/* Max QTY */}
                          <td style={{ textAlign:"center" }}>
                            <span style={{ fontSize:12,fontWeight:700,color:"#374151",
                              background:"#fafafa",border:"1px solid #e2e8f0",
                              borderRadius:5,padding:"2px 10px",display:"inline-block" }}>
                              {a.maxQty ?? 5}
                            </span>
                          </td>

                          {/* Status */}
                          <td>
                            <span className={`admin-status-pill ${a.isActive?"admin-status-pill--active":"admin-status-pill--inactive"}`}>
                              <span className="admin-status-dot"/>{a.isActive?"Active":"Inactive"}
                            </span>
                          </td>

                          {/* Actions: Edit + Toggle */}
                          <td>
                            <div className="admin-row-actions">
                              <button className="admin-edit-btn"
                                onClick={() => openEditActivity(a)}>
                                ✏ Edit
                              </button>
                              <button className={a.isActive?"admin-cancel-btn":"admin-save-btn"}
                                onClick={() => handleToggleActivity(a.id, a.isActive)}>
                                {a.isActive?"Deactivate":"Activate"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )
                )}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          {!actLoading && activityTypes.length > 0 && (
            <div style={{ display:"flex",gap:16,marginTop:12,fontSize:12,color:"#6b7280",flexWrap:"wrap" }}>
              <span><strong style={{ color:"#0a2540" }}>{Object.keys(groupedActivities).length}</strong> activity names</span>
              <span><strong style={{ color:"#0a2540" }}>{activityTypes.length}</strong> total subcategories</span>
              <span><strong style={{ color:"#16a34a" }}>{activityTypes.filter(a=>a.isActive).length}</strong> active</span>
              <span><strong style={{ color:"#6b7280" }}>{activityTypes.filter(a=>!a.isActive).length}</strong> inactive</span>
              <span><strong style={{ color:"#1e40af" }}>{activityTypes.filter(a=>a.activityType==="ATL").length}</strong> ATL</span>
              <span><strong style={{ color:"#166534" }}>{activityTypes.filter(a=>a.activityType==="BTL").length}</strong> BTL</span>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          Edit Activity Modal
      ══════════════════════════════════════════════════════ */}
      {editActId !== null && (
        <div className="admin-modal-overlay" onClick={closeEditActivity}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth:480 }}>
            <div className="admin-modal-head">
              <h3>Edit Activity</h3>
              <button className="admin-modal-close" onClick={closeEditActivity}>✕</button>
            </div>
            <p className="admin-modal-sub" style={{ fontSize:12,color:"#6b7280",marginBottom:16 }}>
              Changes create a new entry (old one deactivated). The name and subcategory combination must be unique.
            </p>
            {editActError && <div className="admin-error">{editActError}</div>}

            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              {/* Row 1: Name + Type */}
              <div style={{ display:"flex",gap:10 }}>
                <div style={{ flex:2,display:"flex",flexDirection:"column",gap:4 }}>
                  <label style={{ fontSize:11,fontWeight:600,color:"#374151",
                    textTransform:"uppercase",letterSpacing:"0.04em" }}>Activity Name *</label>
                  <input className="admin-input" value={editActName}
                    onChange={(e) => setEditActName(e.target.value)}
                    placeholder="e.g. Digital"/>
                </div>
                <div style={{ flex:"0 0 90px",display:"flex",flexDirection:"column",gap:4 }}>
                  <label style={{ fontSize:11,fontWeight:600,color:"#374151",
                    textTransform:"uppercase",letterSpacing:"0.04em" }}>Type *</label>
                  <select className="admin-input" value={editActType}
                    onChange={(e) => setEditActType(e.target.value as "ATL"|"BTL")}>
                    <option value="ATL">ATL</option>
                    <option value="BTL">BTL</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Subcategory + MaxQty */}
              <div style={{ display:"flex",gap:10 }}>
                <div style={{ flex:2,display:"flex",flexDirection:"column",gap:4 }}>
                  <label style={{ fontSize:11,fontWeight:600,color:"#374151",
                    textTransform:"uppercase",letterSpacing:"0.04em" }}>Subcategory *</label>
                  <input className="admin-input" value={editActSub}
                    onChange={(e) => setEditActSub(e.target.value)}
                    placeholder="e.g. Facebook"/>
                </div>
                <div style={{ flex:"0 0 90px",display:"flex",flexDirection:"column",gap:4 }}>
                  <label style={{ fontSize:11,fontWeight:600,color:"#374151",
                    textTransform:"uppercase",letterSpacing:"0.04em" }}>Max QTY *</label>
                  <input className="admin-input" type="number" min={1} max={100}
                    value={editActMaxQty} onChange={(e) => setEditActMaxQty(e.target.value)}/>
                </div>
              </div>
            </div>

            <div className="admin-modal-actions" style={{ marginTop:20 }}>
              <button className="admin-save-btn" disabled={editActSaving}
                onClick={handleSaveEditActivity}>
                {editActSaving?"Saving…":"💾 Save Changes"}
              </button>
              <button className="admin-cancel-btn" onClick={closeEditActivity}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          Reset Password Modal
      ══════════════════════════════════════════════════════ */}
      {resetTargetId !== null && (
        <div className="admin-modal-overlay" onClick={closeResetModal}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <h3>Reset Password</h3>
              <button className="admin-modal-close" onClick={closeResetModal}>✕</button>
            </div>
            <p className="admin-modal-sub">Set a new password for <strong>{resetTargetName}</strong>.</p>
            <form onSubmit={handleResetSubmit} className="admin-modal-form">
              {resetError && <div className="admin-error">{resetError}</div>}
              <div className="admin-dealer-field">
                <label>New Password</label>
                <input className="admin-input" type="password" required minLength={8}
                  placeholder="Min. 8 characters" value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}/>
              </div>
              <div className="admin-dealer-field">
                <label>Confirm Password</label>
                <input className="admin-input" type="password" required minLength={8}
                  placeholder="Re-enter password" value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}/>
              </div>
              <div className="admin-modal-actions">
                <button className="admin-save-btn" type="submit" disabled={resetSaving}>
                  {resetSaving?"Resetting…":"Reset Password"}
                </button>
                <button className="admin-cancel-btn" type="button" onClick={closeResetModal}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
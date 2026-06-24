import { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchAllUsers, updateUser } from "../services/userService";
import {
  fetchAllActivityTypes,
  createActivityType,
  toggleActivityType,
  type ActivityType,
} from "../services/activityService";
import type { UserProfile } from "../types/user";
import "./AdminUsersPage.css";

const ROLES = ["Admin", "Manager", "User"];

// ─── Skeleton rows ────────────────────────────────────────────────────────────
function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className="admin-skel" style={{ width: i === 0 ? "80%" : i === cols - 1 ? "60px" : "70%" }} />
        </td>
      ))}
    </tr>
  );
}

function TableSkeleton({ rows = 5, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} cols={cols} />
      ))}
    </>
  );
}

export default function AdminUsersPage() {
  const { instance } = useMsal();

  const [users,      setUsers]      = useState<UserProfile[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [draft,      setDraft]      = useState<Partial<UserProfile>>({});
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [actLoading,    setActLoading]    = useState(true);
  const [newActivity,   setNewActivity]   = useState("");
  const [actSaving,     setActSaving]     = useState(false);
  const [actError,      setActError]      = useState<string | null>(null);
  const [actSuccess,    setActSuccess]    = useState<string | null>(null);

  const [tab, setTab] = useState<"users" | "activities">("users");

  useEffect(() => { loadUsers(); loadActivities(); }, []);

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

  const startEdit = (u: UserProfile) => {
    setEditingId(u.id);
    setDraft({
      firstName: u.firstName, lastName: u.lastName,
      department: u.department, jobTitle: u.jobTitle,
      phoneNumber: u.phoneNumber, role: u.role, isActive: u.isActive,
    });
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

  const handleAddActivity = async () => {
    if (!newActivity.trim()) return;
    setActSaving(true); setActError(null); setActSuccess(null);
    try {
      const created = await createActivityType(newActivity.trim(), instance);
      setActivityTypes((prev) => [...prev, created]);
      setNewActivity("");
      setActSuccess(`"${created.activityName}" added successfully.`);
      setTimeout(() => setActSuccess(null), 3000);
    } catch (e) {
      setActError(e instanceof Error ? e.message : "Failed to add activity type.");
    } finally { setActSaving(false); }
  };

  const handleToggleActivity = async (id: number, current: boolean) => {
    try {
      const updated = await toggleActivityType(id, !current, instance);
      setActivityTypes((prev) => prev.map((a) => a.id === id ? updated : a));
    } catch (e) {
      setActError(e instanceof Error ? e.message : "Failed to update activity type.");
    }
  };

  return (
    <div className="admin-users-page">
      <div className="admin-users-head">
        <h1>Admin Settings</h1>
        <p>Manage users and activity types for the BTL proposal system.</p>
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === "users" ? "admin-tab--active" : ""}`}
          onClick={() => setTab("users")}>
          👥 Users
        </button>
        <button className={`admin-tab ${tab === "activities" ? "admin-tab--active" : ""}`}
          onClick={() => setTab("activities")}>
          📋 Activity Types
        </button>
      </div>

      {/* ── TAB 1 — Users ── */}
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
                {loading ? (
                  <TableSkeleton rows={6} cols={8} />
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="admin-empty-cell">No users found.</td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isEditing = editingId === u.id;
                    return (
                      <tr key={u.id} className={isEditing ? "admin-row--editing" : ""}>
                        <td>
                          {isEditing ? (
                            <div className="admin-name-inputs">
                              <input className="admin-input" placeholder="First name"
                                value={draft.firstName ?? ""}
                                onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))} />
                              <input className="admin-input" placeholder="Last name"
                                value={draft.lastName ?? ""}
                                onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))} />
                            </div>
                          ) : (
                            <span className="admin-user-name">{u.displayName}</span>
                          )}
                        </td>
                        <td className="admin-readonly">{u.email}</td>
                        <td>
                          {isEditing
                            ? <input className="admin-input" value={draft.department ?? ""}
                                onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} />
                            : <span className="admin-cell-text">{u.department ?? "—"}</span>}
                        </td>
                        <td>
                          {isEditing
                            ? <input className="admin-input" value={draft.jobTitle ?? ""}
                                onChange={(e) => setDraft((d) => ({ ...d, jobTitle: e.target.value }))} />
                            : <span className="admin-cell-text">{u.jobTitle ?? "—"}</span>}
                        </td>
                        <td>
                          {isEditing ? (
                            <input className="admin-input" value={draft.phoneNumber ?? ""} maxLength={10}
                              onChange={(e) => {
                                const v = e.target.value.replace(/\D/g, "");
                                if (v.length <= 10) setDraft((d) => ({ ...d, phoneNumber: v }));
                              }} />
                          ) : (
                            <span className="admin-cell-text">{u.phoneNumber ?? "—"}</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <select className="admin-input" value={draft.role ?? u.role}
                              onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
                              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : (
                            <span className={`role-chip role-${u.role.toLowerCase()}`}>{u.role}</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <label className="admin-toggle">
                              <input type="checkbox" checked={draft.isActive ?? u.isActive}
                                onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))} />
                              <span className="admin-toggle-label">
                                {draft.isActive ?? u.isActive ? "Active" : "Inactive"}
                              </span>
                            </label>
                          ) : (
                            <span className={`admin-status-pill ${u.isActive ? "admin-status-pill--active" : "admin-status-pill--inactive"}`}>
                              <span className="admin-status-dot" />
                              {u.isActive ? "Active" : "Inactive"}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <div className="admin-row-actions">
                              <button className="admin-save-btn" disabled={saving}
                                onClick={() => saveEdit(u.id)}>
                                {saving ? "Saving…" : "Save"}
                              </button>
                              <button className="admin-cancel-btn" onClick={cancelEdit}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button className="admin-edit-btn" onClick={() => startEdit(u)}>
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── TAB 2 — Activity Types ── */}
      {tab === "activities" && (
        <div className="admin-act-section">
          {actError   && <div className="admin-error">{actError}</div>}
          {actSuccess && <div className="admin-success">{actSuccess}</div>}

          <div className="admin-act-add-row">
            <input className="admin-input admin-act-input"
              placeholder="New activity type name…"
              value={newActivity}
              onChange={(e) => setNewActivity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddActivity()} />
            <button className="admin-save-btn"
              onClick={handleAddActivity}
              disabled={actSaving || !newActivity.trim()}>
              {actSaving ? "Adding…" : "+ Add"}
            </button>
          </div>

          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Activity Name</th>
                  <th>Status</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {actLoading ? (
                  <TableSkeleton rows={5} cols={4} />
                ) : activityTypes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="admin-empty-cell">
                      No activity types yet. Add one above.
                    </td>
                  </tr>
                ) : (
                  activityTypes.map((a, i) => (
                    <tr key={a.id}>
                      <td className="admin-readonly">{i + 1}</td>
                      <td><span className="admin-user-name">{a.activityName}</span></td>
                      <td>
                        <span className={`admin-status-pill ${a.isActive ? "admin-status-pill--active" : "admin-status-pill--inactive"}`}>
                          <span className="admin-status-dot" />
                          {a.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <button
                          className={a.isActive ? "admin-cancel-btn" : "admin-save-btn"}
                          onClick={() => handleToggleActivity(a.id, a.isActive)}>
                          {a.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
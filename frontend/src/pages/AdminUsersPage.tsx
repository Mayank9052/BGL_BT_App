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

export default function AdminUsersPage() {
  const { instance } = useMsal();

  // ── Users state ────────────────────────────────────────────
  const [users, setUsers]       = useState<UserProfile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft]       = useState<Partial<UserProfile>>({});
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // ── Activity types state ───────────────────────────────────
  const [activityTypes, setActivityTypes]   = useState<ActivityType[]>([]);
  const [actLoading, setActLoading]         = useState(true);
  const [newActivity, setNewActivity]       = useState("");
  const [actSaving, setActSaving]           = useState(false);
  const [actError, setActError]             = useState<string | null>(null);
  const [actSuccess, setActSuccess]         = useState<string | null>(null);

  // ── Active tab ─────────────────────────────────────────────
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

  // ── User edit helpers ──────────────────────────────────────
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
      setUsers((list) => list.map((u) => u.id === id ? {
        ...u, ...updated,
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

  // ── Activity type helpers ──────────────────────────────────
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

  if (loading && actLoading) {
    return <div className="admin-loading"><div className="spinner" /></div>;
  }

  return (
    <div className="admin-users-page">
      <div className="admin-users-head">
        <h1>Admin Settings</h1>
        <p>Manage users and activity types for the BTL proposal system.</p>
      </div>

      {/* ── Tabs ── */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === "users" ? "admin-tab--active" : ""}`}
          onClick={() => setTab("users")}
        >
          👥 Users
        </button>
        <button
          className={`admin-tab ${tab === "activities" ? "admin-tab--active" : ""}`}
          onClick={() => setTab("activities")}
        >
          📋 Activity Types
        </button>
      </div>

      {/* ════════════════════════════════════════════════
          TAB 1 — Users
      ════════════════════════════════════════════════ */}
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
                {users.map((u) => {
                  const isEditing = editingId === u.id;
                  return (
                    <tr key={u.id}>
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
                        ) : u.displayName}
                      </td>
                      <td className="admin-readonly">{u.email}</td>
                      <td>
                        {isEditing
                          ? <input className="admin-input" value={draft.department ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} />
                          : u.department ?? "—"}
                      </td>
                      <td>
                        {isEditing
                          ? <input className="admin-input" value={draft.jobTitle ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...d, jobTitle: e.target.value }))} />
                          : u.jobTitle ?? "—"}
                      </td>
                      <td>
                        {isEditing ? (
                          <input className="admin-input" value={draft.phoneNumber ?? ""} maxLength={10}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, "");
                              if (v.length <= 10) setDraft((d) => ({ ...d, phoneNumber: v }));
                            }} />
                        ) : u.phoneNumber ?? "—"}
                      </td>
                      <td>
                        {isEditing ? (
                          <select className="admin-input" value={draft.role ?? u.role}
                            onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}>
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : <span className={`role-chip role-${u.role.toLowerCase()}`}>{u.role}</span>}
                      </td>
                      <td>
                        {isEditing ? (
                          <input type="checkbox" checked={draft.isActive ?? u.isActive}
                            onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))} />
                        ) : (
                          <span className={u.isActive ? "status-active" : "status-inactive"}>
                            {u.isActive ? "Active" : "Inactive"}
                          </span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div className="admin-row-actions">
                            <button className="admin-save-btn" disabled={saving} onClick={() => saveEdit(u.id)}>Save</button>
                            <button className="admin-cancel-btn" onClick={cancelEdit}>Cancel</button>
                          </div>
                        ) : (
                          <button className="admin-edit-btn" onClick={() => startEdit(u)}>Edit</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════
          TAB 2 — Activity Types
      ════════════════════════════════════════════════ */}
      {tab === "activities" && (
        <div className="admin-act-section">
          {actError   && <div className="admin-error">{actError}</div>}
          {actSuccess && <div className="admin-success">{actSuccess}</div>}

          {/* Add new */}
          <div className="admin-act-add-row">
            <input
              className="admin-input admin-act-input"
              placeholder="New activity type name…"
              value={newActivity}
              onChange={(e) => setNewActivity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddActivity()}
            />
            <button
              className="admin-save-btn"
              onClick={handleAddActivity}
              disabled={actSaving || !newActivity.trim()}
            >
              {actSaving ? "Adding…" : "+ Add"}
            </button>
          </div>

          {/* List */}
          {actLoading ? (
            <div className="admin-loading"><div className="spinner" /></div>
          ) : (
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Activity Name</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {activityTypes.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "#94a3b8", padding: "24px" }}>
                        No activity types yet. Add one above.
                      </td>
                    </tr>
                  )}
                  {activityTypes.map((a, i) => (
                    <tr key={a.id}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>{a.activityName}</td>
                      <td>
                        <span className={a.isActive ? "status-active" : "status-inactive"}>
                          {a.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="admin-readonly">
                        {/* createdAt not in ActivityType interface yet — omit or add */}
                      </td>
                      <td>
                        <button
                          className={a.isActive ? "admin-cancel-btn" : "admin-save-btn"}
                          style={{ fontSize: 12 }}
                          onClick={() => handleToggleActivity(a.id, a.isActive)}
                        >
                          {a.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
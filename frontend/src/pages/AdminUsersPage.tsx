import { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchAllUsers, updateUser } from "../services/userService";
import type { UserProfile } from "../types/user";
import "./AdminUsersPage.css";

const ROLES = ["Admin", "Manager", "User"];

export default function AdminUsersPage() {
  const { instance } = useMsal();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<UserProfile>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await fetchAllUsers(instance));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (u: UserProfile) => {
    setEditingId(u.id);
    setDraft({
      firstName: u.firstName,
      lastName: u.lastName,
      department: u.department,
      jobTitle: u.jobTitle,
      phoneNumber: u.phoneNumber,
      role: u.role,
      isActive: u.isActive,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async (id: number) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateUser(id, draft, instance);
      setUsers((list) =>
        list.map((u) =>
          u.id === id
            ? {
                ...u,           // keep all existing fields (azureObjectId, etc.)
                ...updated,     // overlay whatever the backend returned
                // explicitly carry over fields that may be missing from UserResponseDto
                phoneNumber: updated.phoneNumber ?? draft.phoneNumber ?? u.phoneNumber,
                firstName:   updated.firstName   ?? draft.firstName   ?? u.firstName,
                lastName:    updated.lastName    ?? draft.lastName    ?? u.lastName,
                department:  updated.department  ?? draft.department  ?? u.department,
                jobTitle:    updated.jobTitle    ?? draft.jobTitle    ?? u.jobTitle,
                role:        updated.role        ?? draft.role        ?? u.role,
                isActive:    updated.isActive    ?? draft.isActive    ?? u.isActive,
              }
            : u
        )
      );
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update user.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="admin-users-page">
      <div className="admin-users-head">
        <h1>Manage Users</h1>
        <p>
          Update team member details. Email, username, and password are managed via
          Microsoft 365 login and can't be changed here.
        </p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-users-table-wrap">
        <table className="admin-users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Job Title</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Active</th>
              <th></th>
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
                        <input
                          className="admin-input"
                          placeholder="First name"
                          value={draft.firstName ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))}
                        />
                        <input
                          className="admin-input"
                          placeholder="Last name"
                          value={draft.lastName ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))}
                        />
                      </div>
                    ) : (
                      u.displayName
                    )}
                  </td>
                  <td className="admin-readonly">{u.email}</td>
                  <td>
                    {isEditing ? (
                      <input
                        className="admin-input"
                        value={draft.department ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
                      />
                    ) : (
                      u.department ?? "—"
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        className="admin-input"
                        value={draft.jobTitle ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, jobTitle: e.target.value }))}
                      />
                    ) : (
                      u.jobTitle ?? "—"
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        className="admin-input"
                        value={draft.phoneNumber ?? ""}
                        maxLength={10}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, ""); // allow only numbers
                          if (value.length <= 10) {
                            setDraft((d) => ({ ...d, phoneNumber: value }));
                          }
                        }}
                      />
                    ) : (
                      u.phoneNumber ?? "—"
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="admin-input"
                        value={draft.role ?? u.role}
                        onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`role-chip role-${u.role.toLowerCase()}`}>{u.role}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        type="checkbox"
                        checked={draft.isActive ?? u.isActive}
                        onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                      />
                    ) : (
                      <span className={u.isActive ? "status-active" : "status-inactive"}>
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="admin-row-actions">
                        <button className="admin-save-btn" disabled={saving} onClick={() => saveEdit(u.id)}>
                          Save
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
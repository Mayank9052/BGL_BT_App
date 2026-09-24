// src/pages/AdminAuditLogPage.tsx
import { useEffect, useState, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import {
  fetchAuditLogs, fetchAuditLogActions,
  type AuditLogEntry, type AuditLogFilters,
} from "../services/auditLogService";

const ROLES = ["Admin", "Manager", "User", "Dealer", "RSM", "TSM", "ZSM", "Commando"];

const ACTION_LABELS: Record<string, string> = {
  Login:                     "🔓 Login",
  LoginFailed:               "⛔ Login failed",
  Logout:                    "🔒 Logout",
  PasswordForgotRequested:   "✉️ Forgot password requested",
  PasswordReset:             "🔑 Password reset (via email link)",
  PasswordChanged:           "🔑 Password changed (self)",
  PasswordAdminReset:        "🔑 Password reset by admin",
  AccountCreated:            "➕ Account created",
  AccountActivated:          "✅ Account activated",
  AccountDeactivated:        "🚫 Account deactivated",
  ProposalSubmitted:         "📋 Proposal submitted",
  ProposalApproved:          "✓ Proposal approved",
  ProposalRejected:          "✕ Proposal rejected",
  ProposalSentBack:          "↩ Proposal sent back",
  DealerNotified:            "📧 Dealer notified",
  BulkImport:                "📥 Bulk import run",
};

function actionLabel(a: string) { return ACTION_LABELS[a] ?? a; }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function roleChipStyle(role: string): React.CSSProperties {
  const map: Record<string, { bg: string; c: string }> = {
    Admin:    { bg: "#ede9fe", c: "#5b21b6" },
    Dealer:   { bg: "#f0fdf4", c: "#166534" },
    RSM:      { bg: "#fef3c7", c: "#92400e" },
    TSM:      { bg: "#dbeafe", c: "#1e40af" },
    ZSM:      { bg: "#fce7f3", c: "#9d174d" },
    Commando: { bg: "#ede9fe", c: "#6d28d9" },
  };
  const { bg, c } = map[role] ?? { bg: "#f1f5f9", c: "#374151" };
  return { background: bg, color: c, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12 };
}

export default function AdminAuditLogPage() {
  const { instance } = useMsal();

  const [logs,       setLogs]       = useState<AuditLogEntry[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [pageSize]                  = useState(50);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const [actionOptions, setActionOptions] = useState<string[]>([]);
  const [filterAction,  setFilterAction]  = useState("");
  const [filterRole,    setFilterRole]    = useState("");
  const [filterActor,   setFilterActor]   = useState("");
  const [filterFrom,    setFilterFrom]    = useState("");
  const [filterTo,      setFilterTo]      = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const filters: AuditLogFilters = {
        action: filterAction || undefined,
        role: filterRole || undefined,
        actorEmail: filterActor || undefined,
        from: filterFrom ? new Date(filterFrom).toISOString() : undefined,
        to: filterTo ? new Date(filterTo + "T23:59:59").toISOString() : undefined,
        page, pageSize,
      };
      const result = await fetchAuditLogs(filters, instance);
      setLogs(result.logs);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity log.");
    } finally {
      setLoading(false);
    }
  }, [instance, filterAction, filterRole, filterActor, filterFrom, filterTo, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchAuditLogActions(instance).then(setActionOptions).catch(() => {});
  }, [instance]);

  useEffect(() => { setPage(1); }, [filterAction, filterRole, filterActor, filterFrom, filterTo]);

  const clearFilters = () => {
    setFilterAction(""); setFilterRole(""); setFilterActor(""); setFilterFrom(""); setFilterTo("");
  };
  const hasFilters = !!(filterAction || filterRole || filterActor || filterFrom || filterTo);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ padding: "2px 10px 40px", width: "100%", boxSizing: "border-box" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0a2540", margin: "0 0 4px" }}>
          Activity Log
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
          Logins, password resets, and account changes across dealers and staff.
          Passwords themselves are never recorded — only that an action happened, by whom, and when.
        </p>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "4px solid #ef4444",
          borderRadius: 8, padding: "11px 14px", marginBottom: 16, fontSize: 13, color: "#991b1b" }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16,
        background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" }}>
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12, minWidth: 160 }}>
          <option value="">All actions</option>
          {actionOptions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>

        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12, minWidth: 130 }}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <input value={filterActor} onChange={(e) => setFilterActor(e.target.value)}
          placeholder="Search email…"
          style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12, flex: "1 1 180px", minWidth: 160 }}/>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>From</label>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12 }}/>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>To</label>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 12 }}/>
        </div>

        {hasFilters && (
          <button onClick={clearFilters}
            style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7,
              padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
            ✕ Clear filters
          </button>
        )}
        <button onClick={load}
          style={{ marginLeft: "auto", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 7,
            padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          ↻ Refresh
        </button>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#0a2540" }}>
              {["When", "Actor", "Role", "Action", "Target / Details", "Result"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#94a3b8",
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontStyle: "italic" }}>
                No activity matches these filters.
              </td></tr>
            ) : logs.map((l, i) => (
              <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "9px 14px", whiteSpace: "nowrap", color: "#6b7280", fontSize: 12 }}>
                  {fmtDate(l.createdAt)}
                </td>
                <td style={{ padding: "9px 14px" }}>
                  <div style={{ fontWeight: 600, color: "#0a2540" }}>{l.actorName || "—"}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>{l.actorEmail}</div>
                </td>
                <td style={{ padding: "9px 14px" }}>
                  <span style={roleChipStyle(l.actorRole)}>{l.actorRole || "—"}</span>
                </td>
                <td style={{ padding: "9px 14px", fontWeight: 500 }}>{actionLabel(l.action)}</td>
                <td style={{ padding: "9px 14px", fontSize: 12, color: "#374151" }}>
                  {l.targetEmail && <div>→ {l.targetEmail}</div>}
                  {l.details && <div style={{ color: "#6b7280" }}>{l.details}</div>}
                  {!l.targetEmail && !l.details && <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
                <td style={{ padding: "9px 14px" }}>
                  {l.success ? (
                    <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 12 }}>✓ Success</span>
                  ) : (
                    <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 12 }}>✕ Failed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, fontSize: 12, color: "#6b7280" }}>
          <span>{total} total event{total !== 1 ? "s" : ""} · page {page} of {totalPages}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #e2e8f0",
                background: page <= 1 ? "#f8fafc" : "#fff", cursor: page <= 1 ? "not-allowed" : "pointer", fontSize: 12 }}>
              ← Prev
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #e2e8f0",
                background: page >= totalPages ? "#f8fafc" : "#fff", cursor: page >= totalPages ? "not-allowed" : "pointer", fontSize: 12 }}>
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

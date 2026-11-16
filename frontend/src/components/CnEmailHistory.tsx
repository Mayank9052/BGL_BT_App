import { useEffect, useState } from "react";
import { fetchCnEmails, type CnEmailLogEntry, type MsalLike } from "../services/cnService";

const ist = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

export default function CnEmailHistory({ activityId, instance, refreshKey }:
  { activityId: string; instance?: MsalLike; refreshKey?: unknown }) {
  const [rows, setRows] = useState<CnEmailLogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true; setErr(null);
    fetchCnEmails(activityId, instance).then((x) => live && setRows(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [activityId, instance, refreshKey]);

  if (err) return <div style={{ color: "#991b1b", fontSize: 12 }}>⚠ {err}</div>;
  if (!rows) return <div style={{ fontSize: 12, color: "#64748b" }}>Loading email history…</div>;

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 700, color: "#0a2540", marginBottom: 8 }}>📧 Email History ({rows.length})</div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No emails logged yet for this CN.</div>}
      {rows.map((m) => (
        <div key={m.id} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", cursor: "pointer" }} onClick={() => setOpen(open === m.id ? null : m.id)}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: m.success ? "#dcfce7" : "#fee2e2", color: m.success ? "#166534" : "#991b1b" }}>
              {m.success ? "Sent" : "Failed"}</span>
            <span style={{ fontSize: 10, background: "#eef2ff", color: "#4338ca", borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>{m.action}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0a2540", flex: 1 }}>{m.subject}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>{ist(m.sentAt)}</span>
            <span style={{ fontSize: 10 }}>{open === m.id ? "▲" : "▼"}</span>
          </div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>
            <b>To:</b> {m.toEmails || "—"} {m.ccEmails && <> · <b>Cc:</b> {m.ccEmails}</>} · <b>From:</b> {m.sentBy}
            {m.attachmentNames && <> · 📎 {m.attachmentNames}</>}
          </div>
          {!m.success && m.error && <div style={{ fontSize: 11, color: "#991b1b", marginTop: 2 }}>{m.error}</div>}
          {open === m.id && (
            <iframe title={m.id} sandbox="" srcDoc={m.bodyHtml}
              style={{ width: "100%", height: 420, border: "1px solid #e2e8f0", borderRadius: 6, marginTop: 8, background: "#fff" }} />
          )}
        </div>
      ))}
    </div>
  );
}
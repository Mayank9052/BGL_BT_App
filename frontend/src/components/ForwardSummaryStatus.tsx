// src/components/ForwardSummaryStatus.tsx
// Checker banner: "was the state-wise summary mailed?" + one-click "Send now" for anything waiting.
import { useCallback, useEffect, useState } from "react";
import type { IPublicClientApplication } from "@azure/msal-browser";
import {
  getForwardSummaryStatus, sendPendingSummary,
  type ForwardSummaryStatus as Status, type ForwardSummaryMailResult,
} from "../services/forwardSummaryService";

const fmt = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function ForwardSummaryStatus({ instance, refreshKey, lastMail }: {
  instance: IPublicClientApplication; refreshKey?: unknown; lastMail?: ForwardSummaryMailResult | null;
}) {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => { getForwardSummaryStatus(instance).then(setS).catch(() => setS(null)); }, [instance]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    if (!lastMail) return;
    setMsg(lastMail.sent
      ? { ok: true, text: `State-wise summary (${lastMail.proposals} proposals, ${lastMail.states} states) mailed to ${lastMail.to.join(", ")} at ${lastMail.sentAtIst.slice(11)} via ${lastMail.via}. A copy is in your inbox / Sent Items.` }
      : { ok: false, text: `Proposals forwarded, but the summary mail was NOT sent: ${lastMail.error ?? "unknown error"}. Click "Send summary now".` });
    load();
  }, [lastMail, load]);

  const sendNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await sendPendingSummary(instance);
      setMsg(r.mail
        ? { ok: r.mail.sent, text: r.mail.sent
            ? `Summary mailed now: ${r.mail.proposals} proposals · ${r.mail.states} states → ${r.mail.to.join(", ")} at ${r.mail.sentAtIst.slice(11)}.`
            : `Not sent: ${r.mail.error}` }
        : { ok: true, text: r.message ?? "Nothing waiting." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Send failed." }); }
    finally { setBusy(false); load(); }
  };

  if (!s && !msg) return null;
  const waiting = s?.pendingMail ?? 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
      {msg && (
        <div style={{ background: msg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${msg.ok ? "#bbf7d0" : "#fecaca"}`,
          borderLeft: `4px solid ${msg.ok ? "#16a34a" : "#dc2626"}`, borderRadius: 8, padding: "9px 14px", fontSize: 12,
          color: msg.ok ? "#166534" : "#991b1b", display: "flex", gap: 10, alignItems: "center" }}>
          <span>{msg.ok ? "✅" : "⚠"} {msg.text}</span>
          <button onClick={() => setMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>
      )}
      {s && (
        <div style={{ background: waiting > 0 ? "#fffbeb" : "#f8fafc", border: `1px solid ${waiting > 0 ? "#fde68a" : "#e2e8f0"}`,
          borderRadius: 8, padding: "8px 14px", fontSize: 12, color: waiting > 0 ? "#92400e" : "#475569",
          display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>📧 <b>Summary mail to Final Approver</b>{s.to?.length ? ` (${s.to.join(", ")})` : ""}:</span>
          <span>{s.lastSentAt ? <>last sent <b>{fmt(s.lastSentAt)}</b> ({s.lastBatch} proposal{s.lastBatch === 1 ? "" : "s"})</> : "not sent yet"}</span>
          <span>· {s.withApprover} pending with approver</span>
          {waiting > 0 ? (
            <>
              <span style={{ fontWeight: 700 }}>· ⚠ {waiting} forwarded proposal{waiting === 1 ? "" : "s"} NOT yet mailed</span>
              <button onClick={sendNow} disabled={busy}
                style={{ marginLeft: "auto", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 7,
                  padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>
                {busy ? "Sending…" : "📤 Send state-wise summary now"}</button>
            </>
          ) : <span style={{ color: "#16a34a", fontWeight: 600 }}>· ✓ everything forwarded has been mailed</span>}
        </div>
      )}
    </div>
  );
}

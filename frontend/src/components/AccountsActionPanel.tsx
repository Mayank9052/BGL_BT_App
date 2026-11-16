import { useCallback, useEffect, useState } from "react";
import { fetchCnForProposal, cnAccountsAction, CN_STATUS_META, type AccountsAction, type CnActivityState, type MsalLike } from "../services/cnService";

const LABEL: Record<AccountsAction, string> = {
  pending: "Mark CN Pending", reject: "Reject", revise: "Request Revision", cleared: "Mark CN Cleared",
};
const COLOR: Record<AccountsAction, string> = { pending: "#b45309", reject: "#dc2626", revise: "#f59e0b", cleared: "#16a34a" };

export default function AccountsActionPanel({ proposalId, activityId, instance, onChanged }:
  { proposalId: string; activityId: string; instance?: MsalLike; onChanged: () => void }) {
  const [cn, setCn] = useState<CnActivityState | null>(null);
  const [action, setAction] = useState<AccountsAction | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const all = await fetchCnForProposal(proposalId, instance);
    setCn(all.find((x) => x.activityId === activityId) ?? null);
  }, [proposalId, activityId, instance]);
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: e.message })); }, [load]);

  if (!cn) return null;
  const meta = CN_STATUS_META[cn.cnStatus];
  const available: AccountsAction[] = [
    ...(cn.cnStatus === "SentToAccounts" && cn.canAccountsAct ? ["pending" as const] : []),
    ...(cn.canAccountsAct ? ["reject" as const, "revise" as const] : []),
    ...(cn.canClear ? ["cleared" as const] : []),
  ];
  const needsNote = action === "reject" || action === "revise";

  const submit = async () => {
    if (!action) return;
    if (needsNote && !note.trim()) { setMsg({ ok: false, text: "Please enter a reason." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await cnAccountsAction(activityId, action, note.trim(), instance);
      setMsg({ ok: true, text: `${LABEL[action]} done.${r.mailMessage ? " " + r.mailMessage : r.mailSent ? " Email sent." : ""}` });
      setAction(null); setNote(""); await load(); onChanged();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed." }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ color: "#0a2540" }}>Accounts actions</b>
        <span style={{ background: meta.bg, color: meta.color, borderRadius: 10, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{meta.label}</span>
        {cn.cnAccountsNote && <span style={{ fontSize: 11, color: "#78350f" }}>Last note: {cn.cnAccountsNote}</span>}
      </div>
      {available.length > 0 ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {available.map((a) => (
            <button key={a} disabled={busy} onClick={() => { setAction(a); setNote(""); setMsg(null); }}
              style={{ background: action === a ? COLOR[a] : "#fff", color: action === a ? "#fff" : COLOR[a], border: `1.5px solid ${COLOR[a]}`, borderRadius: 7, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              {LABEL[a]}
            </button>
          ))}
        </div>
      ) : <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>No Accounts action available at this stage.</div>}
      {action && (
        <div style={{ marginTop: 10 }}>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={needsNote ? "Reason (required) — sent to Checker / dealer / RSM by mail" : "Note (optional) — included in the mail"}
            style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 7, padding: 8, fontSize: 13, boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button disabled={busy} onClick={submit} style={{ background: COLOR[action], color: "#fff", border: "none", borderRadius: 7, padding: "7px 18px", fontWeight: 700, cursor: "pointer" }}>
              {busy ? "Sending…" : `Confirm — ${LABEL[action]}`}</button>
            <button disabled={busy} onClick={() => setAction(null)} style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, padding: "7px 14px", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 12, color: msg.ok ? "#166534" : "#991b1b" }}>{msg.ok ? "✓" : "⚠"} {msg.text}</div>}
    </div>
  );
}
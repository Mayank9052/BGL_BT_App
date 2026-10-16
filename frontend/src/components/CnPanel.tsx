// src/components/CnPanel.tsx
// Credit Note card shown inside each activity's Post-Activity section.
// Buttons appear only when the backend says the logged-in user may perform that step.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { IPublicClientApplication } from "@azure/msal-browser";
import {
  fetchCnForProposal, cnSendToRsm, cnRsmDecision, cnUploadFinalInvoice,
  cnSendToAccounts, cnMarkProcessed, resolveMediaUrl, CN_STATUS_META,
  type CnActivityState, type CnActionResult,
} from "../services/cnService";

const inr = (v: number | null | undefined) =>
  v == null ? "—" : "₹" + Math.round(v).toLocaleString("en-IN");
const dt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const pct = (v: number) => `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;

const STEPS = ["Proof verified", "RSM approval", "BGauss invoice", "Sent to Accounts", "CN processed"];
function doneSteps(cn: CnActivityState): number {
  switch (cn.cnStatus) {
    case "NotStarted":         return 0;
    case "SentForRsmApproval": return 1;
    case "RsmRejected":        return 1;
    case "RsmApproved":        return cn.cnFinalInvoiceUrl ? 3 : 2;
    case "SentToAccounts":     return 4;
    case "CnProcessed":        return 5;
  }
}

interface Props {
  proposalId: string;
  activityId: string;
  instance?: IPublicClientApplication | null;   // Azure pages pass MSAL; DealerDashboard passes nothing
  refreshKey?: string | number;                // change → reload (e.g. after photo / invoice upload)
  onChanged?: (cn: CnActivityState) => void;
}

export default function CnPanel({ proposalId, activityId, instance, refreshKey, onChanged }: Props) {
  const [cn, setCn]           = useState<CnActivityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<{ text: string; ok: boolean } | null>(null);
  const [note, setNote]       = useState("");
  const [invFile, setInvFile] = useState<File | null>(null);
  const [invAmt, setInvAmt]   = useState("");
  const [cnNo, setCnNo]       = useState("");

  const load = useCallback(async () => {
    setLoading(true); setLoadErr(null);
    try {
      const list = await fetchCnForProposal(proposalId, instance);
      setCn(list.find((x) => x.activityId === activityId) ?? null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load CN status.");
    } finally { setLoading(false); }
  }, [proposalId, activityId, instance]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (fn: () => Promise<CnActionResult>, okText: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      setCn(r.cn);
      onChanged?.(r.cn);
      setMsg({
        text: r.mailMessage ? `${okText} · ${r.mailMessage}` : okText,
        ok: r.mailSent || !r.mailMessage?.startsWith("Mail NOT sent"),
      });
      setNote(""); setInvFile(null); setInvAmt(""); setCnNo("");
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Action failed.", ok: false });
    } finally { setBusy(false); }
  };

  if (loading && !cn) return <div style={box}><span style={{ fontSize: 12, color: "#64748b" }}>Loading Credit Note status…</span></div>;
  if (loadErr) return (
    <div style={box}>
      <span style={{ fontSize: 12, color: "#991b1b" }}>⚠ CN: {loadErr}</span>
      <button onClick={load} style={{ ...btnGhost, marginLeft: 8 }}>Retry</button>
    </div>
  );
  if (!cn) return null;

  const r = cn.report;
  const meta = CN_STATUS_META[cn.cnStatus];
  const done = doneSteps(cn);
  const rejected = cn.cnStatus === "RsmRejected";
  const amt = parseFloat(invAmt);
  const amtInvalid = invAmt !== "" && (!(amt > 0) || amt > cn.approvedBgaussAmount);

  return (
    <div style={box}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#0a2540" }}>💳 Credit Note (CN)</span>
        <span style={{ background: meta.bg, color: meta.color, borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>
          {meta.label}
        </span>
        {cn.cnNumber && <span style={{ fontSize: 11, color: "#166534", fontWeight: 700 }}>CN No: {cn.cnNumber}</span>}
        <button onClick={load} disabled={busy || loading} style={{ ...btnGhost, marginLeft: "auto" }} title="Refresh CN status">↻</button>
      </div>

      {/* Stepper */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {STEPS.map((s, i) => {
          const isDone = i < done;
          const isRej = rejected && i === 1;
          return (
            <div key={s} style={{
              flex: "1 1 110px", textAlign: "center", fontSize: 10, fontWeight: 700, padding: "5px 4px", borderRadius: 6,
              background: isRej ? "#fee2e2" : isDone ? "#dcfce7" : i === done ? "#fef9c3" : "#f1f5f9",
              color: isRej ? "#991b1b" : isDone ? "#166534" : i === done ? "#92400e" : "#94a3b8",
            }}>
              {isRej ? "✕" : isDone ? "✓" : i + 1}. {s}
            </div>
          );
        })}
      </div>

      {/* Approved vs Actual */}
      <div style={{ overflowX: "auto", marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 420 }}>
          <thead>
            <tr style={{ background: "#0a2540" }}>
              {["Metric", "Approved", "Actual", "Achievement"].map((h, i) => (
                <th key={h} style={{ padding: "6px 10px", color: "#e2e8f0", fontSize: 10, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <PvaRow label="Leads"  a={r.approvedLeads.toLocaleString("en-IN")}  b={r.actualLeads.toLocaleString("en-IN")}  c={pct(r.leadsAchievementPct)} />
            <PvaRow label="Retail" a={r.approvedRetail.toLocaleString("en-IN")} b={r.actualRetail.toLocaleString("en-IN")} c={pct(r.retailAchievementPct)} />
            <PvaRow label="Budget (BGauss)" a={inr(r.approvedBudget)} b={r.actualBudget == null ? "Pending invoice" : inr(r.actualBudget)}
              c={r.actualBudget == null || r.approvedBudget <= 0 ? "—" : pct(Math.round(r.actualBudget * 1000 / r.approvedBudget) / 10)} />
            <PvaRow label="CPL" a={inr(r.approvedCpl)} b={inr(r.actualCpl)} c="" />
            <PvaRow label="CAC" a={inr(r.approvedCac)} b={inr(r.actualCac)} c="" />
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>
          Actual leads: {r.leadsSource} · Actual retail: {r.retailSource} — save Post-Activity daily entries to update.
        </div>
      </div>

      {/* Checklist / timeline */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 6, fontSize: 11, marginBottom: 10 }}>
        <Item ok={r.photoCount > 0} text={`Activity photos: ${r.photoCount}`} />
        <Item ok={r.vendorInvoiceCount > 0} text={`Vendor invoices: ${r.vendorInvoiceCount}`} />
        <Item ok={!!cn.cnRequestedAt} text={cn.cnRequestedAt ? `Sent to RSM ${dt(cn.cnRequestedAt)} · ${cn.cnRequestedByEmail ?? ""}` : `RSM: ${cn.rsmEmails.join(", ") || "not mapped"}`} />
        <Item ok={cn.cnStatus !== "RsmRejected" && !!cn.cnRsmDecidedAt} bad={rejected}
          text={cn.cnRsmDecidedAt ? `RSM ${rejected ? "rejected" : "approved"} ${dt(cn.cnRsmDecidedAt)} · ${cn.cnRsmDecidedByEmail ?? ""}` : "RSM decision pending"} />
        <Item ok={!!cn.cnFinalInvoiceUrl} text={cn.cnFinalInvoiceUrl ? `BGauss invoice ${inr(cn.cnInvoiceAmount)} · ${dt(cn.cnFinalInvoiceAt)}` : "BGauss invoice pending"}
          link={cn.cnFinalInvoiceUrl ? resolveMediaUrl(cn.cnFinalInvoiceUrl) : undefined} />
        <Item ok={!!cn.cnSentToAccountsAt} text={cn.cnSentToAccountsAt ? `Sent to Accounts ${dt(cn.cnSentToAccountsAt)}` : "Not sent to Accounts"} />
      </div>

      {cn.cnRsmDecisionNote && (
        <div style={{ background: rejected ? "#fef2f2" : "#f0fdf4", border: `1px solid ${rejected ? "#fecaca" : "#bbf7d0"}`,
          borderRadius: 6, padding: "6px 10px", fontSize: 12, color: rejected ? "#7f1d1d" : "#166534", marginBottom: 10 }}>
          <strong>RSM note:</strong> {cn.cnRsmDecisionNote}
        </div>
      )}

      {/* ── STEP 1: Checker → RSM ── */}
      {cn.isChecker && (cn.cnStatus === "NotStarted" || cn.cnStatus === "RsmRejected") && (
        <div style={actionBox}>
          {cn.sendToRsmBlockers.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 11, color: "#92400e" }}>
              {cn.sendToRsmBlockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          <button disabled={busy || !cn.canSendToRsm} onClick={() => act(() => cnSendToRsm(activityId, instance), "Sent for RSM approval")}
            style={btn("#1e3a5f", busy || !cn.canSendToRsm)}>
            {busy ? "Sending…" : rejected ? "📤 Re-send for RSM Approval" : "📤 Verify & Send for RSM Approval"}
          </button>
          {cn.rsmEmails.length > 0 && <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>to {cn.rsmEmails.join(", ")}</span>}
        </div>
      )}

      {/* ── STEP 2: RSM decision ── */}
      {cn.canRsmDecide && (
        <div style={actionBox}>
          {cn.rsmDecideOnBehalf && (
            <div style={{ fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 8px", marginBottom: 8 }}>
              You are recording the RSM's decision on their behalf (e.g. RSM approved by email). A note is mandatory.
            </div>
          )}
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={cn.rsmDecideOnBehalf ? "e.g. Approved by RSM on email dated 02.10.2026" : "Note (mandatory for rejection)…"}
            style={input} />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button disabled={busy || (cn.rsmDecideOnBehalf && !note.trim())}
              onClick={() => act(() => cnRsmDecision(activityId, true, note, instance), "Approved for CN")}
              style={btn("#16a34a", busy || (cn.rsmDecideOnBehalf && !note.trim()))}>✓ Approve for CN</button>
            <button disabled={busy || !note.trim()}
              onClick={() => act(() => cnRsmDecision(activityId, false, note, instance), "Rejected")}
              style={btn("#dc2626", busy || !note.trim())}>✕ Reject</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: BGauss-name invoice ── */}
      {cn.canUploadFinalInvoice && (
        <div style={actionBox}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#0a2540", marginBottom: 4 }}>
            {cn.cnFinalInvoiceUrl ? "Replace invoice in BGauss's name" : "Upload invoice in BGauss's name"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
            Amount must not exceed the approved BGauss amount <strong>{inr(cn.approvedBgaussAmount)}</strong>.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setInvFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
            <input type="number" min={1} max={cn.approvedBgaussAmount} step="1" value={invAmt}
              onChange={(e) => setInvAmt(e.target.value)} placeholder="Invoice amount ₹"
              style={{ ...input, width: 150, borderColor: amtInvalid ? "#dc2626" : "#d1d5db" }} />
            <button disabled={busy || !invFile || !(amt > 0) || amtInvalid}
              onClick={() => act(() => cnUploadFinalInvoice(activityId, invFile!, amt, instance), "BGauss invoice uploaded")}
              style={btn("#0369a1", busy || !invFile || !(amt > 0) || amtInvalid)}>
              {busy ? "Uploading…" : "📤 Upload Invoice"}
            </button>
          </div>
          {amtInvalid && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>Enter an amount between ₹1 and {inr(cn.approvedBgaussAmount)}.</div>}
        </div>
      )}

      {/* ── STEP 4: Checker → Accounts ── */}
      {cn.isChecker && cn.cnStatus === "RsmApproved" && (
        <div style={actionBox}>
          <button disabled={busy || !cn.canSendToAccounts}
            onClick={() => {
              if (!window.confirm(`Send CN to Accounts (${cn.accountsEmails.join(", ")}) with all supporting documents?`)) return;
              act(() => cnSendToAccounts(activityId, instance), "Sent to Accounts");
            }}
            style={btn("#166534", busy || !cn.canSendToAccounts)}>
            {busy ? "Sending…" : "📧 Send to Accounts for CN"}
          </button>
          <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>
            {cn.canSendToAccounts ? `to ${cn.accountsEmails.join(", ")} · BGauss invoice + vendor invoices + photos attached`
              : "Waiting for the dealer's invoice in BGauss's name."}
          </span>
        </div>
      )}

      {/* ── STEP 5: CN processed ── */}
      {cn.canMarkProcessed && (
        <div style={actionBox}>
          <div style={{ fontSize: 12, color: "#0a2540", marginBottom: 6 }}>When Accounts issues the CN, record the CN number:</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={cnNo} maxLength={50} onChange={(e) => setCnNo(e.target.value)} placeholder="CN number" style={{ ...input, width: 200 }} />
            <button disabled={busy || !cnNo.trim()}
              onClick={() => act(() => cnMarkProcessed(activityId, cnNo.trim(), instance), "CN marked processed")}
              style={btn("#16a34a", busy || !cnNo.trim())}>✓ Mark CN Processed</button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: msg.ok ? "#166534" : "#991b1b",
          background: msg.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${msg.ok ? "#bbf7d0" : "#fecaca"}`, borderRadius: 6, padding: "6px 10px" }}>
          {msg.ok ? "✓" : "⚠"} {msg.text}
        </div>
      )}
    </div>
  );
}

function PvaRow({ label, a, b, c }: { label: string; a: string; b: string; c: string }) {
  const td: CSSProperties = { padding: "5px 10px", borderBottom: "1px solid #f1f5f9", textAlign: "right" };
  return (
    <tr>
      <td style={{ ...td, textAlign: "left", color: "#374151" }}>{label}</td>
      <td style={td}>{a}</td>
      <td style={{ ...td, fontWeight: 700, color: "#0a2540" }}>{b}</td>
      <td style={{ ...td, color: "#64748b" }}>{c}</td>
    </tr>
  );
}

function Item({ ok, bad, text, link }: { ok: boolean; bad?: boolean; text: string; link?: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", color: bad ? "#991b1b" : ok ? "#166534" : "#64748b" }}>
      <span>{bad ? "✕" : ok ? "✓" : "○"}</span>
      <span>{text}{link && <> · <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>View</a></>}</span>
    </div>
  );
}

const box: CSSProperties = {
  background: "#fff", border: "1.5px solid #c7d2fe", borderRadius: 9, padding: "12px 14px", marginBottom: 12,
};
const actionBox: CSSProperties = {
  background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginTop: 8,
};
const input: CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 9px", fontSize: 12, outline: "none",
};
const btnGhost: CSSProperties = {
  background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#374151", borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer",
};
const btn = (bg: string, disabled: boolean): CSSProperties => ({
  background: disabled ? "#9ca3af" : bg, color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px",
  fontSize: 12, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
});

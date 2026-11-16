// src/pages/AccountsAccess.tsx — Accounts Access Management (access admins only; the API enforces this).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAccountsAccess } from "../hooks/useAccountsAccess";
import {
  fetchAccessUsers, saveAccessUser, fetchAccessAudit,
  type AccessPageDef, type AccessUser, type AuditRow,
} from "../services/accountsAccessService";
import "./AccountsAccess.css";

type Flags = { view: boolean; download: boolean; full: boolean };
type Draft = Record<string, Flags>;
type Lvl = keyof Flags;

const EMAIL_RX = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const ist = (s: string) => new Date(s).toLocaleString("en-IN",
  { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const toDraft = (pages: AccessPageDef[], u: AccessUser): Draft =>
  Object.fromEntries(pages.map((p) => {
    const x = u.permissions.find((q) => q.pageKey === p.key);
    return [p.key, { view: !!x?.view, download: !!x?.download, full: !!x?.full }];
  }));

export default function AccountsAccess() {
  const { instance, accounts } = useMsal();
  const msal = accounts.length > 0 ? instance : null;
  const access = useAccountsAccess(msal);

  const [tab, setTab] = useState<"perm" | "audit">("perm");
  const [pages, setPages] = useState<AccessPageDef[]>([]);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // audit state
  const [aRows, setARows] = useState<AuditRow[]>([]);
  const [aTotal, setATotal] = useState(0);
  const [aPage, setAPage] = useState(1);
  const [aUser, setAUser] = useState("");
  const [aActor, setAActor] = useState("");
  const [aAction, setAAction] = useState("");
  const [aLoading, setALoading] = useState(false);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchAccessUsers(msal);
      setPages(r.pages); setUsers(r.users);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load users." }); }
    finally { setLoading(false); }
  }, [msal]);
  useEffect(() => { if (access.ready && access.isAdmin) load(); else if (access.ready) setLoading(false); }, [access.ready, access.isAdmin, load]);

  const loadAudit = useCallback(async () => {
    setALoading(true);
    try {
      const r = await fetchAccessAudit({ page: aPage, pageSize: PAGE_SIZE, user: aUser, actor: aActor, action: aAction }, msal);
      setARows(r.rows); setATotal(r.total);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load audit log." }); }
    finally { setALoading(false); }
  }, [msal, aPage, aUser, aActor, aAction]);
  useEffect(() => { if (tab === "audit" && access.isAdmin) loadAudit(); }, [tab, access.isAdmin, loadAudit]);

  const current = users.find((u) => u.email === sel) ?? null;
  const original = useMemo(() => (current ? toDraft(pages, current) : {}), [current, pages]);
  const dirty = !!current && !current.isAdmin && (isNew || JSON.stringify(draft) !== JSON.stringify(original));

  const select = (u: AccessUser) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setSel(u.email); setDraft(toDraft(pages, u)); setIsNew(false); setMsg(null);
  };

  const toggle = (key: string, lvl: Lvl) => setDraft((d) => {
    const def = pages.find((p) => p.key === key)!;
    const p = { ...d[key] }; const next = !p[lvl];
    if (lvl === "view")     { p.view = next; if (!next) { p.download = false; p.full = false; } }
    if (lvl === "download") { p.download = next; if (next) p.view = true; else p.full = false; }
    if (lvl === "full")     { p.full = next; if (next) { p.view = true; p.download = def.hasDownload; } }
    return { ...d, [key]: p };
  });

  const preset = (kind: "none" | "view" | "viewdl" | "full") => setDraft(
    Object.fromEntries(pages.map((p) => [p.key, {
      view: kind !== "none",
      download: (kind === "viewdl" || kind === "full") && p.hasDownload,
      full: kind === "full" && p.hasFull,
    }])));

  const addUser = () => {
    const e = addEmail.trim().toLowerCase();
    if (!EMAIL_RX.test(e)) { setMsg({ ok: false, text: "Enter a valid email address." }); return; }
    const existing = users.find((u) => u.email === e);
    if (existing) { select(existing); setAddEmail(""); return; }
    const u: AccessUser = { email: e, displayName: null, role: null, isAdmin: false, configured: false, legacy: false,
      permissions: [], updatedAt: null, updatedBy: null };
    setUsers((x) => [...x, u].sort((a, b) => a.email.localeCompare(b.email)));
    setSel(e); setDraft(toDraft(pages, u)); setIsNew(true); setAddEmail(""); setMsg(null);
  };

  const save = async () => {
    if (!current) return;
    setSaving(true); setMsg(null);
    try {
      const r = await saveAccessUser(current.email,
        Object.entries(draft).map(([pageKey, f]) => ({ pageKey, ...f })), msal);
      setUsers((list) => list.map((u) => u.email === current.email
        ? { ...u, configured: true, legacy: false, permissions: r.permissions, updatedAt: new Date().toISOString() } : u));
      setIsNew(false);
      setMsg({ ok: true, text: r.changes > 0 ? `Saved — ${r.changes} change(s) recorded in the audit log.` : "No changes to save." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed." }); }
    finally { setSaving(false); }
  };

  if (!access.ready) return <div className="aa-page"><div className="aa-card aa-center">Checking your access…</div></div>;
  if (!access.isAdmin) return (
    <div className="aa-page"><div className="aa-card aa-center">
      <div className="aa-big">🔒</div><b>Only Accounts access admins can open this page.</b>
      <p>Access admins: Ankit Heda and Gaurav Zore.</p><Link className="aa-btn" to="/accounts">← Back to Credit Notes</Link>
    </div></div>);

  const shown = users.filter((u) => !filter || u.email.includes(filter.toLowerCase()) || (u.displayName ?? "").toLowerCase().includes(filter.toLowerCase()));
  const aPages = Math.max(1, Math.ceil(aTotal / PAGE_SIZE));

  return (
    <div className="aa-page">
      <div className="aa-head">
        <div>
          <div className="aa-eyebrow">Accounts</div>
          <h1>Access Management</h1>
          <p>Grant or revoke page-wise access for Accounts team members. Every change is recorded in the audit history.</p>
        </div>
        <Link className="aa-btn" to="/accounts">← Credit Notes</Link>
      </div>

      <div className="aa-tabs">
        <button className={tab === "perm" ? "is-on" : ""} onClick={() => setTab("perm")}>👥 Users &amp; permissions</button>
        <button className={tab === "audit" ? "is-on" : ""} onClick={() => setTab("audit")}>🧾 Audit history</button>
      </div>

      {msg && <div className={`aa-msg ${msg.ok ? "aa-msg--ok" : "aa-msg--err"}`}>{msg.ok ? "✓" : "⚠"} {msg.text}</div>}

      {tab === "perm" && (
        <div className="aa-grid">
          <aside className="aa-card aa-users">
            <input className="aa-input" placeholder="🔍 Search users…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="aa-add">
              <input className="aa-input" placeholder="Add user by email…" value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUser()} />
              <button className="aa-btn aa-btn--primary" onClick={addUser}>Add</button>
            </div>
            <div className="aa-userlist">
              {loading ? <div className="aa-muted">Loading…</div>
                : shown.length === 0 ? <div className="aa-muted">No users.</div>
                : shown.map((u) => (
                  <button key={u.email} className={`aa-user${sel === u.email ? " is-on" : ""}`} onClick={() => select(u)}>
                    <span className="aa-avatar">{(u.displayName || u.email)[0].toUpperCase()}</span>
                    <span className="aa-user-txt">
                      <b>{u.displayName || u.email.split("@")[0]}</b>
                      <small>{u.email}</small>
                    </span>
                    {u.isAdmin ? <span className="aa-tag aa-tag--admin">Admin</span>
                      : !u.configured ? <span className="aa-tag aa-tag--legacy" title="No restrictions configured yet">Unrestricted</span>
                      : null}
                  </button>))}
            </div>
          </aside>

          <section className="aa-card aa-editor">
            {!current ? <div className="aa-center aa-muted">Select a user on the left to manage their access.</div> : (
              <>
                <div className="aa-editor-head">
                  <div><h2>{current.displayName || current.email}</h2><small>{current.email}</small></div>
                  {current.updatedAt && <small className="aa-muted">Last updated {ist(current.updatedAt)}{current.updatedBy ? ` · ${current.updatedBy}` : ""}</small>}
                </div>

                {current.isAdmin ? (
                  <div className="aa-msg aa-msg--info">🔑 Access admin — full access to every page and to this Access Management screen. This cannot be changed here.</div>
                ) : (
                  <>
                    {!current.configured && !isNew && (
                      <div className="aa-msg aa-msg--info">This user currently has unrestricted (legacy) access. Saving will replace it with the permissions below.</div>)}
                    <div className="aa-presets">
                      <span>Quick set:</span>
                      <button className="aa-chip" onClick={() => preset("view")}>View only</button>
                      <button className="aa-chip" onClick={() => preset("viewdl")}>View &amp; Download</button>
                      <button className="aa-chip" onClick={() => preset("full")}>Full access</button>
                      <button className="aa-chip aa-chip--danger" onClick={() => preset("none")}>Revoke all</button>
                    </div>

                    <div className="aa-table-wrap">
                      <table className="aa-table">
                        <thead><tr><th>Page</th><th>View</th><th>Download</th><th>Full</th></tr></thead>
                        <tbody>
                          {pages.map((p) => {
                            const f = draft[p.key] ?? { view: false, download: false, full: false };
                            const cell = (lvl: Lvl, applicable: boolean) => applicable
                              ? <input type="checkbox" checked={f[lvl]} onChange={() => toggle(p.key, lvl)} aria-label={`${p.name} ${lvl}`} />
                              : <span className="aa-na" title="Not applicable for this page">—</span>;
                            return (
                              <tr key={p.key}>
                                <td><b>{p.name}</b><small>{p.description}</small></td>
                                <td>{cell("view", true)}</td>
                                <td>{cell("download", p.hasDownload)}</td>
                                <td>{cell("full", p.hasFull)}</td>
                              </tr>);
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="aa-actions">
                      <button className="aa-btn aa-btn--primary" disabled={!dirty || saving} onClick={save}>
                        {saving ? "Saving…" : "💾 Save permissions"}</button>
                      <button className="aa-btn" disabled={!dirty || saving} onClick={() => { setDraft(original); setIsNew(false); }}>Reset</button>
                      {dirty && <span className="aa-muted">Unsaved changes</span>}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {tab === "audit" && (
        <div className="aa-card">
          <div className="aa-filters">
            <input className="aa-input" placeholder="Filter by user (receiver)…" value={aUser} onChange={(e) => { setAUser(e.target.value); setAPage(1); }} />
            <input className="aa-input" placeholder="Filter by who changed it…" value={aActor} onChange={(e) => { setAActor(e.target.value); setAPage(1); }} />
            <select className="aa-input" value={aAction} onChange={(e) => { setAAction(e.target.value); setAPage(1); }}>
              <option value="">All actions</option><option>Granted</option><option>Revoked</option>
              <option>UserAdded</option><option>Denied</option>
            </select>
            <button className="aa-btn" onClick={loadAudit} disabled={aLoading}>{aLoading ? "Loading…" : "↻ Refresh"}</button>
          </div>
          <div className="aa-table-wrap">
            <table className="aa-table aa-table--audit">
              <thead><tr><th>Date &amp; time (IST)</th><th>Action by</th><th>Action</th><th>User</th><th>Page</th><th>Permission</th><th>Note</th></tr></thead>
              <tbody>
                {aRows.length === 0 ? <tr><td colSpan={7} className="aa-center aa-muted">{aLoading ? "Loading…" : "No audit entries."}</td></tr>
                  : aRows.map((r) => (
                    <tr key={r.id}>
                      <td className="aa-nowrap">{ist(r.at)}</td>
                      <td><b>{r.actorName}</b><small>{r.actorEmail}</small></td>
                      <td><span className={`aa-badge aa-badge--${r.action}`}>{r.action}</span></td>
                      <td>{r.targetEmail}</td>
                      <td>{r.pageName}</td>
                      <td>{r.permissionType}</td>
                      <td>{r.note ?? ""}</td>
                    </tr>))}
              </tbody>
            </table>
          </div>
          <div className="aa-pager">
            <span className="aa-muted">{aTotal} entr{aTotal === 1 ? "y" : "ies"}</span>
            <button className="aa-btn" disabled={aPage <= 1} onClick={() => setAPage((p) => p - 1)}>‹ Prev</button>
            <span>Page {aPage} / {aPages}</span>
            <button className="aa-btn" disabled={aPage >= aPages} onClick={() => setAPage((p) => p + 1)}>Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}
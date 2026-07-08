// src/components/chat/WhatsAppPanel.tsx
import { useEffect, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import {
  fetchWaContacts, fetchWaConversation, fetchWaTemplates,
  sendWaText, sendWaTemplate,
  fmtPhone, isValidPhone, normalisePhone,
  type WaContact, type WaMessage, type WaTemplate,
} from "../../services/whatsappService";
import "./WhatsAppPanel.css";

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function StatusTick({ status }: { status: string }) {
  if (status === "read")      return <span className="wa-tick wa-tick--read">✓✓</span>;
  if (status === "delivered") return <span className="wa-tick wa-tick--del">✓✓</span>;
  if (status === "sent")      return <span className="wa-tick">✓</span>;
  if (status === "failed")    return <span className="wa-tick wa-tick--fail">!</span>;
  return null;
}

function WaAvatar({ name, size = 38 }: { name: string; size?: number }) {
  const initials = (name || "?").split(" ").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 2);
  const colors = ["#128C7E","#25D366","#075E54","#34B7F1","#00a884"];
  const idx = (name.charCodeAt(0) || 0) % colors.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: colors[idx],
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, color: "#fff", flexShrink: 0,
    }}>{initials}</div>
  );
}

export default function WhatsAppPanel() {
  const { instance } = useMsal();

  const [open,      setOpen]      = useState(false);
  const [view,      setView]      = useState<"contacts"|"thread"|"new"|"template">("contacts");
  const [contacts,  setContacts]  = useState<WaContact[]>([]);
  const [messages,  setMessages]  = useState<WaMessage[]>([]);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [active,    setActive]    = useState<WaContact | null>(null);

  // New contact form
  const [newPhone,  setNewPhone]  = useState("");
  const [newName,   setNewName]   = useState("");
  const [phoneErr,  setPhoneErr]  = useState("");

  // Message input
  const [draft,     setDraft]     = useState("");
  const [sending,   setSending]   = useState(false);
  const [sendErr,   setSendErr]   = useState<string | null>(null);

  // Template
  const [selTemplate, setSelTemplate] = useState<WaTemplate | null>(null);
  const [tplParams,   setTplParams]   = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const phoneRef  = useRef<HTMLInputElement>(null);

  const scrollBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

  // Load contacts when panel opens
  useEffect(() => {
    if (!open) return;
    fetchWaContacts(instance).then(setContacts).catch(() => {});
  }, [open]);

  // ── Open existing contact thread directly ─────────────────────────────────
  const openThread = async (contact: WaContact) => {
    setActive(contact);
    setView("thread");
    setSendErr(null);
    setMessages([]);
    try {
      const msgs = await fetchWaConversation(contact.phone, instance);
      setMessages(msgs);
      scrollBottom();
    } catch {}
  };

  // ── New conversation: show form, then immediately open thread on submit ───
  const handleNewStart = async () => {
    if (!isValidPhone(newPhone)) {
      setPhoneErr("Enter a valid 10-digit mobile number.");
      phoneRef.current?.focus();
      return;
    }
    const phone = normalisePhone(newPhone);
    const contact: WaContact = {
      phone,
      contactName: newName.trim() || null,
      lastMessage: null,
      lastAt: new Date().toISOString(),
      unread: 0,
    };

    // Add/update in contacts list
    setContacts((prev) => {
      const exists = prev.find((c) => c.phone === phone);
      return exists ? prev : [contact, ...prev];
    });

    // Clear form and go straight to thread
    setNewPhone("");
    setNewName("");
    setPhoneErr("");
    await openThread(contact);
  };

  // ── Send text message ─────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!draft.trim() || !active) return;
    const body = draft.trim();
    setSending(true);
    setSendErr(null);
    setDraft("");

    // Optimistic bubble
    const temp: WaMessage = {
      id: crypto.randomUUID(), toPhone: active.phone,
      contactName: active.contactName, body,
      messageType: "text", direction: "outbound",
      status: "sent", waMessageId: null,
      sentAt: new Date().toISOString(),
      deliveredAt: null, readAt: null,
      sentByName: "Me", sentByEmail: "",
    };
    setMessages((prev) => [...prev, temp]);
    scrollBottom();

    try {
      await sendWaText(active.phone, body, active.contactName, instance);
      // Refresh contacts to update lastMessage
      fetchWaContacts(instance).then(setContacts).catch(() => {});
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  // ── Open template view ────────────────────────────────────────────────────
  const openTemplate = async () => {
    if (templates.length === 0) {
      const tpls = await fetchWaTemplates(instance).catch(() => []);
      setTemplates(tpls);
    }
    setSelTemplate(null);
    setTplParams([]);
    setView("template");
  };

  // ── Send template ─────────────────────────────────────────────────────────
  const handleTemplateSend = async () => {
    if (!selTemplate || !active) return;
    setSending(true);
    setSendErr(null);
    try {
      await sendWaTemplate(active.phone, selTemplate.id, tplParams, active.contactName, instance);
      const msgs = await fetchWaConversation(active.phone, instance);
      setMessages(msgs);
      scrollBottom();
      setView("thread");
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Template send failed.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <>
      {/* ── WhatsApp bubble ── */}
      <button className="wa-bubble" onClick={() => setOpen((v) => !v)} title="WhatsApp">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.112 1.524 5.84L0 24l6.335-1.503A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.003-1.369l-.36-.214-3.72.883.947-3.461-.235-.374A9.818 9.818 0 0 1 2.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
        </svg>
      </button>

      {open && (
        <div className="wa-panel">

          {/* Header */}
          <div className="wa-head">
            {(view === "thread" || view === "template") && active ? (
              <>
                <button className="wa-back" onClick={() => setView("contacts")}>←</button>
                <WaAvatar name={active.contactName ?? active.phone} size={32}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="wa-head-name">{active.contactName || fmtPhone(active.phone)}</div>
                  <div className="wa-head-phone">{fmtPhone(active.phone)}</div>
                </div>
                {view === "thread" && (
                  <button className="wa-tpl-btn" onClick={openTemplate} title="Send template">📋</button>
                )}
              </>
            ) : view === "new" ? (
              <>
                <button className="wa-back" onClick={() => setView("contacts")}>←</button>
                <span className="wa-head-title">New WhatsApp Chat</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" style={{ flexShrink:0 }}>
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.112 1.524 5.84L0 24l6.335-1.503A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.003-1.369l-.36-.214-3.72.883.947-3.461-.235-.374A9.818 9.818 0 0 1 2.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
                </svg>
                <span className="wa-head-title">WhatsApp</span>
              </>
            )}
            <button className="wa-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* ── Contacts list ── */}
          {view === "contacts" && (
            <div className="wa-contacts-view">
              {/* New chat button — always at top */}
              <button className="wa-new-btn" onClick={() => {
                setNewPhone(""); setNewName(""); setPhoneErr("");
                setView("new");
              }}>
                ✎ New Chat by Number
              </button>

              {contacts.length === 0 ? (
                <div className="wa-empty">
                  No conversations yet.<br/>
                  <span style={{ fontSize:11 }}>Tap "New Chat by Number" to start.</span>
                </div>
              ) : (
                contacts.map((c) => (
                  // Click existing contact → directly opens thread (no extra step)
                  <div key={c.phone} className="wa-contact-row" onClick={() => openThread(c)}>
                    <WaAvatar name={c.contactName ?? c.phone}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div className="wa-contact-name">
                        {c.contactName || fmtPhone(c.phone)}
                      </div>
                      <div className="wa-contact-last">{c.lastMessage || "Tap to chat"}</div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                      <span className="wa-contact-time">{fmtTime(c.lastAt)}</span>
                      {c.unread > 0 && <span className="wa-unread-dot">{c.unread}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── New contact form — minimal, just phone + name, opens thread immediately ── */}
          {view === "new" && (
            <div className="wa-new-view">
              <p className="wa-new-hint">
                Enter a WhatsApp number to start chatting. The thread opens immediately after you tap Start.
              </p>

              <label className="wa-field-label">Phone Number *</label>
              <div className="wa-phone-row">
                <span className="wa-country-code">+91</span>
                <input
                  ref={phoneRef}
                  type="tel"
                  autoFocus
                  maxLength={15}
                  className={`wa-phone-input${phoneErr ? " wa-phone-input--err" : ""}`}
                  placeholder="9876543210"
                  value={newPhone}
                  onChange={(e) => { setNewPhone(e.target.value.replace(/\D/g, "")); setPhoneErr(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleNewStart()}
                />
              </div>
              {phoneErr && <span className="wa-field-err">{phoneErr}</span>}

              <label className="wa-field-label" style={{ marginTop:12 }}>
                Contact Name (optional)
              </label>
              <input
                type="text"
                className="wa-text-input"
                placeholder="e.g. Rajesh Kumar"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNewStart()}
              />

              <button className="wa-start-btn" onClick={handleNewStart}>
                Open Chat →
              </button>
            </div>
          )}

          {/* ── Thread ── */}
          {view === "thread" && (
            <div className="wa-thread-view">
              <div className="wa-messages" style={{ background:"#ece5dd" }}>
                {messages.length === 0 && (
                  <div className="wa-empty" style={{ color:"#54656f" }}>
                    No messages yet.<br/>
                    <span style={{ fontSize:11 }}>
                      Send a template first if this is a first-time contact.
                    </span>
                    <button className="wa-tpl-start-btn" onClick={openTemplate}>
                      📋 Send Template
                    </button>
                  </div>
                )}
                {messages.map((m) => {
                  const isOut = m.direction === "outbound";
                  return (
                    <div key={m.id}
                      className={`wa-msg-wrap ${isOut ? "wa-msg-wrap--out" : "wa-msg-wrap--in"}`}>
                      <div className={`wa-bubble-msg ${isOut ? "wa-bubble-msg--out" : "wa-bubble-msg--in"}`}>
                        <span className="wa-msg-body">{m.body}</span>
                        <div className="wa-msg-meta">
                          <span className="wa-msg-time">{fmtTime(m.sentAt)}</span>
                          {isOut && <StatusTick status={m.status}/>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef}/>
              </div>

              {sendErr && <div className="wa-send-err">⚠ {sendErr}</div>}

              <div className="wa-input-bar">
                <textarea
                  className="wa-input"
                  placeholder="Type a message…"
                  value={draft}
                  rows={1}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button className="wa-send-btn"
                  onClick={handleSend} disabled={!draft.trim() || sending}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/>
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* ── Template view ── */}
          {view === "template" && (
            <div className="wa-tpl-view">
              <p className="wa-new-hint">
                Select an approved template for first messages or outside the 24h window.
              </p>
              {templates.map((t) => (
                <div key={t.id}
                  className={`wa-tpl-row ${selTemplate?.id === t.id ? "wa-tpl-row--sel" : ""}`}
                  onClick={() => { setSelTemplate(t); setTplParams(Array(t.variables.length).fill("")); }}>
                  <div className="wa-tpl-label">{t.label}</div>
                  <div className="wa-tpl-id">{t.id}</div>
                </div>
              ))}
              {selTemplate && (
                <div className="wa-tpl-params">
                  <div className="wa-field-label" style={{ marginBottom:8 }}>
                    Fill in: <strong>{selTemplate.label}</strong>
                  </div>
                  {selTemplate.variables.map((v, i) => (
                    <div key={v} style={{ marginBottom:8 }}>
                      <label className="wa-field-label">{`{{${i+1}}} ${v}`}</label>
                      <input type="text" className="wa-text-input" placeholder={v}
                        value={tplParams[i] ?? ""}
                        onChange={(e) => {
                          const next = [...tplParams]; next[i] = e.target.value; setTplParams(next);
                        }}/>
                    </div>
                  ))}
                  <button className="wa-start-btn" disabled={sending} onClick={handleTemplateSend}>
                    {sending ? "Sending…" : "📤 Send Template"}
                  </button>
                  {sendErr && <div className="wa-send-err">{sendErr}</div>}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </>
  );
}
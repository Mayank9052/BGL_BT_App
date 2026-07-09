// src/components/chat/ChatPanel.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../../store/authStore";
import {
  initChatConnection, startConnection, stopConnection,
  getConnection, sendMessage, sendTyping, joinRoom, leaveRoom,
  fetchEmployees, fetchRooms, fetchMessages,
  getOrCreateDirect, getOrCreateBotRoom,
  type ChatMessage, type ChatRoom, type Employee,
} from "../../services/chatService";
import "./ChatPanel.css";

// ── Notification sounds — shared AudioContext (avoids autoplay block) ─────────
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx)
      _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Resume if suspended (browser autoplay policy)
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    return _audioCtx;
  } catch { return null; }
}
function playTone(freqStart: number, freqEnd: number, duration: number, volume: number) {
  const ctx = getAudioCtx(); if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(freqStart, ctx.currentTime);
    if (freqEnd !== freqStart)
      osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + duration);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration + 0.01);
  } catch {}
}
// Incoming — crisp single "ting" (high C, 80ms, instant decay)
function playNotificationSound() { playTone(1046, 1046, 0.08, 0.22); }
// Outgoing — soft click (short ascending, 100ms)
function playSentSound()         { playTone(600, 780, 0.09, 0.14); }

// ── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, isBot = false, size = 36 }: { name: string; isBot?: boolean; size?: number }) {
  const initials = isBot ? "AI"
    : name.split(" ").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 2);
  const colors = ["#1e40af","#166534","#92400e","#7c3aed","#be185d","#0e7490","#b45309"];
  const color  = colors[(name.charCodeAt(0) || 0) % colors.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: isBot ? "#1e3a5f" : color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, color: "#fff", flexShrink: 0,
      border: "2px solid rgba(255,255,255,0.15)",
    }}>{initials}</div>
  );
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ChatPanel() {
  const { instance, accounts } = useMsal();
  const { user }               = useAuthStore();

  // Identity: Azure AD staff OR dealer JWT from localStorage
  const dealerUser = (() => {
    try {
      const raw = localStorage.getItem("bgauss_dealer_user");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const myEmail = accounts[0]?.username ?? user?.email ?? dealerUser?.email ?? "";
  const myName  = accounts[0]?.name     ?? user?.displayName
                  ?? dealerUser?.dealerName ?? dealerUser?.displayName ?? "Me";

  const [open,       setOpen]       = useState(false);
  const [view,       setView]       = useState<"rooms"|"employees"|"thread">("rooms");
  const [rooms,      setRooms]      = useState<ChatRoom[]>([]);
  const [employees,  setEmployees]  = useState<Employee[]>([]);
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const [messages,   setMessages]   = useState<ChatMessage[]>([]);
  const [draft,      setDraft]      = useState("");
  const [empSearch,  setEmpSearch]  = useState("");
  const [typing,     setTyping]     = useState<string | null>(null);
  const [unread,     setUnread]     = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [connState,  setConnState]  = useState<"connecting"|"connected"|"disconnected">("connecting");

  const bottomRef     = useRef<HTMLDivElement>(null);
  const typingTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef      = useRef<HTMLTextAreaElement>(null);
  const activeRoomRef = useRef<ChatRoom | null>(null);
  activeRoomRef.current = activeRoom;

  // ── Init SignalR ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Allow both MSAL staff (accounts[0]) and dealer JWT (localStorage)
    const hasDealerToken = (() => {
      try {
        const raw = localStorage.getItem("bgauss_dealer_user");
        return !!(raw && JSON.parse(raw)?.token);
      } catch { return false; }
    })();
    if (!accounts[0] && !hasDealerToken) return;
    const conn = initChatConnection(instance);

    conn.onreconnecting(() => setConnState("connecting"));
    conn.onreconnected(()  => { setConnState("connected"); reloadRooms(); });
    conn.onclose(()        => setConnState("disconnected"));

    // Incoming message — only show in thread if it belongs to the active room
    conn.on("ReceiveMessage", (msg: ChatMessage) => {
      console.log("[Chat] ReceiveMessage:", msg.roomId, "isBot:", msg.isBot, "current:", activeRoomRef.current?.id);
      const currentRoom = activeRoomRef.current;
      // Case-insensitive roomId comparison (Guid serialization can vary)
      // Compare roomId - normalize both sides (Guid can be with/without dashes)
      const normalizeId = (id: string) => id?.toLowerCase().replace(/-/g, "");
      const sameRoom = currentRoom &&
        normalizeId(msg.roomId) === normalizeId(currentRoom.id);

      // Play sound for any incoming message NOT sent by self
      const fromSelf = msg.senderEmail?.toLowerCase() === myEmail.toLowerCase();
      if (!fromSelf) playNotificationSound();

      if (sameRoom) {
        setMessages((prev) => {
          // Replace optimistic bubble for USER's own messages only
          // Bot replies (isBot=true) are always new — never deduplicate them
          if (msg.isBot) return [...prev, msg];
          const isDup = prev.some(
            (p) => !p.isBot &&
                   p.body === msg.body &&
                   p.senderEmail?.toLowerCase() === msg.senderEmail?.toLowerCase() &&
                   Math.abs(new Date(p.sentAt).getTime() - new Date(msg.sentAt).getTime()) < 8000
          );
          return isDup
            ? prev.map((p) =>
                (!p.isBot && p.body === msg.body &&
                 p.senderEmail?.toLowerCase() === msg.senderEmail?.toLowerCase())
                  ? msg : p
              )
            : [...prev, msg];
        });
        scrollBottom();
      } else if (msg.isBot) {
        if (currentRoom) setUnread((n) => n + 1);
      } else {
        setUnread((n) => {
          const next = n + 1;
          // Dispatch event so Navbar bell icon can update
          window.dispatchEvent(new CustomEvent("chat-unread", { detail: { count: next } }));
          return next;
        });
        // Browser notification when tab/panel is not focused
        if (document.hidden && Notification.permission === "granted") {
          new Notification("BGauss Chat", {
            body: `${msg.senderName}: ${msg.body.slice(0, 80)}`,
            icon: "/BGauss_Logo.png",
            tag:  "chat-msg",       // replaces previous if still shown
          });
        }
      }
      reloadRooms();
    });

    conn.on("ChatError", (msg: string) => {
      console.error("[ChatError]", msg);
      // Show error in the chat as a system message
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(), roomId: activeRoomRef.current?.id ?? "",
        senderEmail: "system", senderName: "System",
        body: `⚠ ${msg}`, isBot: true, sentAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    });

    conn.on("UserTyping", ({ senderName, isTyping }: { senderName: string; isTyping: boolean }) => {
      setTyping(isTyping ? senderName : null);
      if (isTyping) {
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(null), 3000);
      }
    });

    startConnection()
      .then(() => { setConnState("connected"); reloadRooms(); })
      .catch(() => setConnState("disconnected"));

    return () => { stopConnection(); };
  // Re-init if MSAL account OR dealer token changes
  }, [accounts[0]?.username, myEmail]);

  // ── Bell icon click → open chat panel ────────────────────────────────────
  useEffect(() => {
    const handler = () => { setOpen(true); setUnread(0);
      window.dispatchEvent(new CustomEvent("chat-unread", { detail: { count: 0 } }));
    };
    window.addEventListener("chat-open-panel", handler);
    return () => window.removeEventListener("chat-open-panel", handler);
  }, []);

  const reloadRooms = useCallback(async () => {
    try { setRooms(await fetchRooms(instance)); }
    catch {}
  }, [instance]);

  useEffect(() => { if (open) reloadRooms(); }, [open]);

  const scrollBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

  // ── Open thread — shows the conversation from MY perspective ─────────────
  // otherName/otherEmail come from the server already filtered to "the other person"
  // (ChatController returns otherEmail = the member who is NOT the current user)
  const openThread = async (room: ChatRoom) => {
    // Leave previous room group
    if (activeRoomRef.current?.id && activeRoomRef.current.id !== room.id)
      leaveRoom(activeRoomRef.current.id).catch(() => {});

    setActiveRoom(room);
    setView("thread");
    setLoading(true);
    setUnread(0);
    setMessages([]);

    // Join room group for efficient typing broadcast (no DB query on server)
    joinRoom(room.id).catch(() => {});

    try {
      const msgs = await fetchMessages(room.id, instance);
      setMessages(msgs);
      scrollBottom();
    } catch {}
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // ── Start direct chat with an employee ────────────────────────────────────
  // Creates a room (or reuses existing) between myEmail ↔ emp.email
  const startDirect = async (emp: Employee) => {
    // If a room with this person already exists, just open it
    const existing = rooms.find(
      (r) => r.roomType === "direct" &&
             r.otherEmail?.toLowerCase() === emp.email.toLowerCase()
    );
    if (existing) { await openThread(existing); return; }

    setLoading(true);
    try {
      const { roomId } = await getOrCreateDirect(emp.email, instance);
      const room: ChatRoom = {
        id: roomId, roomType: "direct",
        otherName:  emp.displayName,
        otherEmail: emp.email,
        lastMessage: "", lastAt: new Date().toISOString(),
      };
      await openThread(room);
      await reloadRooms();
    } catch {}
    setLoading(false);
  };

  // ── Open bot room ─────────────────────────────────────────────────────────
  const openBot = async () => {
    // Reuse existing bot room if present
    const existing = rooms.find((r) => r.roomType === "bot");
    if (existing) { await openThread(existing); return; }

    setLoading(true);
    try {
      const { roomId } = await getOrCreateBotRoom(instance);
      const room: ChatRoom = {
        id: roomId, roomType: "bot",
        otherName: "BGauss Assistant", otherEmail: "bot@bgauss.com",
        lastMessage: "", lastAt: new Date().toISOString(),
      };
      await openThread(room);
      await reloadRooms();
    } catch {}
    setLoading(false);
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  // Send current draft
  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !activeRoom) return;
    setDraft("");
    // Optimistic message bubble
    const temp: ChatMessage = {
      id: crypto.randomUUID(), roomId: activeRoom.id,
      senderEmail: myEmail, senderName: myName,
      body, isBot: false, sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    scrollBottom();
    playSentSound();   // play immediately on send
    try { await sendMessage(activeRoom.id, body); }
    catch (e) { console.error(e); }
  };

  // Send an arbitrary body immediately (used by suggestion chips)
  const sendImmediate = async (body: string) => {
    if (!body.trim() || !activeRoom) return;
    const temp: ChatMessage = {
      id: crypto.randomUUID(), roomId: activeRoom.id,
      senderEmail: myEmail, senderName: myName,
      body, isBot: false, sentAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    scrollBottom();
    playSentSound();   // play immediately on send
    try {
      await sendMessage(activeRoom.id, body);
    } catch (e) {
      // Show delivery error in chat
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(), roomId: activeRoom.id,
        senderEmail: "system", senderName: "System",
        body: `⚠ Message not delivered: ${e instanceof Error ? e.message : "Connection error"}. Please try again.`,
        isBot: true, sentAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Typing indicator — debounced to max once per 3 seconds to protect DB
  const lastTypingSent = useRef<number>(0);
  const handleTyping = () => {
    if (!activeRoom) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;  // throttle to 1 call per 3s
    lastTypingSent.current = now;
    sendTyping(activeRoom.id, true).catch(() => {});   // fire and forget, never throw
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() =>
      sendTyping(activeRoom.id, false).catch(() => {}), 3000);
  };

  const openEmployees = async () => {
    setView("employees");
    if (employees.length === 0) {
      try { setEmployees(await fetchEmployees(instance)); }
      catch {}
    }
  };

  // Filter out yourself from the employee list
  const filteredEmployees = employees.filter((e) => {
    if (e.email.toLowerCase() === myEmail.toLowerCase()) return false;
    if (!empSearch) return true;
    return (
      e.displayName.toLowerCase().includes(empSearch.toLowerCase()) ||
      e.email.toLowerCase().includes(empSearch.toLowerCase()) ||
      (e.department ?? "").toLowerCase().includes(empSearch.toLowerCase())
    );
  });

  // ── Role-based auto-suggestions ────────────────────────────────────────────
  const commonSuggestions = [
    "What is the CAC limit for Eligible Old Dealer?",
    "Explain the 3-month average eligibility criteria",
    "What is the CPL logic?",
    "Show all state-wise budget summary",
  ];

  const adminSuggestions = [
    "Which state has the highest CAC?",
    "Show all pending proposals with CAC analysis",
    "Which dealers exceed the CAC limit?",
    "Compare CAC vs CPL across all states",
    "What is the total approved budget?",
    "Show RSM-wise submission summary",
  ];

  const managerSuggestions = [
    "Show pending proposals for my review",
    "Which proposals exceed CAC limit?",
    "What is the 3-month average CAC?",
    "Show dealer-wise budget breakdown",
    "Which dealers are non-eligible?",
  ];

  const rsmSuggestions = [
    "Show my pending proposals",
    "What is my total budget approved?",
    "How do I calculate CAC for my proposal?",
    "Am I within the CAC limit?",
    "What activities are available for BTL?",
  ];

  function getRoleSuggestions(role?: string | null): string[] {
    const r = (role ?? "").toLowerCase();
    if (r === "admin")   return [...adminSuggestions.slice(0, 4),   ...commonSuggestions.slice(0, 2)];
    if (r === "manager") return [...managerSuggestions.slice(0, 4), ...commonSuggestions.slice(0, 2)];
    return [...rsmSuggestions.slice(0, 3), ...commonSuggestions.slice(0, 3)];
  }

  return (
    <>
      {/* ── Floating bubble ── */}
      <button className="chat-bubble"
        onClick={() => {
          setOpen((v) => !v);
          setUnread(0);
          window.dispatchEvent(new CustomEvent("chat-unread", { detail: { count: 0 } }));
          // Request browser notification permission on first open
          if (Notification.permission === "default")
            Notification.requestPermission().catch(() => {});
        }}
        title="Open BGauss Chat">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        {unread > 0 && <span className="chat-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {/* ── Panel ── */}
      {open && (
        <div className="chat-panel">

          {/* Header */}
          <div className="chat-panel-head">
            {view === "thread" && activeRoom ? (
              <>
                <button className="chat-back-btn" onClick={() => setView("rooms")}>←</button>
                <Avatar name={activeRoom.otherName} isBot={activeRoom.roomType === "bot"} size={30}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="chat-head-name">{activeRoom.otherName}</div>
                  <div className="chat-head-sub">
                    {activeRoom.roomType === "bot"
                      ? "AI • BTL Assistant"
                      : activeRoom.otherEmail}
                  </div>
                </div>
              </>
            ) : view === "employees" ? (
              <>
                <button className="chat-back-btn" onClick={() => setView("rooms")}>←</button>
                <span className="chat-head-title">New Chat</span>
              </>
            ) : (
              <>
                <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span className="chat-head-title">BGauss Chat</span>
                  <span className={`chat-conn-dot chat-conn-dot--${connState}`} title={connState}/>
                {connState === "disconnected" && (
                  <span style={{ fontSize:10, color:"#ef4444", fontWeight:600 }}>
                    Reconnecting…
                  </span>
                )}
                </div>
                {/* Show logged-in user identity */}
                <span className="chat-my-email" title={myEmail}>
                  {myName.split(" ")[0]}
                </span>
              </>
            )}
            <button className="chat-close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* ── Rooms list ── */}
          {view === "rooms" && (
            <div className="chat-rooms-view">
              <div className="chat-rooms-actions">
                <button className="chat-action-btn chat-action-btn--bot" onClick={openBot}>
                  🤖 Ask AI Assistant
                </button>
                <button className="chat-action-btn" onClick={openEmployees}>
                  👥 New Chat
                </button>
              </div>

              {/* Logged in as banner */}
              <div className="chat-identity-bar">
                <span className="chat-identity-dot"/>
                Chatting as <strong>{myEmail}</strong>
              </div>

              {rooms.length === 0 ? (
                <div className="chat-empty">
                  No conversations yet.<br/>Start a chat above.
                </div>
              ) : (
                rooms.map((r) => (
                  <div key={r.id} className="chat-room-row" onClick={() => openThread(r)}>
                    <Avatar name={r.otherName} isBot={r.roomType === "bot"} size={38}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      {/* otherName = the other person's name (not yours) */}
                      <div className="chat-room-name">{r.otherName}</div>
                      <div className="chat-room-last">{r.lastMessage || "No messages yet"}</div>
                    </div>
                    <div className="chat-room-time">{fmtTime(r.lastAt)}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Employees list ── */}
          {view === "employees" && (
            <div className="chat-emp-view">
              <div className="chat-search-bar">
                <input autoFocus type="search"
                  placeholder="Search name, email, department…"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  className="chat-search-input"
                />
              </div>
              <div style={{ overflowY:"auto", flex:1 }}>
                {filteredEmployees.length === 0 ? (
                  <div className="chat-empty">No employees found.</div>
                ) : (
                  filteredEmployees.map((e) => {
                    const hasRoom = rooms.some(
                      (r) => r.roomType === "direct" &&
                             r.otherEmail?.toLowerCase() === e.email.toLowerCase()
                    );
                    return (
                      <div key={e.id} className="chat-emp-row" onClick={() => startDirect(e)}>
                        <Avatar name={e.displayName} size={36}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div className="chat-emp-name">
                            {e.displayName}
                            {hasRoom && (
                              <span className="chat-existing-tag">existing chat</span>
                            )}
                          </div>
                          <div className="chat-emp-sub">
                            {[e.department, e.jobTitle].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <span className={`chat-role-chip chat-role-chip--${e.role.toLowerCase()}`}>
                          {e.role}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ── Thread ── */}
          {view === "thread" && (
            <div className="chat-thread-view">
              <div className="chat-messages">
                {loading && <div className="chat-empty">Loading…</div>}

                {/* Bot welcome */}
                {!loading && messages.length === 0 && activeRoom?.roomType === "bot" && (
                  <div className="chat-bot-welcome">
                    <div style={{ fontSize:32, marginBottom:8 }}>🤖</div>
                    <div style={{ fontWeight:600, color:"#0a2540", marginBottom:4 }}>
                      Hi {myName.split(" ")[0]}! I'm your BGauss BTL Assistant.
                    </div>
                    <div style={{ fontSize:12, color:"#64748b" }}>
                      I have access to live proposal data. Ask me about CAC, budgets, dealers, or any proposal.
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:12, justifyContent:"center" }}>
                      {getRoleSuggestions(user?.role).map((q) => (
                        <button key={q} className="chat-suggestion-btn"
                          onClick={() => sendImmediate(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty direct chat */}
                {!loading && messages.length === 0 && activeRoom?.roomType === "direct" && (
                  <div className="chat-empty" style={{ marginTop:40 }}>
                    Start your conversation with<br/>
                    <strong>{activeRoom.otherName}</strong>
                  </div>
                )}

                {messages.map((m) => {
                  const isMine = m.senderEmail?.toLowerCase() === myEmail.toLowerCase();
                  return (
                    <div key={m.id}
                      className={`chat-msg-wrap ${isMine ? "chat-msg-wrap--mine" : "chat-msg-wrap--theirs"}`}>
                      {!isMine && <Avatar name={m.senderName} isBot={m.isBot} size={28}/>}
                      <div className="chat-msg-col">
                        {!isMine && (
                          <div className="chat-msg-sender">
                            {m.isBot ? "🤖 BGauss Assistant" : m.senderName}
                          </div>
                        )}
                        <div className={`chat-bubble-msg ${
                          isMine ? "chat-bubble-msg--mine"
                          : m.isBot ? "chat-bubble-msg--bot"
                          : "chat-bubble-msg--theirs"
                        }`} style={{ whiteSpace:"pre-wrap" }}>
                          {m.body}
                        </div>
                        <div className="chat-msg-time">{fmtTime(m.sentAt)}</div>
                      </div>
                    </div>
                  );
                })}

                {typing && (
                  <div className="chat-typing">
                    <span className="chat-typing-dots"><span/><span/><span/></span>
                    {typing} is typing…
                  </div>
                )}
                <div ref={bottomRef}/>
              </div>

              {/* Input bar */}
              <div className="chat-input-bar">
                <textarea
                  ref={inputRef}
                  className="chat-input"
                  placeholder={activeRoom?.roomType === "bot"
                    ? "Ask the AI assistant…"
                    : `Message ${activeRoom?.otherName ?? ""}…`}
                  value={draft}
                  rows={1}
                  onChange={(e) => { setDraft(e.target.value); handleTyping(); }}
                  onKeyDown={handleKeyDown}
                />
                <button className="chat-send-btn"
                  onClick={handleSend} disabled={!draft.trim()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
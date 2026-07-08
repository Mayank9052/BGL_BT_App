// src/pages/ChatTestPage.tsx
// Test page to verify both ChatPanel (in-app) and WhatsApp panel are working.
// Navigate to /chat to access this page.
import { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import {
  fetchEmployees,
  fetchRooms,
  getConnection,
  type Employee,
  type ChatRoom,
} from "../services/chatService";

export default function ChatTestPage() {
  const { instance, accounts } = useMsal();
  const { user }               = useAuthStore();

  const [employees,  setEmployees]  = useState<Employee[]>([]);
  const [rooms,      setRooms]      = useState<ChatRoom[]>([]);
  const [connState,  setConnState]  = useState("checking…");
  const [empError,   setEmpError]   = useState<string | null>(null);
  const [roomError,  setRoomError]  = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    // Check SignalR connection state
    const conn = getConnection();
    if (!conn) {
      setConnState("❌ Not initialised — make sure Navbar is mounted");
    } else {
      setConnState(`✅ ${conn.state}`);
    }

    // Fetch employees
    fetchEmployees(instance)
      .then(setEmployees)
      .catch((e) => setEmpError(e instanceof Error ? e.message : "Failed"))
      .finally(() => {});

    // Fetch rooms
    fetchRooms(instance)
      .then(setRooms)
      .catch((e) => setRoomError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [instance]);

  const card = (title: string, children: React.ReactNode) => (
    <div style={{
      background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12,
      padding: "18px 20px", marginBottom: 16,
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#0a2540" }}>
        {title}
      </h3>
      {children}
    </div>
  );

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", gap: 12, padding: "5px 0",
      borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
      <span style={{ color: "#64748b", minWidth: 160, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#0a2540", fontWeight: 500 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px" }}>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0a2540", margin: "0 0 4px" }}>
          🧪 Chat System — Test Page
        </h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          Verify SignalR connection, employee list, and existing rooms.
          The floating chat bubbles (navy + green) appear bottom-right on every page.
        </p>
      </div>

      {/* How to test */}
      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd",
        borderLeft: "4px solid #0ea5e9", borderRadius: 10,
        padding: "14px 16px", marginBottom: 20, fontSize: 13 }}>
        <strong style={{ color: "#0369a1" }}>How to test the chat:</strong>
        <ol style={{ margin: "8px 0 0 18px", color: "#0c4a6e", lineHeight: 2 }}>
          <li>Look for the <strong>navy chat bubble</strong> (💬) at the bottom-right of any page</li>
          <li>Click it → opens the BGauss Chat panel</li>
          <li>Click <strong>"🤖 Ask AI Assistant"</strong> → opens bot chat → ask "What is CAC limit for Old dealer?"</li>
          <li>Click <strong>"👥 New Chat"</strong> → search an employee → start direct message</li>
          <li>Look for the <strong>green WhatsApp bubble</strong> (📱) next to the navy one</li>
          <li>Click it → enter any 10-digit number → chat or send a template</li>
        </ol>
      </div>

      {/* SignalR status */}
      {card("SignalR Connection", (
        <>
          {row("Connection state", connState)}
          {row("Hub URL", `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5086"}/hubs/chat`)}
          {row("Your email", accounts[0]?.username ?? user?.email ?? "—")}
          {row("Your name",  accounts[0]?.name    ?? user?.displayName ?? "—")}
        </>
      ))}

      {/* Employees */}
      {card(`BGauss Employees (${employees.length})`, (
        <>
          {empError && (
            <div style={{ background: "#fef2f2", color: "#991b1b",
              border: "1px solid #fecaca", borderRadius: 7,
              padding: "8px 12px", fontSize: 12, marginBottom: 10 }}>
              ⚠ {empError}
            </div>
          )}
          {employees.length === 0 && !empError && (
            <p style={{ color: "#94a3b8", fontSize: 13 }}>
              No employees found — check that Users table has active records.
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {employees.slice(0, 20).map((e) => (
              <div key={e.id} style={{
                background: "#f8fafc", border: "1px solid #e2e8f0",
                borderRadius: 8, padding: "7px 12px", fontSize: 12,
              }}>
                <div style={{ fontWeight: 600, color: "#0a2540" }}>{e.displayName}</div>
                <div style={{ color: "#64748b", fontSize: 11 }}>{e.email}</div>
                <div style={{ marginTop: 3 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 7px",
                    background: e.role === "Admin" ? "#ede9fe"
                              : e.role === "Manager" ? "#e0f2fe" : "#f0fdf4",
                    color: e.role === "Admin" ? "#5b21b6"
                         : e.role === "Manager" ? "#0369a1" : "#166534",
                  }}>{e.role}</span>
                </div>
              </div>
            ))}
            {employees.length > 20 && (
              <div style={{ fontSize: 12, color: "#64748b", padding: "7px 12px" }}>
                +{employees.length - 20} more…
              </div>
            )}
          </div>
        </>
      ))}

      {/* Existing rooms */}
      {card(`Chat Rooms (${rooms.length})`, (
        <>
          {roomError && (
            <div style={{ background: "#fef2f2", color: "#991b1b",
              border: "1px solid #fecaca", borderRadius: 7,
              padding: "8px 12px", fontSize: 12, marginBottom: 10 }}>
              ⚠ {roomError}
            </div>
          )}
          {loading && <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</p>}
          {!loading && rooms.length === 0 && !roomError && (
            <p style={{ color: "#94a3b8", fontSize: 13 }}>
              No rooms yet — open the chat panel and start a conversation.
            </p>
          )}
          {rooms.map((r) => (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "9px 0", borderBottom: "1px solid #f1f5f9",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: r.roomType === "bot" ? "#1e3a5f" : "#0a2540",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: "#fff", fontWeight: 700, flexShrink: 0,
              }}>
                {r.roomType === "bot" ? "AI" : r.otherName[0]?.toUpperCase() ?? "?"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#0a2540" }}>
                  {r.otherName}
                  <span style={{
                    marginLeft: 8, fontSize: 10, fontWeight: 700,
                    background: r.roomType === "bot" ? "#eff6ff" : "#f0fdf4",
                    color: r.roomType === "bot" ? "#1e40af" : "#166534",
                    padding: "1px 7px", borderRadius: 10,
                  }}>{r.roomType}</span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>
                  {r.lastMessage || "No messages yet"}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>
                {new Date(r.lastAt).toLocaleDateString("en-IN",
                  { day: "2-digit", month: "short" })}
              </div>
            </div>
          ))}
        </>
      ))}

      {/* Backend checklist */}
      {card("Backend Checklist", (
        <div style={{ fontSize: 13, lineHeight: 2 }}>
          {[
            ["SQL", "ChatTables_Migration.sql run on RDS BTL_BG_DB",
              "ChatRooms, ChatRoomMembers, ChatMessages tables"],
            ["NuGet", "Microsoft.AspNetCore.SignalR installed",
              "dotnet add package Microsoft.AspNetCore.SignalR"],
            ["Backend", "ChatHub.cs, BotService.cs, ChatController.cs deployed",
              "Restart IIS after deploy"],
            ["Program.cs", "AddSignalR() + MapHub<ChatHub>(\"/hubs/chat\") added",
              "CORS AllowCredentials() must be on"],
            ["appsettings", "Anthropic:ApiKey set",
              "Get from console.anthropic.com → API Keys"],
            ["npm", "@microsoft/signalr installed",
              "npm install @microsoft/signalr"],
          ].map(([cat, check, note]) => (
            <div key={String(cat)} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ background: "#f1f5f9", border: "1px solid #e2e8f0",
                borderRadius: 5, padding: "1px 8px", fontSize: 11, fontWeight: 700,
                color: "#374151", flexShrink: 0, marginTop: 2 }}>{cat}</span>
              <div>
                <div style={{ fontWeight: 600, color: "#0a2540" }}>{check}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{note}</div>
              </div>
            </div>
          ))}
        </div>
      ))}

    </div>
  );
}

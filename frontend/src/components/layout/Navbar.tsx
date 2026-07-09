// src/components/layout/Navbar.tsx
import { useState, useRef, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import type { UserProfile } from "../../types/user";
import ChatPanel from "../chat/ChatPanel";
import WhatsAppPanel from "../chat/WhatsAppPanel";
import "./Navbar.css";

interface NavbarProps {
  user:          UserProfile | null;
  onMenuClick:   () => void;
  onBrandClick?: () => void;
}

export default function Navbar({ user, onMenuClick, onBrandClick }: NavbarProps) {
  const { instance } = useMsal();
  const [open,        setOpen]       = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Listen for unread count from ChatPanel ────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const count = (e as CustomEvent<{ count: number }>).detail?.count ?? 0;
      setUnreadCount(count);
    };
    window.addEventListener("chat-unread", handler);
    return () => window.removeEventListener("chat-unread", handler);
  }, []);

  const initials = user
    ? ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? user.displayName?.[0] ?? "")).toUpperCase()
    : "?";

  const handleLogout = () => instance.logoutRedirect().catch(console.error);

  return (
    <>
      <header className="app-navbar">
        <div className="app-navbar-left">
          {/* Hamburger — mobile only */}
          <button className="app-navbar-hamburger" onClick={onMenuClick}
            aria-label="Open navigation menu">
            <span /><span /><span />
          </button>

          {/* Brand */}
          <button className="app-navbar-brand" onClick={onBrandClick}>
            <img src="/login/BGauss_Logo_transparent.png" alt="BGauss" className="app-navbar-logo" />
            <span className="app-navbar-brand-text"></span>
          </button>
        </div>

        <div className="app-navbar-right" ref={ref}>
          {/* Role chip */}
          {user?.role && (
            <span className={`role-chip role-chip--nav role-${user.role.toLowerCase()}`}>
              {user.role}
            </span>
          )}

          {/* ── Notification bell ── */}
          <div className="nav-bell-wrap">
            <button className="nav-bell-btn" aria-label="Chat notifications"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("chat-open-panel"))
              }>
              <i className="ti ti-bell" />
              {unreadCount > 0 && (
                <span className="nav-bell-badge">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Avatar */}
          <button className="nav-avatar-btn" onClick={() => setOpen((o) => !o)}
            aria-label="Profile menu" aria-expanded={open}>
            <span className="nav-avatar">{initials}</span>
          </button>

          {/* Dropdown */}
          {open && (
            <div className="nav-profile-dropdown" role="menu">
              <div className="nav-profile-header">
                <div className="nav-profile-avatar-row">
                  <span className="nav-avatar nav-avatar--lg">{initials}</span>
                  <div>
                    <span className="nav-profile-name">{user?.displayName ?? "—"}</span>
                    <span className="nav-profile-email">{user?.email}</span>
                  </div>
                </div>
                {user?.role && (
                  <span className={`role-chip role-${user.role.toLowerCase()}`}>
                    {user.role}
                  </span>
                )}
              </div>
              <div className="nav-profile-divider" />
              <button className="nav-profile-logout" onClick={handleLogout} role="menuitem">
                <i className="ti ti-logout" aria-hidden="true" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Chat bubbles — rendered outside <header> so they float freely ── */}
      {/* Both panels are portal-style fixed elements — they don't affect layout */}
      <ChatPanel />
      {/* <WhatsAppPanel /> */}
    </>
  );
}
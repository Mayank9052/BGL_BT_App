// src/components/layout/DealerNavbar.tsx
import { useState, useRef, useEffect } from "react";
import type { DealerLoginResponse } from "../../services/dealerAuthService";
import "./Navbar.css";

interface DealerNavbarProps {
  dealer:      DealerLoginResponse | null;
  onMenuClick: () => void;
  onLogout:    () => void;
}

export default function DealerNavbar({ dealer, onMenuClick, onLogout }: DealerNavbarProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = dealer
    ? (dealer.dealerName || dealer.displayName || "D").charAt(0).toUpperCase()
    : "D";

  return (
    <header className="app-navbar">
      <div className="app-navbar-left">
        <button className="app-navbar-hamburger" onClick={onMenuClick}
          aria-label="Open navigation menu">
          <span /><span /><span />
        </button>

        <div className="app-navbar-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="app-navbar-logo" />
          <span className="app-navbar-brand-text">BGauss Portal</span>
        </div>
      </div>

      <div className="app-navbar-right" ref={ref}>
        <span className="role-chip role-chip--nav role-dealer">Dealer</span>

        <button className="nav-avatar-btn" onClick={() => setOpen((o) => !o)}
          aria-label="Profile menu" aria-expanded={open}>
          <span className="nav-avatar">{initials}</span>
        </button>

        {open && (
          <div className="nav-profile-dropdown" role="menu">
            <div className="nav-profile-header">
              <div className="nav-profile-avatar-row">
                <span className="nav-avatar nav-avatar--lg">{initials}</span>
                <div>
                  <span className="nav-profile-name">{dealer?.dealerName || dealer?.displayName || "—"}</span>
                  <span className="nav-profile-email">{dealer?.email}</span>
                </div>
              </div>
              <span className="role-chip role-dealer">Dealer</span>
            </div>
            <div className="nav-profile-divider" />
            <button className="nav-profile-logout" onClick={onLogout} role="menuitem">
              <i className="ti ti-logout" aria-hidden="true" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
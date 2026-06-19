// src/components/layout/Navbar.tsx
import { useState, useRef, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import type { UserProfile } from "../../types/user";
import "./Navbar.css";

interface NavbarProps {
  user: UserProfile | null;
  onBrandClick: () => void;
}

export default function Navbar({ user, onBrandClick }: NavbarProps) {
  const { instance } = useMsal();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = user
    ? ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? user.displayName?.[0] ?? "")).toUpperCase()
    : "?";

  const handleLogout = () =>
    instance.logoutRedirect().catch(console.error);

  return (
    <header className="app-navbar">
      <button className="app-navbar-brand" onClick={onBrandClick}>
        BGauss Portal
      </button>

      <div className="app-navbar-right" ref={ref}>
        <button
          className="nav-avatar-btn"
          onClick={() => setOpen((o) => !o)}
          aria-label="Profile menu"
        >
          <span className="nav-avatar">{initials}</span>
        </button>

        {open && (
          <div className="nav-profile-dropdown">
            <div className="nav-profile-header">
              <span className="nav-profile-name">{user?.displayName ?? "—"}</span>
              <span className="nav-profile-email">{user?.email}</span>
              {user?.role && (
                <span className={`role-chip role-${user.role.toLowerCase()}`}>
                  {user.role}
                </span>
              )}
            </div>
            <div className="nav-profile-divider" />
            <button className="nav-profile-logout" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
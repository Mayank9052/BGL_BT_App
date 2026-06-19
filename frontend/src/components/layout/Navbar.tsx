// src/components/layout/Navbar.tsx
import type { UserProfile } from "../../types/user";
import "./Navbar.css";

interface NavbarProps {
  user: UserProfile | null;
  onBrandClick: () => void;
  // onLogout removed — logout now lives in the Sidebar
}

export default function Navbar({ user, onBrandClick }: NavbarProps) {
  return (
    <header className="app-navbar">
      <button className="app-navbar-brand" onClick={onBrandClick}>
        BGauss Portal
      </button>
      <div className="app-navbar-right">
        {user?.role && (
          <span className={`role-chip role-${user.role.toLowerCase()}`}>
            {user.role}
          </span>
        )}
        <span className="app-navbar-email">{user?.email}</span>
      </div>
    </header>
  );
}
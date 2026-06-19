// src/components/layout/Sidebar.tsx
import { NavLink } from "react-router-dom";
import "./Sidebar.css";

interface SidebarProps {
  isAdmin: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: "🏠" },
  { to: "/rsm-form", label: "RSM Proposal Form", icon: "📋" },
];

export default function Sidebar({ isAdmin, collapsed, onToggle, onLogout }: SidebarProps) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    "app-sidebar-link" + (isActive ? " app-sidebar-link-active" : "");

  return (
    <aside className={"app-sidebar" + (collapsed ? " app-sidebar-collapsed" : "")}>
      {/* Brand */}
      <div className="app-sidebar-brand">
        <img src="/BGauss_Logo.png" alt="BGauss" className="app-sidebar-logo" />
        {!collapsed && <span>BGauss</span>}
      </div>

      {/* Collapse toggle */}
      <button
        className="app-sidebar-toggle"
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronIcon direction={collapsed ? "right" : "left"} />
      </button>

      {/* Nav links */}
      <nav className="app-sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={linkClass}
            title={collapsed ? item.label : undefined}
          >
            <span className="app-sidebar-icon">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="app-sidebar-divider" />
            {!collapsed && <span className="app-sidebar-section-label">Admin</span>}
            <NavLink
              to="/admin/users"
              className={linkClass}
              title={collapsed ? "Manage Users" : undefined}
            >
              <span className="app-sidebar-icon">👥</span>
              {!collapsed && <span>Manage Users</span>}
            </NavLink>
          </>
        )}
      </nav>

      {/* Logout pinned to bottom */}
      <div className="app-sidebar-footer">
        <div className="app-sidebar-divider" />
        <button
          className="app-sidebar-logout"
          onClick={onLogout}
          title="Sign out"
        >
          <span className="app-sidebar-icon">🚪</span>
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.5">
      <polyline points={direction === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
    </svg>
  );
}
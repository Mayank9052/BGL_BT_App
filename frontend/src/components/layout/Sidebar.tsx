// src/components/layout/Sidebar.tsx
import { NavLink } from "react-router-dom";
import "./Sidebar.css";

interface SidebarProps {
  isAdmin: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
  userName?: string;
  userRole?: string;
  pendingCount?: number;
}

const NAV_ITEMS = [
  { to: "/dashboard",   label: "Dashboard",         icon: "ti-layout-dashboard" },
  { to: "/rsm-form",    label: "RSM Proposal Form",  icon: "ti-file-text"        },
  { to: "/approver",    label: "Approver Portal",    icon: "ti-clipboard-list", badge: true },
];

const ADMIN_ITEMS = [
  { to: "/admin/users",      label: "Manage Users & Activity",    icon: "ti-users"      },
  // { to: "/admin/activities", label: "Activity Types",  icon: "ti-list-check" },
];

export default function Sidebar({
  isAdmin, collapsed, onToggle, onLogout,
  userName, userRole, pendingCount,
}: SidebarProps) {
  const initials = userName
    ? userName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    "sb-link" + (isActive ? " sb-link--active" : "");

  return (
    <aside className={"sb" + (collapsed ? " sb--col" : "")}>

      {/* Toggle */}
      <button className="sb-toggle" onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        <i className={collapsed ? "ti ti-chevron-right" : "ti ti-chevron-left"} aria-hidden="true" />
      </button>

      {/* Brand */}
      <div className="sb-brand">
        <img src="/BGauss_Logo.png" alt="BGauss" className="sb-logo" />
        {!collapsed && <span className="sb-brand-name">BGauss</span>}
      </div>

      {/* Nav */}
      <nav className="sb-nav">
        {!collapsed && <span className="sb-section-lbl">Main</span>}

        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={linkClass}
            title={collapsed ? item.label : undefined}>
            <i className={`ti ${item.icon}`} aria-hidden="true" />
            {!collapsed && <span className="sb-link-label">{item.label}</span>}
            {!collapsed && item.badge && pendingCount && pendingCount > 0 ? (
              <span className="sb-badge">{pendingCount}</span>
            ) : null}
            {collapsed && item.badge && pendingCount && pendingCount > 0 ? (
              <span className="sb-dot" aria-label={`${pendingCount} pending`} />
            ) : null}
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="sb-divider" />
            {!collapsed && <span className="sb-section-lbl">Admin</span>}
            {ADMIN_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}
                title={collapsed ? item.label : undefined}>
                <i className={`ti ${item.icon}`} aria-hidden="true" />
                {!collapsed && <span className="sb-link-label">{item.label}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User + logout */}
      <div className="sb-footer">
        <div className="sb-divider" />

        <div className="sb-user-card" title={collapsed ? (userName ?? "") : undefined}>
          <div className="sb-avatar">{initials}</div>
          {!collapsed && (
            <div className="sb-user-info">
              <span className="sb-user-name">{userName ?? "—"}</span>
              <span className="sb-user-role">{userRole ?? "User"}</span>
            </div>
          )}
        </div>

        <button className="sb-logout" onClick={onLogout} title={collapsed ? "Sign out" : undefined}>
          <i className="ti ti-logout" aria-hidden="true" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
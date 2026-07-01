// src/components/layout/Sidebar.tsx
import { NavLink, useLocation } from "react-router-dom";
import { useEffect } from "react";
import "./Sidebar.css";

interface SidebarProps {
  isAdmin:       boolean;
  isReportsUser: boolean;   // ← new — true only for oat@bgauss.com
  collapsed:     boolean;
  mobileOpen:    boolean;
  onToggle:      () => void;
  onMobileClose: () => void;
  onLogout:      () => void;
  userName?:     string;
  userRole?:     string;
  pendingCount?: number;
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard",        icon: "ti-layout-dashboard" },
  { to: "/rsm-form",  label: "RSM Proposal Form", icon: "ti-file-text"        },
  { to: "/approver",  label: "Approver Portal",   icon: "ti-clipboard-list", badge: true },
];

const ADMIN_ITEMS = [
  { to: "/admin/users", label: "Manage Users & Activity", icon: "ti-users" },
];

export default function Sidebar({
  isAdmin, isReportsUser, collapsed, mobileOpen, onToggle, onMobileClose, onLogout,
  userName, userRole, pendingCount,
}: SidebarProps) {
  const location = useLocation();

  useEffect(() => {
    onMobileClose();
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) onMobileClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const initials = userName
    ? userName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    "sb-link" + (isActive ? " sb-link--active" : "");

  return (
    <>
      {mobileOpen && (
        <div className="sb-overlay" onClick={onMobileClose} aria-hidden="true" />
      )}

      <aside className={[
        "sb",
        collapsed  ? "sb--col"    : "",
        mobileOpen ? "sb--mobile-open" : "",
      ].filter(Boolean).join(" ")}>

        <button className="sb-toggle sb-toggle--desktop"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <i className={collapsed ? "ti ti-chevron-right" : "ti ti-chevron-left"} />
        </button>

        <button className="sb-toggle sb-toggle--mobile"
          onClick={onMobileClose} aria-label="Close menu">
          <i className="ti ti-x" />
        </button>

        <div className="sb-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="sb-logo" />
          {!collapsed && <span className="sb-brand-name">BGauss</span>}
        </div>

        <nav className="sb-nav" role="navigation">
          {!collapsed && <span className="sb-section-lbl">Main</span>}

          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}
              title={collapsed ? item.label : undefined}
              end={item.to === "/dashboard"}>
              <i className={`ti ${item.icon}`} aria-hidden="true" />
              {!collapsed && <span className="sb-link-label">{item.label}</span>}
              {!collapsed && item.badge && pendingCount && pendingCount > 0
                ? <span className="sb-badge">{pendingCount}</span>
                : null}
              {collapsed && item.badge && pendingCount && pendingCount > 0
                ? <span className="sb-dot" aria-label={`${pendingCount} pending`} />
                : null}
            </NavLink>
          ))}

          {/* Reports — visible only to oat@bgauss.com */}
          {isReportsUser && (
            <>
              <div className="sb-divider" />
              {!collapsed && <span className="sb-section-lbl">Reports</span>}
              <NavLink to="/reports" className={linkClass}
                title={collapsed ? "Reports" : undefined}>
                <i className="ti ti-file-report" aria-hidden="true" />
                {!collapsed && <span className="sb-link-label">Download Reports</span>}
              </NavLink>
            </>
          )}

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
          <button className="sb-logout" onClick={onLogout}
            title={collapsed ? "Sign out" : undefined}>
            <i className="ti ti-logout" aria-hidden="true" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
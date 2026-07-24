// src/components/layout/Sidebar.tsx
import { NavLink, useLocation } from "react-router-dom";
import { useEffect } from "react";
import "./Sidebar.css";

interface SidebarProps {
  isAdmin:       boolean;
  isReportsUser: boolean;
  collapsed:     boolean;
  mobileOpen:    boolean;
  onToggle:      () => void;
  onMobileClose: () => void;
  onLogout:      () => void;
  userName?:     string;
  userRole?:     string;
  pendingCount?: number;
}

// ── Inline SVG icons — render without any CSS font dependency ─────────────────
const Icon = ({ name, size = 18 }: { name: string; size?: number }) => {
  const s = { width: size, height: size, display: "block" as const, flexShrink: 0 };
  switch (name) {
    case "dashboard":   return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>;
    case "form":        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>;
    case "approver":    return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 12 2 2 4-4"/></svg>;
    case "reports":     return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>;
    case "users":       return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "newproposal": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
    case "logout":      return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
    case "chevron-r":   return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>;
    case "chevron-l":   return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>;
    case "chevrons-r":  return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="13,17 18,12 13,7"/><polyline points="6,17 11,12 6,7"/></svg>;
    case "close":       return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    default:            return <span style={{ width: size, height: size, display: "inline-block" }}>•</span>;
  }
};

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard",        icon: "dashboard",   badge: false },
  { to: "/rsm-form",  label: "RSM Proposal Form", icon: "form",       badge: false },
  { to: "/approver",  label: "Approver Portal",   icon: "approver",   badge: true  },
];

const ADMIN_ITEMS = [
  { to: "/admin/users", label: "Manage Users & Activity", icon: "users" },
];

export default function Sidebar({
  isAdmin, isReportsUser, collapsed, mobileOpen, onToggle, onMobileClose, onLogout,
  userName, userRole, pendingCount,
}: SidebarProps) {
  const location = useLocation();

  useEffect(() => { onMobileClose(); }, [location.pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) onMobileClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
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

      <aside
        className={[
          "sb",
          collapsed  ? "sb--col"         : "",
          mobileOpen ? "sb--mobile-open" : "",
        ].filter(Boolean).join(" ")}
        title={collapsed ? "Click to expand menu" : undefined}
      >
        {/* Toggle — desktop */}
        <button
          className="sb-toggle sb-toggle--desktop"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Icon name={collapsed ? "chevron-r" : "chevron-l"} size={16} />
        </button>

        {/* Close — mobile */}
        <button className="sb-toggle sb-toggle--mobile"
          onClick={onMobileClose} aria-label="Close menu">
          <Icon name="close" size={16} />
        </button>

        {/* Brand */}
        <div className="sb-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="sb-logo" />
          {!collapsed && <span className="sb-brand-name">BGauss BTL</span>}
        </div>

        {/* Collapsed expand hint */}
        {collapsed && (
          <div className="sb-expand-hint" aria-hidden="true">
            <Icon name="chevrons-r" size={14} />
          </div>
        )}

        {/* Navigation */}
        <nav className="sb-nav" role="navigation">
          {!collapsed && <span className="sb-section-lbl">Main</span>}

          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={linkClass}
              title={item.label}
              end={item.to === "/dashboard"}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name={item.icon} />
              {!collapsed && <span className="sb-link-label">{item.label}</span>}
              {item.badge && pendingCount && pendingCount > 0 ? (
                collapsed
                  ? <span className="sb-dot" aria-label={`${pendingCount} pending`} />
                  : <span className="sb-badge">{pendingCount}</span>
              ) : null}
            </NavLink>
          ))}

          {/* Reports */}
          {isReportsUser && (
            <>
              <div className="sb-divider" />
              {!collapsed && <span className="sb-section-lbl">Reports</span>}
              <NavLink to="/reports" className={linkClass}
                title="Download Reports"
                onClick={(e) => e.stopPropagation()}>
                <Icon name="reports" />
                {!collapsed && <span className="sb-link-label">Download Reports</span>}
              </NavLink>
            </>
          )}

          {/* Admin */}
          {isAdmin && (
            <>
              <div className="sb-divider" />
              {!collapsed && <span className="sb-section-lbl">Admin</span>}
              {ADMIN_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={linkClass}
                  title={item.label}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icon name={item.icon} />
                  {!collapsed && <span className="sb-link-label">{item.label}</span>}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
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
          <button
            className="sb-logout"
            onClick={(e) => { e.stopPropagation(); onLogout(); }}
            title="Sign out">
            <Icon name="logout" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
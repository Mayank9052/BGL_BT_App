// src/components/layout/DealerSidebar.tsx
import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./Sidebar.css";

interface DealerSidebarProps {
  collapsed:     boolean;
  mobileOpen:    boolean;
  onToggle:      () => void;
  onMobileClose: () => void;
  onLogout:      () => void;
  dealerName?:   string;
  dealerCode?:   string | null;
}

// ── Inline SVG icons — same as Sidebar.tsx ────────────────────────────────────
const Icon = ({ name, size = 18 }: { name: string; size?: number }) => {
  const s = { width: size, height: size, display: "block" as const, flexShrink: 0 };
  switch (name) {
    case "dashboard":   return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>;
    case "newproposal": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
    case "logout":      return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
    case "chevron-r":   return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>;
    case "chevron-l":   return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>;
    case "chevrons-r":  return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="13,17 18,12 13,7"/><polyline points="6,17 11,12 6,7"/></svg>;
    case "close":       return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    default:            return <span style={{ width: size, display: "inline-block" }}>•</span>;
  }
};

const NAV_ITEMS = [
  { to: "/dealer-dashboard", icon: "dashboard",   label: "Dashboard"    },
  { to: "/dealer-proposal",  icon: "newproposal", label: "New Proposal" },
];

export default function DealerSidebar({
  collapsed, mobileOpen, onToggle, onMobileClose, onLogout,
  dealerName, dealerCode,
}: DealerSidebarProps) {
  const location = useLocation();

  useEffect(() => { onMobileClose(); }, [location.pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) onMobileClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen, onMobileClose]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const initials = dealerName
    ? dealerName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "D";

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

        {/* Logo */}
        <div className="sb-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="sb-logo"
            style={{ background: "transparent", border: "none" }} />
          {!collapsed && <span className="sb-brand-name">BGauss BTL</span>}
        </div>

        {/* Collapsed expand hint */}
        {collapsed && (
          <div className="sb-expand-hint" aria-hidden="true">
            <Icon name="chevrons-r" size={14} />
          </div>
        )}

        {/* Dealer badge */}
        {!collapsed && (
          <div style={{
            margin: "0 12px 8px",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6, padding: "5px 10px", fontSize: 11,
            color: "rgba(255,255,255,0.6)", textAlign: "center", letterSpacing: "0.04em",
          }}>
            DEALER PORTAL
          </div>
        )}

        <nav className="sb-nav" role="navigation">
          {!collapsed && <span className="sb-section-lbl">Menu</span>}

          {NAV_ITEMS.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={linkClass}
              title={label}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name={icon} />
              {!collapsed && <span className="sb-link-label">{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sb-footer">
          <div className="sb-divider" />
          <div className="sb-user-card" title={collapsed ? (dealerName ?? "") : undefined}>
            <div className="sb-avatar">{initials}</div>
            {!collapsed && (
              <div className="sb-user-info">
                <span className="sb-user-name">{dealerName ?? "—"}</span>
                <span className="sb-user-role">
                  {dealerCode ? `Dealer · ${dealerCode}` : "Dealer"}
                </span>
              </div>
            )}
          </div>
          <button className="sb-logout"
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
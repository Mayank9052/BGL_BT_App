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

export default function DealerSidebar({
  collapsed, mobileOpen, onToggle, onMobileClose, onLogout,
  dealerName, dealerCode,
}: DealerSidebarProps) {
  const location = useLocation();

  // ── Auto-close mobile drawer on route change (same as Sidebar.tsx) ──────
  useEffect(() => { onMobileClose(); }, [location.pathname]);

  // ── Escape key closes mobile drawer ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) onMobileClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen, onMobileClose]);

  // ── Prevent body scroll when mobile drawer is open ───────────────────────
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const initials = dealerName
    ? dealerName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "D";

  const navItems = [
    { to: "/dealer-dashboard", icon: "ti-layout-dashboard", label: "Dashboard"    },
    { to: "/dealer-proposal",  icon: "ti-file-plus",        label: "New Proposal" },
  ];

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
        title={collapsed ? "Click to expand sidebar" : undefined}
      >
        <button className="sb-toggle sb-toggle--mobile"
          onClick={onMobileClose} aria-label="Close menu">
          <i className="ti ti-x" />
        </button>

        {/* Logo */}
        <div className="sb-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="sb-logo"
            style={{ background: "transparent", border: "none" }} />
          {!collapsed && <span className="sb-brand-name"></span>}
        </div>

        {/* Collapsed expand hint */}
        {collapsed && (
          <div className="sb-expand-hint" aria-hidden="true">
            <i className="ti ti-chevrons-right" />
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

          {navItems.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={linkClass}
              title={collapsed ? label : undefined}
              onClick={(e) => e.stopPropagation()}
            >
              <i className={`ti ${icon}`} aria-hidden="true" />
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
            title={collapsed ? "Sign out" : undefined}>
            <i className="ti ti-logout" aria-hidden="true" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
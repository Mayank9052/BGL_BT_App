// src/components/layout/DealerSidebar.tsx
import { useEffect } from "react";
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

  const initials = dealerName
    ? dealerName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "D";

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

          <span className="sb-link sb-link--active" style={{ cursor: "default" }}>
            <i className="ti ti-layout-dashboard" aria-hidden="true" />
            {!collapsed && <span className="sb-link-label">Dashboard</span>}
          </span>
        </nav>

        <div className="sb-footer">
          <div className="sb-divider" />
          <div className="sb-user-card" title={collapsed ? (dealerName ?? "") : undefined}>
            <div className="sb-avatar">{initials}</div>
            {!collapsed && (
              <div className="sb-user-info">
                <span className="sb-user-name">{dealerName ?? "—"}</span>
                <span className="sb-user-role">{dealerCode ? `Dealer · ${dealerCode}` : "Dealer"}</span>
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
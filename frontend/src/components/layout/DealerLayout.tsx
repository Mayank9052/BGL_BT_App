// src/components/layout/DealerLayout.tsx
import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { getDealerUser, dealerLogout } from "../../services/dealerAuthService";
import DealerSidebar from "./DealerSidebar";
import DealerNavbar from "./DealerNavbar";
import "./AppLayout.css";

const SIDEBAR_KEY = "bgauss_dealer_sidebar_collapsed";

interface DealerLayoutProps {
  onLogout?: () => void;
}

export default function DealerLayout({ onLogout }: DealerLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const dealer   = getDealerUser();

  const [collapsed,  setCollapsed]  = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "true"
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── Persist desktop collapsed state ──────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  // ── Auto-collapse sidebar on every route change (same as AppLayout) ──────
  useEffect(() => {
    setCollapsed(true);
    localStorage.setItem(SIDEBAR_KEY, "true");
    setMobileOpen(false);
  }, [location.pathname]);

  // ── Close mobile sidebar on resize to desktop ─────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth > 768) setMobileOpen(false);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── Auto-collapse on narrow viewport ─────────────────────────────────────
  useEffect(() => {
    const checkWidth = () => {
      if (window.innerWidth < 1100) setCollapsed(true);
    };
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    dealerLogout();
    onLogout?.();
    navigate("/", { replace: true });
  };

  // ── Click collapsed sidebar to expand (same as AppLayout) ────────────────
  const handleSidebarClick = () => {
    if (collapsed) setCollapsed(false);
  };

  return (
    <div className={[
      "app-layout",
      collapsed  ? "app-layout--collapsed"   : "",
      mobileOpen ? "app-layout--mobile-open" : "",
    ].filter(Boolean).join(" ")}>

      <div
        onClick={handleSidebarClick}
        style={{ cursor: collapsed ? "pointer" : "default" }}
      >
        <DealerSidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggle={() => setCollapsed((c) => !c)}
          onMobileClose={() => setMobileOpen(false)}
          onLogout={handleLogout}
          dealerName={dealer?.dealerName || dealer?.displayName}
          dealerCode={dealer?.dealerCode}
        />
      </div>

      <div className="app-layout-body">
        <DealerNavbar
          dealer={dealer}
          onMenuClick={() => setMobileOpen((v) => !v)}
          onLogout={handleLogout}
        />
        <main className="app-layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
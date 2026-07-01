// src/components/layout/DealerLayout.tsx
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
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
  const dealer = getDealerUser();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "true"
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const handler = () => {
      if (window.innerWidth > 768) setMobileOpen(false);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const handleLogout = () => {
    dealerLogout();
    onLogout?.();
    navigate("/", { replace: true });
  };

  return (
    <div className={[
      "app-layout",
      collapsed  ? "app-layout--collapsed"   : "",
      mobileOpen ? "app-layout--mobile-open" : "",
    ].filter(Boolean).join(" ")}>

      <DealerSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={() => setCollapsed((c) => !c)}
        onMobileClose={() => setMobileOpen(false)}
        onLogout={handleLogout}
        dealerName={dealer?.dealerName || dealer?.displayName}
        dealerCode={dealer?.dealerCode}
      />

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
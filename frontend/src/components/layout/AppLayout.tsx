// src/components/layout/AppLayout.tsx
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../../store/authStore";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import "./AppLayout.css";

const SIDEBAR_KEY = "bgauss_sidebar_collapsed";
const AUTHORIZED_REPORTS_EMAIL = "oat@bgauss.com";

export default function AppLayout() {
  const { instance } = useMsal();
  const { user }     = useAuthStore();
  const navigate     = useNavigate();

  // Desktop: persisted collapsed state
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "true"
  );

  // Mobile: slide-in drawer state
  const [mobileOpen, setMobileOpen] = useState(false);

  // Persist desktop collapsed state
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  // Close mobile sidebar on window resize to desktop
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth > 768) setMobileOpen(false);
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: "/" }).catch(console.error);
  };

  const isAdmin = user?.role === "Admin" || user?.role === "Manager";
  const isReportsUser = user?.email?.toLowerCase() === AUTHORIZED_REPORTS_EMAIL;

  return (
    <div className={[
      "app-layout",
      collapsed  ? "app-layout--collapsed"    : "",
      mobileOpen ? "app-layout--mobile-open"  : "",
    ].filter(Boolean).join(" ")}>

      <Sidebar
        isAdmin={isAdmin}
        isReportsUser={isReportsUser}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={() => setCollapsed((c) => !c)}
        onMobileClose={() => setMobileOpen(false)}
        onLogout={handleLogout}
        userName={user?.displayName}
        userRole={user?.role}
      />

      <div className="app-layout-body">
        <Navbar
          user={user}
          onMenuClick={() => setMobileOpen((v) => !v)}
          onBrandClick={() => navigate("/dashboard")}
        />
        <main className="app-layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
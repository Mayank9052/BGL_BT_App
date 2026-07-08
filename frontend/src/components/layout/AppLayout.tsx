// src/components/layout/AppLayout.tsx
import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../../store/authStore";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import "./AppLayout.css";

const SIDEBAR_KEY = "bgauss_sidebar_collapsed";

export default function AppLayout() {
  const { instance } = useMsal();
  const { user }     = useAuthStore();
  const navigate     = useNavigate();
  const location     = useLocation();

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

  // Auto-collapse sidebar on every route change
  useEffect(() => {
    setCollapsed(true);
    localStorage.setItem(SIDEBAR_KEY, "true");
    // Also close mobile drawer on navigation
    setMobileOpen(false);
  }, [location.pathname]);

  // Close mobile sidebar on resize to desktop
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

  // Reports access — ALL authenticated users can access reports
  // Backend (ReportsController) enforces its own auth check
  const isReportsUser = !!user;

  // Click anywhere on the collapsed sidebar to expand it
  const handleSidebarClick = () => {
    if (collapsed) setCollapsed(false);
  };

  return (
    <div className={[
      "app-layout",
      collapsed  ? "app-layout--collapsed"   : "",
      mobileOpen ? "app-layout--mobile-open" : "",
    ].filter(Boolean).join(" ")}>

      {/* Wrapper catches clicks on collapsed sidebar to expand it */}
      <div
        onClick={handleSidebarClick}
        style={{ cursor: collapsed ? "pointer" : "default" }}
      >
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
      </div>

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
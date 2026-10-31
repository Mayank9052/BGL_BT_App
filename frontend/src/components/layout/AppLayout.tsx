// src/components/layout/AppLayout.tsx
// 28.10.2026: Accounts team detection (Role "Accounts" / Cn:AccountsTeamEmails via GET /api/cn/me)
//             → "Accounts — Credit Notes" menu + Accounts users land on /accounts.
import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../../store/authStore";
import { apiRequest, API_BASE_URL } from "../../authConfig";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import "./AppLayout.css";

const SIDEBAR_KEY = "bgauss_sidebar_collapsed";

// Fallback list — keep the same as Cn:AccountsTeamEmails in appsettings.json.
// The backend (/api/cn/me) is the final authority.
const ACCOUNTS_EMAILS = ["gaurav.zore@bgauss.com", "ankit.heda@bgauss.com"];

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

  // Accounts team (from backend; local list is used until the backend answers)
  const [isAccountsApi, setIsAccountsApi] = useState<boolean | null>(null);

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

  // Ask the backend whether this user is in the Accounts team (GET /api/cn/me)
  useEffect(() => {
    if (!user) { setIsAccountsApi(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
        if (!account) return;
        const { accessToken } = await instance.acquireTokenSilent({ ...apiRequest, account });
        const res = await fetch(`${API_BASE_URL}/api/cn/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const me: { isAccounts?: boolean } = await res.json();
        if (!cancelled) setIsAccountsApi(!!me.isAccounts);
      } catch { /* keep the local fallback */ }
    })();
    return () => { cancelled = true; };
  }, [user, instance]);

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: "/" }).catch(console.error);
  };

  const isAdmin = user?.role === "Admin" || user?.role === "Manager";

  const isAccounts =
    isAccountsApi ??
    (user?.role === "Accounts" ||
      ACCOUNTS_EMAILS.includes((user?.email ?? "").toLowerCase()));

  // Accounts users (not Admin/Manager) open the Accounts page instead of the dashboard
  useEffect(() => {
    if (isAccounts && !isAdmin && location.pathname === "/dashboard") {
      navigate("/accounts", { replace: true });
    }
  }, [isAccounts, isAdmin, location.pathname, navigate]);

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
          isAccounts={isAccounts || user?.role === "Admin"}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggle={() => setCollapsed((c) => !c)}
          onMobileClose={() => setMobileOpen(false)}
          onLogout={handleLogout}
          userName={user?.displayName}
          userRole={isAccounts && !isAdmin ? "Accounts" : user?.role}
        />
      </div>

      <div className="app-layout-body">
        <Navbar
          user={user}
          onMenuClick={() => setMobileOpen((v) => !v)}
          onBrandClick={() => navigate(isAccounts && !isAdmin ? "/accounts" : "/dashboard")}
        />
        <main className="app-layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
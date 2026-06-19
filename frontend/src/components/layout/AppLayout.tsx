// src/components/layout/AppLayout.tsx
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { useAuthStore } from "../../store/authStore";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import "./AppLayout.css";

const SIDEBAR_KEY = "bgauss_sidebar_collapsed";

export default function AppLayout() {
  const { instance } = useMsal();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "true"
  );

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: "/" }).catch(console.error);
  };

  return (
    <div className="app-layout">
      <Sidebar
        isAdmin={user?.role === "Admin"}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onLogout={handleLogout}
      />
      <div className="app-layout-body">
        <Navbar
          user={user}
          onBrandClick={() => navigate("/dashboard")}
        />
        <main className="app-layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
// src/App.tsx
import { useEffect, useState, useCallback } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import LoginPage from "./pages/LoginPage";
import AppLayout from "./components/layout/AppLayout";
import DealerLayout from "./components/layout/DealerLayout";
import AdminRoute from "./components/AdminRoute";
import DashboardPage from "./pages/DashboardPage";
import RSMProposalForm from "./pages/RSMForm";
import AdminUsersPage from "./pages/AdminUsersPage";
import { useAuthStore } from "./store/authStore";
import { syncUserWithBackend } from "./services/authService";
import ApproverDashboard from "./pages/Approverdashboard";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ReportsPage from "./pages/ReportsPage";
import DealerDashboard from "./pages/DealerDashboard";
import ChatTestPage from "./pages/ChatTestPage";
import { getDealerUser, type DealerLoginResponse } from "./services/dealerAuthService";

export default function App() {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { setUser, setLoading } = useAuthStore();

  const [dealer, setDealer] = useState<DealerLoginResponse | null>(() => getDealerUser());

  const refreshDealer = useCallback(() => {
    setDealer(getDealerUser());
  }, []);

  useEffect(() => {
    if (isAuthenticated && inProgress === InteractionStatus.None) {
      setLoading(true);
      syncUserWithBackend(instance)
        .then(setUser)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [isAuthenticated, inProgress]);

  return (
    <BrowserRouter>
      {dealer ? (
        <Routes>
          {/* Dealer uses the same AppLayout and DashboardPage as staff */}
          <Route element={<AppLayout />}>
            <Route path="/dashboard"  element={<DashboardPage />} />
            <Route path="/rsm-form"   element={<RSMProposalForm />} />
            <Route path="/reports"    element={<ReportsPage />} />
            <Route path="/chat"       element={<ChatTestPage />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
          <Route path="/reset-password"   element={<ResetPasswordPage />} />
          {/* <Route path="*" element={<Navigate to="/dealer-dashboard" replace />} /> */}
        </Routes>
      ) : isAuthenticated ? (
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/dashboard"  element={<DashboardPage />} />
            <Route path="/rsm-form"   element={<RSMProposalForm />} />
            <Route element={<AdminRoute />}>
              <Route path="/admin/users" element={<AdminUsersPage />} />
            </Route>
            <Route path="/approver"   element={<ApproverDashboard />} />
            <Route path="/reports"    element={<ReportsPage />} />
            {/* ── Chat test page — accessible at /chat ── */}
            <Route path="/chat"       element={<ChatTestPage />} />
            <Route path="/"  element={<Navigate to="/dashboard" replace />} />
            <Route path="*"  element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      ) : (
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
          <Route path="*" element={<LoginPage onDealerLogin={refreshDealer} />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
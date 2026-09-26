// src/App.tsx
import { useEffect, useState, useCallback } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import LoginPage from "./pages/LoginPage";
import AppLayout from "./components/layout/AppLayout";
import DealerLayout from "./components/layout/DealerLayout";
import AdminRoute from "./components/AdminRoute";
import AnalyticsDashboard from "./pages/AnalyticsDashboard";
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
import StaffDashboard from "./pages/StaffDashboard";
import ChatTestPage from "./pages/ChatTestPage";
import { getDealerUser, type DealerLoginResponse } from "./services/dealerAuthService";
import AdminAuditLogPage from "./pages/AdminAuditLogPage";
import AdminDealerMapPage from "./pages/AdminDealerMapPage";

const STAFF_ROLES = new Set(["RSM", "TSM", "ZSM", "Commando"]);

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

  // ── Distinguish WHICH kind of local-auth session this is. staffLogin()
  // and dealerLogin() both write to the same localStorage key so existing
  // token/session helpers (getDealerToken, dealerLogout, etc.) work for
  // both — but that means `dealer` being truthy no longer implies the
  // account is actually a Dealer. Branch on the real role instead. ──────────
  const isDealerSession = !!dealer && dealer.role === "Dealer";
  const isStaffSession  = !!dealer && STAFF_ROLES.has(dealer.role);

  return (
    <BrowserRouter>
      {isDealerSession ? (
        // ── Dealer login — DealerLayout with own sidebar ──────────────────────
        <Routes>
          <Route element={<DealerLayout onLogout={refreshDealer} />}>
            {/* Dashboard — proposal history, KPIs, send-back */}
            <Route path="/dealer-dashboard" element={<DealerDashboard />} />
            {/* New Proposal — same RSMForm but under dealer route */}
            <Route path="/dealer-proposal"  element={<RSMProposalForm />} />
            <Route path="/" element={<Navigate to="/dealer-dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dealer-dashboard" replace />} />
          </Route>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
        </Routes>
      ) : isStaffSession ? (
        // ── RSM/TSM/ZSM/Commando local login — their own dashboard,
        // filtered to proposals matching their name via
        // GET /api/proposals/my-team-proposals. They do NOT get the
        // dealer's proposal-submission form or the DealerLayout shell. ──────
        <Routes>
          <Route element={<DealerLayout onLogout={refreshDealer} />}>
            <Route path="/staff-dashboard" element={<StaffDashboard staff={dealer!} />} />
            {/* Reuses the same submission form as RSM/dealer — a TSM/RSM/Commando
                filling this in submits on a dealer's behalf, same as any other
                proposal creation path. Both paths are registered because
                DealerSidebar's "New Proposal" nav link is hardcoded to
                /dealer-proposal regardless of which role is signed in — rather
                than touching that shared component, both routes just resolve
                to the same form here. */}
            <Route path="/staff-proposal"  element={<RSMProposalForm />} />
            <Route path="/dealer-proposal" element={<RSMProposalForm />} />
            <Route path="/" element={<Navigate to="/staff-dashboard" replace />} />
            <Route path="*" element={<Navigate to="/staff-dashboard" replace />} />
          </Route>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
        </Routes>
      ) : isAuthenticated ? (
        // ── Microsoft SSO login — AppLayout (RSM / Manager / Admin) ───────────
        <Routes>
          <Route element={<AppLayout />}>
            {/* Dashboard — state-wise, dealer-wise summary */}
            <Route path="/dashboard"   element={<DashboardPage />} />
            {/* RSM proposal submission form */}
            <Route path="/rsm-form"    element={<RSMProposalForm />} />
            {/* Approver / review portal */}
            <Route path="/approver"    element={<ApproverDashboard />} />
            {/* Analytics — budget/region/activity/daily insights */}
            <Route path="/analytics"  element={<AnalyticsDashboard />} />
            {/* Reports — Excel / PDF downloads */}
            <Route path="/reports"     element={<ReportsPage />} />
            {/* Chat — AI assistant + team chat */}
            <Route path="/chat"        element={<ChatTestPage />} />
            {/* Admin — user management */}
            <Route element={<AdminRoute />}>
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
              <Route path="/admin/dealer-map" element={<AdminDealerMapPage />} />
            </Route>
            <Route path="/"  element={<Navigate to="/dashboard" replace />} />
            <Route path="*"  element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      ) : (
        // ── Not logged in ─────────────────────────────────────────────────────
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
          <Route path="*" element={<LoginPage onDealerLogin={refreshDealer} />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
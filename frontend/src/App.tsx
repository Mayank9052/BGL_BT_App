import { useEffect } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import {
  useMsal,
  useIsAuthenticated,
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
} from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import RSMProposalForm from "./pages/RSMForm";
import ApproverDashboard from "./pages/Approverdashboard";
import { useAuthStore } from "./store/authStore";
import { syncUserWithBackend } from "./services/authService";

export default function App() {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { setUser, setLoading } = useAuthStore();

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
      <AuthenticatedTemplate>
        <Routes>
          <Route path="/dashboard"         element={<DashboardPage />} />
          <Route path="/rsm-form"          element={<RSMProposalForm />} />
          <Route path="/approver"          element={<ApproverDashboard />} />  {/* NEW */}
          <Route path="/"                  element={<Navigate to="/dashboard" replace />} />
          <Route path="*"                  element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthenticatedTemplate>

      <UnauthenticatedTemplate>
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </UnauthenticatedTemplate>
    </BrowserRouter>
  );
}
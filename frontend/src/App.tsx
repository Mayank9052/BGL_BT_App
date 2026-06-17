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
import { useAuthStore } from "./store/authStore";
import { syncUserWithBackend } from "./services/authService";

export default function App() {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { setUser, setLoading } = useAuthStore();

  // Sync the signed-in Microsoft account into the SQL Server Users table
  // exactly once login completes, before any protected route renders.
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
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/rsm-form" element={<RSMProposalForm />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
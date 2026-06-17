//src/App.tsx
import { useEffect } from "react";
import { useMsal, useIsAuthenticated, AuthenticatedTemplate, UnauthenticatedTemplate } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import RsmForm from "./pages/RSMForm";
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
    <>
      <AuthenticatedTemplate>
        <RsmForm />
      </AuthenticatedTemplate>
      {/* <AuthenticatedTemplate>
        <DashboardPage />
      </AuthenticatedTemplate> */}
      <UnauthenticatedTemplate>
        <LoginPage />
      </UnauthenticatedTemplate>
    </>
  );
}

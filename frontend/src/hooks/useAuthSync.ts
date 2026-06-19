// src/hooks/useAuthSync.ts
import { useEffect } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { useAuthStore } from "../store/authStore";
import { syncUserWithBackend } from "../services/authService"; // adjust path to wherever this file lives

export function useAuthSync() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { user, setUser, setLoading } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || accounts.length === 0 || user) return;

    let cancelled = false;
    setLoading(true);

    syncUserWithBackend(instance)
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch((err) => console.error("login-sync failed:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, accounts, user, instance, setUser, setLoading]);
}
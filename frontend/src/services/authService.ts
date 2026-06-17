import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";
import type { UserProfile } from "../types/user";

export async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account");

  const result = await instance.acquireTokenSilent({
    ...apiRequest,
    account,
  });
  return result.accessToken;
}

export async function syncUserWithBackend(
  instance: IPublicClientApplication
): Promise<UserProfile> {
  const token = await getAccessToken(instance);

  const res = await fetch(`${API_BASE_URL}/api/auth/login-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) throw new Error(`Backend sync failed: ${res.status}`);
  return res.json();
}

export async function fetchMyProfile(
  instance: IPublicClientApplication
): Promise<UserProfile> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}
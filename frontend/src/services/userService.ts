// frontend\src\services\userService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";
import type { UserProfile } from "../types/user";

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account — please sign in again.");

  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function fetchAllUsers(instance: IPublicClientApplication): Promise<UserProfile[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  return res.json();
}

export async function updateUser(
  id: number,
  changes: Partial<UserProfile>,
  instance: IPublicClientApplication
): Promise<UserProfile> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/users/${id}`, {
    method: "PATCH",          // ← was PUT, must match [HttpPatch] on the controller
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      firstName: changes.firstName,
      lastName: changes.lastName,
      department: changes.department,
      jobTitle: changes.jobTitle,
      phoneNumber: changes.phoneNumber,
      role: changes.role,
      isActive: changes.isActive,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to update user (${res.status})`);
  }
  return res.json();
}
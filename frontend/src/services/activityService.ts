import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface ActivityType {
  id: number;
  activityName: string;
  isActive: boolean;
}

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function fetchActivityTypes(
  instance: IPublicClientApplication
): Promise<ActivityType[]> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/activity-types`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load activity types (${res.status})`);
  return res.json();
}

export async function fetchAllActivityTypes(
  instance: IPublicClientApplication
): Promise<ActivityType[]> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/activity-types/all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load activity types (${res.status})`);
  return res.json();
}

export async function createActivityType(
  name: string,
  instance: IPublicClientApplication
): Promise<ActivityType> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/activity-types`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ activityName: name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to create activity type (${res.status})`);
  }
  return res.json();
}

export async function toggleActivityType(
  id: number,
  isActive: boolean,
  instance: IPublicClientApplication
): Promise<ActivityType> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/activity-types/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ isActive }),
  });
  if (!res.ok) throw new Error(`Failed to update activity type (${res.status})`);
  return res.json();
}
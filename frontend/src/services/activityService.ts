// src/services/activityService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface ActivityType {
  id:           number;
  activityName: string;
  activityType: "ATL" | "BTL";
  isActive:     boolean;
}

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

/** Active activity types for RSM form dropdown */
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

/** All activity types including inactive — admin view */
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

/** Create a new activity type — requires activityType: "ATL" | "BTL" */
export async function createActivityType(
  activityName: string,
  activityType: "ATL" | "BTL",
  instance: IPublicClientApplication
): Promise<ActivityType> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/activity-types`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ activityName, activityType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.message ?? `Failed to create activity type (${res.status})`);
  }
  return res.json();
}

/** Toggle active/inactive */
export async function toggleActivityType(
  id: number,
  isActive: boolean,
  instance: IPublicClientApplication
): Promise<ActivityType> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/activity-types/${id}/toggle`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ isActive }),
  });
  if (!res.ok) throw new Error(`Failed to update activity type (${res.status})`);
  return res.json();
}
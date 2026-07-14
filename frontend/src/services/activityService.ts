// src/services/activityService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface ActivityType {
  id:           number;
  activityName: string;   // "Digital", "Canopy", "Gift"…
  activityType: "ATL" | "BTL";
  isActive:     boolean;
  subcategory:  string | null;  // "Facebook", "LED TV"…
  maxQty:       number;         // upper bound for qty dropdown
}

// Grouped structure for cascading dropdowns
export interface ActivityGroup {
  activityName: string;
  activityType: "ATL" | "BTL";
  subcategories: Array<{
    subcategory: string;
    maxQty: number;
    id: number;
  }>;
}

/** Build grouped structure from flat list for cascading dropdowns.
 *  Handles null subcategory — uses activityName itself as the single subcategory
 *  so the dropdown always shows something even before SQL migration is run.
 */
export function groupActivityTypes(types: ActivityType[]): ActivityGroup[] {
  const map = new Map<string, ActivityGroup>();
  for (const t of types) {
    const key = t.activityName.trim();
    if (!map.has(key)) {
      map.set(key, {
        activityName: key,
        activityType: t.activityType,
        subcategories: [],
      });
    }
    const group = map.get(key)!;
    // subcategory may be null if DB column not yet added — fall back to activityName
    const sub = t.subcategory?.trim() || null;
    if (sub) {
      // Avoid duplicates
      if (!group.subcategories.find((s) => s.subcategory === sub)) {
        group.subcategories.push({
          subcategory: sub,
          maxQty: t.maxQty > 0 ? t.maxQty : 5,
          id: t.id,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.activityName.localeCompare(b.activityName)
  );
}

async function getToken(instance: IPublicClientApplication): Promise<string> {
  // Staff: Azure AD MSAL token
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (account) {
    const result = await instance.acquireTokenSilent({ ...apiRequest, account });
    return result.accessToken;
  }
  // Dealer: JWT from localStorage
  try {
    const raw = localStorage.getItem("bgauss_dealer_user");
    if (raw) {
      const d = JSON.parse(raw);
      if (d?.token) return d.token as string;
    }
  } catch (_e) {}
  throw new Error("Not signed in.");
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

/** Create a new activity type */
export async function createActivityType(
  activityName: string,
  activityType: "ATL" | "BTL",
  instance: IPublicClientApplication,
  subcategory?: string,
  maxQty?: number
): Promise<ActivityType> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/activity-types`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ activityName, activityType, subcategory, maxQty }),
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
// src/services/dealerStatusService.ts
// Dealer Active / Inactive + RRERP Old/New refresh (Dealer Mapping).
import type { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (account) return (await instance.acquireTokenSilent({ ...apiRequest, account })).accessToken;
  try {
    const raw = localStorage.getItem("bgauss_dealer_user");
    if (raw) { const d = JSON.parse(raw); if (d?.token) return d.token as string; }
  } catch { /* ignore */ }
  throw new Error("Not signed in.");
}

async function call<T>(instance: IPublicClientApplication, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = JSON.parse(text)?.message ?? text; } catch { /* plain text */ }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface DealerStatusRow {
  dealerName: string; dealerCode: string | null; isActive?: boolean; dealerType: string | null;
}

/** All mapped dealers with Active flag (GET /api/dealer-team-mapping/lookup — any signed-in user). */
export const fetchDealerStatus = (instance: IPublicClientApplication) =>
  call<DealerStatusRow[]>(instance, "/api/dealer-team-mapping/lookup");

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Returns isInactive(code, name) built from the lookup rows. Unknown dealers count as active. */
export function buildInactiveMatcher(rows: DealerStatusRow[]) {
  const codes = new Set<string>(), names = new Set<string>();
  for (const r of rows) {
    if (r.isActive !== false) continue;
    if (r.dealerCode) codes.add(r.dealerCode.trim().toLowerCase());
    if (r.dealerName) names.add(norm(r.dealerName));
  }
  return (code?: string | null, name?: string | null) =>
    (!!code && codes.has(code.trim().toLowerCase())) || (!!name && names.has(norm(name)));
}

/** Admin: set a mapped dealer Active / Inactive (also (de)activates the dealer's portal logins). */
export const setDealerMappingStatus = (id: number, isActive: boolean, instance: IPublicClientApplication) =>
  call<{ isActive: boolean; loginsUpdated: number }>(instance, `/api/dealer-team-mapping/${id}/status`,
    { method: "PATCH", body: JSON.stringify({ isActive }) });

/** Admin: recompute Old / New from RRERP for all mapped dealers that have a Dealer Code. */
export const refreshDealerTypes = (instance: IPublicClientApplication) =>
  call<{ checked: number; changed: number; windowMonths: number }>(instance,
    "/api/dealer-team-mapping/refresh-dealer-types", { method: "POST" });

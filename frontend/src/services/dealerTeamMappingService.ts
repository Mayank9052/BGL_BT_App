// src/services/dealerTeamMappingService.ts
import type { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

const BASE_PATH = "/api/dealer-team-mapping";

// ── Types ────────────────────────────────────────────────────────────────────
export interface DealerTeamMappingRow {
  id: number;
  dealerName: string; dealerCode: string | null; city: string | null; state: string | null;
  rsm: string; rsmEmail: string | null;
  tsm: string | null; tsmEmail: string | null;
  commando: string | null; commandoEmail: string | null;
  dealerEmail: string | null;
  isEligible: boolean; dealerType: string | null;
  updatedAt: string; updatedByEmail: string | null;
}

/** Read-only shape returned by GET /lookup (non-admin screens). */
export type DealerTeamLookupRow = Omit<DealerTeamMappingRow, "id" | "updatedAt" | "updatedByEmail">;

/** Single create / edit from the Add/Edit modal — all core fields required. */
export interface UpsertDealerTeamMapping {
  dealerName: string; dealerCode?: string; city?: string; state?: string;
  rsm: string; rsmEmail?: string; tsm?: string; tsmEmail?: string;
  commando?: string; commandoEmail?: string; dealerEmail?: string;
  isEligible: boolean; dealerType?: string;
}

/** Excel bulk row — every field optional: blank / null = KEEP existing DB value. */
export interface BulkImportRowData {
  dealerName: string; dealerCode?: string; city?: string; state?: string;
  rsm?: string; rsmEmail?: string; tsm?: string; tsmEmail?: string;
  commando?: string; commandoEmail?: string; dealerEmail?: string;
  isEligible?: boolean | null; dealerType?: string;
}

export interface BulkImportRow    { sourceRow: number; data: BulkImportRowData; }
export interface BulkImportError  { sourceRow: number; dealerName: string; message: string; }
export interface BulkImportResult { created: number; updated: number; unchanged: number; errors: BulkImportError[]; }

// ── Auth — IDENTICAL to proposalService.getAccessToken ────────────────────────
// apiRequest / API_BASE_URL from authConfig; Azure account FIRST, local
// dealer/staff token only as fallback. Fixes AADSTS90009 and the 401.
function localToken(): string | null {
  try {
    const raw = localStorage.getItem("bgauss_dealer_user");
    if (raw) { const d = JSON.parse(raw); if (d?.token) return d.token as string; }
  } catch { /* ignore */ }
  return null;
}

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (account) {
    const result = await instance.acquireTokenSilent({ ...apiRequest, account });
    return result.accessToken;
  }
  const t = localToken();                      // Dealer / RSM / TSM / Commando local login
  if (t) return t;
  throw new Error("Not signed in.");
}

async function request<T>(instance: IPublicClientApplication, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    const text = await res.text().catch(() => "");
    try {
      const body = JSON.parse(text);
      if (body?.message) msg = body.message;
      else if (body?.title) msg = `${msg} — ${body.title}`;
    } catch { if (text) msg = `${msg} — ${text.slice(0, 300)}`; }
    const why = res.headers.get("WWW-Authenticate");
    if (res.status === 401 && why) msg += ` — ${why}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Lookup cache (per signed-in identity) ────────────────────────────────────
let lookupCache: { key: string; promise: Promise<DealerTeamLookupRow[]> } | null = null;

function identityKey(instance: IPublicClientApplication): string {
  return instance.getAllAccounts()[0]?.homeAccountId ?? localToken() ?? "anon";
}

/** Any signed-in user. Cached for the session; admin edits invalidate it. */
export function fetchDealerTeamLookup(
  instance: IPublicClientApplication,
  opts?: { force?: boolean },
): Promise<DealerTeamLookupRow[]> {
  const key = identityKey(instance);
  if (!lookupCache || lookupCache.key !== key || opts?.force) {
    const promise = request<DealerTeamLookupRow[]>(instance, `${BASE_PATH}/lookup`)
      .catch((e) => { lookupCache = null; throw e; });
    lookupCache = { key, promise };
  }
  return lookupCache.promise;
}

export function invalidateDealerTeamLookup() { lookupCache = null; }

// ── Admin CRUD ───────────────────────────────────────────────────────────────
export function fetchDealerTeamMappings(instance: IPublicClientApplication, search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<DealerTeamMappingRow[]>(instance, `${BASE_PATH}${qs}`);
}

export async function createDealerTeamMapping(data: UpsertDealerTeamMapping, instance: IPublicClientApplication) {
  const r = await request<DealerTeamMappingRow>(instance, BASE_PATH, { method: "POST", body: JSON.stringify(data) });
  invalidateDealerTeamLookup();
  return r;
}

export async function updateDealerTeamMapping(id: number, data: UpsertDealerTeamMapping, instance: IPublicClientApplication) {
  const r = await request<DealerTeamMappingRow>(instance, `${BASE_PATH}/${id}`, { method: "PUT", body: JSON.stringify(data) });
  invalidateDealerTeamLookup();
  return r;
}

export async function deleteDealerTeamMapping(id: number, instance: IPublicClientApplication) {
  const r = await request<{ message: string }>(instance, `${BASE_PATH}/${id}`, { method: "DELETE" });
  invalidateDealerTeamLookup();
  return r;
}

export async function bulkImportDealerTeamMappings(rows: BulkImportRow[], instance: IPublicClientApplication) {
  const r = await request<BulkImportResult>(instance, `${BASE_PATH}/bulk`, {
    method: "POST", body: JSON.stringify({ rows }),
  });
  invalidateDealerTeamLookup();
  return r;
}
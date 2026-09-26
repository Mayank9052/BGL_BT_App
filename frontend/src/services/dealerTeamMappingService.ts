// src/services/dealerTeamMappingService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface DealerTeamMappingRow {
  id: number;
  dealerName: string;
  dealerCode: string | null;
  city: string | null;
  state: string | null;
  rsm: string;
  rsmEmail: string | null;
  tsm: string | null;
  tsmEmail: string | null;
  commando: string | null;
  commandoEmail: string | null;
  dealerEmail: string | null;
  isEligible: boolean;
  dealerType: string | null;
  updatedAt: string;
  updatedByEmail: string | null;
}

export interface UpsertDealerTeamMapping {
  dealerName: string;
  dealerCode?: string | null;
  city?: string | null;
  state?: string | null;
  rsm: string;
  rsmEmail?: string | null;
  tsm?: string | null;
  tsmEmail?: string | null;
  commando?: string | null;
  commandoEmail?: string | null;
  dealerEmail?: string | null;
  isEligible: boolean;
  dealerType?: string | null;
}

async function getAdminToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function fetchDealerTeamMappings(
  instance: IPublicClientApplication,
  search?: string,
): Promise<DealerTeamMappingRow[]> {
  const token = await getAdminToken(instance);
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${API_BASE_URL}/api/dealer-team-mapping${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function createDealerTeamMapping(
  dto: UpsertDealerTeamMapping,
  instance: IPublicClientApplication,
): Promise<DealerTeamMappingRow> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealer-team-mapping`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(dto),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function updateDealerTeamMapping(
  id: number,
  dto: UpsertDealerTeamMapping,
  instance: IPublicClientApplication,
): Promise<DealerTeamMappingRow> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealer-team-mapping/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(dto),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function deleteDealerTeamMapping(
  id: number,
  instance: IPublicClientApplication,
): Promise<void> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealer-team-mapping/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
}
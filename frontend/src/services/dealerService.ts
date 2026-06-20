import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface DealerOption {
  customerCode: string;
  customerName: string;
  city: string | null;
  state: string | null;
  mobile: string | null;
  contactPerson: string | null;
  tsmCode: string | null;
  tsmName: string | null;
  rsmCode: string | null;
  rsmName: string | null;
}

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function fetchDealers(
  instance: IPublicClientApplication
): Promise<DealerOption[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Dealer API error body:", body);   // ← check browser console
    throw new Error(`Failed to load dealers (${res.status}): ${body}`);
  }
  return res.json();
}
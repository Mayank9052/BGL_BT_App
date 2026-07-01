// frontend\src\services\vendorService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface VendorOption {
  id:         number;
  vendorName: string;
  isActive:   boolean;
}

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function fetchVendors(
  instance: IPublicClientApplication
): Promise<VendorOption[]> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/vendors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load vendors (${res.status})`);
  return res.json();
}
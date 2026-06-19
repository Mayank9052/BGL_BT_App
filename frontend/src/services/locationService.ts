import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";
import type { StateOption, CityOption } from "../types/location";

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account — please sign in again.");

  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function fetchStates(instance: IPublicClientApplication): Promise<StateOption[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/locations/states`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load states (${res.status})`);
  return res.json();
}

export async function fetchCitiesByState(
  stateId: number,
  instance: IPublicClientApplication
): Promise<CityOption[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/locations/states/${stateId}/cities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load cities (${res.status})`);
  return res.json();
}
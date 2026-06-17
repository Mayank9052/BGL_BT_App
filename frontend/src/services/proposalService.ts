// src/services/proposalService.ts
import {
  IPublicClientApplication,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";
import { apiRequest } from "../authConfig";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/* Shape sent to the backend — keep in sync with your C# DTO. */
export interface ProposalActivity {
  activityType: string;
  target: number;
  startDate: string; // yyyy-MM-dd
  endDate: string;   // yyyy-MM-dd
  budget: number;
  incentive: number;
}

export interface ProposalPayload {
  state: string;
  location: string;
  type: string;
  dealerName: string;
  rsmName: string;
  commandoName: string;
  month: string;
  eligibility: string;
  remarks: string;
  submittedBy: string | null;
  activities: ProposalActivity[];
  totalBudget: number;
  totalTarget: number;
  cac: number;
}

/**
 * Acquire an access token for the protected API. Tries silent first,
 * falls back to an interactive redirect if consent/login is required.
 */
async function getAccessToken(
  instance: IPublicClientApplication
): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) {
    throw new Error("No signed-in account found.");
  }

  try {
    const result = await instance.acquireTokenSilent({
      ...apiRequest,
      account,
    });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      // Will navigate away and return; the submit won't resolve in this call.
      await instance.acquireTokenRedirect(apiRequest);
    }
    throw err;
  }
}

/**
 * Submit an RSM proposal to the backend.
 * Returns the created resource (adjust the return type to match your API).
 */
export async function submitProposal(
  payload: ProposalPayload,
  instance: IPublicClientApplication
): Promise<unknown> {
  const token = await getAccessToken(instance);

  const res = await fetch(`${API_BASE}/api/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Submit failed (${res.status} ${res.statusText})${text ? `: ${text}` : ""}`
    );
  }

  // No body on 201/204 is fine.
  return res.status === 204 ? null : await res.json().catch(() => null);
}
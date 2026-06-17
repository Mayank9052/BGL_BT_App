import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

interface ActivityPayload {
  activityType: string;
  target: number;
  startDate: string;
  endDate: string;
  budget: number;
  incentive: number;
}

interface ProposalPayload {
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
  activities: ActivityPayload[];
  totalBudget: number;
  totalTarget: number;
  cac: number;
}

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account — please sign in again.");

  const result = await instance.acquireTokenSilent({
    ...apiRequest,
    account,
  });
  return result.accessToken;
}

export async function submitProposal(
  payload: ProposalPayload,
  instance: IPublicClientApplication
) {
  const token = await getAccessToken(instance);

  const res = await fetch(`${API_BASE_URL}/api/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to submit proposal (${res.status})`);
  }

  return res.json();
}

export async function fetchProposals(instance: IPublicClientApplication) {
  const token = await getAccessToken(instance);

  const res = await fetch(`${API_BASE_URL}/api/proposals`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Failed to load proposals (${res.status})`);
  return res.json();
}
// src/services/proposalService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

/* ── Types ────────────────────────────────────────────────── */
export interface ActivityResponse {
  id: string;
  activityType: string;
  target: number;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  incentive: number;
  remarks: string | null;
}

export interface ProposalResponse {
  id: string;
  state: string;
  location: string;
  type: string;
  dealerName: string;
  rsmName: string;
  commandoName: string;
  month: string;
  eligibility: string;
  remarks: string | null;
  totalBudget: number;
  totalTarget: number;
  cac: number;
  submittedBy: string;
  createdAt: string;
  status: "Pending" | "Approved" | "Rejected";
  approverNote: string | null;
  approvedBy: string | null;
  decidedAt: string | null;
  tokenNumber: string | null;
  activities: ActivityResponse[];
}

interface ActivityPayload {
  activityType: string;
  target: number;
  startDate: string;
  endDate: string;
  budget: number;
  incentive: number;
  remarks?: string;
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

export interface DecidePayload {
  status: "Approved" | "Rejected";
  approverNote: string | null;
  approvedBy: string | null;
}

/* ── Token helper ─────────────────────────────────────────── */
async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account — please sign in again.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

/* ── API calls ────────────────────────────────────────────── */
export async function submitProposal(
  payload: ProposalPayload,
  instance: IPublicClientApplication
): Promise<ProposalResponse> {
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

export async function fetchMyProposals(
  instance: IPublicClientApplication
): Promise<ProposalResponse[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load your proposals (${res.status})`);
  return res.json();
}

export async function fetchProposals(
  instance: IPublicClientApplication
): Promise<ProposalResponse[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load proposals (${res.status})`);
  return res.json();
}

export async function decideProposal(
  id: string,
  payload: DecidePayload,
  instance: IPublicClientApplication
): Promise<ProposalResponse> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/decide`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Decision failed (${res.status})`);
  }
  return res.json();
}
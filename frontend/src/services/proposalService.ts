import { IPublicClientApplication } from "@azure/msal-browser";

const API_BASE = "/api/proposals";

const SCOPES = ["api://<YOUR_API_CLIENT_ID>/access_as_user"];

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const accounts = instance.getAllAccounts();
  if (!accounts.length) throw new Error("No signed-in account found.");

  const result = await instance.acquireTokenSilent({
    scopes: SCOPES,
    account: accounts[0],
  });
  return result.accessToken;
}

async function apiFetch<T>(
  instance: IPublicClientApplication,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken(instance);

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }

  // 204 No Content — return undefined cast to T
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ── Types (mirror DTOs from backend) ───────────────────── */
export interface ActivityPayload {
  activityType: string;
  target: number;
  startDate: string;
  endDate: string;
  budget: number;
  incentive: number;
}

export interface CreateProposalPayload {
  state: string;
  location: string;
  type: string;
  dealerName: string;
  rsmName: string;
  commandoName: string;
  month: string;
  eligibility: string;
  remarks: string;
  submittedBy?: string | null;
  activities: ActivityPayload[];
  totalBudget: number;
  totalTarget: number;
  cac: number;
}

export interface ActivityResponse {
  id: string;
  activityType: string;
  target: number;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  incentive: number;
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
  remarks: string;
  totalBudget: number;
  totalTarget: number;
  cac: number;
  submittedBy: string;
  createdAt: string;
  status: "Pending" | "Approved" | "Rejected";
  approverNote: string | null;
  approvedBy: string | null;
  decidedAt: string | null;
  activities: ActivityResponse[];
}

export interface DecisionPayload {
  status: "Approved" | "Rejected";
  approverNote: string | null;
  approvedBy: string | null;
}

/* ── API calls ───────────────────────────────────────────── */

/** Submit a new RSM proposal */
export async function submitProposal(
  payload: CreateProposalPayload,
  instance: IPublicClientApplication
): Promise<ProposalResponse> {
  return apiFetch<ProposalResponse>(instance, API_BASE, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Fetch all proposals (approver view) */
export async function fetchProposals(
  instance: IPublicClientApplication
): Promise<ProposalResponse[]> {
  return apiFetch<ProposalResponse[]>(instance, API_BASE);
}

/** Approve or reject a single proposal */
export async function decideProposal(
  id: string,
  payload: DecisionPayload,
  instance: IPublicClientApplication
): Promise<ProposalResponse> {
  return apiFetch<ProposalResponse>(
    instance,
    `${API_BASE}/${id}/decision`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}
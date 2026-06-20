// src/services/proposalService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

/* ── Types ────────────────────────────────────────────────────────────────── */
export interface ActivityResponse {
  id: string;
  activityType: string;
  target: number;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  incentive: number;
  remarks: string | null;
  // ── actuals (filled after approval) ──
  actualStartDate: string | null;
  actualEndDate:   string | null;
  mediaFileUrl:    string | null;
  mediaFileName:   string | null;
  mediaFileType:   string | null;
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
  submittedByDisplayName: string | null;  // ← add this line
  createdAt: string;
  status: "Pending" | "Approved" | "Rejected" | "NeedsRevision";
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
  docNumber: string;
  activities: ActivityPayload[];
  totalBudget: number;
  totalTarget: number;
  cac: number;
}

// Payload the reviewer sends when saving edits to a pending proposal
export interface UpdateProposalPayload {
  dealerName: string;
  location: string;
  state: string;
  type: string;
  rsmName: string;
  commandoName: string;
  month: string;
  eligibility: string;
  remarks: string;
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

export interface SendBackPayload {
  note: string | null;
  sentBackBy: string | null;
}

export async function sendBackProposal(
  id: string,
  payload: SendBackPayload,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/sendback`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Send-back failed (${res.status})`);
  }
  return res.json();
}

export interface ActivityActualsPayload {
  activityId: string;
  actualStartDate: string | null;
  actualEndDate:   string | null;
  mediaFileUrl:    string | null;
  mediaFileName:   string | null;
  mediaFileType:   string | null;
}

/** Update actual dates + media for approved proposal activities */
export async function updateProposalActuals(
  id: string,
  actuals: ActivityActualsPayload[],
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/actuals`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(actuals),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to save actuals (${res.status})`);
  }
  return res.json();
}

/** Upload a media file, returns { url, fileName, fileType } */
export async function uploadActivityMedia(
  file: File,
  instance: IPublicClientApplication,
): Promise<{ url: string; fileName: string; fileType: string }> {
  const token = await getAccessToken(instance);
  const form  = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Upload failed (${res.status})`);
  }
  return res.json();
}

/* ── Token helper ─────────────────────────────────────────────────────────── */
async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account — please sign in again.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

/* ── API calls ────────────────────────────────────────────────────────────── */

/** Submit a new proposal (RSM → backend) */
export async function submitProposal(
  payload: ProposalPayload,
  instance: IPublicClientApplication,
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

/** Update an existing pending proposal (reviewer edits before deciding) */
export async function updateProposal(
  id: string,
  payload: UpdateProposalPayload,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to update proposal (${res.status})`);
  }
  return res.json();
}

export async function fetchProposalById(
  id: string,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load proposal (${res.status})`);
  return res.json();
}

/** Fetch all proposals submitted by the current RSM */
export async function fetchMyProposals(
  instance: IPublicClientApplication,
): Promise<ProposalResponse[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load your proposals (${res.status})`);
  return res.json();
}

/** Fetch all proposals (approver view) */
export async function fetchProposals(
  instance: IPublicClientApplication,
): Promise<ProposalResponse[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load proposals (${res.status})`);
  return res.json();
}

/** Approve or reject a proposal */
export async function decideProposal(
  id: string,
  payload: DecidePayload,
  instance: IPublicClientApplication,
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
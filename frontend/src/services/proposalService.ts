// src/services/proposalService.ts
import { IPublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";
import { apiRequest, graphMailRequest, API_BASE_URL } from "../authConfig";
import { getDealerToken } from "./dealerAuthService";

/* ── Types ────────────────────────────────────────────────────────────────── */
export interface ActivityMediaResponse {
  id:       string;
  fileUrl:  string;
  fileName: string;
  fileType: string;
  // ── NEW: GPS + capture time ──
  capturedAt?: string | null;
  latitude?:   number | null;
  longitude?:  number | null;
  locationAccuracyMeters?: number | null;
}

export interface ActivityResponse {
  id:               string;
  activityType:     string;
  category:         string | null;
  subcategory:      string | null;
  qty:              number;
  salesPercent:     number | null;    // ← NEW
  leadTarget:       number;
  retailTarget:     number;
  startDate:        string | null;
  endDate:          string | null;
  budget:           number;
  additionalBudget: number;
  bgaussShare:      number;
  vendorId:         number | null;
  remarks:          string | null;
  actualStartDate:  string | null;
  actualEndDate:    string | null;
  mediaFileUrl:     string | null;
  mediaFileName:    string | null;
  mediaFileType:    string | null;
  mediaFiles:       ActivityMediaResponse[];
}

export interface ProposalResponse {
  id:                     string;
  state:                  string;
  location:               string;
  type:                   string;
  dealerName:             string;
  vendorId:               number | null;
  vendorName:             string | null;
  rsmName:                string;
  tsmName:                string;   // TSM (Territory Sales Manager)
  commandoName:           string | null; // Sales Commando (DesignationId=26)
  month:                  string;
  eligibility:            string;
  remarks:                string | null;
  totalBudget:            number;
  totalLeadTarget:        number;
  totalRetailTarget:      number;
  cac:                    number;
  cpl:                    number;
  allowedCac:             number;
  cacWarning:             string | null;
  submittedBy:            string;
  submittedByDisplayName: string | null;
  createdAt:              string;
  status:                 "Pending" | "Approved" | "Rejected" | "NeedsRevision";
  approverNote:           string | null;
  approvedBy:             string | null;
  decidedAt:              string | null;
  tokenNumber:            string | null;
  checkedByEmail:         string | null;
  checkedAt:              string | null;
  dealerNotified:         boolean;
  dealerEmail:            string | null;
  activities:             ActivityResponse[];
}

export interface DealerSendBackPayload {
  dealerEmail: string;
  requestNote: string;
}

interface ActivityPayload {
  activityType:     string;
  category:         string | null;
  subcategory:      string | null;
  qty:              number;
  salesPercent:     number | null;    // ← NEW
  leadTarget:       number;
  retailTarget:     number;
  startDate:        string;
  endDate:          string;
  budget:           number;
  additionalBudget: number;
  bgaussShare:      number;
  vendorId:         number | null;
  remarks?:         string;
  mediaFiles?: Array<{ fileUrl: string; fileName: string; fileType: string }>;
}

interface ProposalPayload {
  state:              string;
  location:           string;
  type:               string;
  dealerName:         string;
  vendorId:           number | null;
  vendorName:         string | null;
  rsmName:            string;
  tsmName:            string;
  commandoName:       string | null;
  month:              string;
  eligibility:        string;
  remarks:            string | null;
  submittedBy:        string | null;
  docNumber:          string;
  activities:         ActivityPayload[];
  totalBudget:        number;
  totalLeadTarget:    number;
  totalRetailTarget:  number;
  cac:                number;
  cpl:                number;
}

export interface UpdateProposalPayload {
  dealerName:         string;
  vendorId:           number | null;
  vendorName:         string | null;
  location:           string;
  state:              string;
  type:               string;
  rsmName:            string;
  tsmName:            string;
  commandoName:       string | null;
  month:              string;
  eligibility:        string;
  remarks:            string;
  activities:         ActivityPayload[];
  totalBudget:        number;
  totalLeadTarget:    number;
  totalRetailTarget:  number;
  cac:                number;
  cpl:                number;
}

export interface DecidePayload {
  status:       "Approved" | "Rejected";
  approverNote: string | null;
  approvedBy:   string | null;
}

export interface SendBackPayload {
  note:       string | null;
  sentBackBy: string | null;
}

export interface ActivityActualsPayload {
  activityId:      string;
  actualStartDate: string | null;
  actualEndDate:   string | null;
  mediaFileUrl:    string | null;
  mediaFileName:   string | null;
  mediaFileType:   string | null;
}

/* ── Token helpers ────────────────────────────────────────────────────────── */
async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (account) {
    const result = await instance.acquireTokenSilent({ ...apiRequest, account });
    return result.accessToken;
  }
  try {
    const raw = localStorage.getItem("bgauss_dealer_user");
    if (raw) { const d = JSON.parse(raw); if (d?.token) return d.token as string; }
  } catch {}
  throw new Error("Not signed in.");
}

async function getGraphToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) return "";
  try {
    const result = await instance.acquireTokenSilent({ ...graphMailRequest, account });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      const result = await instance.acquireTokenPopup({ ...graphMailRequest, account });
      return result.accessToken;
    }
    return "";
  }
}

/* ── API calls ────────────────────────────────────────────────────────────── */

export async function submitProposal(
  payload: ProposalPayload,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const [apiToken, graphToken] = await Promise.all([
    getAccessToken(instance),
    getGraphToken(instance),
  ]);
  const res = await fetch(`${API_BASE_URL}/api/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${apiToken}`,
      "X-Graph-Token": graphToken,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function updateProposal(
  id: string,
  payload: UpdateProposalPayload,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const [apiToken, graphToken] = await Promise.all([
    getAccessToken(instance),
    getGraphToken(instance),
  ]);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${apiToken}`,
      "X-Graph-Token": graphToken,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
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

export async function dealerSendBack(
  id: string,
  payload: DealerSendBackPayload,
): Promise<ProposalResponse> {
  const token = getDealerToken();
  if (!token) throw new Error("Not signed in as a dealer.");
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/dealer-sendback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

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

export async function fetchProposalsByDealer(
  dealerName: string,
  instance: IPublicClientApplication,
): Promise<ProposalResponse[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(
    `${API_BASE_URL}/api/proposals/by-dealer?name=${encodeURIComponent(dealerName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Failed to load dealer history (${res.status})`);
  return res.json();
}

export async function fetchActivityTypesUsed(
  dealerName: string,
  month: string,
  instance: IPublicClientApplication,
): Promise<string[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(
    `${API_BASE_URL}/api/proposals/activity-types-used` +
    `?dealerName=${encodeURIComponent(dealerName)}&month=${encodeURIComponent(month)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Failed to check activity types (${res.status})`);
  return res.json();
}

export async function decideProposal(
  id: string,
  payload: DecidePayload,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const [apiToken, graphToken] = await Promise.all([
    getAccessToken(instance),
    getGraphToken(instance),
  ]);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/decide`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${apiToken}`,
      "X-Graph-Token": graphToken,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Decision failed (${res.status})`);
  return res.json();
}

export async function sendBackProposal(
  id: string,
  payload: SendBackPayload,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const [apiToken, graphToken] = await Promise.all([
    getAccessToken(instance),
    getGraphToken(instance),
  ]);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/sendback`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${apiToken}`,
      "X-Graph-Token": graphToken,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Send-back failed (${res.status})`);
  return res.json();
}

export async function updateProposalActuals(
  id: string,
  actuals: ActivityActualsPayload[],
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/actuals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(actuals),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to save actuals (${res.status})`);
  }
  return res.json();
}

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

export async function fetchMyDealerProposals(): Promise<ProposalResponse[]> {
  const token = getDealerToken();
  if (!token) throw new Error("Not signed in as a dealer.");
  const res = await fetch(`${API_BASE_URL}/api/proposals/my-dealer-proposals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to load proposals (${res.status})`);
  }
  return res.json();
}

// export async function addActivityMedia(
//   proposalId: string,
//   activityId: string,
//   media: { fileUrl: string; fileName: string; fileType: string },
//   instance: IPublicClientApplication,
// ): Promise<ActivityMediaResponse> {
//   const token = await getAccessToken(instance);
//   const res = await fetch(
//     `${API_BASE_URL}/api/proposals/${proposalId}/activities/${activityId}/media`,
//     {
//       method: "POST",
//       headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
//       body: JSON.stringify(media),
//     },
//   );
//   if (!res.ok) {
//     const text = await res.text().catch(() => "");
//     throw new Error(text || `Failed to attach media (${res.status})`);
//   }
//   return res.json();
// }

export async function addActivityMedia(
  proposalId: string,
  activityId: string,
  media: {
    fileUrl: string; fileName: string; fileType: string;
    capturedAt?: string; latitude?: number; longitude?: number; locationAccuracyMeters?: number;
  },
  instance: IPublicClientApplication,
): Promise<ActivityMediaResponse> {
  const token = await getAccessToken(instance);
  const res = await fetch(
    `${API_BASE_URL}/api/proposals/${proposalId}/activities/${activityId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(media),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to attach media (${res.status})`);
  }
  return res.json();
}

export async function forwardProposalToApprover(
  id: string,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const [apiToken, graphToken] = await Promise.all([
    getAccessToken(instance),
    getGraphToken(instance),
  ]);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/forward`, {
    method: "POST",
    headers: {
      Authorization:   `Bearer ${apiToken}`,
      "X-Graph-Token": graphToken,
    },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function notifyDealer(
  id: string,
  dealerEmail: string,
  instance: IPublicClientApplication,
): Promise<ProposalResponse> {
  const [apiToken, graphToken] = await Promise.all([
    getAccessToken(instance),
    getGraphToken(instance),
  ]);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${id}/notify-dealer`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Bearer ${apiToken}`,
      "X-Graph-Token": graphToken,
    },
    body: JSON.stringify({ dealerEmail }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function removeActivityMedia(
  proposalId: string,
  activityId: string,
  mediaId: string,
  instance: IPublicClientApplication,
): Promise<void> {
  const token = await getAccessToken(instance);
  const res = await fetch(
    `${API_BASE_URL}/api/proposals/${proposalId}/activities/${activityId}/media/${mediaId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to remove media (${res.status})`);
  }
}
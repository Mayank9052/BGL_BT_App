// src/services/proposalAiReviewService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface ProposalAiFlag {
  id:                   string;
  severity:             "Blocking" | "Warning" | "Info";
  title:                string;
  detail:               string;
  relatedActivityType:  string | null;
}

export interface ProposalAiReview {
  id:             string;
  proposalId:     string;
  status:         "Running" | "Completed" | "Failed";
  overallVerdict: "Clean" | "Warning" | "Blocking";
  summary:        string | null;
  modelUsed:      string;
  toolCallCount:  number;
  runAt:          string;
  errorMessage:   string | null;
  flags:          ProposalAiFlag[];
}

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (account) {
    const result = await instance.acquireTokenSilent({ ...apiRequest, account });
    return result.accessToken;
  }
  try {
    const raw = localStorage.getItem("bgauss_dealer_user");
    if (raw) {
      const d = JSON.parse(raw);
      if (d?.token) return d.token as string;
    }
  } catch (_e) {}
  throw new Error("Not signed in.");
}

/** Fetch the latest AI review for a proposal. Returns null if none has run yet. */
export async function fetchAiReview(
  proposalId: string,
  instance: IPublicClientApplication
): Promise<ProposalAiReview | null> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${proposalId}/ai-review`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load AI review (${res.status})${text ? ": " + text : ""}`);
  }
  return res.json();
}

/** Trigger a fresh AI review run and wait for the result. */
export async function rerunAiReview(
  proposalId: string,
  instance: IPublicClientApplication
): Promise<ProposalAiReview> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/proposals/${proposalId}/ai-review/rerun`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to re-run AI review (${res.status})${text ? ": " + text : ""}`);
  }
  return res.json();
}

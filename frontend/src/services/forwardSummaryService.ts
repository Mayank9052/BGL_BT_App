// src/services/forwardSummaryService.ts
// Forward to Final Approver + ONE state-wise summary mail IMMEDIATELY (no midnight digest).
import type { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";
import { getGraphTokenForBulk } from "./proposalService";

async function apiToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in.");
  return (await instance.acquireTokenSilent({ ...apiRequest, account })).accessToken;
}

async function call<T>(instance: IPublicClientApplication, path: string, init: RequestInit = {}, withGraph = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${await apiToken(instance)}` };
  if (withGraph) {
    // Delegated Mail.Send token → the summary is sent from the Checker's own mailbox (copy in Sent Items)
    try { const g = await getGraphTokenForBulk(instance); if (g) headers["X-Graph-Token"] = g; } catch { /* backend falls back to app-only */ }
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) } });
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* plain text */ }
  if (!res.ok) throw new Error((data as { message?: string } | null)?.message || text || `Request failed (${res.status})`);
  return data as T;
}

export interface ForwardSummaryMailResult {
  sent: boolean; via: string; to: string[]; cc: string[];
  sentAtIst: string; proposals: number; states: number; subject: string; error?: string | null;
}
export interface ForwardNowResult {
  forwarded: number; failed: number; skipped: number;
  failedDetails: { id: string; token?: string; error: string }[];
  mail: ForwardSummaryMailResult | null;
}
export interface ForwardSummaryStatus {
  pendingMail: number; withApprover: number; lastSentAt: string | null; lastBatch: number; to?: string[]; error?: string;
}

/** Forward the selected proposals and mail ONE state-wise summary right away. */
export const forwardNow = (ids: string[], instance: IPublicClientApplication) =>
  call<ForwardNowResult>(instance, "/api/proposals/forward-now",
    { method: "POST", body: JSON.stringify({ proposalIds: ids }) }, true);

/** Last summary mail + forwarded proposals not yet mailed. */
export const getForwardSummaryStatus = (instance: IPublicClientApplication) =>
  call<ForwardSummaryStatus>(instance, "/api/proposals/forward-summary/status");

/** Mail NOW everything forwarded but not yet mailed (e.g. a batch that waited for midnight). */
export const sendPendingSummary = (instance: IPublicClientApplication) =>
  call<{ mail: ForwardSummaryMailResult | null; message?: string }>(instance,
    "/api/proposals/forward-summary/send-pending", { method: "POST" }, true);

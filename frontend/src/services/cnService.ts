// src/services/cnService.ts
// CN (Credit Note) workflow API. Works for Azure (staff) and local (Dealer / RSM / TSM / Commando) logins.
//  - Pass the MSAL `instance` from Azure pages (ApproverDashboard, CN Tracker).
//  - Pass nothing from DealerDashboard → the local dealer/staff JWT is used.
import type { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest } from "../authConfig";            // same import proposalService.ts uses — adjust path if different
import { getDealerToken } from "./dealerAuthService";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export type CnStatus =
  | "NotStarted" | "SentForRsmApproval" | "RsmApproved" | "RsmRejected" | "SentToAccounts" | "CnProcessed";

export interface CnReportRow {
  proposalId: string; activityId: string; tokenNumber: string;
  dealerName: string; state: string; month: string; year: string; rsmName: string;
  activityName: string; category: string | null;
  approvedLeads: number; approvedRetail: number; approvedBudget: number; approvedCpl: number; approvedCac: number;
  actualLeads: number; actualRetail: number; actualBudget: number | null; actualCpl: number | null; actualCac: number | null;
  leadsAchievementPct: number; retailAchievementPct: number;
  leadsSource: string; retailSource: string;
  photoCount: number; vendorInvoiceCount: number; hasFinalInvoice: boolean;
  cnStatus: CnStatus; cnNumber: string | null;
}

export interface CnActivityState {
  activityId: string; proposalId: string;
  report: CnReportRow;
  cnStatus: CnStatus;
  approvedBgaussAmount: number;
  rsmEmails: string[]; accountsEmails: string[];
  cnRequestedAt: string | null; cnRequestedByEmail: string | null;
  cnRsmDecidedAt: string | null; cnRsmDecidedByEmail: string | null; cnRsmDecisionNote: string | null;
  cnFinalInvoiceUrl: string | null; cnFinalInvoiceFileName: string | null; cnFinalInvoiceAt: string | null;
  cnInvoiceAmount: number | null;
  cnSentToAccountsAt: string | null; cnSentToAccountsByEmail: string | null;
  cnProcessedAt: string | null; cnNumber: string | null;
  isChecker: boolean;
  canSendToRsm: boolean; sendToRsmBlockers: string[];
  canRsmDecide: boolean; rsmDecideOnBehalf: boolean;
  canUploadFinalInvoice: boolean; canSendToAccounts: boolean; canMarkProcessed: boolean;
}

export interface CnActionResult {
  cn: CnActivityState;
  mailSent: boolean;
  mailMessage: string | null;
}

type MsalLike = IPublicClientApplication | null | undefined;

async function authHeader(instance?: MsalLike): Promise<string> {
  if (instance) {
    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
    if (account) {
      const r = await instance.acquireTokenSilent({ ...apiRequest, account });
      return `Bearer ${r.accessToken}`;
    }
  }
  const t = getDealerToken();
  if (t) return `Bearer ${t}`;
  throw new Error("Not signed in — please log in again.");
}

async function errText(r: Response): Promise<string> {
  const t = await r.text();
  try { const j = JSON.parse(t); return j.message || t || `HTTP ${r.status}`; }
  catch { return t || `HTTP ${r.status}`; }
}

async function call<T>(path: string, method: "GET" | "POST", body: unknown, instance?: MsalLike): Promise<T> {
  const auth = await authHeader(instance);
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errText(resp));
  return resp.json() as Promise<T>;
}

export const fetchCnForProposal = (proposalId: string, instance?: MsalLike) =>
  call<CnActivityState[]>(`/api/cn/proposals/${proposalId}`, "GET", undefined, instance);

export const cnSendToRsm = (activityId: string, instance?: MsalLike) =>
  call<CnActionResult>(`/api/cn/activities/${activityId}/send-to-rsm`, "POST", {}, instance);

export const cnRsmDecision = (activityId: string, approved: boolean, note: string, instance?: MsalLike) =>
  call<CnActionResult>(`/api/cn/activities/${activityId}/rsm-decision`, "POST", { approved, note }, instance);

export const cnSendToAccounts = (activityId: string, instance?: MsalLike) =>
  call<CnActionResult>(`/api/cn/activities/${activityId}/send-to-accounts`, "POST", {}, instance);

export const cnMarkProcessed = (activityId: string, cnNumber: string, instance?: MsalLike) =>
  call<CnActionResult>(`/api/cn/activities/${activityId}/mark-processed`, "POST", { cnNumber }, instance);

export async function cnUploadFinalInvoice(
  activityId: string, file: File, amount: number, instance?: MsalLike,
): Promise<CnActionResult> {
  const auth = await authHeader(instance);
  const fd = new FormData();
  fd.append("file", file);
  const up = await fetch(`${API_BASE}/api/media/upload`, { method: "POST", headers: { Authorization: auth }, body: fd });
  if (!up.ok) throw new Error(await errText(up));
  const d = await up.json();
  return call<CnActionResult>(`/api/cn/activities/${activityId}/final-invoice`, "POST", {
    fileUrl: d.url || d.fileUrl,
    fileName: d.fileName || file.name,
    fileType: d.fileType || file.type,
    amount,
  }, instance);
}

export function fetchCnReport(
  filters: { month?: string; year?: string; status?: string; dealer?: string },
  instance?: MsalLike,
) {
  const q = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v && v !== "All") q.set(k, v); });
  return call<CnReportRow[]>(`/api/cn/report${q.toString() ? `?${q}` : ""}`, "GET", undefined, instance);
}

export const resolveMediaUrl = (url: string | null | undefined) => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
};

export const CN_STATUS_META: Record<CnStatus, { label: string; bg: string; color: string }> = {
  NotStarted:         { label: "Not started",            bg: "#f1f5f9", color: "#475569" },
  SentForRsmApproval: { label: "Awaiting RSM approval",  bg: "#fef3c7", color: "#92400e" },
  RsmApproved:        { label: "RSM approved",           bg: "#dbeafe", color: "#1e40af" },
  RsmRejected:        { label: "Rejected by RSM",        bg: "#fee2e2", color: "#991b1b" },
  SentToAccounts:     { label: "With Accounts",          bg: "#ede9fe", color: "#5b21b6" },
  CnProcessed:        { label: "CN processed",           bg: "#dcfce7", color: "#166534" },
};

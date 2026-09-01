// src/services/leadReportService.ts
import type { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

// ── Matches LeadFunnelSummaryController's response shape exactly ──────────
export interface LeadFunnelQualified {
  total: number; hot: number; warm: number; normal: number; notSet: number; activeTotal: number;
}
export interface LeadFunnelRow {
  name: string;              // RSM name, or Dealer name when groupBy=dealer
  dealerCode?: string;       // present only when groupBy=dealer
  dealerName?: string;
  city?: string;
  state?: string;
  totalLeads: number;
  notCalled: number;
  followUp: number;
  closed: number;
  qualified: LeadFunnelQualified;
  booked: number;
  lost: number;
}
export interface LeadFunnelSummaryResponse {
  fromDate: string;
  toDate: string;
  groupBy: "rsm" | "dealer";
  rows: LeadFunnelRow[];
  total: LeadFunnelRow;
}

export async function fetchLeadFunnelSummary(
  instance: IPublicClientApplication,
  opts: { groupBy?: "rsm" | "dealer"; state?: string; dealerCode?: string; fromDate?: string; toDate?: string } = {},
): Promise<LeadFunnelSummaryResponse> {
  const token = await getAccessToken(instance);
  const params = new URLSearchParams();
  if (opts.groupBy)    params.set("groupBy", opts.groupBy);
  if (opts.state)      params.set("state", opts.state);
  if (opts.dealerCode) params.set("dealerCode", opts.dealerCode);
  if (opts.fromDate)   params.set("fromDate", opts.fromDate);
  if (opts.toDate)     params.set("toDate", opts.toDate);

  const res = await fetch(`${API_BASE_URL}/api/lead-funnel-summary?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load lead funnel summary (${res.status})`);
  return res.json();
}

// ── Matches LeadReportController's response shape ──────────────────────────
export interface LeadReportApiRow {
  state: string;
  leadsMonthTarget: number; leadsMtdTarget: number;
  walkinTarget: number; walkinMtdTarget: number; walkinMtdAch: number;
  btlTarget: number; btlMtdTarget: number; btlMtdAch: number;
  referralTarget: number; referralMtdTarget: number; referralMtdAch: number;
  atlTarget: number; atlMtdTarget: number; atlMtdAch: number;
  digitalTarget: number; digitalMtdTarget: number; digitalMtdAch: number;
  totalLeadsReceived: number; leadsVariance: number;
  leadsAchievementPct: number; leadsAchievementPctMtd: number;
  retailTargets: number; mtdRetailTargets: number; mtdRetailAchieved: number;
  mtdRetailAchievementPct: number; retailsEnquiriesPct: number;
}
export interface LeadReportApiResponse {
  month: number; year: number; generatedAt: string; rows: LeadReportApiRow[];
}

export async function fetchLeadReport(
  instance: IPublicClientApplication,
  opts: { month?: number; year?: number } = {},
): Promise<LeadReportApiResponse> {
  const token = await getAccessToken(instance);
  const params = new URLSearchParams();
  if (opts.month) params.set("month", String(opts.month));
  if (opts.year)  params.set("year", String(opts.year));

  const res = await fetch(`${API_BASE_URL}/api/lead-report?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load lead report (${res.status})`);
  return res.json();
}
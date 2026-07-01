// src/services/reportService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export interface ReportFilters {
  period?: "daily" | "weekly" | "monthly";
  from?: string;
  to?: string;
  state?: string;
  dealer?: string;
}

function buildQuery(filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  if (filters.from)   params.set("from", filters.from);
  if (filters.to)     params.set("to", filters.to);
  if (filters.state)  params.set("state", filters.state);
  if (filters.dealer) params.set("dealer", filters.dealer);
  return params.toString();
}

export async function fetchReportData(filters: ReportFilters, instance: IPublicClientApplication) {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/reports/data?${buildQuery(filters)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load report (${res.status})`);
  return res.json();
}

async function downloadFile(url: string, fileName: string, instance: IPublicClientApplication) {
  const token = await getToken(instance);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadExcelReport(filters: ReportFilters, instance: IPublicClientApplication) {
  return downloadFile(
    `${API_BASE_URL}/api/reports/excel?${buildQuery(filters)}`,
    `BTL_Report_${Date.now()}.xlsx`,
    instance,
  );
}

export function downloadPdfReport(filters: ReportFilters, instance: IPublicClientApplication) {
  return downloadFile(
    `${API_BASE_URL}/api/reports/pdf?${buildQuery(filters)}`,
    `BTL_Report_${Date.now()}.pdf`,
    instance,
  );
}
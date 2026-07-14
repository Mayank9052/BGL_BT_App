// src/services/reportService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

async function getToken(instance: IPublicClientApplication): Promise<string> {
  // Staff: Azure AD MSAL token
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (account) {
    const result = await instance.acquireTokenSilent({ ...apiRequest, account });
    return result.accessToken;
  }
  // Dealer: JWT from localStorage
  try {
    const raw = localStorage.getItem("bgauss_dealer_user");
    if (raw) {
      const d = JSON.parse(raw);
      if (d?.token) return d.token as string;
    }
  } catch (_e) {}
  throw new Error("Not signed in.");
}

export interface ReportFilters {
  period?: "daily" | "weekly" | "monthly";
  from?:   string;
  to?:     string;
  state?:  string;
  dealer?: string;
  status?: string;
  month?:  string;
}

function buildQuery(filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  if (filters.from)   params.set("from",   filters.from);
  if (filters.to)     params.set("to",     filters.to);
  if (filters.state)  params.set("state",  filters.state);
  if (filters.dealer) params.set("dealer", filters.dealer);
  // status and month are client-side filters only (not sent to backend)
  return params.toString();
}

export async function fetchReportData(
  filters: ReportFilters,
  instance: IPublicClientApplication,
) {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/reports/data?${buildQuery(filters)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      res.status === 403
        ? "Access denied — your account does not have permission to view reports."
        : `Failed to load report (${res.status})${text ? ": " + text : ""}`,
    );
  }
  return res.json();
}

async function downloadFile(
  url: string,
  fileName: string,
  instance: IPublicClientApplication,
) {
  const token = await getToken(instance);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      res.status === 403
        ? "Access denied — your account does not have permission to download reports."
        : `Download failed (${res.status})${text ? ": " + text : ""}`,
    );
  }

  const blob = await res.blob();
  const link = document.createElement("a");
  link.href     = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export function downloadExcelReport(
  filters: ReportFilters,
  instance: IPublicClientApplication,
) {
  return downloadFile(
    `${API_BASE_URL}/api/reports/excel?${buildQuery(filters)}`,
    `BTL_Report_${new Date().toISOString().slice(0, 10)}.xlsx`,
    instance,
  );
}

export function downloadPdfReport(
  filters: ReportFilters,
  instance: IPublicClientApplication,
) {
  return downloadFile(
    `${API_BASE_URL}/api/reports/pdf?${buildQuery(filters)}`,
    `BTL_Report_${new Date().toISOString().slice(0, 10)}.pdf`,
    instance,
  );
}
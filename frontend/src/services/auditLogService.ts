// src/services/auditLogService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface AuditLogEntry {
  id:          number;
  actorEmail:  string;
  actorName:   string;
  actorRole:   string;
  authType:    string;
  action:      string;
  targetEmail: string | null;
  details:     string | null;
  success:     boolean;
  createdAt:   string;
}

export interface AuditLogPage {
  total:    number;
  page:     number;
  pageSize: number;
  logs:     AuditLogEntry[];
}

async function getAdminToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export interface AuditLogFilters {
  action?:     string;
  actorEmail?: string;
  role?:       string;
  from?:       string; // ISO date
  to?:         string; // ISO date
  page?:       number;
  pageSize?:   number;
}

export async function fetchAuditLogs(
  filters: AuditLogFilters,
  instance: IPublicClientApplication,
): Promise<AuditLogPage> {
  const token = await getAdminToken(instance);
  const params = new URLSearchParams();
  if (filters.action)     params.set("action", filters.action);
  if (filters.actorEmail) params.set("actorEmail", filters.actorEmail);
  if (filters.role)       params.set("role", filters.role);
  if (filters.from)       params.set("from", filters.from);
  if (filters.to)         params.set("to", filters.to);
  params.set("page", String(filters.page ?? 1));
  params.set("pageSize", String(filters.pageSize ?? 50));

  const res = await fetch(`${API_BASE_URL}/api/audit-logs?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function fetchAuditLogActions(
  instance: IPublicClientApplication,
): Promise<string[]> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/audit-logs/actions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}
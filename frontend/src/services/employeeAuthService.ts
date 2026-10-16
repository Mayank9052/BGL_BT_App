// src/services/employeeAuthService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface StaffAccount {
  id:            number;
  email:         string;
  displayName:   string;
  employeeCode:  string | null;
  role:          string; // "RSM" | "TSM" | "ZSM" | "Commando"
  phoneNumber:   string | null;
  isActive:      boolean;
  lastLoginAt:   string | null;
  createdByEmail: string | null;
  createdAt:     string;
}

export interface StaffBulkPreviewResult {
  totalEligible:   number;
  alreadyImported: number;
  toCreate:        number;
  employees: Array<{
    employeeCode: string;
    employeeName: string;
    role:         string | null;
    emailId:      string;
    hasRealEmail: boolean;
  }>;
}

export interface StaffBulkImportResult {
  message:         string;
  created:         number;
  skipped:         number;
  failed:          number;
  defaultPassword: string;
  errors:          string[];
  employees: Array<{ employeeCode: string; employeeName: string; role: string; email: string }>;
}

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function bulkPreviewStaff(
  instance: IPublicClientApplication,
): Promise<StaffBulkPreviewResult> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/employee-auth/bulk-preview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function bulkImportStaff(
  instance: IPublicClientApplication,
): Promise<StaffBulkImportResult> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/employee-auth/bulk-import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

// ── NOTE: the backend EmployeeAuthController I gave you earlier only has
// login + bulk-preview + bulk-import. It does NOT yet have a "list all staff
// accounts" or "toggle active" or "reset password" endpoint — those need to
// be added to EmployeeAuthController.cs (mirroring DealerAuthController's
// ListDealerUsers / ToggleDealerActive / AdminResetDealerPassword) before
// fetchStaffUsers/toggleStaffActive/resetStaffPassword below will work. ──

export async function fetchStaffUsers(
  instance: IPublicClientApplication,
): Promise<StaffAccount[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/employee-auth/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function toggleStaffActive(
  id: number,
  instance: IPublicClientApplication,
): Promise<{ id: number; isActive: boolean }> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/employee-auth/${id}/toggle`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}

export async function resetStaffPassword(
  id: number,
  newPassword: string,
  instance: IPublicClientApplication,
): Promise<{ message: string }> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/employee-auth/${id}/admin-reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ newPassword }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => "") || `Failed (${res.status})`);
  return res.json();
}
// src/services/dealerAuthService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface DealerLoginResponse {
  token:       string;
  userId:      number;
  email:       string;
  displayName: string;
  role:        string;
  dealerCode:  string | null;
  dealerName:  string | null;
}

export interface DealerAccount {
  id:             number;
  email:          string;
  displayName:    string;
  dealerCode:     string | null;
  dealerName:     string | null;
  phoneNumber:    string | null;
  isActive:       boolean;
  lastLoginAt:    string | null;
  createdByEmail: string | null;
  createdAt:      string;
}

const DEALER_TOKEN_KEY = "bgauss_dealer_token";
const DEALER_USER_KEY  = "bgauss_dealer_user";

export async function dealerLogin(email: string, password: string): Promise<DealerLoginResponse> {
  const res = await fetch(`${API_BASE_URL}/api/dealer-auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Login failed.");
  }
  const data: DealerLoginResponse = await res.json();
  localStorage.setItem(DEALER_TOKEN_KEY, data.token);
  localStorage.setItem(DEALER_USER_KEY, JSON.stringify(data));
  return data;
}

export function getDealerToken(): string | null {
  return localStorage.getItem(DEALER_TOKEN_KEY);
}

export function getDealerUser(): DealerLoginResponse | null {
  const raw = localStorage.getItem(DEALER_USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function dealerLogout(): void {
  localStorage.removeItem(DEALER_TOKEN_KEY);
  localStorage.removeItem(DEALER_USER_KEY);
}

// ── Forgot / reset password — public, no auth required ───────────────────────
export async function forgotDealerPassword(email: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/dealer-auth/forgot-password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Failed to send reset link.");
  }
  return res.json();
}

export async function resetDealerPassword(
  email: string, token: string, newPassword: string,
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/dealer-auth/reset-password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, token, newPassword }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Failed to reset password.");
  }
  return res.json();
}

// ── Admin-only: reset a dealer's password directly (Azure AD token) ──────────
export async function adminResetDealerPassword(
  id: number,
  newPassword: string,
  instance: IPublicClientApplication,
): Promise<{ message: string }> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealer-auth/${id}/admin-reset-password`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ newPassword }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to reset password (${res.status})`);
  }
  return res.json();
}

// ── Admin-only: create / list / toggle dealer accounts (uses Azure AD token) ──
async function getAdminToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

export async function createDealerUser(
  payload: { email: string; password: string; displayName: string; dealerCode: string; dealerName: string; phoneNumber?: string },
  instance: IPublicClientApplication,
): Promise<DealerAccount> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealer-auth/create`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to create dealer user (${res.status})`);
  }
  return res.json();
}

export async function fetchDealerUsers(instance: IPublicClientApplication): Promise<DealerAccount[]> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealer-auth/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to load dealer users (${res.status})`);
  }
  return res.json();
}

export async function toggleDealerActive(
  id: number, instance: IPublicClientApplication,
): Promise<{ id: number; isActive: boolean }> {
  const token = await getAdminToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/dealer-auth/${id}/toggle`, {
    method:  "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to toggle dealer status (${res.status})`);
  }
  return res.json();
}
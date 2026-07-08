// src/services/whatsappService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface WaMessage {
  id:          string;
  toPhone:     string;
  contactName: string | null;
  body:        string;
  messageType: string;
  direction:   "inbound" | "outbound";
  status:      "sent" | "delivered" | "read" | "failed" | "received";
  waMessageId: string | null;
  sentAt:      string;
  deliveredAt: string | null;
  readAt:      string | null;
  sentByName:  string;
  sentByEmail: string;
}

export interface WaContact {
  phone:        string;
  contactName:  string | null;
  lastMessage:  string | null;
  lastAt:       string;
  unread:       number;
}

export interface WaTemplate {
  id:        string;
  label:     string;
  variables: string[];
}

async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

async function api<T>(
  path: string,
  method: "GET" | "POST",
  instance: IPublicClientApplication,
  body?: unknown
): Promise<T> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const fetchWaContacts = (instance: IPublicClientApplication) =>
  api<WaContact[]>("/api/whatsapp/contacts", "GET", instance);

export const fetchWaConversation = (phone: string, instance: IPublicClientApplication) =>
  api<WaMessage[]>(`/api/whatsapp/conversation?phone=${encodeURIComponent(phone)}`, "GET", instance);

export const sendWaText = (
  phone: string, body: string, contactName: string | null,
  instance: IPublicClientApplication
) => api<{ success: boolean; waMessageId: string }>(
  "/api/whatsapp/send", "POST", instance,
  { phone, body, contactName }
);

export const sendWaTemplate = (
  phone: string, templateName: string, params: string[], contactName: string | null,
  instance: IPublicClientApplication
) => api<{ success: boolean; waMessageId: string }>(
  "/api/whatsapp/send-template", "POST", instance,
  { phone, templateName, params, contactName }
);

export const fetchWaTemplates = (instance: IPublicClientApplication) =>
  api<WaTemplate[]>("/api/whatsapp/templates", "GET", instance);

// Format phone for display
export function fmtPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 12 && clean.startsWith("91"))
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  return phone;
}

// Validate phone loosely
export function isValidPhone(phone: string): boolean {
  const clean = phone.replace(/[\s\-().+]/g, "");
  return /^\d{10,15}$/.test(clean);
}

// Normalise to E.164 for India (+91)
export function normalisePhone(phone: string): string {
  const clean = phone.replace(/[\s\-().]/g, "");
  if (clean.startsWith("+")) return clean;
  if (clean.startsWith("91") && clean.length === 12) return `+${clean}`;
  if (clean.length === 10) return `+91${clean}`;
  return `+${clean}`;
}
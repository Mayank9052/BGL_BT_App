import { call, type MsalLike } from "./cnService";

export type AccessLevel = "view" | "download" | "full";
export interface AccessPageDef { key: string; name: string; description: string; hasDownload: boolean; hasFull: boolean }
export interface PagePerm { pageKey: string; view: boolean; download: boolean; full: boolean }
export interface AccessMe { email: string; isAdmin: boolean; legacy: boolean; pages: AccessPageDef[]; permissions: PagePerm[] }
export interface AccessUser {
  email: string; displayName: string | null; role: string | null; isAdmin: boolean;
  configured: boolean; legacy: boolean; permissions: PagePerm[]; updatedAt: string | null; updatedBy: string | null;
}
export interface AuditRow {
  id: number; at: string; actorEmail: string; actorName: string; targetEmail: string;
  pageKey: string; pageName: string; permissionType: string; action: string; result: string; note: string | null;
}

export const fetchAccessMe = (i?: MsalLike) =>
  call<AccessMe>("/api/accounts-access/me", "GET", undefined, i);
export const fetchAccessUsers = (i?: MsalLike) =>
  call<{ pages: AccessPageDef[]; users: AccessUser[] }>("/api/accounts-access/users", "GET", undefined, i);
export const saveAccessUser = (email: string, permissions: Array<{ pageKey: string; view: boolean; download: boolean; full: boolean }>, i?: MsalLike) =>
  call<{ email: string; permissions: PagePerm[]; legacy: boolean; changes: number }>(
    `/api/accounts-access/users/${encodeURIComponent(email)}`, "PUT", { permissions }, i);
export const fetchAccessAudit = (q: { page: number; pageSize: number; user?: string; actor?: string; action?: string }, i?: MsalLike) => {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== "") p.set(k, String(v)); });
  return call<{ total: number; page: number; pageSize: number; rows: AuditRow[] }>(`/api/accounts-access/audit?${p}`, "GET", undefined, i);
};
// frontend\src\services\userService.ts
// [BTL-2026-11-14] Error banner shows the server's message text, not raw JSON.
// [BTL-2026-11-16] syncDirectory — add Azure AD users who have never logged in.
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";
import type { UserProfile } from "../types/user";

async function getAccessToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("No active account — please sign in again.");

  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

// Reads { message } / { title } / plain text from an error response.
async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return fallback;
  try {
    const j = JSON.parse(text);
    return j?.message || j?.title || j?.error || fallback;
  } catch {
    return text;
  }
}

export async function fetchAllUsers(instance: IPublicClientApplication): Promise<UserProfile[]> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await readError(res, `Failed to load users (${res.status})`));
  return res.json();
}

export async function updateUser(
  id: number,
  changes: Partial<UserProfile>,
  instance: IPublicClientApplication
): Promise<UserProfile> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/users/${id}`, {
    method: "PATCH",          // must match [HttpPatch] on the controller
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      firstName: changes.firstName,
      lastName: changes.lastName,
      department: changes.department,
      jobTitle: changes.jobTitle,
      phoneNumber: changes.phoneNumber,
      role: changes.role,
      isActive: changes.isActive,
    }),
  });

  if (!res.ok) {
    const msg = await readError(res, `Failed to update user (${res.status})`);
    throw new Error(res.status === 403 ? "Only Admin can change users." : msg);
  }
  return res.json();
}

// ── Azure AD directory sync (Admin only) ─────────────────────────────────────
export interface DirectorySyncResult {
  dryRun: boolean;
  totalInDirectory: number;
  toCreate: number;          // users that are / will be added
  linked: number;            // manually-created rows matched by email and linked to the Azure account
  alreadyPresent: number;
  skipped: number;
  conflicts: number;         // same email, different Azure ID — left for a human
  newUsers: { email: string; displayName: string }[];
}

/** dryRun = true only reports what would be added; false actually adds them. */
export async function syncDirectory(
  dryRun: boolean,
  instance: IPublicClientApplication
): Promise<DirectorySyncResult> {
  const token = await getAccessToken(instance);
  const res = await fetch(`${API_BASE_URL}/api/users/sync-directory?dryRun=${dryRun}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const msg = await readError(res, `Directory sync failed (${res.status})`);
    throw new Error(res.status === 403 ? "Only Admin can sync the directory." : msg);
  }
  return res.json();
}
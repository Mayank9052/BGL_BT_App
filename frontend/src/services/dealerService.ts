// src/services/dealerService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import { apiRequest, API_BASE_URL } from "../authConfig";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DealerOption {
  customerCode:  string;
  customerName:  string;
  state:         string | null;
  city:          string | null;
  mobile:        string | null;
  contactPerson: string | null;
  rsmCode:       string | null;
  rsmName:       string | null;
  tsmCode:       string | null;
  tsmName:       string | null;
}

export interface DealerEligibility {
  customerCode:      string;
  state:             string;
  isEligible:        boolean;
  dealerType:        "Old" | "New";          // Old = >6 months, New = <6 months
  baseCacPerVehicle: number;                 // 4000 for Old, 6000 for New
  monthlyAvgRetail:  number;                 // avg retail units/month (last 3 months)
  retailLast3Months: number;                 // total retail units in last 3 months
  monthsActive:      number;                 // months since dealer was added
  eligibilityReason: string;                 // human-readable reason
}

export interface DealerStateCount {
  state:        string;
  eligibleOld:  number;   // dealers with avg >= 10 units AND active > 6 months
  eligibleNew:  number;   // dealers active < 6 months (new dealers)
  nonEligible:  number;   // dealers with avg < 10 units (not eligible for BTL)
  total:        number;
}

// ── Token helper ──────────────────────────────────────────────────────────────
async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

async function get<T>(path: string, instance: IPublicClientApplication): Promise<T> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} failed (${res.status})${text ? ": " + text : ""}`);
  }
  return res.json();
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** Full dealer list with RSM/TSM details */
export const fetchDealers = (instance: IPublicClientApplication) =>
  get<DealerOption[]>("/api/dealers", instance);

/** 3-month eligibility for a specific dealer */
export const fetchDealerEligibility = (
  customerCode: string,
  instance: IPublicClientApplication
) => get<DealerEligibility>(`/api/dealers/eligibility/${encodeURIComponent(customerCode)}`, instance);

/**
 * Per-state counts of eligible/non-eligible dealers from BaplFinal DB
 * Used by DashboardPage to populate the Non-Eligible column with real data
 */
export const fetchDealerStateCounts = (instance: IPublicClientApplication) =>
  get<DealerStateCount[]>("/api/dealers/state-counts", instance);
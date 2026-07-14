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
  commandoCode:  string | null;  // Sales Commando (DesignationId=26)
  commandoName:  string | null;
}

export interface CommandoOption {
  code:     string;
  name:     string;
  mobile:   string | null;
  location: string | null;
  zone:     string | null;
}

export interface DealerEligibility {
  dealerCode?:       string;
  customerCode?:     string;
  state?:            string;
  isEligible:        boolean;
  isNew?:            boolean;
  dealerType:        "Old" | "New";
  baseCacPerVehicle: number;   // normalized: from baseCac or baseCacPerVehicle
  eligibilityReason: string;   // normalized: from reason or eligibilityReason
  monthlyAvgRetail:  number;   // normalized: from avgRetails or monthlyAvgRetail
  avgRetails?:       number;
  retailLast3Months?: number;
  monthsActive?:      number;
  baseCac?:          number;
  reason?:           string;
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

/** All active Sales Commandos (DesignationId=26) for dropdown */
export const fetchCommandos = (instance: IPublicClientApplication) =>
  get<CommandoOption[]>("/api/dealers/commandos", instance);

/** 3-month eligibility for a specific dealer */
// Fetches dealer eligibility from DealerEligibilityController (uses DMS_SaleBill)
// Normalizes response to a consistent shape regardless of which endpoint responds
export async function fetchDealerEligibility(
  customerCode: string,
  instance: IPublicClientApplication
): Promise<DealerEligibility> {
  const raw = await get<Record<string, unknown>>(
    `/api/dealer-eligibility?dealerCode=${encodeURIComponent(customerCode)}`,
    instance
  );
  // DealerEligibilityDto shape: { dealerCode, isEligible, isNew, avgRetails, reason, baseCac, dealerType }
  // Normalize to common shape used by RSMForm
  return {
    ...raw,
    dealerCode:        String(raw.dealerCode        ?? raw.customerCode ?? customerCode),
    isEligible:        Boolean(raw.isEligible),
    dealerType:        (raw.dealerType as "Old" | "New") ?? "Old",
    baseCacPerVehicle: Number(raw.baseCac           ?? raw.baseCacPerVehicle ?? 4000),
    eligibilityReason: String(raw.reason            ?? raw.eligibilityReason ?? ""),
    monthlyAvgRetail:  Number(raw.avgRetails         ?? raw.monthlyAvgRetail  ?? 0),
    // keep originals too
    baseCac:           Number(raw.baseCac            ?? 4000),
    avgRetails:        Number(raw.avgRetails          ?? 0),
    reason:            String(raw.reason             ?? ""),
  } as DealerEligibility;
}

/**
 * Per-state counts of eligible/non-eligible dealers from BaplFinal DB
 * Used by DashboardPage to populate the Non-Eligible column with real data
 */
export const fetchDealerStateCounts = (instance: IPublicClientApplication) =>
  get<DealerStateCount[]>("/api/dealers/state-counts", instance);
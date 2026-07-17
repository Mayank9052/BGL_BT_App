// src/pages/RSMForm.tsx
// CHANGES:
//   1. RSM/TSM + Commando lock (LockedField) when dealer auto-filled
//   2. BGauss CAC + BGauss CPL in totals strip
//   3. CAC warning checks BGauss CAC against allowed limit
//   4. Sales % column — Retail auto-calculates and locks from Lead × Sales%
//   5. goToSummary BLOCKS if BGauss CAC exceeds allowed limit (red warning shown)

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchStates, fetchCitiesByState } from "../services/locationService";
import {
  fetchDealers, fetchDealerEligibility,
  type DealerOption, type DealerEligibility,
} from "../services/dealerService";
import {
  fetchActivityTypes, groupActivityTypes,
  type ActivityType, type ActivityGroup,
} from "../services/activityService";
import { fetchVendors, type VendorOption } from "../services/vendorService";
import SearchableSelect from "../components/SearchableSelect";
import type { StateOption, CityOption } from "../types/location";
// ── TEMPORARY: static RSM/TSM/Sales Commando lookup from the team-mapping CSV.
// Used only as a fallback source for these 3 fields until the dealer master API
// reliably returns them for every dealer. Remove this import + its usages below
// (they are clearly marked) once the backend is fixed — don't delete the old
// ERP-based logic, it stays commented out right next to the new lookup.
import { findDealerTeam } from "../data/dealerTeamMap";
import * as XLSX from "xlsx";
import "./RSMForm.css";
import {
  submitProposal, updateProposal, fetchProposalById, fetchProposalsByDealer,
  fetchActivityTypesUsed, uploadActivityMedia,
  type ProposalResponse,
} from "../services/proposalService";

const DEALER_TYPES         = ["Old", "New"];
const ELIGIBILITY_OPTIONS  = ["Eligible", "Not Eligible", "Pending Approval"];
const BGAUSS_SHARE_OPTIONS = ["100", "70", "50"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const CURRENT_MONTH = MONTHS[new Date().getMonth()];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(String);
const isoDate = (d: Date) => d.toISOString().split("T")[0];
const TODAY_ISO = isoDate(new Date());
const DEFAULT_END_ISO = isoDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
// ← no backdating to ANY past date (was Jan 1 of current year)
const MIN_ACTIVITY_DATE = TODAY_ISO;

interface ActivityRow {
  id: string; activityType: string; category: string;
  categoryLocked: boolean; subcategory: string; qty: string;
  leadTarget: string; salesPercent: string; retailTarget: string;
  retailLocked: boolean;
  startDate: string; endDate: string;
  budget: string; additionalBudget: string; bgaussShare: string;
  remarks: string; mediaFiles: MediaFile[]; _maxQty: number;
}
interface MediaFile { id: string; fileUrl: string; fileName: string; fileType: string; }
interface ProposalHeader {
  dealerId: string; dealerName: string; vendorId: string; vendorName: string;
  state: string; stateId: number | null; location: string; type: string;
  rsmName: string; tsmName: string; commandoName: string; month: string; year: string;
  eligibility: string; remarks: string;
}
interface FieldErrors {
  dealerName?: string; state?: string; location?: string; type?: string;
  rsmName?: string; month?: string; year?: string; eligibility?: string;
}
interface ActivityErrors {
  [rowId: string]: {
    activityType?: string; subcategory?: string; qty?: string;
    leadTarget?: string; retailTarget?: string;
    startDate?: string; endDate?: string; budget?: string;
  };
}

const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const inr = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const titleCase = (str: string): string =>
  (str ?? "").toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function generateDocNumber(): string {
  const now = new Date();
  return `BTL-${now.getFullYear().toString().slice(-2)}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${Math.floor(Math.random()*9000)+1000}`;
}
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}

function calcRetailFromSales(leadTarget: string, salesPercent: string): string {
  const lead = num(leadTarget);
  const pct  = num(salesPercent);
  if (!lead || !salesPercent.trim() || pct <= 0) return "";
  return String(Math.round(lead * pct / 100));
}

const emptyActivity = (): ActivityRow => ({
  id: crypto.randomUUID(), activityType: "", category: "", categoryLocked: false,
  subcategory: "", qty: "1", _maxQty: 5, leadTarget: "", salesPercent: "",
  retailTarget: "", retailLocked: false,
  startDate: TODAY_ISO, endDate: DEFAULT_END_ISO,          // ← auto Start=today, End=today+7 days
  budget: "", additionalBudget: "0",
  bgaussShare: "100", remarks: "", mediaFiles: [],
});
const emptyHeader = (): ProposalHeader => ({
  dealerId: "", dealerName: "", vendorId: "", vendorName: "",
  state: "", stateId: null, location: "", type: "",
  rsmName: "", tsmName: "", commandoName: "", month: CURRENT_MONTH, year: String(CURRENT_YEAR),
  eligibility: "", remarks: "",
});

function validateDetails(h: ProposalHeader): FieldErrors {
  const e: FieldErrors = {};
  if (!h.dealerName.trim())  e.dealerName  = "Dealer is required.";
  if (!h.state.trim())       e.state       = "State is required.";
  if (!h.location.trim())    e.location    = "City is required.";
  if (!h.type.trim())        e.type        = "Location type is required.";
  if (!h.month.trim())       e.month       = "Month is required.";
  if (!h.year.trim())        e.year        = "Year is required.";
  if (!h.eligibility.trim()) e.eligibility = "Eligibility is required.";
  return e;
}
function validateActivities(rows: ActivityRow[]): ActivityErrors {
  const e: ActivityErrors = {};
  rows.forEach((a) => {
    const rowErr: ActivityErrors[string] = {};
    if (!a.activityType.trim())                         rowErr.activityType = "Required";
    if (!a.leadTarget   || num(a.leadTarget)   <= 0)   rowErr.leadTarget   = "Required";
    if (!a.retailTarget || num(a.retailTarget) <= 0)   rowErr.retailTarget = "Required";
    if (!a.startDate)                                   rowErr.startDate    = "Required";
    if (!a.endDate)                                     rowErr.endDate      = "Required";
    if (a.startDate && a.endDate && a.endDate < a.startDate) rowErr.endDate = "End must be after start";
    // ── block dates before today (RSM cannot backdate) ──
    if (!rowErr.startDate && a.startDate < MIN_ACTIVITY_DATE) rowErr.startDate = "Cannot select a date in the past.";
    if (!rowErr.endDate   && a.endDate   < MIN_ACTIVITY_DATE) rowErr.endDate   = "Cannot select a date in the past.";
    if (!a.budget || num(a.budget) <= 0)               rowErr.budget       = "Required";
    if (Object.keys(rowErr).length) e[a.id] = rowErr;
  });
  return e;
}

const bgaussAmount = (budget: string, addBudget: string, share: string) =>
  Math.round((num(budget) + num(addBudget)) * (num(share || "100") / 100));

export default function RSMProposalForm() {
  const { instance, accounts } = useMsal();
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const account        = accounts[0];

  // ── Dealer user detection ─────────────────────────────────────────────────
  // When a dealer logs in (DealerJwt), their info is stored in localStorage.
  // isDealerUser=true → lock the Dealer dropdown to their own dealership.
  const dealerUser = (() => {
    try {
      const raw = localStorage.getItem("bgauss_dealer_user");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const isDealerUser = !!(dealerUser?.role === "Dealer");
  const xlsxRef        = useRef<HTMLInputElement>(null);

  const editId   = searchParams.get("edit");
  const editMode = !!editId;

  const [docNumber] = useState<string>(generateDocNumber);
  const [docDate]   = useState<string>(() => formatDate(new Date()));

  const [header,           setHeader]           = useState<ProposalHeader>(emptyHeader());
  const [activities,       setActivities]       = useState<ActivityRow[]>([emptyActivity()]);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitted,        setSubmitted]        = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [revisionNote,     setRevisionNote]     = useState<string | null>(null);
  const [loadingEdit,      setLoadingEdit]      = useState(false);
  const [dealerAutoFilled, setDealerAutoFilled] = useState(false);

  const [fieldErrors,    setFieldErrors]    = useState<FieldErrors>({});
  const [activityErrors, setActivityErrors] = useState<ActivityErrors>({});
  const [showDetailErr,  setShowDetailErr]  = useState(false);
  const [showActErr,     setShowActErr]     = useState(false);
  const [usedActivityTypes, setUsedActivityTypes] = useState<string[]>([]);

  const [states,        setStates]        = useState<StateOption[]>([]);
  const [cities,        setCities]        = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [stateLoadError, setStateLoadError] = useState<string | null>(null);
  const [cityLoadError,  setCityLoadError]  = useState<string | null>(null);
  const [dealers,        setDealers]        = useState<DealerOption[]>([]);
  const [loadingDealers, setLoadingDealers] = useState(false);
  const [dealerError,    setDealerError]    = useState<string | null>(null);
  const [vendors,        setVendors]        = useState<VendorOption[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [dealerHistory,  setDealerHistory]  = useState<ProposalResponse[]>([]);
  const [loadingDealerHistory, setLoadingDealerHistory] = useState(false);
  const [activityTypes,       setActivityTypes]       = useState<ActivityType[]>([]);
  const [activityGroups,      setActivityGroups]      = useState<ActivityGroup[]>([]);
  const [activityTypesLoaded, setActivityTypesLoaded] = useState(false);
  const [eligibility,        setEligibility]        = useState<DealerEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [cacWarning,         setCacWarning]         = useState<string | null>(null);
  const [cacBlocking,        setCacBlocking]        = useState(false); // true = red, blocks submit

  const [activeSection,   setActiveSection]   = useState<"details"|"activities"|"summary">("details");
  const [showDealerPanel, setShowDealerPanel] = useState(false);
  const [xlsxMsg,         setXlsxMsg]         = useState<{ok:boolean;text:string}|null>(null);
  const [xlsxAlert,       setXlsxAlert]       = useState<{unknownTypes:string[];skippedRows:number}|null>(null);
  const [uploadingMedia,  setUploadingMedia]  = useState<Record<string,boolean>>({});

  const selectedDealer = dealers.find((d) => d.customerCode === header.dealerId) ?? null;

  useEffect(() => {
    fetchStates(instance).then(setStates).catch(() => setStateLoadError("Could not load state list. Please refresh the page."));
  }, [instance]);
  useEffect(() => {
    setLoadingDealers(true);
    fetchDealers(instance).then(setDealers).catch(() => setDealerError("Could not load dealer list.")).finally(() => setLoadingDealers(false));
  }, [instance]);

  // ── Auto-select dealer for dealer-logged-in users once the list is ready ──
  useEffect(() => {
    if (!isDealerUser || !dealers.length || header.dealerId) return;
    const code = (dealerUser?.dealerCode as string | undefined);
    const name = (dealerUser?.dealerName as string | undefined)?.toLowerCase().trim();
    if (code) {
      handleDealerSelect(code);
    } else if (name) {
      const match = dealers.find((d) => d.customerName.toLowerCase().trim() === name);
      if (match) handleDealerSelect(match.customerCode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDealerUser, dealers]);

  useEffect(() => {
    setLoadingVendors(true);
    fetchVendors(instance).then(setVendors).catch(() => {}).finally(() => setLoadingVendors(false));
  }, [instance]);
  useEffect(() => {
    fetchActivityTypes(instance)
      .then((types) => { setActivityTypes(types); setActivityGroups(groupActivityTypes(types)); setActivityTypesLoaded(true); })
      .catch(() => setActivityTypesLoaded(true));
  }, [instance]);
  useEffect(() => {
    if (!header.dealerName || !header.month || editMode) { setUsedActivityTypes([]); return; }
    fetchActivityTypesUsed(header.dealerName, header.month, instance).then(setUsedActivityTypes).catch(() => setUsedActivityTypes([]));
  }, [header.dealerName, header.month, instance, editMode]);

  useEffect(() => {
    if (!editId) return;
    setLoadingEdit(true);
    fetchProposalById(editId, instance)
      .then((p) => {
        setHeader({
          dealerId: "", dealerName: titleCase(p.dealerName), vendorId: String(p.vendorId ?? ""),
          vendorName: p.vendorName ?? "", state: titleCase(p.state), stateId: null,
          location: titleCase(p.location), type: p.type, rsmName: titleCase(p.rsmName),
          tsmName:      titleCase(p.tsmName ?? p.commandoName ?? ""),
          commandoName: p.commandoName ?? "", month: p.month, year: String(CURRENT_YEAR), // backend has no Year field yet
          eligibility: p.eligibility, remarks: p.remarks ?? "",
        });
        setActivities(p.activities.map((a) => ({
          id: crypto.randomUUID(), activityType: a.activityType, category: a.category ?? "",
          categoryLocked: false, subcategory: (a as any).subcategory ?? "",
          qty: String((a as any).qty ?? 1), _maxQty: 20,
          leadTarget: String(a.leadTarget ?? 0),
          salesPercent: String((a as any).salesPercent ?? ""), retailTarget: String(a.retailTarget ?? 0),
          retailLocked: !!(a as any).salesPercent && num(String((a as any).salesPercent)) > 0,
          startDate: a.startDate?.split("T")[0] ?? "", endDate: a.endDate?.split("T")[0] ?? "",
          budget: String(a.budget), additionalBudget: String(a.additionalBudget ?? 0),
          bgaussShare: String(a.bgaussShare ?? 100), remarks: a.remarks ?? "",
          mediaFiles: (a.mediaFiles ?? []).map((m: any) => ({ id: m.id, fileUrl: m.fileUrl, fileName: m.fileName, fileType: m.fileType })),
        })));
        if (p.approverNote) setRevisionNote(p.approverNote);
        setDealerAutoFilled(false);
      })
      .catch(() => setError("Could not load proposal for editing."))
      .finally(() => setLoadingEdit(false));
  }, [editId, instance]);

  const totals = useMemo(() => {
    const totalBudget       = activities.reduce((s, a) => s + num(a.budget) + num(a.additionalBudget), 0);
    const totalLeadTarget   = activities.reduce((s, a) => s + num(a.leadTarget), 0);
    const totalRetailTarget = activities.reduce((s, a) => s + num(a.retailTarget), 0);
    const totalBgauss        = activities.reduce((s, a) => s + bgaussAmount(a.budget, a.additionalBudget, a.bgaussShare), 0);
    const totalAdditional    = activities.reduce((s, a) => s + num(a.additionalBudget), 0);
    const cac = totalRetailTarget > 0 ? totalBgauss / totalRetailTarget : 0;
    const cpl = totalLeadTarget   > 0 ? totalBgauss / totalLeadTarget   : 0;
    const hasSpecialApproval = totalAdditional > 0;
    return { totalBudget, totalLeadTarget, totalRetailTarget, totalBgauss, cac, cpl, hasSpecialApproval, totalAdditional };
  }, [activities]);
  const { totalBudget, totalLeadTarget, totalRetailTarget, totalBgauss, cac, cpl, hasSpecialApproval } = totals;

  // ── CAC warning — updates live as Budget / BGauss% / Retail change ────────
  useEffect(() => {
    if (!eligibility || (totals.totalLeadTarget === 0 && totals.totalRetailTarget === 0)) {
      setCacWarning(null); setCacBlocking(false); return;
    }
    if (cac > eligibility.baseCacPerVehicle) {
      if (hasSpecialApproval) {
        setCacWarning(
          `CAC ₹${Math.round(cac).toLocaleString("en-IN")} exceeds ` +
          `₹${eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle — ` +
          `Special Approval budget applied (₹${totals.totalAdditional.toLocaleString("en-IN")}). ` +
          `Proposal will be submitted for deviation approval.`
        );
        setCacBlocking(false);
      } else {
        setCacWarning(
          `CAC ₹${Math.round(cac).toLocaleString("en-IN")} exceeds allowed ` +
          `₹${eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle for ${eligibility.dealerType} dealer. ` +
          `Reduce budget or BGauss% or increase Retail target.`
        );
        setCacBlocking(true);
      }
    } else {
      setCacWarning(null);
      setCacBlocking(false);
    }
  }, [cac, totals.totalLeadTarget, totals.totalRetailTarget, eligibility]);

  const setField = (key: keyof ProposalHeader, value: string) => {
    setHeader((h) => ({ ...h, [key]: value }));
    if (fieldErrors[key as keyof FieldErrors])
      setFieldErrors((e) => { const n = { ...e }; delete n[key as keyof FieldErrors]; return n; });
  };

  const handleDealerSelect = (customerCode: string) => {
    const dealer = dealers.find((d) => d.customerCode === customerCode);
    setShowDealerPanel(false); setDealerHistory([]); setEligibility(null);
    setCacWarning(null); setCacBlocking(false); setUsedActivityTypes([]);
    setEligibilityLoading(false);
    setHeader(emptyHeader());
    setCities([]);
    setDealerAutoFilled(false);

    if (dealer) {
      setDealerAutoFilled(true);
      const csvTeam = findDealerTeam(dealer.customerCode, dealer.customerName);
      setHeader((h) => ({
        ...h,
        dealerId:      dealer.customerCode,
        dealerName:    titleCase(dealer.customerName),
        state:         titleCase(dealer.state ?? ""),
        stateId:       null,
        location:      titleCase(dealer.city ?? ""),
        // rsmName:       titleCase(dealer.rsmName ?? dealer.rsmCode ?? ""),        // ← OLD (ERP-based) — kept for reference, do not delete
        // tsmName:       titleCase(dealer.tsmName ?? dealer.tsmCode ?? ""),        // ← OLD (ERP-based) — kept for reference, do not delete
        // commandoName:  titleCase(dealer.commandoName ?? ""),                    // ← OLD (ERP-based) — kept for reference, do not delete
        rsmName:       titleCase(csvTeam?.rsm || dealer.rsmName || dealer.rsmCode || ""),
        tsmName:       titleCase(csvTeam?.tsm || dealer.tsmName || dealer.tsmCode || ""),
        commandoName:  titleCase(csvTeam?.commando || dealer.commandoName || ""),
        month:         h.month || CURRENT_MONTH,
        year:          h.year || String(CURRENT_YEAR),
        vendorId:      h.vendorId,
        vendorName:    h.vendorName,
      }));
      setFieldErrors((e) => { const n = { ...e }; delete n.dealerName; delete n.rsmName; return n; });
      setEligibilityLoading(true);
      fetchDealerEligibility(dealer.customerCode, instance)
        .then((elig) => {
          setEligibility(elig);
          setHeader((h) => ({ ...h, type: elig.dealerType, eligibility: elig.isEligible ? "Eligible" : "Not Eligible" }));
          setFieldErrors((e) => { const n = { ...e }; delete n.type; delete n.eligibility; return n; });
        })
        .catch(() => {}).finally(() => setEligibilityLoading(false));
      setLoadingDealerHistory(true);
      fetchProposalsByDealer(titleCase(dealer.customerName), instance)
        .then(setDealerHistory).catch(() => {}).finally(() => setLoadingDealerHistory(false));
    } else {
      setDealerAutoFilled(false);
      setHeader((h) => ({ ...h, dealerId:"", dealerName:"", state:"", stateId:null, location:"", rsmName:"", tsmName:"", commandoName:"", type:"", eligibility:"" }));
    }
  };

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id  = e.target.value ? Number(e.target.value) : null;
    const sel = states.find((s) => s.id === id) ?? null;
    setHeader((h) => ({ ...h, state: sel ? titleCase(sel.name) : "", stateId: id, location: "" }));
    setCities([]); setCityLoadError(null);
    if (fieldErrors.state) setFieldErrors((err) => { const n = { ...err }; delete n.state; return n; });
    if (id) {
      setLoadingCities(true);
      fetchCitiesByState(id, instance)
        .then(setCities)
        .catch(() => setCityLoadError("Could not load cities for this state."))
        .finally(() => setLoadingCities(false));
    }
  };

  const handleActivityNameChange = (rowId: string, activityName: string) => {
    const group = activityGroups.find((g) => g.activityName.toLowerCase() === activityName.toLowerCase());
    setActivities((rows) => rows.map((r) => r.id === rowId ? {
      ...r, activityType: activityName,
      category: group ? group.activityType : r.category,
      categoryLocked: !!group, subcategory: "", qty: "1",
      _maxQty: group?.subcategories?.[0]?.maxQty ?? 5,
    } : r));
    if (activityErrors[rowId]?.activityType)
      setActivityErrors((prev) => { const next = { ...prev }; if (next[rowId]) { next[rowId] = { ...next[rowId] }; delete next[rowId].activityType; if (!Object.keys(next[rowId]).length) delete next[rowId]; } return next; });
  };

  const handleSubcategoryChange = (rowId: string, activityName: string, subcategory: string) => {
    const group = activityGroups.find((g) => g.activityName.toLowerCase() === activityName.toLowerCase());
    const sub   = group?.subcategories.find((s) => s.subcategory === subcategory);
    setActivities((rows) => rows.map((r) => r.id === rowId ? { ...r, subcategory, qty: "1", _maxQty: sub?.maxQty ?? 5 } : r));
  };

  const setActivity = (id: string, key: keyof ActivityRow, value: string | MediaFile[]) => {
    setActivities((rows) => rows.map((r) => {
      if (r.id !== id) return r;
      const next: ActivityRow = { ...r, [key]: value } as ActivityRow;
      if (typeof value === "string" && (key === "leadTarget" || key === "salesPercent")) {
        const pctTrimmed = next.salesPercent.trim();
        if (pctTrimmed && num(pctTrimmed) > 0) {
          const computed = calcRetailFromSales(next.leadTarget, next.salesPercent);
          next.retailTarget = computed;
          next.retailLocked = true;
        } else {
          next.retailLocked = false;
        }
      }
      return next;
    }));
    if (typeof value === "string" && activityErrors[id]?.[key as keyof ActivityErrors[string]])
      setActivityErrors((prev) => { const next = { ...prev }; if (next[id]) { next[id] = { ...next[id] }; delete next[id][key as keyof ActivityErrors[string]]; if (!Object.keys(next[id]).length) delete next[id]; } return next; });
  };

  const addActivity    = () => setActivities((rows) => [...rows, emptyActivity()]);
  const removeActivity = (id: string) => {
    setActivities((rows) => rows.length > 1 ? rows.filter((r) => r.id !== id) : rows);
    setActivityErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleMediaUpload = async (activityId: string, files: FileList) => {
    setUploadingMedia((prev) => ({ ...prev, [activityId]: true }));
    try {
      const uploaded: MediaFile[] = [];
      for (const file of Array.from(files)) {
        const data = await uploadActivityMedia(file, instance);
        uploaded.push({ id: crypto.randomUUID(), fileUrl: data.url, fileName: data.fileName, fileType: data.fileType });
      }
      setActivities((rows) => rows.map((r) => r.id === activityId ? { ...r, mediaFiles: [...r.mediaFiles, ...uploaded] } : r));
    } catch { setXlsxMsg({ ok: false, text: "File upload failed. Please try again." }); }
    finally { setUploadingMedia((prev) => ({ ...prev, [activityId]: false })); }
  };

  const removeMedia = (activityId: string, mediaId: string) =>
    setActivities((rows) => rows.map((r) => r.id === activityId ? { ...r, mediaFiles: r.mediaFiles.filter((m) => m.id !== mediaId) } : r));

  const resetForm = useCallback(() => {
    setHeader(emptyHeader()); setActivities([emptyActivity()]); setCities([]);
    setShowDealerPanel(false); setRevisionNote(null); setDealerHistory([]);
    setFieldErrors({}); setActivityErrors({}); setShowDetailErr(false); setShowActErr(false);
    setEligibility(null); setCacWarning(null); setCacBlocking(false);
    setXlsxMsg(null); setXlsxAlert(null);
    setDealerAutoFilled(false); setUsedActivityTypes([]);
  }, []);

  const goToActivities = () => {
    if (eligibility && !eligibility.isEligible) {
      setFieldErrors({ dealerName: "This dealer is not eligible for BTL this month." });
      setShowDetailErr(true); window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    const errs = validateDetails(header);
    if (Object.keys(errs).length) { setFieldErrors(errs); setShowDetailErr(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setFieldErrors({}); setShowDetailErr(false);
    setActiveSection("activities"); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToSummary = () => {
    const errs = validateActivities(activities);
    if (Object.keys(errs).length) { setActivityErrors(errs); setShowActErr(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setActivityErrors({}); setShowActErr(false);
    if (eligibility && cac > eligibility.baseCacPerVehicle && totals.totalRetailTarget > 0 && !hasSpecialApproval) {
      setCacWarning(
        `CAC ₹${Math.round(cac).toLocaleString("en-IN")} exceeds allowed ` +
        `₹${eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle for ${eligibility.dealerType} dealer. ` +
        `Reduce budget or BGauss share, or increase Retail Target to proceed.`
      );
      setCacBlocking(true);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); return;
    }
    setActiveSection("summary"); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cellVal = (r: Record<string, unknown>, ...keys: string[]): string => {
    for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim(); }
    return "";
  };
  const parseExcelDate = (v: unknown): string => {
    if (!v && v !== 0) return "";
    if (typeof v === "number") {
      try { const p = XLSX.SSF.parse_date_code(v); if (p) return `${p.y}-${String(p.m).padStart(2,"0")}-${String(p.d).padStart(2,"0")}`; } catch {}
    }
    const str = String(v).trim(); if (!str) return "";
    const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) { const [,d,m,y] = dmyMatch; return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`; }
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return str.substring(0, 10);
    const native = new Date(str); if (!isNaN(native.getTime())) return native.toISOString().split("T")[0];
    return "";
  };
  const isSkippableRow = (rawType: string) =>
    !rawType || rawType.startsWith("[") || rawType.startsWith("Valid:") || rawType.toLowerCase() === "activity type";

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    setXlsxMsg(null); setXlsxAlert(null);
    const file = e.target.files?.[0];
    if (!file) { e.target.value = ""; return; }
    if (!activityTypesLoaded) { setXlsxMsg({ ok: false, text: "Activity types still loading — please wait." }); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = ev.target?.result; if (!result) { setXlsxMsg({ ok: false, text: "Could not read file." }); return; }
        const wb = XLSX.read(new Uint8Array(result as ArrayBuffer), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]]; if (!ws) { setXlsxMsg({ ok: false, text: "No sheet found." }); return; }
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (!rows.length) { setXlsxMsg({ ok: false, text: "File is empty." }); return; }
        const validNames = new Set(activityGroups.map((g) => g.activityName.trim().toLowerCase()));
        const realDataRows = rows.filter((r) => !isSkippableRow(cellVal(r, "Activity Name", "activityName")));
        if (realDataRows.length === 0) { setXlsxMsg({ ok: false, text: "No data rows found." }); return; }
        const unknownTypes: string[] = []; const validRows: typeof rows = [];
        rows.forEach((r) => {
          const rawName = cellVal(r, "Activity Name", "activityName");
          if (isSkippableRow(rawName)) return;
          const isKnown = validNames.size === 0 || validNames.has(rawName.toLowerCase());
          if (!isKnown) { if (!unknownTypes.includes(rawName)) unknownTypes.push(rawName); } else validRows.push(r);
        });
        const skippedCount = realDataRows.length - validRows.length;
        if (unknownTypes.length > 0) setXlsxAlert({ unknownTypes, skippedRows: skippedCount });
        if (validRows.length === 0) { setXlsxMsg({ ok: false, text: `No valid rows — ${unknownTypes.length} unknown type(s).` }); return; }
        const mapped: ActivityRow[] = validRows.map((r) => {
          const actName   = cellVal(r, "Activity Name", "activityName");
          const subcat    = cellVal(r, "Subcategory", "subcategory");
          const group     = activityGroups.find((g) => g.activityName.toLowerCase() === actName.toLowerCase());
          const sub       = group?.subcategories.find((s) => s.subcategory.toLowerCase() === subcat.toLowerCase());
          const shareRaw  = cellVal(r, "BGauss Share", "bgaussShare") || "100";
          const shareVal  = BGAUSS_SHARE_OPTIONS.includes(shareRaw) ? shareRaw : "100";
          const qtyRaw    = cellVal(r, "QTY", "qty") || "1";
          const leadRaw   = cellVal(r, "Lead Target", "leadTarget", "Target", "target");
          const salesPct  = cellVal(r, "Sales %", "Sales%", "salesPercent");
          const retailRaw = cellVal(r, "Retail Target", "retailTarget");
          const computedRetail = calcRetailFromSales(leadRaw, salesPct);
          return {
            id: crypto.randomUUID(), activityType: actName,
            category: group ? group.activityType : cellVal(r, "Category", "category"),
            categoryLocked: !!group, subcategory: subcat, qty: qtyRaw,
            _maxQty: sub?.maxQty ?? group?.subcategories?.[0]?.maxQty ?? 5,
            leadTarget: leadRaw, salesPercent: salesPct,
            retailTarget: computedRetail || retailRaw, retailLocked: !!computedRetail,
            startDate:        parseExcelDate(r["Start Date"] ?? r["startDate"] ?? ""),
            endDate:          parseExcelDate(r["End Date"]   ?? r["endDate"]   ?? ""),
            budget:           cellVal(r, "Budget", "budget"),
            additionalBudget: cellVal(r, "Additional Budget", "additionalBudget") || "0",
            bgaussShare: shareVal, remarks: cellVal(r, "Remarks", "remarks") || "",
            mediaFiles: [],
          };
        });
        setActivities(mapped); setActivityErrors({});
        const skippedMsg = skippedCount > 0 ? ` · ${skippedCount} row(s) skipped` : "";
        setXlsxMsg({ ok: true, text: `${mapped.length} row(s) imported${skippedMsg}.` });
      } catch { setXlsxMsg({ ok: false, text: "Could not parse the file. Please use the provided template." }); }
    };
    reader.onerror = () => setXlsxMsg({ ok: false, text: "Failed to read the file." });
    reader.readAsArrayBuffer(file); e.target.value = "";
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const actNames  = activityGroups.map((g) => g.activityName);
    const header = [
      "Activity Name", "Subcategory", "QTY", "Category (auto)",
      "Lead Target", "Sales %", "Retail Target",
      "Start Date", "End Date",
      "Budget", "Special Approval", "BGauss Share %", "Remarks",
    ];
    const hint = [
      "Select from dropdown", "Select from dropdown", "Select from dropdown", "Auto-filled from Activity Name",
      "Number", "e.g. 3 (optional, locks Retail)", "Number (or leave blank if using Sales %)",
      "dd-MM-yyyy", "dd-MM-yyyy",
      "₹ amount", "₹ additional budget (Special Approval — bypasses CAC limit)", "100 or 70 or 50", "Optional notes",
    ];
    const exampleRow = activityGroups[0]
      ? [
          activityGroups[0].activityName,
          activityGroups[0].subcategories?.[0]?.subcategory ?? "",
          "1",
          activityGroups[0].activityType,
          "20", "3", "",
          "01-07-2026", "31-07-2026",
          "50000", "0", "100", "Sample row",
        ]
      : [];

    const rows = [header, hint];
    if (exampleRow.length) rows.push(exampleRow);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      {wch:24},{wch:26},{wch:6},{wch:16},{wch:12},{wch:10},{wch:14},
      {wch:14},{wch:14},{wch:12},{wch:20},{wch:14},{wch:25},
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Activities");

    const refRows: (string | number)[][] = [
      ["=== Valid Activity Names ==="],
      ...actNames.map((n) => [n]),
      [""],
      ["=== Valid BGauss Share ==="],
      ["100"], ["70"], ["50"],
      [""],
      ["=== Date Format ==="],
      ["dd-MM-yyyy  (e.g. 15-07-2026)"],
    ];
    const wsRef = XLSX.utils.aoa_to_sheet(refRows);
    wsRef["!cols"] = [{wch:40}];
    XLSX.utils.book_append_sheet(wb, wsRef, "Valid Values");

    const subRows: string[][] = [["Activity Name", "Subcategory", "Max QTY"]];
    for (const g of activityGroups) {
      for (const s of (g.subcategories ?? [])) {
        subRows.push([g.activityName, s.subcategory, String(s.maxQty ?? 5)]);
      }
    }
    const wsSub = XLSX.utils.aoa_to_sheet(subRows);
    wsSub["!cols"] = [{wch:28},{wch:28},{wch:10}];
    XLSX.utils.book_append_sheet(wb, wsSub, "Subcategory List");

    XLSX.writeFile(wb, "BTL_Activity_Template.xlsx");
  };

  const handleSubmit = async () => {
    if (eligibility && cac > eligibility.baseCacPerVehicle && totals.totalRetailTarget > 0 && !hasSpecialApproval) {
      setCacBlocking(true);
      setCacWarning(`CAC ₹${Math.round(cac).toLocaleString("en-IN")} exceeds allowed ₹${eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle. Cannot submit.`);
      return;
    }
    const dErrs = validateDetails(header); const aErrs = validateActivities(activities);
    if (Object.keys(dErrs).length) { setFieldErrors(dErrs); setShowDetailErr(true); setActiveSection("details"); window.scrollTo({top:0,behavior:"smooth"}); return; }
    if (Object.keys(aErrs).length) { setActivityErrors(aErrs); setShowActErr(true); setActiveSection("activities"); window.scrollTo({top:0,behavior:"smooth"}); return; }
    setError(null); setSubmitting(true);
    try {
      const activityPayload = activities.map((a) => ({
        activityType: a.activityType, category: a.category || null,
        subcategory: a.subcategory || null, qty: num(a.qty) || 1,
        salesPercent: a.salesPercent.trim() ? parseFloat(a.salesPercent) : null,
        leadTarget: num(a.leadTarget), retailTarget: num(a.retailTarget),
        startDate: a.startDate, endDate: a.endDate,
        budget: num(a.budget), additionalBudget: num(a.additionalBudget),
        bgaussShare: num(a.bgaussShare) || 100, vendorId: null,
        remarks: a.remarks,
        mediaFiles: a.mediaFiles.map((m) => ({ fileUrl: m.fileUrl, fileName: m.fileName, fileType: m.fileType })),
      }));
      const payload = {
        state: header.state, location: header.location, type: header.type,
        dealerName: header.dealerName, dealerCode: header.dealerId || null,
        vendorId: header.vendorId ? Number(header.vendorId) : null, vendorName: header.vendorName || null,
        rsmName: header.rsmName, tsmName: header.tsmName, commandoName: header.commandoName || null,
        month: header.month, year: header.year, eligibility: header.eligibility, remarks: header.remarks,
        submittedBy: account?.username ?? null, docNumber: generateDocNumber(),
        activities: activityPayload,
        totalBudget, totalLeadTarget: Math.round(totalLeadTarget),
        totalRetailTarget: Math.round(totalRetailTarget), cac, cpl,
      };
      if (editMode && editId) await updateProposal(editId, payload as any, instance);
      else await submitProposal(payload as any, instance);
      resetForm(); setSubmitted(true);
      setTimeout(() => navigate("/dashboard"), 1800);
    } catch (ex) { setError(ex instanceof Error ? ex.message : "Something went wrong."); setSubmitting(false); }
  };

  const dealerOptions = dealers.map((d) => ({
    value: d.customerCode, label: titleCase(d.customerName),
    sublabel: [d.city, d.state].filter((v): v is string => v !== null).map(titleCase).join(", ")
  }));
  const vendorOptions = vendors.map((v) => ({ value: String(v.id), label: titleCase(v.vendorName) }));
  const rsmOptions = Array.from(new Map([
    ...dealers.filter((d) => d.rsmName || d.rsmCode).map((d) => { const val = d.rsmName ?? d.rsmCode!; return [titleCase(val), { value: val, label: titleCase(val) }] as [string, { value: string; label: string }]; }),
    ...dealers.filter((d) => d.tsmName || d.tsmCode).map((d) => { const val = d.tsmName ?? d.tsmCode!; return [titleCase(val), { value: val, label: titleCase(val) }] as [string, { value: string; label: string }]; }),
  ]).values()).sort((a, b) => a.label.localeCompare(b.label));
  const tsmOptions = Array.from(new Map(
    dealers.filter((d) => d.tsmName || d.tsmCode).map((d) => {
      const val = d.tsmName ?? d.tsmCode!;
      return [titleCase(val), { value: val, label: titleCase(val) }] as [string, { value: string; label: string }];
    })
  ).values()).sort((a, b) => a.label.localeCompare(b.label));

  const commandoOptions = Array.from(new Map(
    dealers.filter((d) => d.commandoName).map((d) => {
      const val = d.commandoName!;
      return [titleCase(val), { value: val, label: titleCase(val) }] as [string, { value: string; label: string }];
    })
  ).values()).sort((a, b) => a.label.localeCompare(b.label));
  const activityNameOptions = activityGroups.map((g) => ({ value: g.activityName, label: g.activityName }));
  const monthOptions        = MONTHS.map((m) => ({ value: m, label: m }));

  const fmtShort = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
  const statusCls = (s: string) => {
    if (s === "Approved")      return "rsm-history-status--approved";
    if (s === "Rejected")      return "rsm-history-status--rejected";
    if (s === "NeedsRevision") return "rsm-history-status--revision";
    return "rsm-history-status--pending";
  };

  const LockedField = ({ value }: { value: string }) => (
    <div style={{ display:"flex",alignItems:"center",gap:8,background:"#f8fafc",
      border:"1.5px solid #e2e8f0",borderRadius:7,padding:"8px 11px",height:38,
      fontSize:13,color:"#0a2540",minHeight:38 }}>
      <span style={{ flex:1 }}>{value || <span style={{ color:"#9ca3af" }}>—</span>}</span>
      <span style={{ fontSize:11,color:"#9ca3af" }} title="Auto-filled from dealer ERP data">🔒</span>
    </div>
  );

  if (loadingEdit) {
    return (
      <div className="rsm-page">
        <div style={{ display:"flex",justifyContent:"center",alignItems:"center",minHeight:"60vh" }}>
          <div style={{ textAlign:"center",color:"#64748b" }}>
            <div className="rsm-spinner"/>
            <p style={{ marginTop:12 }}>Loading proposal for editing…</p>
          </div>
        </div>
      </div>
    );
  }

  const CacWarningBanner = ({ style }: { style?: React.CSSProperties }) => {
    if (!cacWarning) return null;
    return (
      <div style={{
        background: cacBlocking ? "#fef2f2" : "#fefce8",
        border: `1px solid ${cacBlocking ? "#fecaca" : "#fde68a"}`,
        borderLeft: `4px solid ${cacBlocking ? "#ef4444" : "#f59e0b"}`,
        borderRadius: 8, padding: "10px 14px", fontSize: 13,
        color: cacBlocking ? "#991b1b" : "#92400e", fontWeight: 500,
        ...style,
      }}>
        {cacBlocking ? "🚫" : "⚠"} {cacWarning}
        {cacBlocking && (
          <div style={{ fontSize:12,fontWeight:400,marginTop:4,color:"#b91c1c" }}>
            Cannot proceed — please reduce budget, switch BGauss share to 70%/50%, or increase Retail Target.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rsm-page">
      <main className="rsm-main">

        {editMode && revisionNote && (
          <div className="rsm-revision-banner">
            <span className="rsm-revision-icon">↩</span>
            <div><strong>Revision requested:</strong><span style={{ marginLeft:8 }}>{revisionNote}</span></div>
          </div>
        )}

        {/* ════ SECTION 1 — Proposal Details ════ */}
        {activeSection === "details" && (
          <Card title="Proposal Details" subtitle="Fill in all required fields marked with *.">
            {showDetailErr && Object.keys(fieldErrors).length > 0 && (
              <div className="rsm-validation-banner">
                <span className="rsm-validation-icon">⚠</span>
                <div>
                  <strong>Please fill in all required fields before continuing.</strong>
                  <ul className="rsm-validation-list">
                    {Object.values(fieldErrors).map((msg, i) => <li key={i}>{msg}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {/* Row 1 — Dealer, Vendor, Month, Year */}
            <div className="rsm-form-row1" style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
              <div className="rsm-field">
                <Label text="Dealer" required/>
                {dealerError && !isDealerUser && (
                  <span className="rsm-field-error">{dealerError}</span>
                )}
                <div className="rsm-dealer-input-wrap">
                  <div style={{ flex:1, minWidth:0 }}>
                    {isDealerUser ? (
                      // Dealer user: locked to their own dealership — cannot select another
                      <div>
                        <LockedField value={
                          header.dealerName
                            ? `${header.dealerName}${header.state ? " · " + header.state : ""}`
                            : loadingDealers ? "Loading your dealer…" : "—"
                        }/>
                        {!header.dealerName && !loadingDealers && (
                          <span style={{ fontSize:11,color:"#f59e0b",marginTop:3,display:"block" }}>
                            ⚠ Your dealer account is not linked. Contact admin.
                          </span>
                        )}
                        <span style={{ fontSize:10,color:"#6b7280",marginTop:2,display:"block" }}>
                          🔒 Proposals can only be submitted for your own dealership
                        </span>
                      </div>
                    ) : editMode ? (
                      <input className={`rsm-select${fieldErrors.dealerName?" rsm-input--error":""}`}
                        value={header.dealerName} onChange={(e) => setField("dealerName", e.target.value)} placeholder="Dealer name"/>
                    ) : (
                      <div className={fieldErrors.dealerName?"rsm-select-error-wrap":""}>
                        <SearchableSelect options={dealerOptions} value={header.dealerId}
                          onChange={handleDealerSelect}
                          placeholder={loadingDealers?"Loading…":"Search dealer…"} loading={loadingDealers}/>
                      </div>
                    )}
                  </div>
                  {!editMode && !isDealerUser && header.dealerId && (
                    <button className="rsm-info-btn" title="View dealer details"
                      onClick={() => setShowDealerPanel((v) => !v)}>ⓘ</button>
                  )}
                </div>
                {fieldErrors.dealerName && (
                  <span className="rsm-field-error">{fieldErrors.dealerName}</span>
                )}
              </div>

              <div className="rsm-field">
                <Label text="Vendor"/>
                <SearchableSelect options={vendorOptions} value={header.vendorId}
                  onChange={(v) => { const vend = vendors.find((vn) => String(vn.id) === v); setHeader((h) => ({...h, vendorId:v, vendorName:vend?titleCase(vend.vendorName):""})); }}
                  placeholder={loadingVendors?"Loading…":"Select vendor (optional)"} loading={loadingVendors} allowCreate={false}/>
              </div>

              <div className="rsm-field">
                <Label text="Month" required/>
                <SearchableSelect options={monthOptions} value={header.month}
                  onChange={(v) => setField("month", v)} placeholder="Select month" allowCreate={false}
                  className={fieldErrors.month?"rsm-select-error-wrap":""}/>
                {fieldErrors.month && <span className="rsm-field-error">{fieldErrors.month}</span>}
              </div>

              {/* Year — auto-selects the current year */}
              <div className="rsm-field">
                <Label text="Year" required/>
                <select className={`rsm-select${fieldErrors.year?" rsm-input--error":""}`}
                  value={header.year} onChange={(e) => setField("year", e.target.value)}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                {fieldErrors.year && <span className="rsm-field-error">{fieldErrors.year}</span>}
              </div>
            </div>

            {/* Row 2 — State, City, Dealer Type, Eligibility */}
            <div className="rsm-form-row1" style={{ gridTemplateColumns:"repeat(4,1fr)", marginTop:0 }}>
              <div className="rsm-field">
                <Label text="State" required/>
                {dealerAutoFilled && !editMode ? <LockedField value={header.state}/> :
                header.state && !header.stateId ? (
                  <select className={`rsm-select${fieldErrors.state?" rsm-input--error":""}`}
                    value={header.stateId??""} onChange={handleStateChange}>
                    <option value="">{header.state} (dealer)</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{titleCase(s.name)}</option>)}
                  </select>
                ) : (
                  <select className={`rsm-select${fieldErrors.state?" rsm-input--error":""}`}
                    value={header.stateId??""} onChange={handleStateChange}>
                    <option value="">Select state</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{titleCase(s.name)}</option>)}
                  </select>
                )}
                {fieldErrors.state && <span className="rsm-field-error">{fieldErrors.state}</span>}
                {!dealerAutoFilled && stateLoadError && <span className="rsm-field-error">{stateLoadError}</span>}
              </div>

              <div className="rsm-field">
                <Label text="City" required/>
                {dealerAutoFilled && !editMode ? <LockedField value={header.location}/> :
                header.location && !header.stateId ? (
                  <input className={`rsm-select${fieldErrors.location?" rsm-input--error":""}`}
                    value={header.location} onChange={(e) => setField("location", e.target.value)} placeholder="City"/>
                ) : (
                  <select className={`rsm-select${fieldErrors.location?" rsm-input--error":""}`}
                    value={header.location} onChange={(e) => setField("location", e.target.value)}
                    disabled={!header.stateId || loadingCities}>
                    <option value="">{!header.stateId?"Select state first":loadingCities?"Loading…":"Select city"}</option>
                    {cities.map((c) => <option key={c.id} value={titleCase(c.name)}>{titleCase(c.name)}</option>)}
                  </select>
                )}
                {(fieldErrors.location || cityLoadError) && <span className="rsm-field-error">{fieldErrors.location || cityLoadError}</span>}
              </div>

              <div className="rsm-field">
                <Label text="Dealer Type" required/>
                {dealerAutoFilled && !editMode ? <LockedField value={header.type}/> : (
                  <select className={`rsm-select${fieldErrors.type?" rsm-input--error":""}`}
                    value={header.type} onChange={(e) => setField("type", e.target.value)}>
                    <option value="">{eligibilityLoading?"Loading…":"Select type"}</option>
                    {DEALER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                {fieldErrors.type && <span className="rsm-field-error">{fieldErrors.type}</span>}
              </div>

              <div className="rsm-field">
                <Label text="Eligibility" required/>
                {dealerAutoFilled && !editMode ? <LockedField value={header.eligibility}/> : (
                  <select className={`rsm-select${fieldErrors.eligibility?" rsm-input--error":""}`}
                    value={header.eligibility} onChange={(e) => setField("eligibility", e.target.value)}>
                    <option value="">{eligibilityLoading?"Checking…":"Select eligibility"}</option>
                    {ELIGIBILITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {fieldErrors.eligibility && <span className="rsm-field-error">{fieldErrors.eligibility}</span>}
              </div>
            </div>

            {!editMode && showDealerPanel && selectedDealer && (
              <div className="rsm-dealer-panel">
                <div className="rsm-dealer-panel-head">
                  <div>
                    <h3 className="rsm-dealer-panel-name">{titleCase(selectedDealer.customerName)}</h3>
                    <p className="rsm-dealer-panel-sub">Code: <b>{selectedDealer.customerCode}</b>&nbsp;·&nbsp;
                      {[selectedDealer.city, selectedDealer.state].filter((v): v is string => v !== null).map(titleCase).join(", ")}</p>
                  </div>
                  <button className="rsm-close-panel-btn" onClick={() => setShowDealerPanel(false)}>✕</button>
                </div>
                <div className="rsm-dealer-contacts">
                  {selectedDealer.contactPerson && <span className="rsm-dealer-contact">👤 {titleCase(selectedDealer.contactPerson)}</span>}
                  {selectedDealer.mobile        && <span className="rsm-dealer-contact">📞 {selectedDealer.mobile}</span>}
                  {!selectedDealer.rsmName && !selectedDealer.tsmName && (
                    <span className="rsm-dealer-contact" style={{ color:"#9ca3af" }}>No RSM/TSM assigned in ERP</span>
                  )}
                </div>
                <div className="rsm-dealer-history">
                  <p className="rsm-panel-section-title">Previous Proposals
                    {!loadingDealerHistory && dealerHistory.length > 0 && <span className="rsm-history-count">{dealerHistory.length}</span>}
                  </p>
                  {loadingDealerHistory && <div className="rsm-history-loading"><div className="rsm-spinner-sm"/><span>Loading…</span></div>}
                  {!loadingDealerHistory && dealerHistory.length === 0 && <p className="rsm-history-empty">No previous proposals.</p>}
                  {!loadingDealerHistory && dealerHistory.length > 0 && (
                    <div className="rsm-panel-table-wrap">
                      <table className="rsm-panel-table">
                        <thead><tr>
                          <th className="rsm-panel-th">Token</th><th className="rsm-panel-th">Month</th>
                          <th className="rsm-panel-th">RSM</th><th className="rsm-panel-th">Activities</th>
                          <th className="rsm-panel-th rsm-panel-th--right">Budget</th>
                          <th className="rsm-panel-th rsm-panel-th--right">Target</th>
                          <th className="rsm-panel-th">Status</th><th className="rsm-panel-th">Submitted</th>
                        </tr></thead>
                        <tbody>
                          {dealerHistory.map((p, i) => (
                            <tr key={p.id} className={i%2===0?"rsm-panel-row--even":"rsm-panel-row--odd"}>
                              <td className="rsm-panel-td"><span className="rsm-history-token">{p.tokenNumber ?? "—"}</span></td>
                              <td className="rsm-panel-td">{p.month}</td>
                              <td className="rsm-panel-td" style={{ whiteSpace:"nowrap" }}>{p.rsmName ? titleCase(p.rsmName) : "—"}</td>
                              <td className="rsm-panel-td">
                                {p.activities.slice(0,2).map((a,ai) => <span key={ai} className="rsm-history-chip">{a.activityType}</span>)}
                                {p.activities.length > 2 && <span className="rsm-history-chip rsm-history-chip--more">+{p.activities.length-2}</span>}
                              </td>
                              <td className="rsm-panel-td rsm-panel-td--right">₹{Math.round(p.totalBudget).toLocaleString("en-IN")}</td>
                              <td className="rsm-panel-td rsm-panel-td--right">{p.totalLeadTarget}</td>
                              <td className="rsm-panel-td"><span className={`rsm-history-status ${statusCls(p.status)}`}>{p.status==="NeedsRevision"?"Revision":p.status}</span></td>
                              <td className="rsm-panel-td" style={{ whiteSpace:"nowrap",fontSize:11 }}>{fmtShort(p.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {eligibilityLoading && <div className="rsm-elig-loading"><div className="rsm-spinner-sm"/><span>Checking eligibility…</span></div>}
            {!eligibilityLoading && eligibility && (
              <div className={`rsm-elig-banner ${eligibility.isEligible?"rsm-elig-banner--ok":"rsm-elig-banner--no"}`}>
                <span className="rsm-elig-icon">{eligibility.isEligible?"✓":"✕"}</span>
                <div style={{ flex:1 }}>
                  <strong>{eligibility.isEligible?"Eligible for BTL":"Not Eligible for BTL"}</strong>
                  <span style={{ marginLeft:8,fontWeight:400,fontSize:12 }}>{eligibility.eligibilityReason}</span>
                  {eligibility.isEligible && <span className="rsm-elig-cac">&nbsp;·&nbsp;Max BGauss CAC: ₹{eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle&nbsp;({eligibility.dealerType} dealer)</span>}
                </div>
              </div>
            )}

            {/* Row 3 — RSM Name, TSM Name, Commando Name */}
            <div className="rsm-form-row2" style={{ gridTemplateColumns:"repeat(3,1fr)" }}>
              <div className="rsm-field">
                <Label text="RSM Name"/>
                {dealerAutoFilled && !editMode ? (
                  <LockedField value={header.rsmName}/>
                ) : (
                  <SearchableSelect options={rsmOptions} value={header.rsmName}
                    onChange={(v) => setField("rsmName", v)} placeholder="Search or type…" allowCreate={true}
                    className={fieldErrors.rsmName?"rsm-select-error-wrap":""}/>
                )}
                {fieldErrors.rsmName && <span className="rsm-field-error">{fieldErrors.rsmName}</span>}
                {dealerAutoFilled && !editMode && header.rsmName && (
                  <span style={{ fontSize:10,color:"#6b7280",marginTop:2,display:"block" }}>
                    Auto-filled from ERP · <button type="button"
                      style={{ fontSize:10,color:"#2563eb",background:"none",border:"none",cursor:"pointer",padding:0 }}
                      onClick={() => setDealerAutoFilled(false)}>Edit manually</button>
                  </span>
                )}
              </div>
              <div className="rsm-field">
                <Label text="TSM Name"/>
                {dealerAutoFilled && !editMode ? (
                  header.tsmName
                    ? <LockedField value={header.tsmName}/>
                    : <div style={{ display:"flex",alignItems:"center",gap:8,background:"#f8fafc",
                        border:"1.5px solid #e2e8f0",borderRadius:7,padding:"8px 11px",height:38,fontSize:13 }}>
                        <span style={{ color:"#9ca3af",flex:1,fontSize:12 }}>Not assigned in ERP</span>
                        <span style={{ fontSize:11,color:"#e2e8f0" }}>🔒</span>
                      </div>
                ) : (
                  <SearchableSelect options={tsmOptions} value={header.tsmName}
                    onChange={(v) => setField("tsmName", v)} placeholder="Search or type…" allowCreate={true}/>
                )}
                {dealerAutoFilled && !editMode && header.tsmName && (
                  <span style={{ fontSize:10,color:"#6b7280",marginTop:2,display:"block" }}>
                    Auto-filled from ERP
                  </span>
                )}
              </div>
              <div className="rsm-field">
                <Label text="Commando Name"/>
                {dealerAutoFilled && !editMode ? (
                  header.commandoName
                    ? <LockedField value={header.commandoName}/>
                    : <div style={{ display:"flex",alignItems:"center",gap:8,background:"#f8fafc",
                        border:"1.5px solid #e2e8f0",borderRadius:7,padding:"8px 11px",height:38,fontSize:13 }}>
                        <span style={{ color:"#9ca3af",flex:1,fontSize:12 }}>Not assigned in ERP</span>
                        <span style={{ fontSize:11,color:"#e2e8f0" }}>🔒</span>
                      </div>
                ) : (
                  <SearchableSelect options={commandoOptions} value={header.commandoName}
                    onChange={(v) => setField("commandoName", v)} placeholder="Search or type…" allowCreate={true}/>
                )}
                {dealerAutoFilled && !editMode && header.commandoName && (
                  <span style={{ fontSize:10,color:"#6b7280",marginTop:2,display:"block" }}>
                    Auto-filled from ERP (Sales Commando)
                  </span>
                )}
              </div>
            </div>

            {/* Row 4 — Overall Remarks */}
            <div className="rsm-remarks-row">
              <Label text="Overall Remarks"/>
              <textarea className="rsm-textarea" placeholder="Additional notes for the approver…"
                value={header.remarks} onChange={(e) => setField("remarks", e.target.value)}/>
            </div>
            <div className="rsm-section-footer">
              <button className="rsm-primary-btn" onClick={goToActivities}>Continue to Activities →</button>
            </div>
          </Card>
        )}

        {/* ════ SECTION 2 — Activities ════ */}
        {activeSection === "activities" && (
          <Card title="Activity Plan"
            subtitle="Select Activity Name → Subcategory → QTY. Enter Sales % to auto-lock Retail Target."
            action={
              <div className="rsm-card-actions">
                <input ref={xlsxRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleExcelImport}/>
                <button className="rsm-tpl-btn" onClick={downloadTemplate} type="button">⬇ Template</button>
                <button className="rsm-xlsx-btn" type="button" onClick={() => xlsxRef.current?.click()} disabled={!activityTypesLoaded}>
                  {activityTypesLoaded?"📥 Import":"⏳ Loading…"}
                </button>
                <button className="rsm-add-row-btn" type="button" onClick={addActivity}>+ Add Activity</button>
              </div>
            }>

            {showActErr && Object.keys(activityErrors).length > 0 && (
              <div className="rsm-validation-banner">
                <span className="rsm-validation-icon">⚠</span>
                <div><strong>{Object.keys(activityErrors).length} row(s) have errors. Please fix before continuing.</strong></div>
              </div>
            )}

            {usedActivityTypes.length > 0 && !editMode && (
              <div style={{ background:"#fef9c3",border:"1px solid #fde68a",borderLeft:"3px solid #f59e0b",
                borderRadius:7,padding:"8px 14px",marginBottom:12,fontSize:12,color:"#92400e" }}>
                <strong>⚠ Already used this month for {header.dealerName}:</strong>
                <span style={{ marginLeft:8 }}>
                  {usedActivityTypes.map((t, i) => (
                    <span key={t} style={{ background:"#fef3c7",border:"1px solid #fde68a",borderRadius:4,padding:"1px 7px",marginLeft:i>0?4:0,fontWeight:600 }}>{t}</span>
                  ))}
                </span>
              </div>
            )}

            {xlsxMsg && <div className={`rsm-feedback ${xlsxMsg.ok?"rsm-feedback--ok":"rsm-feedback--err"}`}>{xlsxMsg.ok?"✓":"⚠"} {xlsxMsg.text}</div>}
            {xlsxAlert && xlsxAlert.unknownTypes.length > 0 && (
              <div className="rsm-xlsx-alert">
                <div className="rsm-xlsx-alert-head">
                  <span>⚠</span>
                  <strong>{xlsxAlert.skippedRows} row(s) skipped — unknown types:</strong>
                  <button className="rsm-xlsx-alert-close" onClick={() => setXlsxAlert(null)}>✕</button>
                </div>
                <div className="rsm-xlsx-alert-types">
                  {xlsxAlert.unknownTypes.map((t) => <span key={t} className="rsm-xlsx-unknown-chip">{t}</span>)}
                </div>
                <p className="rsm-xlsx-alert-hint">Ask admin to add these to Activity Master, then re-import.</p>
              </div>
            )}

            <div className="rsm-table-scroll">
              <table className="rsm-table">
                <thead>
                  <tr className="rsm-thead-row">
                    <th className="rsm-th" style={{ width:32 }}>#</th>
                    <th className="rsm-th" style={{ width:160 }}>Activity Name <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width:80 }}>Type<div style={{ fontSize:9,fontWeight:400,opacity:0.7 }}>ATL/BTL</div></th>
                    <th className="rsm-th" style={{ width:160 }}>Subcategory <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width:62 }}>QTY</th>
                    <th className="rsm-th" style={{ width:82 }}>Lead Target <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width:78 }}>Sales %</th>
                    <th className="rsm-th" style={{ width:82 }}>Retail Target <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width:120 }}>Start Date <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width:120 }}>End Date <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th rsm-th--right" style={{ width:100 }}>Budget (₹) <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th rsm-th--right" style={{ width:100 }}>Special Approval</th>
                    <th className="rsm-th" style={{ width:90 }}>BGauss%</th>
                    <th className="rsm-th rsm-th--right" style={{ width:100 }}>BGauss Amt</th>
                    <th className="rsm-th rsm-th--right" style={{ width:90 }}>Total (₹)</th>
                    <th className="rsm-th" style={{ width:110 }}>Remarks</th>
                    {/* <th className="rsm-th" style={{ width:80 }}>Files</th> */}
                    <th className="rsm-th" style={{ width:32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, idx) => {
                    const rowErr      = activityErrors[a.id];
                    const group       = activityGroups.find((g) => g.activityName.toLowerCase() === a.activityType.toLowerCase());
                    const subs        = group?.subcategories ?? [];
                    const selSub      = subs.find((s) => s.subcategory === a.subcategory);
                    const maxQty      = selSub?.maxQty ?? a._maxQty ?? 5;
                    const qtyOpts     = Array.from({ length: maxQty }, (_, i) => String(i + 1));
                    const alreadyUsed = !editMode && a.activityType && usedActivityTypes.some((u) => u.toLowerCase() === a.activityType.toLowerCase());
                    const rowTotal    = num(a.budget) + num(a.additionalBudget);
                    const bgAmt       = bgaussAmount(a.budget, a.additionalBudget, a.bgaussShare);
                    return (
                      <tr key={a.id} className={idx%2===0?"rsm-row--even":"rsm-row--odd"}>
                        <td className="rsm-td"><span className="rsm-row-num">{idx+1}</span></td>
                        <td className="rsm-td" style={{ minWidth:150 }}>
                          <SearchableSelect options={activityNameOptions} value={a.activityType}
                            onChange={(v) => handleActivityNameChange(a.id, v)}
                            placeholder="Select name…" allowCreate={false}
                            className={rowErr?.activityType||alreadyUsed?"rsm-select-error-wrap":""}/>
                          {rowErr?.activityType && <span className="rsm-field-error">{rowErr.activityType}</span>}
                          {alreadyUsed && !rowErr?.activityType && (
                            <span style={{ fontSize:10,color:"#92400e",background:"#fef9c3",border:"1px solid #fde68a",borderRadius:4,padding:"1px 6px",display:"inline-block",marginTop:2 }}>⚠ Already used this month</span>
                          )}
                        </td>
                        <td className="rsm-td">
                          {a.categoryLocked ? (
                            <div style={{ display:"flex",alignItems:"center",gap:4,background:a.category==="ATL"?"#eff6ff":"#f0fdf4",
                              border:`1.5px solid ${a.category==="ATL"?"#bfdbfe":"#bbf7d0"}`,borderRadius:6,padding:"4px 7px",
                              fontSize:11,fontWeight:700,color:a.category==="ATL"?"#1e40af":"#166534",minWidth:48,whiteSpace:"nowrap",height:30 }}>
                              {a.category}<span style={{ fontSize:9,color:"#9ca3af",marginLeft:"auto" }} title="Auto-filled">🔒</span>
                            </div>
                          ) : (
                            <select className="rsm-input-sm" style={{ width:68 }} value={a.category} onChange={(e) => setActivity(a.id,"category",e.target.value)}>
                              <option value="">—</option><option value="ATL">ATL</option><option value="BTL">BTL</option>
                            </select>
                          )}
                        </td>
                        <td className="rsm-td" style={{ minWidth:145 }}>
                          {subs.length > 0 ? (
                            <select className={`rsm-input-sm${rowErr?.subcategory?" rsm-input-sm--error":""}`} style={{ width:"100%" }}
                              value={a.subcategory} onChange={(e) => handleSubcategoryChange(a.id, a.activityType, e.target.value)}>
                              <option value="">Select subcategory…</option>
                              {subs.map((s) => <option key={s.subcategory} value={s.subcategory}>{s.subcategory}</option>)}
                            </select>
                          ) : (
                            <input type="text" className="rsm-input-sm" style={{ width:"100%" }}
                              placeholder={a.activityType?"Type subcategory…":"Select name first"}
                              value={a.subcategory} disabled={!a.activityType}
                              onChange={(e) => setActivity(a.id,"subcategory",e.target.value)}/>
                          )}
                        </td>
                        <td className="rsm-td">
                          <select className="rsm-input-sm" style={{ width:56 }} value={a.qty}
                            onChange={(e) => setActivity(a.id,"qty",e.target.value)}
                            disabled={!a.subcategory && subs.length > 0}>
                            {qtyOpts.map((q) => <option key={q} value={q}>{q}</option>)}
                          </select>
                        </td>
                        <td className="rsm-td">
                          <input type="number" min={0} className={`rsm-input-sm${rowErr?.leadTarget?" rsm-input-sm--error":""}`}
                            style={{ width:72 }} value={a.leadTarget} onChange={(e) => setActivity(a.id,"leadTarget",e.target.value)}/>
                          {rowErr?.leadTarget && <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.leadTarget}</span>}
                        </td>
                        <td className="rsm-td">
                          <input type="number" min={0} max={100} step="0.1" className="rsm-input-sm"
                            style={{ width:66 }} placeholder="e.g. 3"
                            value={a.salesPercent}
                            onChange={(e) => setActivity(a.id,"salesPercent",e.target.value)}/>
                        </td>
                        <td className="rsm-td">
                          {a.retailLocked ? (
                            <div title="Auto-calculated from Lead × Sales%"
                              style={{ display:"flex",alignItems:"center",gap:4,background:"#eff6ff",
                                border:"1.5px solid #bfdbfe",borderRadius:6,padding:"4px 7px",
                                fontSize:12,fontWeight:600,color:"#1e40af",width:72,height:30,justifyContent:"space-between" }}>
                              <span>{a.retailTarget || "0"}</span>
                              <span style={{ fontSize:9,color:"#93c5fd" }}>🔒</span>
                            </div>
                          ) : (
                            <input type="number" min={0} className={`rsm-input-sm${rowErr?.retailTarget?" rsm-input-sm--error":""}`}
                              style={{ width:72 }} value={a.retailTarget} onChange={(e) => setActivity(a.id,"retailTarget",e.target.value)}/>
                          )}
                          {rowErr?.retailTarget && <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.retailTarget}</span>}
                        </td>
                        <td className="rsm-td">
                          <input type="date" lang="en-GB" className={`rsm-input-sm${rowErr?.startDate?" rsm-input-sm--error":""}`}
                            style={{ width:112 }} value={a.startDate} min={MIN_ACTIVITY_DATE}
                            onChange={(e) => setActivity(a.id,"startDate",e.target.value)}/>
                          {rowErr?.startDate && <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.startDate}</span>}
                        </td>
                        <td className="rsm-td">
                          <input type="date" lang="en-GB" className={`rsm-input-sm${rowErr?.endDate?" rsm-input-sm--error":""}`}
                            style={{ width:112 }} value={a.endDate} min={a.startDate||MIN_ACTIVITY_DATE}
                            onChange={(e) => setActivity(a.id,"endDate",e.target.value)}/>
                          {rowErr?.endDate && <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.endDate}</span>}
                        </td>
                        <td className="rsm-td rsm-td--right">
                          <input type="number" min={0} className={`rsm-input-sm${rowErr?.budget?" rsm-input-sm--error":""}`}
                            style={{ width:90,textAlign:"right" }} value={a.budget} onChange={(e) => setActivity(a.id,"budget",e.target.value)}/>
                          {rowErr?.budget && <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.budget}</span>}
                        </td>
                        <td className="rsm-td rsm-td--right">
                          <input type="number" min={0} className="rsm-input-sm"
                            style={{ width:90,textAlign:"right" }} value={a.additionalBudget}
                            onChange={(e) => setActivity(a.id,"additionalBudget",e.target.value)}/>
                        </td>
                        <td className="rsm-td">
                          <select className="rsm-input-sm" style={{ width:76,padding:"4px 6px" }} value={a.bgaussShare}
                            onChange={(e) => setActivity(a.id,"bgaussShare",e.target.value)}>
                            {BGAUSS_SHARE_OPTIONS.map((o) => <option key={o} value={o}>{o}%</option>)}
                          </select>
                        </td>
                        <td className="rsm-td rsm-td--right">
                          <div style={{ fontSize:12,fontWeight:600,color:"#1e40af",background:"#eff6ff",border:"1px solid #bfdbfe",
                            borderRadius:6,padding:"5px 8px",textAlign:"right",whiteSpace:"nowrap",height:32,
                            display:"flex",alignItems:"center",justifyContent:"flex-end" }}>
                            ₹{inr(bgAmt)}
                          </div>
                        </td>
                        <td className="rsm-td rsm-td--total">₹{inr(rowTotal)}</td>
                        <td className="rsm-td">
                          <input type="text" className="rsm-input-sm" style={{ width:100 }}
                            placeholder="Note…" value={a.remarks} onChange={(e) => setActivity(a.id,"remarks",e.target.value)}/>
                        </td>
                        {/* <td className="rsm-td">
                          <label className="rsm-table-upload-btn">
                            {uploadingMedia[a.id] ? "⏳" : `📎${a.mediaFiles.length>0?" "+a.mediaFiles.length:""}`}
                            <input type="file" multiple accept="image/*,application/pdf,video/*" style={{ display:"none" }}
                              onChange={(e) => e.target.files && handleMediaUpload(a.id, e.target.files)}/>
                          </label>
                          {a.mediaFiles.length > 0 && (
                            <div className="rsm-table-media-list">
                              {a.mediaFiles.map((m) => {
                                const fullUrl = m.fileUrl.startsWith("http") ? m.fileUrl : `${import.meta.env.VITE_API_BASE_URL}${m.fileUrl}`;
                                return (
                                  <div key={m.id} className="rsm-table-media-chip">
                                    <a href={fullUrl} target="_blank" rel="noopener noreferrer" title={m.fileName}>
                                      {m.fileType.startsWith("image/")?"🖼":m.fileType.includes("pdf")?"📄":"🎬"}
                                    </a>
                                    <button type="button" onClick={() => removeMedia(a.id, m.id)}>✕</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td> */}
                        <td className="rsm-td">
                          <button className="rsm-remove-btn" onClick={() => removeActivity(a.id)}
                            disabled={activities.length===1} type="button">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="rsm-totals-strip">
              <TotalCell label="Activities"    value={String(activities.length)}/>
              <TotalCell label="Lead Target"   value={String(Math.round(totalLeadTarget))}/>
              <TotalCell label="Retail Target" value={String(Math.round(totalRetailTarget))}/>
              <TotalCell label="Total Budget"  value={`₹ ${inr(totalBudget)}`} accent/>
              <TotalCell label="BGauss Budget" value={`₹ ${inr(totalBgauss)}`} bgauss/>
              <TotalCell label="CAC"           value={`₹ ${cac.toLocaleString("en-IN",{maximumFractionDigits:0})}`} bgauss warn={cacBlocking}/>
              <TotalCell label="CPL"           value={`₹ ${cpl.toLocaleString("en-IN",{maximumFractionDigits:0})}`} bgauss/>
            </div>

            <CacWarningBanner style={{ marginTop:10 }}/>

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => { setActiveSection("details"); window.scrollTo({top:0,behavior:"smooth"}); }}>← Back</button>
              <button className="rsm-primary-btn" onClick={goToSummary} disabled={cacBlocking}
                title={cacBlocking?"Reduce BGauss budget or increase Retail target first":""}>
                {cacBlocking ? "CAC Exceeded — Fix First" : "Review & Submit →"}
              </button>
            </div>
          </Card>
        )}

        {/* ════ SECTION 3 — Review & Submit ════ */}
        {activeSection === "summary" && (
          <Card title="Review & Submit" subtitle="Confirm all details before sending for approval.">
            <div className="rsm-review-grid">
              <ReviewGroup title="Proposal Details">
                <ReviewRow label="Document No." value={docNumber} mono/>
                <ReviewRow label="Date"         value={docDate}/>
                <ReviewRow label="Dealer"       value={header.dealerName||"—"}/>
                {header.vendorName && <ReviewRow label="Vendor" value={header.vendorName}/>}
                <ReviewRow label="Location"     value={header.location?`${header.location}, ${header.state}`:"—"}/>
                <ReviewRow label="Type"         value={header.type||"—"}/>
                <ReviewRow label="Month"        value={header.month||"—"}/>
                <ReviewRow label="Year"         value={header.year||"—"}/>
                <ReviewRow label="Eligibility"  value={header.eligibility||"—"}/>
                <ReviewRow label="RSM Name"    value={header.rsmName||"—"}/>
                <ReviewRow label="TSM Name"    value={header.tsmName||"—"}/>
                <ReviewRow label="Commando"    value={header.commandoName||"—"}/>
                {header.remarks && <ReviewRow label="Remarks" value={header.remarks}/>}
              </ReviewGroup>
              <ReviewGroup title="Financial Summary">
                <ReviewRow label="Activities"    value={String(activities.length)}/>
                <ReviewRow label="Lead Target"   value={String(Math.round(totalLeadTarget))}/>
                <ReviewRow label="Retail Target" value={String(Math.round(totalRetailTarget))}/>
                <ReviewRow label="Total Budget"  value={`₹ ${inr(totalBudget)}`} highlight/>
                <ReviewRow label="BGauss Budget" value={`₹ ${inr(totalBgauss)}`}/>
                <ReviewRow label="CAC"            value={`₹ ${cac.toLocaleString("en-IN",{maximumFractionDigits:2})}`}/>
                <ReviewRow label="CPL"            value={`₹ ${cpl.toLocaleString("en-IN",{maximumFractionDigits:2})}`}/>
                {eligibility && <ReviewRow label="Allowed CAC" value={`₹ ${eligibility.baseCacPerVehicle.toLocaleString("en-IN")} (${eligibility.dealerType})`}/>}
              </ReviewGroup>
            </div>

            <p className="rsm-review-section-title">Activities ({activities.length})</p>
            <div className="rsm-table-scroll">
              <table className="rsm-table">
                <thead>
                  <tr className="rsm-thead-row">
                    <th className="rsm-th">#</th><th className="rsm-th">Activity Name</th>
                    <th className="rsm-th">Type</th><th className="rsm-th">Subcategory</th>
                    <th className="rsm-th">QTY</th><th className="rsm-th">Lead Target</th>
                    <th className="rsm-th">Sales %</th><th className="rsm-th">Retail Target</th>
                    <th className="rsm-th">Dates</th>
                    <th className="rsm-th rsm-th--right">Budget</th>
                    <th className="rsm-th rsm-th--right">BGauss%</th>
                    <th className="rsm-th rsm-th--right">BGauss Amt</th>
                    <th className="rsm-th rsm-th--right">Total</th>
                    <th className="rsm-th">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, i) => (
                    <tr key={a.id} className={i%2===0?"rsm-row--even":"rsm-row--odd"}>
                      <td className="rsm-td"><span className="rsm-row-num">{i+1}</span></td>
                      <td className="rsm-td">{a.activityType||"—"}</td>
                      <td className="rsm-td">
                        {a.category ? (
                          <span style={{ fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:4,
                            background:a.category==="ATL"?"#eff6ff":"#f0fdf4",
                            color:a.category==="ATL"?"#1e40af":"#166534" }}>{a.category}</span>
                        ) : "—"}
                      </td>
                      <td className="rsm-td">{a.subcategory||"—"}</td>
                      <td className="rsm-td" style={{ textAlign:"center",fontWeight:600 }}>{a.qty||"1"}</td>
                      <td className="rsm-td">{a.leadTarget||"—"}</td>
                      <td className="rsm-td">{a.salesPercent ? `${a.salesPercent}%` : "—"}</td>
                      <td className="rsm-td">
                        {a.retailTarget||"—"}
                        {a.retailLocked && <span style={{ marginLeft:4,fontSize:10,color:"#93c5fd" }} title="Auto-calculated">🔒</span>}
                      </td>
                      <td className="rsm-td">{a.startDate&&a.endDate?`${a.startDate} → ${a.endDate}`:a.startDate||"—"}</td>
                      <td className="rsm-td rsm-td--right">₹{inr(num(a.budget))}</td>
                      <td className="rsm-td rsm-td--right">{a.bgaussShare}%</td>
                      <td className="rsm-td rsm-td--right" style={{ color:"#1e40af",fontWeight:600 }}>
                        ₹{inr(bgaussAmount(a.budget,a.additionalBudget,a.bgaussShare))}
                      </td>
                      <td className="rsm-td rsm-td--total">₹{inr(num(a.budget)+num(a.additionalBudget))}</td>
                      <td className="rsm-td">{a.mediaFiles.length>0?`${a.mediaFiles.length} file(s)`:"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <CacWarningBanner style={{ marginTop:12 }}/>
            {submitted && <div className="rsm-success-banner">✓ Proposal {editMode?"resubmitted":"submitted"} — redirecting…</div>}
            {error     && <div className="rsm-error-banner">{error}</div>}

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => { setActiveSection("activities"); window.scrollTo({top:0,behavior:"smooth"}); }}>← Back</button>
              <button className="rsm-primary-btn" onClick={handleSubmit} disabled={submitting || cacBlocking}
                title={cacBlocking?"BGauss CAC exceeds limit — go back and fix":""}>
                {submitting ? "Submitting…" : cacBlocking ? "CAC Exceeded" : editMode ? "Resubmit for Approval" : "Submit for Approval"}
              </button>
            </div>
          </Card>
        )}

      </main>
    </div>
  );
}

function Card({ title, subtitle, children, action }: { title:string; subtitle?:string; children:React.ReactNode; action?:React.ReactNode }) {
  return (
    <div className="rsm-card">
      <div className="rsm-card-head">
        <div><h2 className="rsm-card-title">{title}</h2>{subtitle&&<p className="rsm-card-sub">{subtitle}</p>}</div>
        {action && <div>{action}</div>}
      </div>
      <div className="rsm-card-body">{children}</div>
    </div>
  );
}
function Label({ text, required }: { text:string; required?:boolean }) {
  return <label className="rsm-label">{text}{required&&<span className="rsm-label-req"> *</span>}</label>;
}
function ReviewGroup({ title, children }: { title:string; children:React.ReactNode }) {
  return <div className="rsm-review-group"><p className="rsm-review-group-title">{title}</p>{children}</div>;
}
function ReviewRow({ label, value, highlight, mono }: { label:string; value:string; highlight?:boolean; mono?:boolean }) {
  return (
    <div className="rsm-review-row">
      <span className="rsm-review-label">{label}</span>
      <span className={`rsm-review-value${highlight?" rsm-review-value--highlight":""}${mono?" rsm-review-value--mono":""}`}>{value}</span>
    </div>
  );
}
function TotalCell({ label, value, accent, bgauss, warn }: { label:string; value:string; accent?:boolean; bgauss?:boolean; warn?:boolean }) {
  return (
    <div className={`rsm-total-cell${accent?" rsm-total-cell--accent":""}${bgauss&&!warn?" rsm-total-cell--bgauss":""}${warn?" rsm-total-cell--warn":""}`}>
      <span className="rsm-total-label">{label}</span>
      <span className={`rsm-total-value${accent?" rsm-total-value--accent":""}${bgauss&&!warn?" rsm-total-value--bgauss":""}${warn?" rsm-total-value--warn":""}`}>{value}</span>
    </div>
  );
}
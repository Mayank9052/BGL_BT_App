import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate, useSearchParams } from "react-router-dom";
// import {
//   submitProposal, updateProposal, fetchProposalById, fetchProposalsByDealer,
//   type ProposalResponse,
// } from "../services/proposalService";
import { fetchStates, fetchCitiesByState } from "../services/locationService";
import {
  fetchDealers, fetchDealerEligibility,
  type DealerOption, type DealerEligibility,
} from "../services/dealerService";
import { fetchActivityTypes, type ActivityType } from "../services/activityService";
import { fetchVendors, type VendorOption } from "../services/vendorService";
import SearchableSelect from "../components/SearchableSelect";
import type { StateOption, CityOption } from "../types/location";
import * as XLSX from "xlsx";
import "./RSMForm.css";
import {
  submitProposal, updateProposal, fetchProposalById, fetchProposalsByDealer,
  uploadActivityMedia,
  type ProposalResponse,
} from "../services/proposalService";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEALER_TYPES        = ["Old", "New"];
const ELIGIBILITY_OPTIONS = ["Eligible", "Not Eligible", "Pending Approval"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const CURRENT_MONTH = MONTHS[new Date().getMonth()];

// ─── Types ────────────────────────────────────────────────────────────────────
interface ActivityRow {
  id:               string;
  activityType:     string;
  category:         string;
  leadTarget:       string;
  retailTarget:     string;
  startDate:        string;
  endDate:          string;
  budget:           string;
  additionalBudget: string;
  bgaussShare:      string;
  remarks:          string;
  mediaFiles:       MediaFile[];
}

interface MediaFile {
  id:       string;
  fileUrl:  string;
  fileName: string;
  fileType: string;
}

interface ProposalHeader {
  dealerId:     string;
  dealerName:   string;
  vendorId:     string;
  vendorName:   string;
  state:        string;
  stateId:      number | null;
  location:     string;
  type:         string;
  rsmName:      string;
  commandoName: string;
  month:        string;
  eligibility:  string;
  remarks:      string;
}

interface FieldErrors {
  dealerName?:  string;
  state?:       string;
  location?:    string;
  type?:        string;
  rsmName?:     string;
  month?:       string;
  eligibility?: string;
}

interface ActivityErrors {
  [rowId: string]: {
    activityType?: string;
    leadTarget?:   string;
    retailTarget?: string;
    startDate?:    string;
    endDate?:      string;
    budget?:       string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const inr = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

const titleCase = (str: string): string =>
  (str ?? "").toLowerCase().split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function generateDocNumber(): string {
  const now = new Date();
  const yy  = now.getFullYear().toString().slice(-2);
  const mm  = String(now.getMonth() + 1).padStart(2, "0");
  const dd  = String(now.getDate()).padStart(2, "0");
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `BTL-${yy}${mm}${dd}-${seq}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const emptyActivity = (): ActivityRow => ({
  id: crypto.randomUUID(), activityType: "", category: "",
  leadTarget: "", retailTarget: "",
  startDate: "", endDate: "",
  budget: "", additionalBudget: "", bgaussShare: "100",
  remarks: "", mediaFiles: [],
});

const emptyHeader = (): ProposalHeader => ({
  dealerId: "", dealerName: "", vendorId: "", vendorName: "",
  state: "", stateId: null, location: "", type: "",
  rsmName: "", commandoName: "", month: CURRENT_MONTH,
  eligibility: "", remarks: "",
});

// ─── Validation ───────────────────────────────────────────────────────────────
function validateDetails(h: ProposalHeader): FieldErrors {
  const e: FieldErrors = {};
  if (!h.dealerName.trim())  e.dealerName  = "Dealer is required.";
  if (!h.state.trim())       e.state       = "State is required.";
  if (!h.location.trim())    e.location    = "City is required.";
  if (!h.type.trim())        e.type        = "Location type is required.";
  if (!h.rsmName.trim())     e.rsmName     = "RSM / TSM name is required.";
  if (!h.month.trim())       e.month       = "Month is required.";
  if (!h.eligibility.trim()) e.eligibility = "Eligibility is required.";
  return e;
}

function validateActivities(rows: ActivityRow[]): ActivityErrors {
  const e: ActivityErrors = {};
  const typeCounts: Record<string, number> = {};
  rows.forEach((a) => {
    if (a.activityType) {
      typeCounts[a.activityType.toLowerCase()] =
        (typeCounts[a.activityType.toLowerCase()] ?? 0) + 1;
    }
  });

  rows.forEach((a) => {
    const rowErr: ActivityErrors[string] = {};
    if (!a.activityType.trim()) rowErr.activityType = "Required";
    else if ((typeCounts[a.activityType.toLowerCase()] ?? 0) > 1)
      rowErr.activityType = "Duplicate activity type in same proposal";
    if (!a.leadTarget   || num(a.leadTarget)   <= 0) rowErr.leadTarget   = "Required";
    if (!a.retailTarget || num(a.retailTarget) <= 0) rowErr.retailTarget = "Required";
    if (!a.startDate) rowErr.startDate = "Required";
    if (!a.endDate)   rowErr.endDate   = "Required";
    if (a.startDate && a.endDate && a.endDate < a.startDate)
      rowErr.endDate = "End must be after start";
    if (!a.budget || num(a.budget) <= 0) rowErr.budget = "Required";
    if (Object.keys(rowErr).length) e[a.id] = rowErr;
  });
  return e;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function RSMProposalForm() {
  const { instance, accounts } = useMsal();
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const account        = accounts[0];
  const xlsxRef        = useRef<HTMLInputElement>(null);

  const editId   = searchParams.get("edit");
  const editMode = !!editId;

  const [docNumber] = useState<string>(generateDocNumber);
  const [docDate]   = useState<string>(() => formatDate(new Date()));

  const [header,       setHeader]       = useState<ProposalHeader>(emptyHeader());
  const [activities,   setActivities]   = useState<ActivityRow[]>([emptyActivity()]);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitted,    setSubmitted]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const [loadingEdit,  setLoadingEdit]  = useState(false);

  const [fieldErrors,    setFieldErrors]    = useState<FieldErrors>({});
  const [activityErrors, setActivityErrors] = useState<ActivityErrors>({});
  const [showDetailErr,  setShowDetailErr]  = useState(false);
  const [showActErr,     setShowActErr]     = useState(false);

  const [states,        setStates]        = useState<StateOption[]>([]);
  const [cities,        setCities]        = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [dealers,        setDealers]        = useState<DealerOption[]>([]);
  const [loadingDealers, setLoadingDealers] = useState(false);
  const [dealerError,    setDealerError]    = useState<string | null>(null);

  const [vendors,        setVendors]        = useState<VendorOption[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);

  const [dealerHistory,        setDealerHistory]        = useState<ProposalResponse[]>([]);
  const [loadingDealerHistory, setLoadingDealerHistory] = useState(false);

  const [activityTypes,       setActivityTypes]       = useState<ActivityType[]>([]);
  const [activityTypesLoaded, setActivityTypesLoaded] = useState(false);

  const [eligibility,        setEligibility]        = useState<DealerEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [cacWarning,         setCacWarning]         = useState<string | null>(null);

  const [activeSection,   setActiveSection]   = useState<"details" | "activities" | "summary">("details");
  const [showDealerPanel, setShowDealerPanel] = useState(false);
  const [xlsxMsg,         setXlsxMsg]         = useState<{ ok: boolean; text: string } | null>(null);
  const [xlsxAlert,       setXlsxAlert]       = useState<{ unknownTypes: string[]; skippedRows: number } | null>(null);
  const [uploadingMedia,  setUploadingMedia]  = useState<Record<string, boolean>>({});

  const selectedDealer = dealers.find((d) => d.customerCode === header.dealerId) ?? null;

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStates(instance).then(setStates).catch(() => setLocationError("Could not load states."));
  }, [instance]);

  useEffect(() => {
    setLoadingDealers(true);
    fetchDealers(instance).then(setDealers)
      .catch(() => setDealerError("Could not load dealer list."))
      .finally(() => setLoadingDealers(false));
  }, [instance]);

  useEffect(() => {
    setLoadingVendors(true);
    fetchVendors(instance).then(setVendors)
      .catch(() => {})
      .finally(() => setLoadingVendors(false));
  }, [instance]);

  useEffect(() => {
    fetchActivityTypes(instance)
      .then((types) => { setActivityTypes(types); setActivityTypesLoaded(true); })
      .catch(() => setActivityTypesLoaded(true));
  }, [instance]);

  // ── Edit mode load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editId) return;
    setLoadingEdit(true);
    fetchProposalById(editId, instance)
      .then((p) => {
        setHeader({
          dealerId:     "",
          dealerName:   titleCase(p.dealerName),
          vendorId:     String(p.vendorId ?? ""),
          vendorName:   p.vendorName ?? "",
          state:        titleCase(p.state),
          stateId:      null,
          location:     titleCase(p.location),
          type:         p.type,
          rsmName:      titleCase(p.rsmName),
          commandoName: titleCase(p.commandoName),
          month:        p.month,
          eligibility:  p.eligibility,
          remarks:      p.remarks ?? "",
        });
        setActivities(p.activities.map((a) => ({
          id:               crypto.randomUUID(),
          activityType:     a.activityType,
          category:         a.category ?? "",
          leadTarget:       String(a.leadTarget ?? 0),
          retailTarget:     String(a.retailTarget ?? 0),
          startDate:        a.startDate?.split("T")[0] ?? "",
          endDate:          a.endDate?.split("T")[0]   ?? "",
          budget:           String(a.budget),
          additionalBudget: String(a.additionalBudget ?? 0),
          bgaussShare:      String(a.bgaussShare ?? 100),
          remarks:          a.remarks ?? "",
          mediaFiles:       (a.mediaFiles ?? []).map((m: any) => ({
            id: m.id, fileUrl: m.fileUrl, fileName: m.fileName, fileType: m.fileType,
          })),
        })));
        if (p.approverNote) setRevisionNote(p.approverNote);
      })
      .catch(() => setError("Could not load proposal for editing."))
      .finally(() => setLoadingEdit(false));
  }, [editId, instance]);

  // ── Computed totals ───────────────────────────────────────────────────────
  const { totalBudget, totalLeadTarget, totalRetailTarget, cpl, cac } = useMemo(() => {
    const totalBudget       = activities.reduce((s, a) => s + num(a.budget) + num(a.additionalBudget), 0);
    const totalLeadTarget   = activities.reduce((s, a) => s + num(a.leadTarget), 0);
    const totalRetailTarget = activities.reduce((s, a) => s + num(a.retailTarget), 0);
    const cpl = totalLeadTarget   > 0 ? totalBudget / totalLeadTarget   : 0;
    const cac = totalRetailTarget > 0 ? totalBudget / totalRetailTarget : 0;
    return { totalBudget, totalLeadTarget, totalRetailTarget, cpl, cac };
  }, [activities]);

  // ── Live CAC/CPL warning ──────────────────────────────────────────────────
  useEffect(() => {
    if (!eligibility || (totalLeadTarget === 0 && totalRetailTarget === 0)) {
      setCacWarning(null); return;
    }
    const limit = eligibility.baseCacPerVehicle;
    if (cac > limit) {
      setCacWarning(
        `CAC ₹${Math.round(cac).toLocaleString("en-IN")} exceeds allowed ` +
        `₹${limit.toLocaleString("en-IN")}/vehicle for ${eligibility.dealerType} dealer. ` +
        `Adjust budget or request deviation approval.`
      );
    } else {
      setCacWarning(null);
    }
  }, [cac, cpl, totalLeadTarget, totalRetailTarget, eligibility]);

  const setField = (key: keyof ProposalHeader, value: string) => {
    setHeader((h) => ({ ...h, [key]: value }));
    if (fieldErrors[key as keyof FieldErrors]) {
      setFieldErrors((e) => { const n = { ...e }; delete n[key as keyof FieldErrors]; return n; });
    }
  };

  // ── Dealer select ─────────────────────────────────────────────────────────
  const handleDealerSelect = (customerCode: string) => {
    const dealer = dealers.find((d) => d.customerCode === customerCode);
    setShowDealerPanel(false); setDealerHistory([]); setEligibility(null); setCacWarning(null);

    if (dealer) {
      setHeader((h) => ({
        ...h,
        dealerId:     dealer.customerCode,
        dealerName:   titleCase(dealer.customerName),
        state:        titleCase(dealer.state   ?? ""),
        stateId:      null,
        location:     titleCase(dealer.city    ?? ""),
        rsmName:      titleCase(dealer.rsmName ?? dealer.rsmCode ?? ""),
        commandoName: titleCase(dealer.tsmName ?? dealer.tsmCode ?? ""),
      }));
      setCities([]);
      setFieldErrors((e) => { const n = { ...e }; delete n.dealerName; return n; });

      setEligibilityLoading(true);
      fetchDealerEligibility(dealer.customerCode, instance)
        .then((elig) => {
          setEligibility(elig);
          setHeader((h) => ({
            ...h,
            type:        elig.dealerType,
            eligibility: elig.isEligible ? "Eligible" : "Not Eligible",
          }));
          setFieldErrors((e) => { const n = { ...e }; delete n.type; delete n.eligibility; return n; });
        })
        .catch(() => {})
        .finally(() => setEligibilityLoading(false));

      setLoadingDealerHistory(true);
      fetchProposalsByDealer(titleCase(dealer.customerName), instance)
        .then(setDealerHistory).catch(() => {})
        .finally(() => setLoadingDealerHistory(false));
    } else {
      setHeader((h) => ({ ...h, dealerId: "", dealerName: "", state: "", stateId: null, location: "", rsmName: "", commandoName: "" }));
    }
  };

  // ── State change ──────────────────────────────────────────────────────────
  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id  = e.target.value ? Number(e.target.value) : null;
    const sel = states.find((s) => s.id === id) ?? null;
    setHeader((h) => ({ ...h, state: sel ? titleCase(sel.name) : "", stateId: id, location: "" }));
    setCities([]); setLocationError(null);
    if (fieldErrors.state) setFieldErrors((err) => { const n = { ...err }; delete n.state; return n; });
    if (id) {
      setLoadingCities(true);
      fetchCitiesByState(id, instance).then(setCities)
        .catch(() => setLocationError("Could not load cities."))
        .finally(() => setLoadingCities(false));
    }
  };

  // ── Activity helpers ──────────────────────────────────────────────────────
  const setActivity = (id: string, key: keyof ActivityRow, value: string) => {
    setActivities((rows) => rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    if (activityErrors[id]?.[key as keyof ActivityErrors[string]]) {
      setActivityErrors((prev) => {
        const next = { ...prev };
        if (next[id]) {
          next[id] = { ...next[id] };
          delete next[id][key as keyof ActivityErrors[string]];
          if (!Object.keys(next[id]).length) delete next[id];
        }
        return next;
      });
    }
  };

  const addActivity    = () => setActivities((rows) => [...rows, emptyActivity()]);
  const removeActivity = (id: string) => {
    setActivities((rows) => rows.length > 1 ? rows.filter((r) => r.id !== id) : rows);
    setActivityErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  // ── Media upload for activity ─────────────────────────────────────────────
  const handleMediaUpload = async (activityId: string, files: FileList) => {
    setUploadingMedia((prev) => ({ ...prev, [activityId]: true }));
    try {
      const uploaded: MediaFile[] = [];
      for (const file of Array.from(files)) {
        const data = await uploadActivityMedia(file, instance);
        uploaded.push({
          id: crypto.randomUUID(),
          fileUrl: data.url,
          fileName: data.fileName,
          fileType: data.fileType,
        });
      }
      setActivities((rows) => rows.map((r) =>
        r.id === activityId
          ? { ...r, mediaFiles: [...r.mediaFiles, ...uploaded] }
          : r
      ));
    } catch (err) {
      console.error("Media upload failed:", err);
      setXlsxMsg({ ok: false, text: "File upload failed. Please try again." });
    } finally {
      setUploadingMedia((prev) => ({ ...prev, [activityId]: false }));
    }
  };

  const removeMedia = (activityId: string, mediaId: string) => {
    setActivities((rows) => rows.map((r) =>
      r.id === activityId
        ? { ...r, mediaFiles: r.mediaFiles.filter((m) => m.id !== mediaId) }
        : r
    ));
  };

  const resetForm = useCallback(() => {
    setHeader(emptyHeader()); setActivities([emptyActivity()]); setCities([]);
    setShowDealerPanel(false); setRevisionNote(null); setDealerHistory([]);
    setFieldErrors({}); setActivityErrors({}); setShowDetailErr(false); setShowActErr(false);
    setEligibility(null); setCacWarning(null); setXlsxMsg(null); setXlsxAlert(null);
  }, []);

  // ── Step navigation ───────────────────────────────────────────────────────
  const goToActivities = () => {
    if (eligibility && !eligibility.isEligible) {
      setFieldErrors({ dealerName: "This dealer is not eligible for BTL this month." });
      setShowDetailErr(true); window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    const errs = validateDetails(header);
    if (Object.keys(errs).length) {
      setFieldErrors(errs); setShowDetailErr(true);
      window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    setFieldErrors({}); setShowDetailErr(false);
    setActiveSection("activities"); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToSummary = () => {
    const errs = validateActivities(activities);
    if (Object.keys(errs).length) {
      setActivityErrors(errs); setShowActErr(true);
      window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    setActivityErrors({}); setShowActErr(false);
    setActiveSection("summary"); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToSection = (key: "details" | "activities" | "summary") => {
    if (key === "details") { setActiveSection("details"); return; }
    if (key === "activities") {
      if (activeSection === "details") { goToActivities(); return; }
      setActiveSection("activities"); return;
    }
    if (key === "summary") {
      if (activeSection === "details") {
        const errs = validateDetails(header);
        if (Object.keys(errs).length) { setFieldErrors(errs); setShowDetailErr(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
        const aErrs = validateActivities(activities);
        if (Object.keys(aErrs).length) { setActiveSection("activities"); setActivityErrors(aErrs); setShowActErr(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      }
      if (activeSection === "activities") { goToSummary(); return; }
      setActiveSection("summary");
    }
  };

  // ── Excel helpers ─────────────────────────────────────────────────────────
  const cellVal = (r: Record<string, unknown>, ...keys: string[]): string => {
    for (const k of keys) {
      const v = r[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  const parseExcelDate = (v: unknown): string => {
    if (!v && v !== 0) return "";
    if (typeof v === "number") {
      try {
        const parsed = XLSX.SSF.parse_date_code(v);
        if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      } catch { /* fall through */ }
    }
    const str = String(v).trim();
    if (!str) return "";
    const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyMatch) { const [, d, m, y] = dmyMatch; return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; }
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return str.substring(0, 10);
    const native = new Date(str);
    if (!isNaN(native.getTime())) return native.toISOString().split("T")[0];
    return "";
  };

  const isSkippableRow = (rawType: string): boolean => {
    if (!rawType) return true;
    if (rawType.startsWith("[") || rawType.startsWith("Valid:")) return true;
    if (rawType.toLowerCase() === "activity type") return true;
    return false;
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    setXlsxMsg(null); setXlsxAlert(null);
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = "";
      return;
    }
    if (!activityTypesLoaded) {
      setXlsxMsg({ ok: false, text: "Activity types still loading — please wait a moment and try again." });
      e.target.value = ""; return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const result = ev.target?.result;
        if (!result) {
          setXlsxMsg({ ok: false, text: "Could not read the file." });
          return;
        }
        const wb   = XLSX.read(new Uint8Array(result as ArrayBuffer), { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        if (!ws) {
          setXlsxMsg({ ok: false, text: "No sheet found in this file." });
          return;
        }
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (!rows.length) { setXlsxMsg({ ok: false, text: "File is empty." }); return; }

        const validTypes = new Set(activityTypes.map((t) => t.activityName.trim().toLowerCase()));
        const realDataRows = rows.filter((r) => !isSkippableRow(cellVal(r, "Activity Type", "activityType")));
        if (realDataRows.length === 0) {
          setXlsxMsg({ ok: false, text: "No data rows found. Please fill in the Activity Type column and re-import." });
          return;
        }

        const unknownTypes: string[] = [];
        const validRows: typeof rows = [];

        rows.forEach((r) => {
          const rawType = cellVal(r, "Activity Type", "activityType", "activity_type");
          if (isSkippableRow(rawType)) return;
          const isKnown = validTypes.size === 0 || validTypes.has(rawType.toLowerCase());
          if (!isKnown) { if (!unknownTypes.includes(rawType)) unknownTypes.push(rawType); }
          else validRows.push(r);
        });

        const skippedCount = realDataRows.length - validRows.length;
        if (unknownTypes.length > 0) setXlsxAlert({ unknownTypes, skippedRows: skippedCount });
        if (validRows.length === 0) {
          setXlsxMsg({ ok: false, text: `No valid rows — ${unknownTypes.length} unknown type(s). Add to Activity Master first.` });
          return;
        }

        const mapped: ActivityRow[] = validRows.map((r) => ({
          id:               crypto.randomUUID(),
          activityType:     cellVal(r, "Activity Type", "activityType"),
          category:         cellVal(r, "Category", "category"),
          leadTarget:       cellVal(r, "Lead Target", "leadTarget", "Target", "target"),
          retailTarget:     cellVal(r, "Retail Target", "retailTarget"),
          startDate:        parseExcelDate(r["Start Date"] ?? r["startDate"] ?? ""),
          endDate:          parseExcelDate(r["End Date"]   ?? r["endDate"]   ?? ""),
          budget:           cellVal(r, "Budget", "budget"),
          additionalBudget: cellVal(r, "Additional Budget", "additionalBudget", "Incentive", "incentive") || "0",
          bgaussShare:      cellVal(r, "BGauss Share", "bgaussShare") || "100",
          remarks:          cellVal(r, "Remarks", "remarks") || "",
          mediaFiles:       [],
        }));

        setActivities(mapped); setActivityErrors({});
        const skippedMsg = skippedCount > 0 ? ` · ${skippedCount} row(s) skipped (unknown types)` : "";
        setXlsxMsg({ ok: true, text: `${mapped.length} row(s) imported successfully${skippedMsg}.` });
      } catch (err) {
        console.error("Excel import error:", err);
        setXlsxMsg({ ok: false, text: "Could not parse the file. Please use the provided template." });
      }
    };
    reader.onerror = () => {
      setXlsxMsg({ ok: false, text: "Failed to read the file." });
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const validTypeNames = activityTypes.length > 0
      ? activityTypes.map((t) => t.activityName)
      : ["Test Drive Camp", "Canopy Activity", "Road Show"];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Activity Type","Category","Lead Target","Retail Target","Start Date","End Date","Budget","Additional Budget","BGauss Share","Remarks"],
      ["", "", "", "", `Valid types: ${validTypeNames.join(" | ")}`, "Format: dd-MM-yyyy", "", "", "100", ""],
      [validTypeNames[0] ?? "Test Drive Camp", "Digital", "10", "5", "01-07-2025", "31-07-2025", "50000", "5000", "100", "Sample activity"],
    ]);
    ws["!cols"] = [
      {wch:30},{wch:15},{wch:12},{wch:14},{wch:14},{wch:14},{wch:12},{wch:18},{wch:14},{wch:25},
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Activities");
    XLSX.writeFile(wb, "BTL_Activity_Template.xlsx");
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const dErrs = validateDetails(header);
    const aErrs = validateActivities(activities);
    if (Object.keys(dErrs).length) {
      setFieldErrors(dErrs); setShowDetailErr(true); setActiveSection("details");
      window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    if (Object.keys(aErrs).length) {
      setActivityErrors(aErrs); setShowActErr(true); setActiveSection("activities");
      window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    setError(null); setSubmitting(true);
    try {
      const activityPayload = activities.map((a) => ({
        activityType:     a.activityType,
        category:         a.category || null,
        leadTarget:       num(a.leadTarget),
        retailTarget:     num(a.retailTarget),
        startDate:        a.startDate,
        endDate:          a.endDate,
        budget:           num(a.budget),
        additionalBudget: num(a.additionalBudget),
        bgaussShare:      num(a.bgaussShare) || 100,
        remarks:          a.remarks,
        mediaFiles: a.mediaFiles.map((m) => ({
          fileUrl:  m.fileUrl,
          fileName: m.fileName,
          fileType: m.fileType,
        })),
      }));

      const payload = {
        state:              header.state,
        location:           header.location,
        type:               header.type,
        dealerName:         header.dealerName,
        vendorId:           header.vendorId ? Number(header.vendorId) : null,
        vendorName:         header.vendorName || null,
        rsmName:            header.rsmName,
        commandoName:       header.commandoName,
        month:              header.month,
        eligibility:        header.eligibility,
        remarks:            header.remarks,
        submittedBy:        account?.username ?? null,
        docNumber,
        activities:         activityPayload,
        totalBudget,
        totalLeadTarget:    Math.round(totalLeadTarget),
        totalRetailTarget:  Math.round(totalRetailTarget),
        cac,
        cpl,
      };

      if (editMode && editId) {
        await updateProposal(editId, payload as any, instance);
      } else {
        await submitProposal(payload as any, instance);
      }
      resetForm(); setSubmitted(true);
      setTimeout(() => navigate("/dashboard"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  // ── Dropdown options ──────────────────────────────────────────────────────
  const dealerOptions = dealers.map((d) => ({
    value:    d.customerCode,
    label:    titleCase(d.customerName),
    sublabel: [d.city, d.state].filter((v): v is string => v !== null).map(titleCase).join(", "),
  }));

  const vendorOptions = vendors.map((v) => ({
    value: String(v.id),
    label: titleCase(v.vendorName),
  }));

  const rsmOptions = Array.from(
    new Map([
      ...dealers.filter((d) => d.rsmName || d.rsmCode).map((d) => {
        const val = d.rsmName ?? d.rsmCode!;
        return [titleCase(val), { value: val, label: titleCase(val) }] as [string, { value: string; label: string }];
      }),
      ...dealers.filter((d) => d.tsmName || d.tsmCode).map((d) => {
        const val = d.tsmName ?? d.tsmCode!;
        return [titleCase(val), { value: val, label: titleCase(val) }] as [string, { value: string; label: string }];
      }),
    ]).values()
  ).sort((a, b) => a.label.localeCompare(b.label));

  const commandoOptions = Array.from(
    new Map(
      dealers.filter((d) => d.tsmName || d.tsmCode).map((d) => {
        const val = d.tsmName ?? d.tsmCode!;
        return [titleCase(val), { value: val, label: titleCase(val) }] as [string, { value: string; label: string }];
      })
    ).values()
  ).sort((a, b) => a.label.localeCompare(b.label));

  const activityOptions = activityTypes.length > 0
    ? activityTypes.map((t) => ({ value: t.activityName, label: titleCase(t.activityName) }))
    : ["Test Drive Camp","Canopy Activity","Mela / Exhibition","Road Show",
       "Digital Campaign","Influencer Activity","Corporate Connect",
       "Society Activation","Referral Program","Other"].map((t) => ({ value: t, label: t }));

  const monthOptions = MONTHS.map((m) => ({ value: m, label: m }));

  const detailsComplete    = Object.keys(validateDetails(header)).length === 0;
  const activitiesComplete = Object.keys(validateActivities(activities)).length === 0;

  const stepCircleClass = (key: string, done: boolean) => {
    if (done) return "rsm-step-circle rsm-step-circle--done";
    if (activeSection === key) return "rsm-step-circle rsm-step-circle--active";
    return "rsm-step-circle rsm-step-circle--pending";
  };

  const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const statusCls = (s: string) => {
    if (s === "Approved")      return "rsm-history-status--approved";
    if (s === "Rejected")      return "rsm-history-status--rejected";
    if (s === "NeedsRevision") return "rsm-history-status--revision";
    return "rsm-history-status--pending";
  };

  if (loadingEdit) {
    return (
      <div className="rsm-page">
        <div style={{ display:"flex", justifyContent:"center", alignItems:"center", minHeight:"60vh" }}>
          <div style={{ textAlign:"center", color:"#64748b" }}>
            <div className="rsm-spinner" />
            <p style={{ marginTop: 12 }}>Loading proposal for editing…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rsm-page">
      <main className="rsm-main">

        {/* Document banner */}
        <div className="rsm-doc-banner">
          <div>
            <div className="rsm-doc-tag">{editMode ? "Revision" : "New Proposal"}</div>
            <h1 className="rsm-doc-title">
              {editMode ? "Edit & Resubmit Proposal" : "Activity Proposal Form"}
            </h1>
            <p className="rsm-doc-sub">
              {editMode
                ? "Update your proposal as requested by the reviewer and resubmit."
                : "Submit a marketing or sales activity plan for management approval."}
            </p>
          </div>
          <div className="rsm-doc-meta">
            <DocMeta label="Document No." value={docNumber} mono />
            <DocMeta label="Date"          value={docDate} />
            <DocMeta label="Submitted by"  value={account?.name ?? "—"} />
            <div className={`rsm-draft-badge${editMode ? " rsm-draft-badge--revision" : ""}`}>
              <span className="rsm-draft-dot" />
              {editMode ? "Revision" : "Draft"}
            </div>
          </div>
        </div>

        {/* Revision note */}
        {editMode && revisionNote && (
          <div className="rsm-revision-banner">
            <span className="rsm-revision-icon">↩</span>
            <div>
              <strong>Revision requested by reviewer:</strong>
              <span style={{ marginLeft: 8 }}>{revisionNote}</span>
            </div>
          </div>
        )}

        {/* Step bar */}
        <div className="rsm-step-bar">
          {([
            { key: "details",    label: "Proposal Details", n: 1, done: detailsComplete },
            { key: "activities", label: "Activities",        n: 2, done: activitiesComplete && detailsComplete },
            { key: "summary",    label: "Review & Submit",   n: 3, done: false },
          ] as const).map(({ key, label, n, done }) => (
            <button key={key} className="rsm-step-btn" onClick={() => goToSection(key)}>
              <div className={stepCircleClass(key, done)}>{done ? "✓" : n}</div>
              <span className={`rsm-step-label${activeSection === key ? " rsm-step-label--active" : ""}`}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* ════════ SECTION 1 — Proposal Details ════════ */}
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

            {/* Row 1: Dealer · Vendor · State */}
            <div className="rsm-form-row1" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>

              {/* Dealer */}
              <div className="rsm-field">
                <Label text="Dealer" required />
                {dealerError && <span className="rsm-field-error">{dealerError}</span>}
                <div className="rsm-dealer-input-wrap">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editMode ? (
                      <input
                        className={`rsm-select${fieldErrors.dealerName ? " rsm-input--error" : ""}`}
                        value={header.dealerName}
                        onChange={(e) => setField("dealerName", e.target.value)}
                        placeholder="Dealer name"
                      />
                    ) : (
                      <div className={fieldErrors.dealerName ? "rsm-select-error-wrap" : ""}>
                        <SearchableSelect
                          options={dealerOptions}
                          value={header.dealerId}
                          onChange={handleDealerSelect}
                          placeholder={loadingDealers ? "Loading…" : "Search dealer…"}
                          loading={loadingDealers}
                        />
                      </div>
                    )}
                  </div>
                  {!editMode && header.dealerId && (
                    <button className="rsm-info-btn" title="View dealer details & history"
                      onClick={() => setShowDealerPanel((v) => !v)}>ⓘ</button>
                  )}
                </div>
                {fieldErrors.dealerName && (
                  <span className="rsm-field-error">{fieldErrors.dealerName}</span>
                )}
              </div>

              {/* Vendor */}
              <div className="rsm-field">
                <Label text="Vendor" />
                <SearchableSelect
                  options={vendorOptions}
                  value={header.vendorId}
                  onChange={(v) => {
                    const vend = vendors.find((vn) => String(vn.id) === v);
                    setHeader((h) => ({ ...h, vendorId: v, vendorName: vend ? titleCase(vend.vendorName) : "" }));
                  }}
                  placeholder={loadingVendors ? "Loading…" : "Select vendor (optional)"}
                  loading={loadingVendors}
                  allowCreate={false}
                />
              </div>

              {/* State */}
              <div className="rsm-field">
                <Label text="State" required />
                {header.state && !header.stateId ? (
                  <select
                    className={`rsm-select${fieldErrors.state ? " rsm-input--error" : ""}`}
                    value={header.stateId ?? ""} onChange={handleStateChange}>
                    <option value="">{header.state} (dealer)</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{titleCase(s.name)}</option>)}
                  </select>
                ) : (
                  <select
                    className={`rsm-select${fieldErrors.state ? " rsm-input--error" : ""}`}
                    value={header.stateId ?? ""} onChange={handleStateChange}>
                    <option value="">Select state</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{titleCase(s.name)}</option>)}
                  </select>
                )}
                {fieldErrors.state && <span className="rsm-field-error">{fieldErrors.state}</span>}
              </div>
            </div>

            <div className="rsm-form-row1" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginTop: 0 }}>
              {/* City */}
              <div className="rsm-field">
                <Label text="City" required />
                {header.location && !header.stateId ? (
                  <input
                    className={`rsm-select${fieldErrors.location ? " rsm-input--error" : ""}`}
                    value={header.location}
                    onChange={(e) => setField("location", e.target.value)}
                    placeholder="City" />
                ) : (
                  <select
                    className={`rsm-select${fieldErrors.location ? " rsm-input--error" : ""}`}
                    value={header.location}
                    onChange={(e) => setField("location", e.target.value)}
                    disabled={!header.stateId || loadingCities}>
                    <option value="">
                      {!header.stateId ? "Select state first" : loadingCities ? "Loading…" : "Select city"}
                    </option>
                    {cities.map((c) => <option key={c.id} value={titleCase(c.name)}>{titleCase(c.name)}</option>)}
                  </select>
                )}
                {(fieldErrors.location || locationError) && (
                  <span className="rsm-field-error">{fieldErrors.location || locationError}</span>
                )}
              </div>

              {/* Dealer Type */}
              <div className="rsm-field">
                <Label text="Dealer Type" required />
                <select
                  className={`rsm-select${fieldErrors.type ? " rsm-input--error" : ""}`}
                  value={header.type} onChange={(e) => setField("type", e.target.value)}>
                  <option value="">{eligibilityLoading ? "Loading…" : "Select type"}</option>
                  {DEALER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {fieldErrors.type && <span className="rsm-field-error">{fieldErrors.type}</span>}
              </div>
            </div>

            {/* Dealer info panel */}
            {!editMode && showDealerPanel && selectedDealer && (
              <div className="rsm-dealer-panel">
                <div className="rsm-dealer-panel-head">
                  <div>
                    <h3 className="rsm-dealer-panel-name">{titleCase(selectedDealer.customerName)}</h3>
                    <p className="rsm-dealer-panel-sub">
                      Code: <b>{selectedDealer.customerCode}</b>&nbsp;·&nbsp;
                      {[selectedDealer.city, selectedDealer.state]
                        .filter((v): v is string => v !== null).map(titleCase).join(", ")}
                    </p>
                  </div>
                  <button className="rsm-close-panel-btn" onClick={() => setShowDealerPanel(false)}>✕</button>
                </div>
                <div className="rsm-dealer-contacts">
                  {selectedDealer.contactPerson && <span className="rsm-dealer-contact">👤 {titleCase(selectedDealer.contactPerson)}</span>}
                  {selectedDealer.mobile        && <span className="rsm-dealer-contact">📞 {selectedDealer.mobile}</span>}
                  {selectedDealer.tsmName       && <span className="rsm-dealer-contact">🧑‍💼 TSM: {titleCase(selectedDealer.tsmName)}</span>}
                  {selectedDealer.rsmName       && <span className="rsm-dealer-contact">👔 RSM: {titleCase(selectedDealer.rsmName)}</span>}
                </div>
                <div className="rsm-dealer-history">
                  <p className="rsm-panel-section-title">
                    Previous Proposals
                    {!loadingDealerHistory && dealerHistory.length > 0 && (
                      <span className="rsm-history-count">{dealerHistory.length}</span>
                    )}
                  </p>
                  {loadingDealerHistory && <div className="rsm-history-loading"><div className="rsm-spinner-sm" /><span>Loading…</span></div>}
                  {!loadingDealerHistory && dealerHistory.length === 0 && <p className="rsm-history-empty">No previous proposals.</p>}
                  {!loadingDealerHistory && dealerHistory.length > 0 && (
                    <div className="rsm-panel-table-wrap">
                      <table className="rsm-panel-table">
                        <thead>
                          <tr>
                            <th className="rsm-panel-th">Token</th>
                            <th className="rsm-panel-th">Month</th>
                            <th className="rsm-panel-th">RSM</th>
                            <th className="rsm-panel-th">Activities</th>
                            <th className="rsm-panel-th rsm-panel-th--right">Budget</th>
                            <th className="rsm-panel-th rsm-panel-th--right">Target</th>
                            <th className="rsm-panel-th">Status</th>
                            <th className="rsm-panel-th">Submitted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dealerHistory.map((p, i) => (
                            <tr key={p.id} className={i % 2 === 0 ? "rsm-panel-row--even" : "rsm-panel-row--odd"}>
                              <td className="rsm-panel-td"><span className="rsm-history-token">{p.tokenNumber ?? "—"}</span></td>
                              <td className="rsm-panel-td">{p.month}</td>
                              <td className="rsm-panel-td" style={{ whiteSpace:"nowrap" }}>{p.rsmName ? titleCase(p.rsmName) : "—"}</td>
                              <td className="rsm-panel-td">
                                {p.activities.slice(0, 2).map((a, ai) => <span key={ai} className="rsm-history-chip">{a.activityType}</span>)}
                                {p.activities.length > 2 && <span className="rsm-history-chip rsm-history-chip--more">+{p.activities.length - 2}</span>}
                              </td>
                              <td className="rsm-panel-td rsm-panel-td--right">₹{Math.round(p.totalBudget).toLocaleString("en-IN")}</td>
                              <td className="rsm-panel-td rsm-panel-td--right">{p.totalLeadTarget}</td>
                              <td className="rsm-panel-td">
                                <span className={`rsm-history-status ${statusCls(p.status)}`}>
                                  {p.status === "NeedsRevision" ? "Revision" : p.status}
                                </span>
                              </td>
                              <td className="rsm-panel-td" style={{ whiteSpace:"nowrap", fontSize:11 }}>{fmtShort(p.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Eligibility banner */}
            {eligibilityLoading && (
              <div className="rsm-elig-loading"><div className="rsm-spinner-sm" /><span>Checking eligibility from ERP…</span></div>
            )}
            {!eligibilityLoading && eligibility && (
              <div className={`rsm-elig-banner ${eligibility.isEligible ? "rsm-elig-banner--ok" : "rsm-elig-banner--no"}`}>
                <span className="rsm-elig-icon">{eligibility.isEligible ? "✓" : "✕"}</span>
                <div style={{ flex: 1 }}>
                  <strong>{eligibility.isEligible ? "Eligible for BTL" : "Not Eligible for BTL"}</strong>
                  <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>{eligibility.eligibilityReason}</span>
                  {eligibility.isEligible && (
                    <span className="rsm-elig-cac">
                      &nbsp;·&nbsp;Max CAC: ₹{eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle
                      &nbsp;({eligibility.dealerType} dealer)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Row 2: RSM · Commando · Month · Eligibility */}
            <div className="rsm-form-row2">
              <div className="rsm-field">
                <Label text="RSM / TSM Name" required />
                <SearchableSelect options={rsmOptions} value={header.rsmName}
                  onChange={(v) => setField("rsmName", v)} placeholder="Search or type…" allowCreate={true}
                  className={fieldErrors.rsmName ? "rsm-select-error-wrap" : ""} />
                {fieldErrors.rsmName && <span className="rsm-field-error">{fieldErrors.rsmName}</span>}
              </div>
              <div className="rsm-field">
                <Label text="Commando Name" />
                <SearchableSelect options={commandoOptions} value={header.commandoName}
                  onChange={(v) => setField("commandoName", v)} placeholder="Search or type…" allowCreate={true} />
              </div>
              <div className="rsm-field">
                <Label text="Month" required />
                <SearchableSelect options={monthOptions} value={header.month}
                  onChange={(v) => setField("month", v)} placeholder="Select month" allowCreate={false}
                  className={fieldErrors.month ? "rsm-select-error-wrap" : ""} />
                {fieldErrors.month && <span className="rsm-field-error">{fieldErrors.month}</span>}
              </div>
              <div className="rsm-field">
                <Label text="Eligibility" required />
                <select className={`rsm-select${fieldErrors.eligibility ? " rsm-input--error" : ""}`}
                  value={header.eligibility} onChange={(e) => setField("eligibility", e.target.value)}>
                  <option value="">{eligibilityLoading ? "Checking…" : "Select eligibility"}</option>
                  {ELIGIBILITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {fieldErrors.eligibility && <span className="rsm-field-error">{fieldErrors.eligibility}</span>}
              </div>
            </div>

            {/* Remarks */}
            <div className="rsm-remarks-row">
              <Label text="Overall Remarks" />
              <textarea className="rsm-textarea" placeholder="Additional notes for the approver…"
                value={header.remarks} onChange={(e) => setField("remarks", e.target.value)} />
            </div>

            <div className="rsm-section-footer">
              <button className="rsm-primary-btn" onClick={goToActivities}>Continue to Activities →</button>
            </div>
          </Card>
        )}

        {/* ════════ SECTION 2 — Activities ════════ */}
        {activeSection === "activities" && (
          <Card
            title="Activity Plan"
            subtitle="Add at least one activity. All starred fields are required."
            action={
              <div className="rsm-card-actions">
                <input ref={xlsxRef} type="file" accept=".xlsx,.xls"
                  style={{ display: "none" }} onChange={handleExcelImport} />
                <button className="rsm-tpl-btn" onClick={downloadTemplate} type="button">
                  ⬇ Download Template
                </button>
                <button className="rsm-xlsx-btn" type="button"
                  onClick={() => xlsxRef.current?.click()}
                  disabled={!activityTypesLoaded}
                  title={!activityTypesLoaded ? "Loading activity types…" : "Import Template"}>
                  {activityTypesLoaded ? "📥 Import Template" : "⏳ Loading…"}
                </button>
                <button className="rsm-add-row-btn" type="button" onClick={addActivity}>+ Add Activity</button>
              </div>
            }
          >
            {showActErr && Object.keys(activityErrors).length > 0 && (
              <div className="rsm-validation-banner">
                <span className="rsm-validation-icon">⚠</span>
                <div><strong>{Object.keys(activityErrors).length} row(s) have errors. Please fix before continuing.</strong></div>
              </div>
            )}

            {xlsxMsg && (
              <div className={`rsm-feedback ${xlsxMsg.ok ? "rsm-feedback--ok" : "rsm-feedback--err"}`}>
                {xlsxMsg.ok ? "✓" : "⚠"} {xlsxMsg.text}
              </div>
            )}

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

            <div className="rsm-xlsx-hint">
              <b>Columns:</b>&nbsp;Activity Type · Category · Lead Target · Retail Target · Start Date (dd-MM-yyyy) · End Date · Budget · Additional Budget · BGauss Share · Remarks
              {activityTypesLoaded && activityTypes.length > 0 && (
                <span style={{ marginLeft: 8, color: "#166534", fontWeight: 600 }}>
                  · {activityTypes.length} valid type(s) loaded
                </span>
              )}
            </div>

            {/* Activity table — single compact row layout */}
            <div className="rsm-table-scroll">
              <table className="rsm-table">
                <thead>
                  <tr className="rsm-thead-row">
                    <th className="rsm-th" style={{ width: 32 }}>#</th>
                    <th className="rsm-th" style={{ width: 170 }}>Activity Type <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width: 110 }}>Category</th>
                    <th className="rsm-th" style={{ width: 90 }}>Lead Target <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width: 90 }}>Retail Target <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width: 126 }}>Start Date <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width: 126 }}>End Date <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th rsm-th--right" style={{ width: 100 }}>Budget (₹) <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th rsm-th--right" style={{ width: 110 }}>Add. Budget (₹)</th>
                    <th className="rsm-th rsm-th--right" style={{ width: 70 }}>BGauss %</th>
                    <th className="rsm-th rsm-th--right" style={{ width: 100 }}>Total (₹)</th>
                    <th className="rsm-th" style={{ width: 140 }}>Remarks</th>
                    <th className="rsm-th" style={{ width: 110 }}>Files</th>
                    <th className="rsm-th" style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, idx) => {
                    const rowErr = activityErrors[a.id];
                    return (
                      <tr key={a.id} className={idx % 2 === 0 ? "rsm-row--even" : "rsm-row--odd"}>
                        <td className="rsm-td"><span className="rsm-row-num">{idx + 1}</span></td>

                        <td className="rsm-td" style={{ minWidth: 160 }}>
                          <SearchableSelect
                            options={activityOptions}
                            value={a.activityType}
                            onChange={(v) => setActivity(a.id, "activityType", v)}
                            placeholder="Select or type…"
                            allowCreate={true}
                            className={rowErr?.activityType ? "rsm-select-error-wrap" : ""}
                          />
                          {rowErr?.activityType && (
                            <span className="rsm-field-error">{rowErr.activityType}</span>
                          )}
                        </td>

                        <td className="rsm-td">
                          <input type="text" className="rsm-input-sm" style={{ width: 100 }}
                            placeholder="Digital…" value={a.category}
                            onChange={(e) => setActivity(a.id, "category", e.target.value)} />
                        </td>

                        <td className="rsm-td">
                          <input type="number" min={0}
                            className={`rsm-input-sm${rowErr?.leadTarget ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 80 }} value={a.leadTarget}
                            onChange={(e) => setActivity(a.id, "leadTarget", e.target.value)} />
                          {rowErr?.leadTarget && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.leadTarget}</span>
                          )}
                        </td>

                        <td className="rsm-td">
                          <input type="number" min={0}
                            className={`rsm-input-sm${rowErr?.retailTarget ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 80 }} value={a.retailTarget}
                            onChange={(e) => setActivity(a.id, "retailTarget", e.target.value)} />
                          {rowErr?.retailTarget && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.retailTarget}</span>
                          )}
                        </td>

                        <td className="rsm-td">
                          <input type="date"
                            className={`rsm-input-sm${rowErr?.startDate ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 116 }} value={a.startDate}
                            onChange={(e) => setActivity(a.id, "startDate", e.target.value)} />
                          {rowErr?.startDate && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.startDate}</span>
                          )}
                        </td>

                        <td className="rsm-td">
                          <input type="date"
                            className={`rsm-input-sm${rowErr?.endDate ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 116 }} value={a.endDate} min={a.startDate || undefined}
                            onChange={(e) => setActivity(a.id, "endDate", e.target.value)} />
                          {rowErr?.endDate && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.endDate}</span>
                          )}
                        </td>

                        <td className="rsm-td rsm-td--right">
                          <input type="number" min={0}
                            className={`rsm-input-sm${rowErr?.budget ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 90, textAlign: "right" }} value={a.budget}
                            onChange={(e) => setActivity(a.id, "budget", e.target.value)} />
                          {rowErr?.budget && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.budget}</span>
                          )}
                        </td>

                        <td className="rsm-td rsm-td--right">
                          <input type="number" min={0} className="rsm-input-sm"
                            style={{ width: 100, textAlign: "right" }} value={a.additionalBudget}
                            onChange={(e) => setActivity(a.id, "additionalBudget", e.target.value)} />
                        </td>

                        <td className="rsm-td rsm-td--right">
                          <input type="number" min={0} max={100} className="rsm-input-sm"
                            style={{ width: 60, textAlign: "right" }} value={a.bgaussShare}
                            onChange={(e) => setActivity(a.id, "bgaussShare", e.target.value)} />
                        </td>

                        <td className="rsm-td rsm-td--total">
                          ₹{inr(num(a.budget) + num(a.additionalBudget))}
                        </td>

                        <td className="rsm-td">
                          <input type="text" className="rsm-input-sm" style={{ width: 130 }}
                            placeholder="Note…" value={a.remarks}
                            onChange={(e) => setActivity(a.id, "remarks", e.target.value)} />
                        </td>

                        <td className="rsm-td">
                          <label className="rsm-table-upload-btn">
                            {uploadingMedia[a.id] ? "…" : `📎 ${a.mediaFiles.length || ""}`}
                            <input type="file" multiple accept="image/*,application/pdf,video/*"
                              style={{ display: "none" }}
                              onChange={(e) => e.target.files && handleMediaUpload(a.id, e.target.files)} />
                          </label>
                          {a.mediaFiles.length > 0 && (
                            <div className="rsm-table-media-list">
                              {a.mediaFiles.map((m) => {
                                const fullUrl = m.fileUrl.startsWith("http")
                                  ? m.fileUrl
                                  : `${import.meta.env.VITE_API_BASE_URL}${m.fileUrl}`;
                                return (
                                  <div key={m.id} className="rsm-table-media-chip">
                                    <a href={fullUrl} target="_blank" rel="noopener noreferrer" title={m.fileName}>
                                      {m.fileType.startsWith("image/") ? "🖼" : "📄"}
                                    </a>
                                    <button type="button" onClick={() => removeMedia(a.id, m.id)}>✕</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>

                        <td className="rsm-td">
                          <button className="rsm-remove-btn"
                            onClick={() => removeActivity(a.id)}
                            disabled={activities.length === 1} title="Remove row" type="button">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals strip */}
            <div className="rsm-totals-strip">
              <TotalCell label="Total Activities"    value={String(activities.length)} />
              <TotalCell label="Lead Target"          value={String(Math.round(totalLeadTarget))} />
              <TotalCell label="Retail Target"        value={String(Math.round(totalRetailTarget))} />
              <TotalCell label="Total Budget"         value={`₹ ${inr(totalBudget)}`} accent />
              <TotalCell label="CPL (auto)"           value={`₹ ${cpl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
              <TotalCell label="CAC (auto)"           value={`₹ ${cac.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
            </div>

            {cacWarning && <div className="rsm-cac-warning">⚠ {cacWarning}</div>}

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => { setActiveSection("details"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>← Back</button>
              <button className="rsm-primary-btn" onClick={goToSummary}>Review & Submit →</button>
            </div>
          </Card>
        )}

        {/* ════════ SECTION 3 — Review & Submit ════════ */}
        {activeSection === "summary" && (
          <Card title="Review & Submit" subtitle="Confirm all details before sending for approval.">
            <div className="rsm-review-grid">
              <ReviewGroup title="Proposal Details">
                <ReviewRow label="Document No."  value={docNumber} mono />
                <ReviewRow label="Date"          value={docDate} />
                <ReviewRow label="Dealer"        value={header.dealerName || "—"} />
                {header.vendorName && <ReviewRow label="Vendor" value={header.vendorName} />}
                <ReviewRow label="Location"      value={header.location ? `${header.location}, ${header.state}` : "—"} />
                <ReviewRow label="Type"          value={header.type || "—"} />
                <ReviewRow label="Month"         value={header.month || "—"} />
                <ReviewRow label="Eligibility"   value={header.eligibility || "—"} />
                <ReviewRow label="RSM / TSM"     value={header.rsmName || "—"} />
                <ReviewRow label="Commando"      value={header.commandoName || "—"} />
                {header.remarks && <ReviewRow label="Remarks" value={header.remarks} />}
              </ReviewGroup>

              <ReviewGroup title="Financial Summary">
                <ReviewRow label="Activities"      value={String(activities.length)} />
                <ReviewRow label="Lead Target"     value={String(Math.round(totalLeadTarget))} />
                <ReviewRow label="Retail Target"   value={String(Math.round(totalRetailTarget))} />
                <ReviewRow label="Total Budget"    value={`₹ ${inr(totalBudget)}`} highlight />
                <ReviewRow label="CPL"             value={`₹ ${cpl.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} />
                <ReviewRow label="CAC"             value={`₹ ${cac.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} />
                {eligibility && (
                  <ReviewRow label="Allowed CAC"
                    value={`₹ ${eligibility.baseCacPerVehicle.toLocaleString("en-IN")} (${eligibility.dealerType})`} />
                )}
              </ReviewGroup>
            </div>

            <p className="rsm-review-section-title">Activities ({activities.length})</p>
            <div className="rsm-table-scroll">
              <table className="rsm-table">
                <thead>
                  <tr className="rsm-thead-row">
                    <th className="rsm-th">#</th>
                    <th className="rsm-th">Activity</th>
                    <th className="rsm-th">Category</th>
                    <th className="rsm-th">Lead Target</th>
                    <th className="rsm-th">Retail Target</th>
                    <th className="rsm-th">Dates</th>
                    <th className="rsm-th rsm-th--right">Budget</th>
                    <th className="rsm-th rsm-th--right">Add. Budget</th>
                    <th className="rsm-th rsm-th--right">Total</th>
                    <th className="rsm-th rsm-th--right">BGauss %</th>
                    <th className="rsm-th">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, i) => (
                    <tr key={a.id} className={i % 2 === 0 ? "rsm-row--even" : "rsm-row--odd"}>
                      <td className="rsm-td"><span className="rsm-row-num">{i + 1}</span></td>
                      <td className="rsm-td">{a.activityType || "—"}</td>
                      <td className="rsm-td">{a.category || "—"}</td>
                      <td className="rsm-td">{a.leadTarget || "—"}</td>
                      <td className="rsm-td">{a.retailTarget || "—"}</td>
                      <td className="rsm-td">
                        {a.startDate && a.endDate ? `${a.startDate} → ${a.endDate}` : a.startDate || "—"}
                      </td>
                      <td className="rsm-td rsm-td--right">₹{inr(num(a.budget))}</td>
                      <td className="rsm-td rsm-td--right">₹{inr(num(a.additionalBudget))}</td>
                      <td className="rsm-td rsm-td--total">₹{inr(num(a.budget) + num(a.additionalBudget))}</td>
                      <td className="rsm-td rsm-td--right">{a.bgaussShare}%</td>
                      <td className="rsm-td">{a.mediaFiles.length > 0 ? `${a.mediaFiles.length} file(s)` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {cacWarning && <div className="rsm-cac-warning" style={{ marginTop: 12 }}>⚠ {cacWarning}</div>}
            {submitted  && <div className="rsm-success-banner">✓ Proposal {editMode ? "resubmitted" : "submitted"} — redirecting…</div>}
            {error      && <div className="rsm-error-banner">{error}</div>}

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => { setActiveSection("activities"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>← Back</button>
              <button className="rsm-primary-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : editMode ? "Resubmit for Approval" : "Submit for Approval"}
              </button>
            </div>
          </Card>
        )}

      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Card({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="rsm-card">
      <div className="rsm-card-head">
        <div><h2 className="rsm-card-title">{title}</h2>{subtitle && <p className="rsm-card-sub">{subtitle}</p>}</div>
        {action && <div>{action}</div>}
      </div>
      <div className="rsm-card-body">{children}</div>
    </div>
  );
}
function Label({ text, required }: { text: string; required?: boolean }) {
  return <label className="rsm-label">{text}{required && <span className="rsm-label-req"> *</span>}</label>;
}
function DocMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rsm-meta-item">
      <span className="rsm-meta-label">{label}</span>
      <span className={`rsm-meta-value${mono ? " rsm-meta-value--mono" : ""}`}>{value}</span>
    </div>
  );
}
function ReviewGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rsm-review-group"><p className="rsm-review-group-title">{title}</p>{children}</div>;
}
function ReviewRow({ label, value, highlight, mono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div className="rsm-review-row">
      <span className="rsm-review-label">{label}</span>
      <span className={`rsm-review-value${highlight ? " rsm-review-value--highlight" : ""}${mono ? " rsm-review-value--mono" : ""}`}>{value}</span>
    </div>
  );
}
function TotalCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rsm-total-cell${accent ? " rsm-total-cell--accent" : ""}`}>
      <span className="rsm-total-label">{label}</span>
      <span className={`rsm-total-value${accent ? " rsm-total-value--accent" : ""}`}>{value}</span>
    </div>
  );
}
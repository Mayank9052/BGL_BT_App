import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  submitProposal,
  updateProposal,
  fetchProposalById,
  fetchProposalsByDealer,
  type ProposalResponse,
} from "../services/proposalService";
import { fetchStates, fetchCitiesByState } from "../services/locationService";
import {
  fetchDealers,
  fetchDealerEligibility,
  type DealerOption,
  type DealerEligibility,
} from "../services/dealerService";
import { fetchActivityTypes, type ActivityType } from "../services/activityService";
import SearchableSelect from "../components/SearchableSelect";
import type { StateOption, CityOption } from "../types/location";
import * as XLSX from "xlsx";
import "./RSMForm.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOCATION_TYPES      = ["Old", "New"];
const ELIGIBILITY_OPTIONS = ["Eligible", "Not Eligible", "Pending Approval"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const CURRENT_MONTH = MONTHS[new Date().getMonth()];

// ─── Types ────────────────────────────────────────────────────────────────────
interface ActivityRow {
  id:           string;
  activityType: string;
  target:       string;
  startDate:    string;
  endDate:      string;
  budget:       string;
  incentive:    string;
  remarks:      string;
}

interface ProposalHeader {
  dealerId:     string;
  state:        string;
  stateId:      number | null;
  location:     string;
  type:         string;
  dealerName:   string;
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
    target?:       string;
    startDate?:    string;
    endDate?:      string;
    budget?:       string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const inr = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

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
  id: crypto.randomUUID(), activityType: "", target: "",
  startDate: "", endDate: "", budget: "", incentive: "", remarks: "",
});

const emptyHeader = (): ProposalHeader => ({
  dealerId: "", state: "", stateId: null, location: "", type: "",
  dealerName: "", rsmName: "", commandoName: "",
  month: CURRENT_MONTH,
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
  rows.forEach((a) => {
    const rowErr: ActivityErrors[string] = {};
    if (!a.activityType.trim()) rowErr.activityType = "Required";
    if (!a.target || num(a.target) <= 0) rowErr.target = "Required";
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

  // Validation errors
  const [fieldErrors,    setFieldErrors]    = useState<FieldErrors>({});
  const [activityErrors, setActivityErrors] = useState<ActivityErrors>({});
  const [showDetailErr,  setShowDetailErr]  = useState(false);
  const [showActErr,     setShowActErr]     = useState(false);

  // Location
  const [states,        setStates]        = useState<StateOption[]>([]);
  const [cities,        setCities]        = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Dealers
  const [dealers,        setDealers]        = useState<DealerOption[]>([]);
  const [loadingDealers, setLoadingDealers] = useState(false);
  const [dealerError,    setDealerError]    = useState<string | null>(null);

  // Dealer history
  const [dealerHistory,        setDealerHistory]        = useState<ProposalResponse[]>([]);
  const [loadingDealerHistory, setLoadingDealerHistory] = useState(false);

  // Activity types
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);

  // Eligibility + CAC
  const [eligibility,        setEligibility]        = useState<DealerEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [cacWarning,         setCacWarning]         = useState<string | null>(null);

  const [activeSection,   setActiveSection]   = useState<"details" | "activities" | "summary">("details");
  const [showDealerPanel, setShowDealerPanel] = useState(false);
  const [xlsxMsg,         setXlsxMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  const selectedDealer = dealers.find((d) => d.customerCode === header.dealerId) ?? null;

  // ── Load states ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStates(instance)
      .then(setStates)
      .catch(() => setLocationError("Could not load states."));
  }, [instance]);

  // ── Load dealers ─────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingDealers(true);
    fetchDealers(instance)
      .then(setDealers)
      .catch(() => setDealerError("Could not load dealer list."))
      .finally(() => setLoadingDealers(false));
  }, [instance]);

  // ── Load activity types ──────────────────────────────────────────────────
  useEffect(() => {
    fetchActivityTypes(instance).then(setActivityTypes).catch(() => {});
  }, [instance]);

  // ── Load existing proposal in edit mode ──────────────────────────────────
  useEffect(() => {
    if (!editId) return;
    setLoadingEdit(true);
    fetchProposalById(editId, instance)
      .then((p) => {
        setHeader({
          dealerId:     "",
          dealerName:   p.dealerName,
          state:        p.state,
          stateId:      null,
          location:     p.location,
          type:         p.type,
          rsmName:      p.rsmName,
          commandoName: p.commandoName,
          month:        p.month,
          eligibility:  p.eligibility,
          remarks:      p.remarks ?? "",
        });
        setActivities(p.activities.map((a) => ({
          id:           crypto.randomUUID(),
          activityType: a.activityType,
          target:       String(a.target),
          startDate:    a.startDate?.split("T")[0] ?? "",
          endDate:      a.endDate?.split("T")[0]   ?? "",
          budget:       String(a.budget),
          incentive:    String(a.incentive),
          remarks:      a.remarks ?? "",
        })));
        if (p.approverNote) setRevisionNote(p.approverNote);
      })
      .catch(() => setError("Could not load proposal for editing."))
      .finally(() => setLoadingEdit(false));
  }, [editId, instance]);

  // ── Computed totals ───────────────────────────────────────────────────────
  const { totalBudget, totalTarget, cac } = useMemo(() => {
    const totalBudget = activities.reduce((s, a) => s + num(a.budget) + num(a.incentive), 0);
    const totalTarget = activities.reduce((s, a) => s + num(a.target), 0);
    const cac         = totalTarget > 0 ? totalBudget / totalTarget : 0;
    return { totalBudget, totalTarget, cac };
  }, [activities]);

  // ── Live CAC warning ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!eligibility || totalTarget === 0) { setCacWarning(null); return; }
    const liveCac = totalBudget / totalTarget;
    if (liveCac > eligibility.baseCacPerVehicle) {
      setCacWarning(
        `CAC ₹${Math.round(liveCac).toLocaleString("en-IN")} exceeds allowed ` +
        `₹${eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle ` +
        `for ${eligibility.dealerType} dealer. ` +
        `Adjust budget or request deviation approval.`
      );
    } else {
      setCacWarning(null);
    }
  }, [totalBudget, totalTarget, eligibility]);

  const setField = (key: keyof ProposalHeader, value: string) => {
    setHeader((h) => ({ ...h, [key]: value }));
    if (fieldErrors[key as keyof FieldErrors]) {
      setFieldErrors((e) => { const n = { ...e }; delete n[key as keyof FieldErrors]; return n; });
    }
  };

  // ── Dealer select ─────────────────────────────────────────────────────────
  const handleDealerSelect = (customerCode: string) => {
    const dealer = dealers.find((d) => d.customerCode === customerCode);
    setShowDealerPanel(false);
    setDealerHistory([]);
    setEligibility(null);
    setCacWarning(null);

    if (dealer) {
      setHeader((h) => ({
        ...h,
        dealerId:     dealer.customerCode,
        dealerName:   dealer.customerName,
        state:        dealer.state   ?? "",
        stateId:      null,
        location:     dealer.city    ?? "",
        rsmName:      dealer.rsmName ?? dealer.rsmCode ?? "",
        commandoName: dealer.tsmName ?? dealer.tsmCode ?? "",
      }));
      setCities([]);
      setFieldErrors((e) => { const n = { ...e }; delete n.dealerName; return n; });

      // ── Fetch eligibility from ERP + auto-fill type & eligibility ────────
      setEligibilityLoading(true);
      fetchDealerEligibility(dealer.customerCode, instance)
        .then((elig) => {
          setEligibility(elig);

          // Auto-fill Dealer Type and Eligibility from ERP result
          setHeader((h) => ({
            ...h,
            type:        elig.dealerType,   // "New" or "Old"
            eligibility: elig.isEligible ? "Eligible" : "Not Eligible",
          }));

          // Clear type/eligibility field errors since they are now filled
          setFieldErrors((e) => {
            const n = { ...e };
            delete n.type;
            delete n.eligibility;
            return n;
          });
        })
        .catch(() => {
          // ERP unavailable — don't auto-fill, let user pick manually
        })
        .finally(() => setEligibilityLoading(false));

      // Fetch proposal history
      setLoadingDealerHistory(true);
      fetchProposalsByDealer(dealer.customerName, instance)
        .then(setDealerHistory)
        .catch(() => {})
        .finally(() => setLoadingDealerHistory(false));
    } else {
      setHeader((h) => ({
        ...h, dealerId: "", dealerName: "", state: "", stateId: null,
        location: "", rsmName: "", commandoName: "",
      }));
    }
  };

  // ── State change ──────────────────────────────────────────────────────────
  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id  = e.target.value ? Number(e.target.value) : null;
    const sel = states.find((s) => s.id === id) ?? null;
    setHeader((h) => ({ ...h, state: sel?.name ?? "", stateId: id, location: "" }));
    setCities([]);
    setLocationError(null);
    if (fieldErrors.state) setFieldErrors((err) => { const n = { ...err }; delete n.state; return n; });
    if (id) {
      setLoadingCities(true);
      fetchCitiesByState(id, instance)
        .then(setCities)
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

  const resetForm = useCallback(() => {
    setHeader(emptyHeader());
    setActivities([emptyActivity()]);
    setCities([]);
    setShowDealerPanel(false);
    setRevisionNote(null);
    setDealerHistory([]);
    setFieldErrors({});
    setActivityErrors({});
    setShowDetailErr(false);
    setShowActErr(false);
    setEligibility(null);
    setCacWarning(null);
  }, []);

  // ── Step navigation ───────────────────────────────────────────────────────
  const goToActivities = () => {
    if (eligibility && !eligibility.isEligible) {
      setFieldErrors({ dealerName: "This dealer is not eligible for BTL this month." });
      setShowDetailErr(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const errs = validateDetails(header);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setShowDetailErr(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setFieldErrors({});
    setShowDetailErr(false);
    setActiveSection("activities");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToSummary = () => {
    const errs = validateActivities(activities);
    if (Object.keys(errs).length) {
      setActivityErrors(errs);
      setShowActErr(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setActivityErrors({});
    setShowActErr(false);
    setActiveSection("summary");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        if (Object.keys(errs).length) {
          setFieldErrors(errs); setShowDetailErr(true);
          window.scrollTo({ top: 0, behavior: "smooth" }); return;
        }
        const aErrs = validateActivities(activities);
        if (Object.keys(aErrs).length) {
          setActiveSection("activities");
          setActivityErrors(aErrs); setShowActErr(true);
          window.scrollTo({ top: 0, behavior: "smooth" }); return;
        }
      }
      if (activeSection === "activities") { goToSummary(); return; }
      setActiveSection("summary");
    }
  };

  // ── Excel helpers ─────────────────────────────────────────────────────────
  function excelDate(v: string | number): string {
    if (!v) return "";
    if (typeof v === "number") {
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return "";
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    const parsed = new Date(String(v));
    return !isNaN(parsed.getTime()) ? parsed.toISOString().split("T")[0] : String(v);
  }

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    setXlsxMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb   = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array" });
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
          wb.Sheets[wb.SheetNames[0]], { defval: "" }
        );
        if (!rows.length) { setXlsxMsg({ ok: false, text: "File is empty." }); return; }
        const mapped: ActivityRow[] = rows.map((r) => ({
          id:           crypto.randomUUID(),
          activityType: String(r["Activity Type"] ?? r["activityType"] ?? ""),
          target:       String(r["Target"]         ?? r["target"]       ?? ""),
          startDate:    excelDate(r["Start Date"]   ?? r["startDate"]    ?? ""),
          endDate:      excelDate(r["End Date"]     ?? r["endDate"]      ?? ""),
          budget:       String(r["Budget"]          ?? r["budget"]       ?? ""),
          incentive:    String(r["Incentive"]       ?? r["incentive"]    ?? ""),
          remarks:      String(r["Remarks"]         ?? r["remarks"]      ?? ""),
        }));
        setActivities(mapped);
        setActivityErrors({});
        setXlsxMsg({ ok: true, text: `${mapped.length} row${mapped.length !== 1 ? "s" : ""} imported.` });
      } catch {
        setXlsxMsg({ ok: false, text: "Could not parse the file. Please use the provided template." });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Activity Type","Target","Start Date","End Date","Budget","Incentive","Remarks"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Activities");
    XLSX.writeFile(wb, "BTL_Activity_Template.xlsx");
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const dErrs = validateDetails(header);
    const aErrs = validateActivities(activities);
    if (Object.keys(dErrs).length) {
      setFieldErrors(dErrs); setShowDetailErr(true);
      setActiveSection("details");
      window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    if (Object.keys(aErrs).length) {
      setActivityErrors(aErrs); setShowActErr(true);
      setActiveSection("activities");
      window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const activityPayload = activities.map((a) => ({
        activityType: a.activityType,
        target:       num(a.target),
        startDate:    a.startDate,
        endDate:      a.endDate,
        budget:       num(a.budget),
        incentive:    num(a.incentive),
        remarks:      a.remarks,
      }));

      if (editMode && editId) {
        await updateProposal(editId, {
          dealerName:   header.dealerName,
          location:     header.location,
          state:        header.state,
          type:         header.type,
          rsmName:      header.rsmName,
          commandoName: header.commandoName,
          month:        header.month,
          eligibility:  header.eligibility,
          remarks:      header.remarks,
          activities:   activityPayload,
          totalBudget,
          totalTarget,
          cac,
        }, instance);
      } else {
        await submitProposal({
          state:        header.state,
          location:     header.location,
          type:         header.type,
          dealerName:   header.dealerName,
          rsmName:      header.rsmName,
          commandoName: header.commandoName,
          month:        header.month,
          eligibility:  header.eligibility,
          remarks:      header.remarks,
          submittedBy:  account?.username ?? null,
          docNumber,
          activities:   activityPayload,
          totalBudget,
          totalTarget,
          cac,
        }, instance);
      }

      resetForm();
      setSubmitted(true);
      setTimeout(() => navigate("/dashboard"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  // ── Dropdown options ──────────────────────────────────────────────────────
  const dealerOptions = dealers.map((d) => ({
    value:    d.customerCode,
    label:    d.customerName,
    sublabel: [d.city, d.state].filter(Boolean).join(", "),
  }));

  const rsmOptions = Array.from(
    new Map([
      ...dealers.filter((d) => d.rsmName || d.rsmCode).map((d) => {
        const val = d.rsmName ?? d.rsmCode!;
        return [val, { value: val, label: val }] as [string, { value: string; label: string }];
      }),
      ...dealers.filter((d) => d.tsmName || d.tsmCode).map((d) => {
        const val = d.tsmName ?? d.tsmCode!;
        return [val, { value: val, label: val }] as [string, { value: string; label: string }];
      }),
    ]).values()
  ).sort((a, b) => a.label.localeCompare(b.label));

  const commandoOptions = Array.from(
    new Map(
      dealers.filter((d) => d.tsmName || d.tsmCode).map((d) => {
        const val = d.tsmName ?? d.tsmCode!;
        return [val, { value: val, label: val }] as [string, { value: string; label: string }];
      })
    ).values()
  ).sort((a, b) => a.label.localeCompare(b.label));

  const activityOptions = activityTypes.length > 0
    ? activityTypes.map((t) => ({ value: t.activityName, label: t.activityName }))
    : ["Test Drive Camp","Canopy Activity","Mela / Exhibition","Road Show",
       "Digital Campaign","Influencer Activity","Corporate Connect",
       "Society Activation","Referral Program","Other"]
        .map((t) => ({ value: t, label: t }));

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

      {/* Top bar */}
      <header className="rsm-topbar">
        <div className="rsm-brand">
          <img src="/BGauss_Logo.png" alt="BGauss" className="rsm-brand-logo" />
          <div className="rsm-brand-text">
            <span className="rsm-brand-name">BGauss</span>
            <span className="rsm-brand-sub">BTL Proposal System</span>
          </div>
        </div>
        <div className="rsm-topbar-right">
          <button className="rsm-ghost-btn" onClick={() => navigate("/dashboard")}>← Dashboard</button>
          {account?.name && (
            <div className="rsm-user-chip">
              <div className="rsm-avatar">{account.name.charAt(0).toUpperCase()}</div>
              <span className="rsm-avatar-name">{account.name}</span>
            </div>
          )}
          <button className="rsm-ghost-btn rsm-ghost-btn--danger"
            onClick={() => instance.logoutRedirect().catch(console.error)}>
            Sign out
          </button>
        </div>
      </header>

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

        {/* Revision note banner */}
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

            {/* Row 1: Dealer · State · City · Location Type */}
            <div className="rsm-form-row1">

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

              {/* State */}
              <div className="rsm-field">
                <Label text="State" required />
                {header.state && !header.stateId ? (
                  <select
                    className={`rsm-select${fieldErrors.state ? " rsm-input--error" : ""}`}
                    value={header.stateId ?? ""}
                    onChange={handleStateChange}>
                    <option value="">{header.state} (dealer)</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <select
                    className={`rsm-select${fieldErrors.state ? " rsm-input--error" : ""}`}
                    value={header.stateId ?? ""}
                    onChange={handleStateChange}>
                    <option value="">Select state</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {fieldErrors.state && <span className="rsm-field-error">{fieldErrors.state}</span>}
              </div>

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
                    {cities.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                )}
                {(fieldErrors.location || locationError) && (
                  <span className="rsm-field-error">{fieldErrors.location || locationError}</span>
                )}
              </div>

              {/* Dealer Type — auto-filled from ERP, still editable */}
              <div className="rsm-field">
                <Label text="Dealer Type" required />
                <select
                  className={`rsm-select${fieldErrors.type ? " rsm-input--error" : ""}`}
                  value={header.type}
                  onChange={(e) => setField("type", e.target.value)}>
                  <option value="">
                    {eligibilityLoading ? "Loading…" : "Select type"}
                  </option>
                  {LOCATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {fieldErrors.type && <span className="rsm-field-error">{fieldErrors.type}</span>}
              </div>

            </div>

            {/* Dealer info panel */}
            {!editMode && showDealerPanel && selectedDealer && (
              <div className="rsm-dealer-panel">
                <div className="rsm-dealer-panel-head">
                  <div>
                    <h3 className="rsm-dealer-panel-name">{selectedDealer.customerName}</h3>
                    <p className="rsm-dealer-panel-sub">
                      Code: <b>{selectedDealer.customerCode}</b>&nbsp;·&nbsp;
                      {[selectedDealer.city, selectedDealer.state].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <button className="rsm-close-panel-btn" onClick={() => setShowDealerPanel(false)}>✕</button>
                </div>
                <div className="rsm-dealer-contacts">
                  {selectedDealer.contactPerson && (
                    <span className="rsm-dealer-contact">👤 {selectedDealer.contactPerson}</span>
                  )}
                  {selectedDealer.mobile && (
                    <span className="rsm-dealer-contact">📞 {selectedDealer.mobile}</span>
                  )}
                  {selectedDealer.tsmName && (
                    <span className="rsm-dealer-contact">🧑‍💼 TSM: {selectedDealer.tsmName}</span>
                  )}
                  {selectedDealer.rsmName && (
                    <span className="rsm-dealer-contact">👔 RSM: {selectedDealer.rsmName}</span>
                  )}
                </div>
                <div className="rsm-dealer-history">
                  <p className="rsm-panel-section-title">
                    Previous Proposals
                    {!loadingDealerHistory && dealerHistory.length > 0 && (
                      <span className="rsm-history-count">{dealerHistory.length}</span>
                    )}
                  </p>
                  {loadingDealerHistory && (
                    <div className="rsm-history-loading">
                      <div className="rsm-spinner-sm" /><span>Loading history…</span>
                    </div>
                  )}
                  {!loadingDealerHistory && dealerHistory.length === 0 && (
                    <p className="rsm-history-empty">No previous proposals for this dealer.</p>
                  )}
                  {!loadingDealerHistory && dealerHistory.length > 0 && (
                    <div className="rsm-panel-table-wrap">
                      <table className="rsm-panel-table">
                        <thead>
                          <tr>
                            <th className="rsm-panel-th">Token</th>
                            <th className="rsm-panel-th">Month</th>
                            <th className="rsm-panel-th">RSM / TSM</th>
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
                              <td className="rsm-panel-td">
                                <span className="rsm-history-token">{p.tokenNumber ?? "—"}</span>
                              </td>
                              <td className="rsm-panel-td">{p.month}</td>
                              <td className="rsm-panel-td" style={{ whiteSpace:"nowrap" }}>{p.rsmName || "—"}</td>
                              <td className="rsm-panel-td">
                                {p.activities.slice(0, 2).map((a, ai) => (
                                  <span key={ai} className="rsm-history-chip">{a.activityType}</span>
                                ))}
                                {p.activities.length > 2 && (
                                  <span className="rsm-history-chip rsm-history-chip--more">
                                    +{p.activities.length - 2}
                                  </span>
                                )}
                              </td>
                              <td className="rsm-panel-td rsm-panel-td--right">
                                ₹{Math.round(p.totalBudget).toLocaleString("en-IN")}
                              </td>
                              <td className="rsm-panel-td rsm-panel-td--right">{p.totalTarget}</td>
                              <td className="rsm-panel-td">
                                <span className={`rsm-history-status ${statusCls(p.status)}`}>
                                  {p.status === "NeedsRevision" ? "Revision" : p.status}
                                </span>
                              </td>
                              <td className="rsm-panel-td" style={{ whiteSpace:"nowrap", fontSize:11 }}>
                                {fmtShort(p.createdAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Eligibility status banner ── */}
            {eligibilityLoading && (
              <div className="rsm-elig-loading">
                <div className="rsm-spinner-sm" />
                <span>Checking dealer eligibility from ERP…</span>
              </div>
            )}
            {!eligibilityLoading && eligibility && (
              <div className={`rsm-elig-banner ${eligibility.isEligible ? "rsm-elig-banner--ok" : "rsm-elig-banner--no"}`}>
                <span className="rsm-elig-icon">{eligibility.isEligible ? "✓" : "✕"}</span>
                <div style={{ flex: 1 }}>
                  <strong>{eligibility.isEligible ? "Eligible for BTL" : "Not Eligible for BTL"}</strong>
                  <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>
                    {eligibility.eligibilityReason}
                  </span>
                  {eligibility.isEligible && (
                    <span className="rsm-elig-cac">
                      &nbsp;·&nbsp;Max CAC: ₹{eligibility.baseCacPerVehicle.toLocaleString("en-IN")}/vehicle
                      &nbsp;({eligibility.dealerType} dealer)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Row 2: RSM/TSM · Commando · Month · Eligibility */}
            <div className="rsm-form-row2">
              <div className="rsm-field">
                <Label text="RSM / TSM Name" required />
                <SearchableSelect
                  options={rsmOptions}
                  value={header.rsmName}
                  onChange={(v) => setField("rsmName", v)}
                  placeholder="Search or type…"
                  allowCreate={true}
                  className={fieldErrors.rsmName ? "rsm-select-error-wrap" : ""}
                />
                {fieldErrors.rsmName && (
                  <span className="rsm-field-error">{fieldErrors.rsmName}</span>
                )}
              </div>

              <div className="rsm-field">
                <Label text="Commando Name" />
                <SearchableSelect
                  options={commandoOptions}
                  value={header.commandoName}
                  onChange={(v) => setField("commandoName", v)}
                  placeholder="Search or type…"
                  allowCreate={true}
                />
              </div>

              <div className="rsm-field">
                <Label text="Month" required />
                <SearchableSelect
                  options={monthOptions}
                  value={header.month}
                  onChange={(v) => setField("month", v)}
                  placeholder="Select month"
                  allowCreate={false}
                  className={fieldErrors.month ? "rsm-select-error-wrap" : ""}
                />
                {fieldErrors.month && (
                  <span className="rsm-field-error">{fieldErrors.month}</span>
                )}
              </div>

              {/* Eligibility — auto-filled from ERP, still editable */}
              <div className="rsm-field">
                <Label text="Eligibility" required />
                <select
                  className={`rsm-select${fieldErrors.eligibility ? " rsm-input--error" : ""}`}
                  value={header.eligibility}
                  onChange={(e) => setField("eligibility", e.target.value)}>
                  <option value="">
                    {eligibilityLoading ? "Checking…" : "Select eligibility"}
                  </option>
                  {ELIGIBILITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {fieldErrors.eligibility && (
                  <span className="rsm-field-error">{fieldErrors.eligibility}</span>
                )}
              </div>
            </div>

            {/* Remarks */}
            <div className="rsm-remarks-row">
              <Label text="Overall Remarks" />
              <textarea className="rsm-textarea" placeholder="Additional notes for the approver…"
                value={header.remarks} onChange={(e) => setField("remarks", e.target.value)} />
            </div>

            <div className="rsm-section-footer">
              <button className="rsm-primary-btn" onClick={goToActivities}>
                Continue to Activities →
              </button>
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
                <button className="rsm-tpl-btn" onClick={downloadTemplate}>⬇ Template</button>
                <button className="rsm-xlsx-btn" onClick={() => xlsxRef.current?.click()}>📥 Import Excel</button>
                <button className="rsm-add-row-btn" onClick={addActivity}>+ Add row</button>
              </div>
            }
          >
            {showActErr && Object.keys(activityErrors).length > 0 && (
              <div className="rsm-validation-banner">
                <span className="rsm-validation-icon">⚠</span>
                <div>
                  <strong>
                    {Object.keys(activityErrors).length} row{Object.keys(activityErrors).length > 1 ? "s have" : " has"} errors.
                    Please fix them before continuing.
                  </strong>
                </div>
              </div>
            )}

            {xlsxMsg && (
              <div className={`rsm-feedback ${xlsxMsg.ok ? "rsm-feedback--ok" : "rsm-feedback--err"}`}>
                {xlsxMsg.ok ? "✓" : "⚠"} {xlsxMsg.text}
              </div>
            )}

            <div className="rsm-xlsx-hint">
              <b>Excel columns expected:</b>&nbsp;
              Activity Type · Target · Start Date · End Date · Budget · Incentive · Remarks
            </div>

            <div className="rsm-table-scroll">
              <table className="rsm-table">
                <thead>
                  <tr className="rsm-thead-row">
                    <th className="rsm-th" style={{ width: 32 }}>#</th>
                    <th className="rsm-th" style={{ width: 180 }}>Activity Type <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width: 80 }}>Target <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width: 130 }}>Start Date <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th" style={{ width: 130 }}>End Date <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th rsm-th--right" style={{ width: 110 }}>Budget (₹) <span style={{ color:"#f87171" }}>*</span></th>
                    <th className="rsm-th rsm-th--right" style={{ width: 110 }}>Incentive (₹)</th>
                    <th className="rsm-th rsm-th--right" style={{ width: 110 }}>Total (₹)</th>
                    <th className="rsm-th" style={{ width: 150 }}>Remarks</th>
                    <th className="rsm-th" style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, idx) => {
                    const rowErr = activityErrors[a.id];
                    return (
                      <tr key={a.id} className={idx % 2 === 0 ? "rsm-row--even" : "rsm-row--odd"}>
                        <td className="rsm-td"><span className="rsm-row-num">{idx + 1}</span></td>
                        <td className="rsm-td" style={{ minWidth: 170 }}>
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
                          <input type="number" min={0}
                            className={`rsm-input-sm${rowErr?.target ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 72 }} value={a.target}
                            onChange={(e) => setActivity(a.id, "target", e.target.value)} />
                          {rowErr?.target && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.target}</span>
                          )}
                        </td>
                        <td className="rsm-td">
                          <input type="date"
                            className={`rsm-input-sm${rowErr?.startDate ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 126 }} value={a.startDate}
                            onChange={(e) => setActivity(a.id, "startDate", e.target.value)} />
                          {rowErr?.startDate && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.startDate}</span>
                          )}
                        </td>
                        <td className="rsm-td">
                          <input type="date"
                            className={`rsm-input-sm${rowErr?.endDate ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 126 }} value={a.endDate} min={a.startDate || undefined}
                            onChange={(e) => setActivity(a.id, "endDate", e.target.value)} />
                          {rowErr?.endDate && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.endDate}</span>
                          )}
                        </td>
                        <td className="rsm-td rsm-td--right">
                          <input type="number" min={0}
                            className={`rsm-input-sm${rowErr?.budget ? " rsm-input-sm--error" : ""}`}
                            style={{ width: 100, textAlign: "right" }} value={a.budget}
                            onChange={(e) => setActivity(a.id, "budget", e.target.value)} />
                          {rowErr?.budget && (
                            <span className="rsm-field-error" style={{ display:"block" }}>{rowErr.budget}</span>
                          )}
                        </td>
                        <td className="rsm-td rsm-td--right">
                          <input type="number" min={0} className="rsm-input-sm"
                            style={{ width: 100, textAlign: "right" }} value={a.incentive}
                            onChange={(e) => setActivity(a.id, "incentive", e.target.value)} />
                        </td>
                        <td className="rsm-td rsm-td--total">
                          ₹{inr(num(a.budget) + num(a.incentive))}
                        </td>
                        <td className="rsm-td">
                          <input type="text" className="rsm-input-sm" style={{ width: 140 }}
                            placeholder="Note…" value={a.remarks}
                            onChange={(e) => setActivity(a.id, "remarks", e.target.value)} />
                        </td>
                        <td className="rsm-td">
                          <button className="rsm-remove-btn"
                            onClick={() => removeActivity(a.id)}
                            disabled={activities.length === 1} title="Remove row">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="rsm-totals-strip">
              <TotalCell label="Total Activities" value={String(activities.length)} />
              <TotalCell label="Total Target"     value={String(Math.round(totalTarget))} />
              <TotalCell label="Total Budget"     value={`₹ ${inr(totalBudget)}`} accent />
              <TotalCell label="CAC (auto)"
                value={`₹ ${cac.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} />
            </div>

            {/* CAC Warning */}
            {cacWarning && (
              <div className="rsm-cac-warning">⚠ {cacWarning}</div>
            )}

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => {
                setActiveSection("details");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}>← Back</button>
              <button className="rsm-primary-btn" onClick={goToSummary}>
                Review & Submit →
              </button>
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
                <ReviewRow label="Location"
                  value={header.location ? `${header.location}, ${header.state}` : "—"} />
                <ReviewRow label="Type"          value={header.type || "—"} />
                <ReviewRow label="Month"         value={header.month || "—"} />
                <ReviewRow label="Eligibility"   value={header.eligibility || "—"} />
                <ReviewRow label="RSM / TSM"     value={header.rsmName || "—"} />
                <ReviewRow label="Commando"      value={header.commandoName || "—"} />
                {header.remarks && <ReviewRow label="Remarks" value={header.remarks} />}
              </ReviewGroup>

              <ReviewGroup title="Financial Summary">
                <ReviewRow label="Activities"   value={String(activities.length)} />
                <ReviewRow label="Total Target" value={String(Math.round(totalTarget))} />
                <ReviewRow label="Total Budget" value={`₹ ${inr(totalBudget)}`} highlight />
                <ReviewRow label="CAC"
                  value={`₹ ${cac.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} />
                {eligibility && (
                  <ReviewRow
                    label="Allowed CAC"
                    value={`₹ ${eligibility.baseCacPerVehicle.toLocaleString("en-IN")} (${eligibility.dealerType})`}
                  />
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
                    <th className="rsm-th">Target</th>
                    <th className="rsm-th">Dates</th>
                    <th className="rsm-th rsm-th--right">Budget</th>
                    <th className="rsm-th rsm-th--right">Incentive</th>
                    <th className="rsm-th rsm-th--right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, i) => (
                    <tr key={a.id} className={i % 2 === 0 ? "rsm-row--even" : "rsm-row--odd"}>
                      <td className="rsm-td"><span className="rsm-row-num">{i + 1}</span></td>
                      <td className="rsm-td">{a.activityType || "—"}</td>
                      <td className="rsm-td">{a.target || "—"}</td>
                      <td className="rsm-td">
                        {a.startDate && a.endDate
                          ? `${a.startDate} → ${a.endDate}`
                          : a.startDate || "—"}
                      </td>
                      <td className="rsm-td rsm-td--right">₹{inr(num(a.budget))}</td>
                      <td className="rsm-td rsm-td--right">₹{inr(num(a.incentive))}</td>
                      <td className="rsm-td rsm-td--total">₹{inr(num(a.budget) + num(a.incentive))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {cacWarning && (
              <div className="rsm-cac-warning" style={{ marginTop: 12 }}>⚠ {cacWarning}</div>
            )}

            {submitted && (
              <div className="rsm-success-banner">
                ✓ Proposal {editMode ? "resubmitted" : "submitted"} — redirecting to dashboard…
              </div>
            )}
            {error && <div className="rsm-error-banner">{error}</div>}

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => {
                setActiveSection("activities");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}>← Back</button>
              <button className="rsm-primary-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting
                  ? "Submitting…"
                  : editMode ? "Resubmit for Approval" : "Submit for Approval"}
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
        <div>
          <h2 className="rsm-card-title">{title}</h2>
          {subtitle && <p className="rsm-card-sub">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="rsm-card-body">{children}</div>
    </div>
  );
}

function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <label className="rsm-label">
      {text}{required && <span className="rsm-label-req"> *</span>}
    </label>
  );
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
  return (
    <div className="rsm-review-group">
      <p className="rsm-review-group-title">{title}</p>
      {children}
    </div>
  );
}

function ReviewRow({ label, value, highlight, mono }: {
  label: string; value: string; highlight?: boolean; mono?: boolean;
}) {
  return (
    <div className="rsm-review-row">
      <span className="rsm-review-label">{label}</span>
      <span className={`rsm-review-value${highlight ? " rsm-review-value--highlight" : ""}${mono ? " rsm-review-value--mono" : ""}`}>
        {value}
      </span>
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
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  submitProposal,
  updateProposal,
  fetchProposalById,
} from "../services/proposalService";
import { fetchStates, fetchCitiesByState } from "../services/locationService";
import { fetchDealers, type DealerOption } from "../services/dealerService";
import { fetchActivityTypes, type ActivityType } from "../services/activityService";
import SearchableSelect from "../components/SearchableSelect";
import type { StateOption, CityOption } from "../types/location";
import * as XLSX from "xlsx";
import "./RSMForm.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOCATION_TYPES = ["Old", "New"];
const ELIGIBILITY_OPTIONS = ["Eligible", "Not Eligible", "Pending Approval"];
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const CURRENT_MONTH = MONTHS[new Date().getMonth()];

// ─── Types ────────────────────────────────────────────────────────────────────
interface ActivityRow {
  id: string;
  activityType: string;
  target: string;
  startDate: string;
  endDate: string;
  budget: string;
  incentive: string;
  remarks: string;
}

interface ProposalHeader {
  dealerId: string;
  state: string;
  stateId: number | null;
  location: string;
  type: string;
  dealerName: string;
  rsmName: string;
  commandoName: string;
  month: string;
  eligibility: string;
  remarks: string;
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function RSMProposalForm() {
  const { instance, accounts } = useMsal();
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const account        = accounts[0];
  const xlsxRef        = useRef<HTMLInputElement>(null);

  // Edit mode — triggered by ?edit={proposalId} from revision email link
  const editId   = searchParams.get("edit");
  const editMode = !!editId;

  const [docNumber] = useState<string>(generateDocNumber);
  const [docDate]   = useState<string>(() => formatDate(new Date()));

  const [header, setHeader]         = useState<ProposalHeader>(emptyHeader());
  const [activities, setActivities] = useState<ActivityRow[]>([emptyActivity()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const [loadingEdit,  setLoadingEdit]  = useState(false);

  // Location
  const [states, setStates]               = useState<StateOption[]>([]);
  const [cities, setCities]               = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Dealers
  const [dealers, setDealers]               = useState<DealerOption[]>([]);
  const [loadingDealers, setLoadingDealers] = useState(false);
  const [dealerError, setDealerError]       = useState<string | null>(null);

  // Activity types
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);

  const [activeSection, setActiveSection]     = useState<"details" | "activities" | "summary">("details");
  const [showDealerPanel, setShowDealerPanel] = useState(false);
  const [xlsxMsg, setXlsxMsg]                 = useState<{ ok: boolean; text: string } | null>(null);

  const selectedDealer = dealers.find((d) => d.customerCode === header.dealerId) ?? null;

  // ── Load states ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStates(instance)
      .then(setStates)
      .catch(() => setLocationError("Could not load states."));
  }, [instance]);

  // ── Load dealers ───────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingDealers(true);
    fetchDealers(instance)
      .then(setDealers)
      .catch(() => setDealerError("Could not load dealer list."))
      .finally(() => setLoadingDealers(false));
  }, [instance]);

  // ── Load activity types ────────────────────────────────────────────────────
  useEffect(() => {
    fetchActivityTypes(instance).then(setActivityTypes).catch(() => {});
  }, [instance]);

  // ── Load existing proposal if in edit mode ─────────────────────────────────
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

  // ── Computed totals ────────────────────────────────────────────────────────
  const { totalBudget, totalTarget, cac } = useMemo(() => {
    const totalBudget = activities.reduce((s, a) => s + num(a.budget) + num(a.incentive), 0);
    const totalTarget = activities.reduce((s, a) => s + num(a.target), 0);
    const cac         = totalTarget > 0 ? totalBudget / totalTarget : 0;
    return { totalBudget, totalTarget, cac };
  }, [activities]);

  const setField = (key: keyof ProposalHeader, value: string) =>
    setHeader((h) => ({ ...h, [key]: value }));

  // ── Dealer select ──────────────────────────────────────────────────────────
  const handleDealerSelect = (customerCode: string) => {
    const dealer = dealers.find((d) => d.customerCode === customerCode);
    setShowDealerPanel(false);
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
    } else {
      setHeader((h) => ({
        ...h, dealerId: "", dealerName: "", state: "", stateId: null,
        location: "", rsmName: "", commandoName: "",
      }));
    }
  };

  // ── State dropdown ─────────────────────────────────────────────────────────
  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id       = e.target.value ? Number(e.target.value) : null;
    const selected = states.find((s) => s.id === id) ?? null;
    setHeader((h) => ({ ...h, state: selected?.name ?? "", stateId: id, location: "" }));
    setCities([]);
    setLocationError(null);
    if (id) {
      setLoadingCities(true);
      fetchCitiesByState(id, instance)
        .then(setCities)
        .catch(() => setLocationError("Could not load cities."))
        .finally(() => setLoadingCities(false));
    }
  };

  // ── Activity helpers ───────────────────────────────────────────────────────
  const setActivity = (id: string, key: keyof ActivityRow, value: string) =>
    setActivities((rows) => rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  const addActivity    = () => setActivities((rows) => [...rows, emptyActivity()]);
  const removeActivity = (id: string) =>
    setActivities((rows) => rows.length > 1 ? rows.filter((r) => r.id !== id) : rows);

  const resetForm = useCallback(() => {
    setHeader(emptyHeader());
    setActivities([emptyActivity()]);
    setCities([]);
    setShowDealerPanel(false);
    setRevisionNote(null);
  }, []);

  // ── Excel helpers ──────────────────────────────────────────────────────────
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

  // ── Submit / Resubmit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
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
        // Resubmit revised proposal via PUT
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
        // New proposal submission via POST
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

  // ── Dropdown options ───────────────────────────────────────────────────────
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

  const detailsComplete    = !!(header.dealerName && header.type && header.rsmName && header.month && header.eligibility);
  const activitiesComplete = activities.every((a) => a.activityType && a.target && a.startDate && a.endDate && a.budget);

  const stepCircleClass = (key: string, done: boolean) => {
    if (done) return "rsm-step-circle rsm-step-circle--done";
    if (activeSection === key) return "rsm-step-circle rsm-step-circle--active";
    return "rsm-step-circle rsm-step-circle--pending";
  };

  // ── Loading state while fetching proposal for edit ─────────────────────────
  if (loadingEdit) {
    return (
      <div className="rsm-page">
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
          <div style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>
            <div className="rsm-spinner" />
            <p style={{ marginTop: 12 }}>Loading proposal for editing…</p>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="rsm-page">

      {/* ── Top bar ── */}
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

        {/* ── Document banner ── */}
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

        {/* ── Revision note banner ── */}
        {editMode && revisionNote && (
          <div className="rsm-revision-banner">
            <span className="rsm-revision-icon">↩</span>
            <div>
              <strong>Revision requested by reviewer:</strong>
              <span style={{ marginLeft: 8 }}>{revisionNote}</span>
            </div>
          </div>
        )}

        {/* ── Step bar ── */}
        <div className="rsm-step-bar">
          {([
            { key: "details",    label: "Proposal Details", n: 1, done: detailsComplete },
            { key: "activities", label: "Activities",        n: 2, done: activitiesComplete },
            { key: "summary",    label: "Review & Submit",   n: 3, done: false },
          ] as const).map(({ key, label, n, done }) => (
            <button key={key} className="rsm-step-btn" onClick={() => setActiveSection(key)}>
              <div className={stepCircleClass(key, done)}>{done ? "✓" : n}</div>
              <span className={`rsm-step-label${activeSection === key ? " rsm-step-label--active" : ""}`}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* ════════ SECTION 1 — Proposal Details ════════ */}
        {activeSection === "details" && (
          <Card title="Proposal Details" subtitle="Select a dealer and fill in the proposal basics.">

            {/* Dealer */}
            <div className="rsm-field rsm-field--full">
              <Label text="Dealer" required />
              {dealerError && <span className="rsm-field-error">{dealerError}</span>}
              <div className="rsm-dealer-input-wrap">
                <div style={{ flex: 1 }}>
                  {editMode ? (
                    // In edit mode, dealer is shown as a read-only input (can be manually overridden)
                    <input
                      className="rsm-select"
                      value={header.dealerName}
                      onChange={(e) => setField("dealerName", e.target.value)}
                      placeholder="Dealer name"
                    />
                  ) : (
                    <SearchableSelect
                      options={dealerOptions}
                      value={header.dealerId}
                      onChange={handleDealerSelect}
                      placeholder={loadingDealers ? "Loading dealers…" : "Search by dealer name or city…"}
                      loading={loadingDealers}
                    />
                  )}
                </div>
                {!editMode && header.dealerId && (
                  <button className="rsm-info-btn" title="View dealer details"
                    onClick={() => setShowDealerPanel((v) => !v)}>ⓘ</button>
                )}
              </div>
            </div>

            {/* Dealer info panel */}
            {!editMode && showDealerPanel && selectedDealer && (
              <div className="rsm-dealer-panel">
                <div className="rsm-dealer-panel-head">
                  <div>
                    <h3 className="rsm-dealer-panel-name">{selectedDealer.customerName}</h3>
                    <p className="rsm-dealer-panel-sub">
                      Code: <b>{selectedDealer.customerCode}</b> &nbsp;·&nbsp;
                      {[selectedDealer.city, selectedDealer.state].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <button className="rsm-close-panel-btn" onClick={() => setShowDealerPanel(false)}>✕</button>
                </div>
                <div className="rsm-dealer-contacts">
                  {selectedDealer.contactPerson && <span className="rsm-dealer-contact">👤 {selectedDealer.contactPerson}</span>}
                  {selectedDealer.mobile        && <span className="rsm-dealer-contact">📞 {selectedDealer.mobile}</span>}
                  {selectedDealer.tsmName       && <span className="rsm-dealer-contact">🧑‍💼 TSM: {selectedDealer.tsmName}</span>}
                  {selectedDealer.rsmName       && <span className="rsm-dealer-contact">👔 RSM: {selectedDealer.rsmName}</span>}
                </div>
              </div>
            )}

            <div className="rsm-grid3">

              {/* State */}
              <div className="rsm-field">
                <Label text="State" required />
                {header.state && !header.stateId ? (
                  <select className="rsm-select" value={header.stateId ?? ""} onChange={handleStateChange}>
                    <option value="">{header.state} (from dealer)</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <select className="rsm-select" value={header.stateId ?? ""} onChange={handleStateChange}>
                    <option value="">Select state</option>
                    {states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>

              {/* City */}
              <div className="rsm-field">
                <Label text="City" required />
                {header.location && !header.stateId ? (
                  <input className="rsm-select" value={header.location}
                    onChange={(e) => setField("location", e.target.value)} placeholder="City" />
                ) : (
                  <select className="rsm-select" value={header.location}
                    onChange={(e) => setField("location", e.target.value)}
                    disabled={!header.stateId || loadingCities}>
                    <option value="">
                      {!header.stateId ? "Select a state first" : loadingCities ? "Loading…" : "Select city"}
                    </option>
                    {cities.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                )}
                {locationError && <span className="rsm-field-error">{locationError}</span>}
              </div>

              {/* Location Type */}
              <div className="rsm-field">
                <Label text="Location Type" required />
                <select className="rsm-select" value={header.type}
                  onChange={(e) => setField("type", e.target.value)}>
                  <option value="">Select type</option>
                  {LOCATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* RSM / TSM Name */}
              <div className="rsm-field">
                <Label text="RSM / TSM Name" required />
                <SearchableSelect
                  options={rsmOptions}
                  value={header.rsmName}
                  onChange={(v) => setField("rsmName", v)}
                  placeholder="Search or type RSM / TSM name…"
                  allowCreate={true}
                />
              </div>

              {/* Commando Name */}
              <div className="rsm-field">
                <Label text="Commando Name" />
                <SearchableSelect
                  options={commandoOptions}
                  value={header.commandoName}
                  onChange={(v) => setField("commandoName", v)}
                  placeholder="Search or type commando name…"
                  allowCreate={true}
                />
              </div>

              {/* Month */}
              <div className="rsm-field">
                <Label text="Month" required />
                <SearchableSelect
                  options={monthOptions}
                  value={header.month}
                  onChange={(v) => setField("month", v)}
                  placeholder="Select month"
                  allowCreate={false}
                />
              </div>

              {/* Eligibility */}
              <div className="rsm-field">
                <Label text="Eligibility" required />
                <select className="rsm-select" value={header.eligibility}
                  onChange={(e) => setField("eligibility", e.target.value)}>
                  <option value="">Select eligibility</option>
                  {ELIGIBILITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

            </div>

            <div className="rsm-remarks-row">
              <Label text="Overall Remarks" />
              <textarea className="rsm-textarea" placeholder="Additional notes for the approver…"
                value={header.remarks} onChange={(e) => setField("remarks", e.target.value)} />
            </div>

            <div className="rsm-section-footer">
              <button className="rsm-primary-btn" onClick={() => setActiveSection("activities")}>
                Continue to Activities →
              </button>
            </div>
          </Card>
        )}

        {/* ════════ SECTION 2 — Activities ════════ */}
        {activeSection === "activities" && (
          <Card
            title="Activity Plan"
            subtitle="Add activities manually or import from an Excel file."
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
            {xlsxMsg && (
              <div className={`rsm-feedback ${xlsxMsg.ok ? "rsm-feedback--ok" : "rsm-feedback--err"}`}>
                {xlsxMsg.ok ? "✓" : "⚠"} {xlsxMsg.text}
              </div>
            )}

            <div className="rsm-xlsx-hint">
              <b>Excel columns expected:</b>&nbsp;
              Activity Type · Target · Start Date · End Date · Budget · Incentive · Remarks
            </div>

            <div className="rsm-table-wrap">
              <table className="rsm-table">
                <thead>
                  <tr className="rsm-thead-row">
                    <th className="rsm-th" style={{ width: 32 }}>#</th>
                    <th className="rsm-th" style={{ width: 180 }}>Activity Type</th>
                    <th className="rsm-th" style={{ width: 80 }}>Target</th>
                    <th className="rsm-th" style={{ width: 130 }}>Start Date</th>
                    <th className="rsm-th" style={{ width: 130 }}>End Date</th>
                    <th className="rsm-th rsm-th--right" style={{ width: 110 }}>Budget (₹)</th>
                    <th className="rsm-th rsm-th--right" style={{ width: 110 }}>Incentive (₹)</th>
                    <th className="rsm-th rsm-th--right" style={{ width: 110 }}>Total (₹)</th>
                    <th className="rsm-th" style={{ width: 150 }}>Remarks</th>
                    <th className="rsm-th" style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, idx) => (
                    <tr key={a.id} className={idx % 2 === 0 ? "rsm-row--even" : "rsm-row--odd"}>
                      <td className="rsm-td"><span className="rsm-row-num">{idx + 1}</span></td>
                      <td className="rsm-td" style={{ minWidth: 170 }}>
                        <SearchableSelect
                          options={activityOptions}
                          value={a.activityType}
                          onChange={(v) => setActivity(a.id, "activityType", v)}
                          placeholder="Select or type…"
                          allowCreate={true}
                        />
                      </td>
                      <td className="rsm-td">
                        <input type="number" min={0} className="rsm-input-sm"
                          style={{ width: 72 }} value={a.target}
                          onChange={(e) => setActivity(a.id, "target", e.target.value)} />
                      </td>
                      <td className="rsm-td">
                        <input type="date" className="rsm-input-sm" style={{ width: 126 }}
                          value={a.startDate}
                          onChange={(e) => setActivity(a.id, "startDate", e.target.value)} />
                      </td>
                      <td className="rsm-td">
                        <input type="date" className="rsm-input-sm" style={{ width: 126 }}
                          value={a.endDate} min={a.startDate || undefined}
                          onChange={(e) => setActivity(a.id, "endDate", e.target.value)} />
                      </td>
                      <td className="rsm-td rsm-td--right">
                        <input type="number" min={0} className="rsm-input-sm"
                          style={{ width: 100, textAlign: "right" }} value={a.budget}
                          onChange={(e) => setActivity(a.id, "budget", e.target.value)} />
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
                  ))}
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

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => setActiveSection("details")}>← Back</button>
              <button className="rsm-primary-btn" onClick={() => setActiveSection("summary")}>
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
                <ReviewRow label="Location"      value={header.location ? `${header.location}, ${header.state}` : "—"} />
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
              </ReviewGroup>
            </div>

            <p className="rsm-review-section-title">Activities ({activities.length})</p>

            <div className="rsm-table-wrap">
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
                        {a.startDate && a.endDate ? `${a.startDate} → ${a.endDate}` : a.startDate || "—"}
                      </td>
                      <td className="rsm-td rsm-td--right">₹{inr(num(a.budget))}</td>
                      <td className="rsm-td rsm-td--right">₹{inr(num(a.incentive))}</td>
                      <td className="rsm-td rsm-td--total">₹{inr(num(a.budget) + num(a.incentive))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {submitted && (
              <div className="rsm-success-banner">
                ✓ Proposal {editMode ? "resubmitted" : "submitted"} — redirecting to dashboard…
              </div>
            )}
            {error && <div className="rsm-error-banner">{error}</div>}

            <div className="rsm-section-footer">
              <button className="rsm-ghost-btn2" onClick={() => setActiveSection("activities")}>← Back</button>
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
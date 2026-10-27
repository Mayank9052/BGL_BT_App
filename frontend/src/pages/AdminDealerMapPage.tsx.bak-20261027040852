// src/pages/AdminDealerMapPage.tsx
// Dealer Mapping admin — CRUD + Excel Template / Export / Import.
//
// Add/Edit form:
//   • Dealer Name / Code / City / State → searchable ERP dealer dropdown
//     (fetchDealers()) with an "Enter manually" fallback.
//   • RSM / TSM / Commando dropdowns → sourced from the STAFF LOGINS
//     (Admin Users → Staff tab, i.e. users imported from ERP H_EmployeeMaster):
//         RSM dropdown      = active staff with Role "RSM"
//         TSM dropdown      = active staff with Role "TSM"
//         Commando dropdown = active staff with Role "Commando"
//     Picking a person also fills their email (placeholder @staff.bgauss.local
//     emails are never auto-filled). Typing a name not in the list still works.
//   • TSM / Commando are optional: the dropdown has "— No TSM / No Commando —"
//     and a "✕ Remove" link. Blank is saved as NULL (name AND email).
//
// IMPORT RULES (unchanged):
//   • Only "Dealer Name" is mandatory in the file.
//   • Cells containing NULL / N/A / None / - are treated as BLANK.
//   • BLANK cell = KEEP the existing DB value (partial update). Use Edit to clear a field.
//   • Match: Dealer Code first, else Dealer Name. Not found → created.
//   • Dealers missing from the file are NOT deleted.
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useMsal } from "@azure/msal-react";
import * as XLSX from "xlsx";
import {
  fetchDealerTeamMappings, createDealerTeamMapping, updateDealerTeamMapping,
  deleteDealerTeamMapping, bulkImportDealerTeamMappings,
  type DealerTeamMappingRow, type UpsertDealerTeamMapping,
  type BulkImportRow, type BulkImportError, type BulkImportResult,
} from "../services/dealerTeamMappingService";
import { fetchDealers, type DealerOption } from "../services/dealerService";
// ⬇ Use the SAME function/type AdminUsersPage.tsx uses for the Staff tab
//   (GET /api/employee-auth/list). Fix the path/names if they differ.
import { fetchStaffUsers, type StaffAccount } from "../services/employeeAuthService";
import SearchableSelect from "../components/SearchableSelect";
import { fetchDealerEligibility } from "../services/dealerService";                              // [BTL-2026-10-26c]
import { setDealerMappingStatus, refreshDealerTypes } from "../services/dealerStatusService";

// ═══════════════════════════════════════════════════════════════════════════
// EXCEL FORMAT — single source of truth for Template, Export and Import
// ═══════════════════════════════════════════════════════════════════════════
type ColKey =
  | "dealerName" | "dealerCode" | "city" | "state"
  | "rsm" | "rsmEmail" | "tsm" | "tsmEmail" | "commando" | "commandoEmail"
  | "dealerEmail" | "isEligible" | "dealerType";

const COLS: { key: ColKey; header: string; width: number }[] = [
  { key: "dealerName",    header: "Dealer Name*",                         width: 40 },
  { key: "dealerCode",    header: "Dealer Code",                          width: 14 },
  { key: "city",          header: "City",                                 width: 16 },
  { key: "state",         header: "State",                                width: 16 },
  { key: "rsm",           header: "RSM Name",                             width: 22 },
  { key: "rsmEmail",      header: "RSM Email",                            width: 30 },
  { key: "tsm",           header: "TSM Name",                             width: 22 },
  { key: "tsmEmail",      header: "TSM Email",                            width: 30 },
  { key: "commando",      header: "Commando Name",                        width: 20 },
  { key: "commandoEmail", header: "Commando Email",                       width: 30 },
  { key: "dealerEmail",   header: "Dealer Email",                         width: 34 },
  { key: "isEligible",    header: "Eligibility (Eligible / Non-Eligible)", width: 22 },
  { key: "dealerType",    header: "Dealer Type (Old / New)",              width: 16 },
];
const REQUIRED_KEYS: ColKey[] = ["dealerName"];
const EMAIL_KEYS: ColKey[]    = ["rsmEmail", "tsmEmail", "commandoEmail", "dealerEmail"];
const SHEET_NAME   = "Dealer Mapping";
const EXPORT_EXTRA = [{ header: "Last Updated (IST)", width: 18 }, { header: "Updated By", width: 30 }];

// "Dealer Name*", "DealerName*", "Dealer Type* (Old / New)" … all normalise to the same key
const normHeader = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");
const HEADER_KEY: Record<string, ColKey> = {
  ...Object.fromEntries(COLS.map((c) => [normHeader(c.header), c.key] as const)),
  rsm: "rsm", tsm: "tsm", commando: "commando", type: "dealerType",
  iseligible: "isEligible", eligible: "isEligible", eligibility: "isEligible",
  code: "dealerCode", location: "city",
};
const colLabel = (k: ColKey) =>
  (COLS.find((c) => c.key === k)?.header ?? k).replace("*", "").replace(/\s*\(.*\)/, "");

// SQL-export artefacts such as the literal text "NULL" are treated as blank.
const BLANK_TOKENS = /^(null|n\/a|none|-|—)$/i;
const clean = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return BLANK_TOKENS.test(s) ? "" : s;
};

const EMAIL_RX = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const firstBadEmail = (v: string): string | null => {
  for (const part of v.split(/[,;]/)) { const p = part.trim(); if (p && !EMAIL_RX.test(p)) return p; }
  return null;
};
const parseEligibility = (v: string): boolean | null => {
  const s = v.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["eligible", "yes", "y", "true", "1"].includes(s)) return true;
  if (["noneligible", "noteligible", "ineligible", "no", "n", "false", "0"].includes(s)) return false;
  return null;
};
const parseType = (v: string): "Old" | "New" | null => {
  const s = v.trim().toLowerCase();
  return s === "old" ? "Old" : s === "new" ? "New" : null;
};

const titleCase = (s: string): string =>
  (s ?? "").toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// ── Staff dropdown helpers ───────────────────────────────────────────────────
type StaffRole = "RSM" | "TSM" | "Commando";

// Options for one role, taken from the Staff-tab users (active only, de-duplicated).
const buildStaffOptions = (staff: StaffAccount[], role: StaffRole) => {
  const map = new Map<string, { value: string; label: string }>();
  for (const s of staff) {
    if (!s.isActive || (s.role ?? "").toLowerCase() !== role.toLowerCase()) continue;
    const tc = titleCase((s.displayName ?? "").trim());
    if (tc) map.set(tc.toLowerCase(), { value: tc, label: tc });
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
};

// Bulk-import creates fake emails like emp0687@staff.bgauss.local — never auto-fill those.
const realEmail = (e?: string | null) =>
  e && e.includes("@") && !e.toLowerCase().endsWith("@staff.bgauss.local") ? e : "";

// ── "None" choice for optional TSM / Commando (lets Edit clear the mapping) ──
const NONE = "__none__";
const noneLabel = (role: string) => `— No ${role} (leave blank) —`;
const withNone = (opts: { value: string; label: string }[], role: string) =>
  [{ value: NONE, label: noneLabel(role) }, ...opts];

// DD.MM.YYYY HH:mm (browser local = IST for users). Server sends UTC without "Z".
const pad = (n: number) => String(n).padStart(2, "0");
const fmtStamp = (iso?: string | null) => {
  if (!iso) return "";
  const s = /[zZ]$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const todayStamp = () => { const d = new Date(); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };

// Export writes real blanks (never the text "NULL") so a re-import round-trips cleanly.
const cellFor = (r: DealerTeamMappingRow, k: ColKey): string =>
  k === "isEligible" ? (r.isEligible ? "Eligible" : "Non-Eligible") : String((r as any)[k] ?? "");

function instructionsSheet() {
  const aoa = [
    ["BGauss BTL — Dealer Mapping import format"], [""],
    ["Column", "Rule"],
    ["Dealer Name*", "Required. Must be unique. Used for matching when Dealer Code is blank."],
    ["Dealer Code", "Recommended (ERP customer code). Matched first — most reliable."],
    ["City / State", "Optional."],
    ["RSM Name", "Required only when creating a NEW dealer. Blank on an existing dealer = keep current RSM."],
    ["RSM / TSM / Commando Email", "Optional, valid email. These people are cc'd on Notify Dealer."],
    ["Dealer Email", "Optional. Multiple allowed, comma-separated."],
    ["Eligibility", "Eligible / Non-Eligible (1 / 0 also accepted). Blank = keep current (new dealer → Eligible)."],
    ["Dealer Type", "Old / New. Blank = keep current."],
    ["Last Updated / Updated By", "Export only — ignored on import."],
    [""],
    ["How import works"],
    ["• Row found (by Dealer Code, else Dealer Name) → updated with the file values."],
    ["• Blank / NULL / N/A cell = existing value KEPT (not cleared). Use Edit in the app to clear a field (e.g. remove TSM)."],
    ["• Row not found → created."],
    ["• Dealers missing from the file are NOT deleted."],
    ["• Rows with errors are skipped and listed; valid rows still save."],
    [`• Do not rename the '${SHEET_NAME}' sheet or its column headers.`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 30 }, { wch: 95 }];
  return ws;
}

function downloadMappingWorkbook(rows: DealerTeamMappingRow[] | null, fileName: string) {
  const isExport = rows !== null;
  const header = [...COLS.map((c) => c.header), ...(isExport ? EXPORT_EXTRA.map((e) => e.header) : [])];
  const body = (rows ?? []).map((r) => [
    ...COLS.map((c) => cellFor(r, c.key)),
    fmtStamp(r.updatedAt), r.updatedByEmail ?? "",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws["!cols"] = [...COLS.map((c) => ({ wch: c.width })), ...(isExport ? EXPORT_EXTRA.map((e) => ({ wch: e.width })) : [])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, instructionsSheet(), "Instructions");
  XLSX.writeFile(wb, fileName);
}

function downloadErrorReport(errors: BulkImportError[]) {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Excel Row", "Dealer Name", "Error"],
    ...errors.map((e) => [e.sourceRow, e.dealerName, e.message]),
  ]);
  ws["!cols"] = [{ wch: 10 }, { wch: 40 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Import Errors");
  XLSX.writeFile(wb, `Dealer_Mapping_Import_Errors_${todayStamp()}.xlsx`);
}

async function parseImportFile(file: File): Promise<{
  rows: BulkImportRow[]; issues: BulkImportError[]; missingHeaders: string[];
}> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[SHEET_NAME] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("No sheet found in the file.");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false, blankrows: true });
  if (!aoa.length) throw new Error("The sheet is empty.");

  const colIndex: Partial<Record<ColKey, number>> = {};
  (aoa[0] as unknown[]).forEach((h, i) => {
    const k = HEADER_KEY[normHeader(String(h ?? ""))];
    if (k && colIndex[k] === undefined) colIndex[k] = i;
  });
  const missingHeaders = REQUIRED_KEYS.filter((k) => colIndex[k] === undefined).map(colLabel);
  if (missingHeaders.length) return { rows: [], issues: [], missingHeaders };

  const rows: BulkImportRow[] = [];
  const issues: BulkImportError[] = [];
  const seenNames = new Map<string, number>();
  const seenCodes = new Map<string, number>();

  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[];
    const get = (k: ColKey) => { const idx = colIndex[k]; return idx === undefined ? "" : clean(r[idx]); };
    if (COLS.every((c) => get(c.key) === "")) continue;          // blank row

    const excelRow = i + 1;
    const name = get("dealerName");
    const code = get("dealerCode");
    const problems: string[] = [];

    if (!name) problems.push("Dealer Name is blank");

    // Blank = keep existing value in DB → only validate when a value is present
    const eligRaw = get("isEligible");
    let elig: boolean | null = null;
    if (eligRaw) {
      elig = parseEligibility(eligRaw);
      if (elig === null) problems.push(`Eligibility "${eligRaw}" must be Eligible or Non-Eligible`);
    }
    const typeRaw = get("dealerType");
    let type: "Old" | "New" | null = null;
    if (typeRaw) {
      type = parseType(typeRaw);
      if (!type) problems.push(`Dealer Type "${typeRaw}" must be Old or New`);
    }

    for (const k of EMAIL_KEYS) {
      const v = get(k);
      const bad = v ? firstBadEmail(v) : null;
      if (bad) problems.push(`${colLabel(k)} "${bad}" is not a valid email`);
    }

    if (name) {
      const k = name.toLowerCase();
      if (seenNames.has(k)) problems.push(`Duplicate Dealer Name (also on row ${seenNames.get(k)})`);
      else seenNames.set(k, excelRow);
    }
    if (code) {
      const k = code.toLowerCase();
      if (seenCodes.has(k)) problems.push(`Duplicate Dealer Code (also on row ${seenCodes.get(k)})`);
      else seenCodes.set(k, excelRow);
    }

    if (problems.length) { issues.push({ sourceRow: excelRow, dealerName: name, message: problems.join("; ") }); continue; }

    rows.push({
      sourceRow: excelRow,
      data: {
        dealerName: name, dealerCode: code, city: get("city"), state: get("state"),
        rsm: get("rsm"), rsmEmail: get("rsmEmail"), tsm: get("tsm"), tsmEmail: get("tsmEmail"),
        commando: get("commando"), commandoEmail: get("commandoEmail"), dealerEmail: get("dealerEmail"),
        isEligible: elig,              // null = keep existing
        dealerType: type ?? "",        // ""   = keep existing
      },
    });
  }
  return { rows, issues, missingHeaders: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// Dealer search dropdown — fetched from ERP (same source as AdminUsersPage /
// RSMForm). Selecting a dealer hands the full DealerOption back to the
// caller so it can auto-fill Dealer Code / City / State / RSM / TSM /
// Commando in one shot.
// ═══════════════════════════════════════════════════════════════════════════
function DealerSearchSelect({ dealers, loading, value, onSelect }: {
  dealers: DealerOption[]; loading: boolean; value: string; // value = dealerCode (if picked from ERP)
  onSelect: (d: DealerOption | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [open,   setOpen]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = dealers.find((d) => d.customerCode === value);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = dealers.filter((d) =>
    !search ||
    d.customerName.toLowerCase().includes(search.toLowerCase()) ||
    d.customerCode.toLowerCase().includes(search.toLowerCase()) ||
    (d.city ?? "").toLowerCase().includes(search.toLowerCase())
  ).slice(0, 50);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={() => { if (!loading) setOpen((v) => !v); }}
        style={{ border: "1.5px solid #e2e8f0", borderRadius: 7, padding: "7px 11px",
          background: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 13,
          color: selected ? "#0a2540" : "#9ca3af", display: "flex",
          justifyContent: "space-between", alignItems: "center", minHeight: 38 }}>
        <span>{loading ? "Loading dealers from ERP…" : selected
          ? `${titleCase(selected.customerName)} (${selected.customerCode})`
          : "🔍 Search ERP dealer…"}</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 1000, maxHeight: 280,
          display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Type dealer name or code…"
              style={{ width: "100%", border: "1.5px solid #e2e8f0", borderRadius: 6,
                padding: "6px 10px", fontSize: 13, outline: "none",
                boxSizing: "border-box" as const }}/>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {value && (
              <div onClick={() => { onSelect(null); setSearch(""); setOpen(false); }}
                style={{ padding: "8px 12px", fontSize: 12, color: "#ef4444",
                  cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}>
                ✕ Clear selection
              </div>
            )}
            {filtered.length === 0
              ? <div style={{ padding: "16px 12px", fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                  {dealers.length === 0 ? "No ERP dealers loaded" : "No results found"}
                </div>
              : filtered.map((d) => (
                <div key={d.customerCode}
                  onClick={() => { onSelect(d); setSearch(""); setOpen(false); }}
                  style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13,
                    background: d.customerCode === value ? "#eff6ff" : "transparent",
                    borderBottom: "1px solid #f9fafb" }}>
                  <div style={{ fontWeight: 600, color: "#0a2540" }}>{titleCase(d.customerName)}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>
                    Code: {d.customerCode}
                    {(d.city || d.state) && ` · ${[d.city, d.state].filter(Boolean).map((v) => titleCase(v!)).join(", ")}`}
                    {d.rsmName && ` · RSM: ${titleCase(d.rsmName)}`}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
const emptyForm: UpsertDealerTeamMapping = {
  dealerName: "", dealerCode: "", city: "", state: "",
  rsm: "", rsmEmail: "", tsm: "", tsmEmail: "",
  commando: "", commandoEmail: "", dealerEmail: "",
  isEligible: true, dealerType: "Old",
};

export default function AdminDealerMapPage() {
  const { instance } = useMsal();

  const [rows,    setRows]    = useState<DealerTeamMappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState("");

  const [showForm,  setShowForm]  = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form,      setForm]      = useState<UpsertDealerTeamMapping>(emptyForm);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── ERP dealers (dealer dropdown) + Staff logins (RSM / TSM / Commando dropdowns) ──
  const [erpDealers, setErpDealers] = useState<DealerOption[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffAccount[]>([]);
  const [erpLoading, setErpLoading] = useState(false);
  // "erp" = pick dealer from ERP dropdown (auto-fills code/city/state/team).
  // "manual" = type everything by hand — for dealers not yet in ERP.
  const [dealerSourceMode, setDealerSourceMode] = useState<"erp" | "manual">("erp");
  const [selectedErpDealerCode, setSelectedErpDealerCode] = useState("");
  // ── [BTL-2026-10-26c] Active / Inactive · Old/New from RRERP · inactive-staff checks ──
  const [statusView,  setStatusView]  = useState<"all" | "active" | "inactive">("all");
  const [typeAuto,    setTypeAuto]    = useState<{ type: "Old" | "New"; reason: string } | null>(null);
  const [typeLoading, setTypeLoading] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [notice,      setNotice]      = useState<string | null>(null);
  const [statusBusy,  setStatusBusy]  = useState<number | null>(null);
  const isRowActive = (r: DealerTeamMappingRow) => (r as unknown as { isActive?: boolean }).isActive !== false;
  const visibleRows = useMemo(() => rows.filter((r) =>
    statusView === "all" || (statusView === "active") === isRowActive(r)), [rows, statusView]);
  // Staff marked Inactive (Users → Staff). A name that an ACTIVE person also uses is not flagged.
  const inactiveStaff = useMemo(() => {
    const active = new Set<string>(), names = new Set<string>(), emails = new Set<string>();
    for (const s of staffUsers) { const n = titleCase((s.displayName ?? "").trim()).toLowerCase(); if (s.isActive && n) active.add(n); }
    for (const s of staffUsers) {
      if (s.isActive) continue;
      const n = titleCase((s.displayName ?? "").trim()).toLowerCase();
      if (n && !active.has(n)) names.add(n);
      const e = (s.email ?? "").trim().toLowerCase();
      if (e) emails.add(e);
    }
    return { names, emails };
  }, [staffUsers]);
  const isInactiveStaff = (name?: string | null, email?: string | null) =>
    (!!name && inactiveStaff.names.has(titleCase(name.trim()).toLowerCase())) ||
    (!!email && email.split(/[,;]/).some((e) => inactiveStaff.emails.has(e.trim().toLowerCase())));
  const inactiveBadge = (
    <span title="Inactive in Users → Staff — re-assign this dealer"
      style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#991b1b", background: "#fee2e2",
        border: "1px solid #fecaca", borderRadius: 4, padding: "0 5px" }}>INACTIVE</span>
  );
  // Old / New from RRERP (same rule as RSM Form and CAC limit) — the field is locked when found
  const autoType = async (code: string) => {
    if (!code) { setTypeAuto(null); return; }
    setTypeLoading(true);
    try {
      const e = await fetchDealerEligibility(code, instance);
      const t: "Old" | "New" = e.dealerType === "New" ? "New" : "Old";
      setTypeAuto({ type: t, reason: e.eligibilityReason });
      setForm((f) => ({ ...f, dealerType: t }));
    } catch { setTypeAuto(null); }
    finally { setTypeLoading(false); }
  };
  const handleStatus = async (row: DealerTeamMappingRow, active: boolean) => {
    if (!active && !window.confirm(`Mark "${row.dealerName}" INACTIVE?\n\nThe dealer will be hidden from the RSM Form and its dealer login(s) will be blocked.`)) return;
    setStatusBusy(row.id); setError(null);
    try {
      const r = await setDealerMappingStatus(row.id, active, instance);
      setRows((prev) => prev.map((x) => (x.id === row.id ? ({ ...x, isActive: r.isActive } as DealerTeamMappingRow) : x)));
      setNotice(`${row.dealerName} is now ${active ? "Active" : "Inactive"}` +
        (r.loginsUpdated ? ` · ${r.loginsUpdated} dealer login(s) ${active ? "re-activated" : "blocked"}` : "") + ".");
    } catch (e) { setError(e instanceof Error ? e.message : "Status change failed."); }
    finally { setStatusBusy(null); }
  };
  const handleRefreshTypes = async () => {
    setRefreshing(true); setError(null);
    try {
      const r = await refreshDealerTypes(instance);
      setNotice(`Old / New refreshed from RRERP (last ${r.windowMonths} months): ${r.checked} dealers checked, ${r.changed} changed.`);
      await load(search || undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); }
    finally { setRefreshing(false); }
  };

  // Excel
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting,    setExporting]    = useState(false);
  const [parsing,      setParsing]      = useState(false);
  const [preview,      setPreview]      = useState<{ fileName: string; rows: BulkImportRow[]; issues: BulkImportError[] } | null>(null);
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState<(BulkImportResult & { fileName: string }) | null>(null);
  const [showResultErrors, setShowResultErrors] = useState(false);

  const load = useCallback(async (q?: string) => {
    setLoading(true); setError(null);
    try { setRows(await fetchDealerTeamMappings(instance, q)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load dealer mappings."); }
    finally { setLoading(false); }
  }, [instance]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Load ERP dealers + staff logins once, in the background (not blocking the
  // page) so the dropdowns are ready by the time the modal opens.
  useEffect(() => {
    setErpLoading(true);
    Promise.all([
      fetchDealers(instance).catch(() => [] as DealerOption[]),
      fetchStaffUsers(instance).catch(() => [] as StaffAccount[]),
    ])
      .then(([dealers, staff]) => { setErpDealers(dealers); setStaffUsers(staff); })
      .finally(() => setErpLoading(false));
  }, [instance]);

  // ── RSM / TSM / Commando options — straight from the Staff tab users ──────
  const rsmOptions      = useMemo(() => buildStaffOptions(staffUsers, "RSM"),      [staffUsers]);
  const tsmOptions      = useMemo(() => buildStaffOptions(staffUsers, "TSM"),      [staffUsers]);
  const commandoOptions = useMemo(() => buildStaffOptions(staffUsers, "Commando"), [staffUsers]);
  // TSM / Commando are optional → first option clears the mapping
  const tsmSelectOptions      = useMemo(() => withNone(tsmOptions, "TSM"),           [tsmOptions]);
  const commandoSelectOptions = useMemo(() => withNone(commandoOptions, "Commando"), [commandoOptions]);

  // Picking a staff member fills the name AND their email (email stays editable).
  // A typed-in name that isn't in the list just sets the name and leaves the email alone.
  const pickStaff = (
    role: StaffRole,
    nameKey: "rsm" | "tsm" | "commando",
    emailKey: "rsmEmail" | "tsmEmail" | "commandoEmail",
  ) => (v: string) => {
    const match = staffUsers.find((s) =>
      s.isActive &&
      (s.role ?? "").toLowerCase() === role.toLowerCase() &&
      titleCase((s.displayName ?? "").trim()).toLowerCase() === v.trim().toLowerCase());
    setForm((f) => ({
      ...f,
      [nameKey]: v,
      ...(match ? { [emailKey]: realEmail(match.email) } : {}),
    }));
  };

  // Same as pickStaff, plus "— No TSM / No Commando —" → clears name AND email.
  const pickOptionalStaff = (
    role: "TSM" | "Commando",
    nameKey: "tsm" | "commando",
    emailKey: "tsmEmail" | "commandoEmail",
  ) => {
    const pick = pickStaff(role, nameKey, emailKey);
    return (v: string) =>
      v === NONE || v === noneLabel(role)
        ? setForm((f) => ({ ...f, [nameKey]: "", [emailKey]: "" }))
        : pick(v);
  };
  const clearStaff = (nameKey: "tsm" | "commando", emailKey: "tsmEmail" | "commandoEmail") =>
    setForm((f) => ({ ...f, [nameKey]: "", [emailKey]: "" }));

  const openCreate = () => {
    setEditingId(null); setForm(emptyForm); setFormError(null);
    setDealerSourceMode("erp"); setSelectedErpDealerCode(""); setTypeAuto(null);
    setShowForm(true);
  };
  const openEdit = (row: DealerTeamMappingRow) => {
    setEditingId(row.id);
    setForm({
      dealerName: row.dealerName, dealerCode: row.dealerCode ?? "", city: row.city ?? "", state: row.state ?? "",
      rsm: row.rsm, rsmEmail: row.rsmEmail ?? "", tsm: row.tsm ?? "", tsmEmail: row.tsmEmail ?? "",
      commando: row.commando ?? "", commandoEmail: row.commandoEmail ?? "", dealerEmail: row.dealerEmail ?? "",
      isEligible: row.isEligible, dealerType: row.dealerType ?? "Old",
    });
    // Editing an existing mapping always starts in "manual" view — the fields
    // are already filled from the DB. Switching to "erp" re-picks a dealer
    // and overwrites Code/City/State/RSM/TSM/Commando from ERP, if needed.
    setDealerSourceMode("manual");
    setSelectedErpDealerCode(row.dealerCode ?? "");
    if (row.dealerCode) autoType(row.dealerCode); else setTypeAuto(null);   // [BTL-2026-10-26c]
    setFormError(null); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setFormError(null); };

  // Dealer picked from the ERP dropdown — auto-fill everything we can
  const handleErpDealerSelect = (d: DealerOption | null) => {
    if (!d) {
      setSelectedErpDealerCode("");
      setTypeAuto(null);
      return;
    }
    setSelectedErpDealerCode(d.customerCode);
    autoType(d.customerCode);   // [BTL-2026-10-26c] Old/New from RRERP
    setForm((f) => ({
      ...f,
      dealerName: titleCase(d.customerName),
      dealerCode: d.customerCode,
      city:       d.city  ? titleCase(d.city)  : f.city,
      state:      d.state ? titleCase(d.state) : f.state,
      // Pre-fill team from ERP, but only if the field is still empty — never
      // clobber something the admin already typed/edited in this session.
      rsm:      f.rsm.trim()      || (d.rsmName      ? titleCase(d.rsmName)      : f.rsm),
      tsm:      f.tsm?.trim()     || (d.tsmName      ? titleCase(d.tsmName)      : f.tsm),
      commando: f.commando?.trim()|| (d.commandoName ? titleCase(d.commandoName) : f.commando),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.dealerName.trim()) { setFormError("Dealer name is required."); return; }
    if (!form.rsm.trim())        { setFormError("RSM name is required."); return; }
    // [BTL-2026-10-26c] inactive staff cannot be mapped
    if (isInactiveStaff(form.rsm, form.rsmEmail)) { setFormError(`RSM "${form.rsm}" is Inactive — pick an active RSM.`); return; }
    if (form.tsm?.trim() && isInactiveStaff(form.tsm, form.tsmEmail)) { setFormError(`TSM "${form.tsm}" is Inactive — pick an active TSM or "No TSM".`); return; }
    if (form.commando?.trim() && isInactiveStaff(form.commando, form.commandoEmail)) { setFormError(`Commando "${form.commando}" is Inactive — pick an active Commando or "No Commando".`); return; }
    setSaving(true); setFormError(null);
    try {
      // Blank optional team fields → NULL in DB (Edit clears; Excel import blank still = keep).
      const payload = {
        ...form,
        tsm:           form.tsm?.trim()           || null,
        tsmEmail:      form.tsmEmail?.trim()      || null,
        commando:      form.commando?.trim()      || null,
        commandoEmail: form.commandoEmail?.trim() || null,
      } as UpsertDealerTeamMapping;
      if (editingId !== null) await updateDealerTeamMapping(editingId, payload, instance);
      else                    await createDealerTeamMapping(payload, instance);
      closeForm();
      await load(search || undefined);
    } catch (e) { setFormError(e instanceof Error ? e.message : "Failed to save."); }
    finally { setSaving(false); }
  };

  const handleDelete = async (row: DealerTeamMappingRow) => {
    if (!window.confirm(`Remove "${row.dealerName}" from the dealer mapping?`)) return;
    try {
      await deleteDealerTeamMapping(row.id, instance);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to delete."); }
  };

  // ── Excel actions ─────────────────────────────────────────────────────────
  const handleTemplate = () => downloadMappingWorkbook(null, "Dealer_Mapping_Template.xlsx");

  const handleExport = async () => {
    setExporting(true); setError(null);
    try {
      const all = await fetchDealerTeamMappings(instance);   // always full list, ignores search box
      downloadMappingWorkbook(all, `Dealer_Mapping_${todayStamp()}.xlsx`);
    } catch (e) { setError(e instanceof Error ? e.message : "Export failed."); }
    finally { setExporting(false); }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null); setImportResult(null); setParsing(true);
    try {
      const parsed = await parseImportFile(file);
      if (parsed.missingHeaders.length) {
        setError(`Missing required column(s): ${parsed.missingHeaders.join(", ")}. Download the Template for the correct format.`);
        return;
      }
      if (!parsed.rows.length && !parsed.issues.length) { setError("No data rows found in the file."); return; }
      setPreview({ fileName: file.name, rows: parsed.rows, issues: parsed.issues });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not read the file."); }
    finally { setParsing(false); }
  };

  const confirmImport = async () => {
    if (!preview || !preview.rows.length) return;
    setImporting(true);
    try {
      const res = await bulkImportDealerTeamMappings(preview.rows, instance);
      const allErrors = [...preview.issues, ...res.errors].sort((a, b) => a.sourceRow - b.sourceRow);
      setImportResult({ ...res, errors: allErrors, fileName: preview.fileName });
      setShowResultErrors(false);
      setPreview(null);
      await load(search || undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); setPreview(null); }
    finally { setImporting(false); }
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0",
    fontSize: 13, outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase",
    letterSpacing: "0.04em", marginBottom: 4, display: "block",
  };
  const toolBtn = (bg: string, color: string, border: string, disabled = false): React.CSSProperties => ({
    background: bg, color, border: `1px solid ${border}`, borderRadius: 8, padding: "9px 14px",
    fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  });
  const removeLinkStyle: React.CSSProperties = {
    background: "none", border: "none", color: "#dc2626", fontSize: 11, fontWeight: 600,
    cursor: "pointer", padding: "4px 0 0",
  };
  const blankHintStyle: React.CSSProperties = { fontSize: 11, color: "#92400e", marginTop: 4 };

  return (
    <div style={{ padding: "2px 10px 40px", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0a2540", margin: "0 0 4px" }}>Dealer Mapping</h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
            RSM / TSM / Commando assignment per dealer, plus eligibility and dealer-type classification —
            single source for RSM Form auto-fill, Notify Dealer cc and the Dashboard Old/New/Non-Eligible split.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFile} />
          <button onClick={handleTemplate} style={toolBtn("#fff", "#374151", "#e2e8f0")}
            title="Blank sheet in the import format">⬇ Template</button>
          <button onClick={handleExport} disabled={exporting} style={toolBtn("#eff6ff", "#1e40af", "#bfdbfe", exporting)}
            title="All current mappings, in the import format">{exporting ? "Exporting…" : "⬇ Export Excel"}</button>
          <button onClick={() => fileRef.current?.click()} disabled={parsing || importing}
            style={toolBtn("#fffbeb", "#92400e", "#fde68a", parsing || importing)}>
            {parsing ? "Reading…" : "📥 Import Excel"}
          </button>
          <button onClick={handleRefreshTypes} disabled={refreshing} style={toolBtn("#f0fdf4", "#166534", "#bbf7d0", refreshing)}
            title="Re-calculate Old / New for every mapped dealer from RRERP (first sale / onboarding within the last 3 months = New). Also runs automatically every 12 h.">
            {refreshing ? "Refreshing…" : "↻ Old/New from RRERP"}</button>
          <button onClick={openCreate} style={{ ...toolBtn("#16a34a", "#fff", "#16a34a"), padding: "9px 20px" }}>
            + Add Dealer Mapping
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "4px solid #ef4444",
          borderRadius: 8, padding: "11px 14px", marginBottom: 16, fontSize: 13, color: "#991b1b", wordBreak: "break-word" }}>⚠ {error}</div>
      )}

      {notice && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderLeft: "4px solid #16a34a", borderRadius: 8,
          padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#166534", display: "flex", alignItems: "center", gap: 10 }}>
          ✓ {notice}
          <button onClick={() => setNotice(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#6b7280", cursor: "pointer" }}>✕</button>
        </div>
      )}
      {importResult && (
        <div style={{ background: importResult.errors.length ? "#fffbeb" : "#f0fdf4",
          border: `1px solid ${importResult.errors.length ? "#fde68a" : "#bbf7d0"}`,
          borderLeft: `4px solid ${importResult.errors.length ? "#f59e0b" : "#16a34a"}`,
          borderRadius: 8, padding: "11px 14px", marginBottom: 16, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <strong style={{ color: "#0a2540" }}>Import complete — {importResult.fileName}</strong>
            <span>✚ Created <b>{importResult.created}</b></span>
            <span>✎ Updated <b>{importResult.updated}</b></span>
            <span>＝ Unchanged <b>{importResult.unchanged}</b></span>
            <span style={{ color: importResult.errors.length ? "#b91c1c" : "#166534" }}>✕ Skipped <b>{importResult.errors.length}</b></span>
            {importResult.errors.length > 0 && (
              <>
                <button onClick={() => setShowResultErrors((v) => !v)}
                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {showResultErrors ? "Hide errors ▲" : "View errors ▼"}
                </button>
                <button onClick={() => downloadErrorReport(importResult.errors)}
                  style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  ⬇ Error report
                </button>
              </>
            )}
            <button onClick={() => setImportResult(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", color: "#6b7280", cursor: "pointer" }}>✕</button>
          </div>
          {showResultErrors && <IssueTable issues={importResult.errors} />}
        </div>
      )}

      <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search dealer name, code, RSM, TSM, city, state…"
          style={{ ...inputStyle, maxWidth: 400 }} />
        <div style={{ display: "inline-flex", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          {(["all", "active", "inactive"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setStatusView(v)}
              style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                background: statusView === v ? (v === "inactive" ? "#991b1b" : v === "active" ? "#16a34a" : "#0a2540") : "#fff",
                color: statusView === v ? "#fff" : "#374151" }}>
              {v === "all" ? `All (${rows.length})` : v === "active" ? `Active (${rows.filter(isRowActive).length})` : `Inactive (${rows.filter((r) => !isRowActive(r)).length})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#0a2540" }}>
              {["Dealer", "Code", "City / State", "RSM", "TSM", "Commando", "Eligibility", "Type", "Status", ""].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#94a3b8",
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontStyle: "italic" }}>
                {search ? "No dealers match your search." : "No dealer mappings yet — Add Dealer Mapping or Import Excel."}
              </td></tr>
            ) : visibleRows.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9", opacity: isRowActive(r) ? 1 : 0.6 }}>
                <td style={{ padding: "9px 12px", fontWeight: 600, color: "#0a2540" }}>
                  {r.dealerName}
                  {r.dealerEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.dealerEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11, color: "#374151" }}>{r.dealerCode ?? "—"}</td>
                <td style={{ padding: "9px 12px", fontSize: 12 }}>{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ fontWeight: 600 }}>{r.rsm}{isInactiveStaff(r.rsm, r.rsmEmail) && inactiveBadge}</div>
                  {r.rsmEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.rsmEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <div>{r.tsm || <span style={{ color: "#cbd5e1" }}>—</span>}{!!r.tsm && isInactiveStaff(r.tsm, r.tsmEmail) && inactiveBadge}</div>
                  {r.tsmEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.tsmEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <div>{r.commando || <span style={{ color: "#cbd5e1" }}>—</span>}{!!r.commando && isInactiveStaff(r.commando, r.commandoEmail) && inactiveBadge}</div>
                  {r.commandoEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.commandoEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12,
                    background: r.isEligible ? "#dcfce7" : "#fee2e2", color: r.isEligible ? "#166534" : "#991b1b" }}>
                    {r.isEligible ? "Eligible" : "Non-Eligible"}
                  </span>
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12,
                    background: r.dealerType === "New" ? "#eff6ff" : "#f1f5f9", color: r.dealerType === "New" ? "#1e40af" : "#374151" }}>
                    {r.dealerType ?? "—"}
                  </span>
                </td>
                <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "inline-flex", border: "1px solid #e2e8f0", borderRadius: 7, overflow: "hidden" }}>
                    <button type="button" disabled={statusBusy === r.id || isRowActive(r)} onClick={() => handleStatus(r, true)}
                      title="Dealer active — visible in RSM Form, dealer login allowed"
                      style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, border: "none",
                        cursor: isRowActive(r) ? "default" : "pointer",
                        background: isRowActive(r) ? "#16a34a" : "#fff", color: isRowActive(r) ? "#fff" : "#166534" }}>Active</button>
                    <button type="button" disabled={statusBusy === r.id || !isRowActive(r)} onClick={() => handleStatus(r, false)}
                      title="Dealer inactive (e.g. F&F done) — hidden from RSM Form, dealer login blocked"
                      style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, border: "none", borderLeft: "1px solid #e2e8f0",
                        cursor: !isRowActive(r) ? "default" : "pointer",
                        background: !isRowActive(r) ? "#dc2626" : "#fff", color: !isRowActive(r) ? "#fff" : "#991b1b" }}>Inactive</button>
                  </div>
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openEdit(r)}
                      style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af",
                        borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                    <button onClick={() => handleDelete(r)}
                      style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b",
                        borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && rows.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>
          {rows.length} dealer{rows.length !== 1 ? "s" : ""} mapped ·{" "}
          <strong style={{ color: "#166534" }}>{rows.filter((r) => r.isEligible).length}</strong> eligible ·{" "}
          <strong style={{ color: "#991b1b" }}>{rows.filter((r) => !r.isEligible).length}</strong> non-eligible ·{" "}
          <strong>{rows.filter((r) => !r.dealerType).length}</strong> without dealer type ·{" "}
          <strong>{rows.filter((r) => !r.dealerCode).length}</strong> without dealer code ·{" "}
          <strong>{rows.filter((r) => !r.tsm).length}</strong> without TSM ·{" "}
          <strong>{rows.filter((r) => !r.commando).length}</strong> without Commando ·{" "}<strong style={{ color: "#991b1b" }}>{rows.filter((r) => !isRowActive(r)).length}</strong> inactive
        </div>
      )}

      {/* ── Import preview modal ── */}
      {preview && (
        <div onClick={() => !importing && setPreview(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 14, maxWidth: 760, width: "100%", maxHeight: "90vh",
              overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ background: "#0a2540", padding: "16px 22px", borderRadius: "14px 14px 0 0", color: "#fff", fontWeight: 700, fontSize: 15 }}>
              Import preview — {preview.fileName}
            </div>
            <div style={{ padding: 22, fontSize: 13 }}>
              <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <span style={{ background: "#dcfce7", color: "#166534", padding: "6px 12px", borderRadius: 8, fontWeight: 700 }}>
                  ✓ {preview.rows.length} valid row{preview.rows.length !== 1 ? "s" : ""} ready
                </span>
                <span style={{ background: preview.issues.length ? "#fee2e2" : "#f1f5f9",
                  color: preview.issues.length ? "#991b1b" : "#6b7280", padding: "6px 12px", borderRadius: 8, fontWeight: 700 }}>
                  ✕ {preview.issues.length} row{preview.issues.length !== 1 ? "s" : ""} with errors (will be skipped)
                </span>
              </div>
              <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "#374151", lineHeight: 1.6 }}>
                <li>Matched by <b>Dealer Code</b>, else <b>Dealer Name</b>. Matched rows are <b>updated</b> with the file values — a <b>blank / NULL cell keeps the existing value</b>.</li>
                <li>New dealers are created (RSM Name required for new dealers; blank Eligibility → Eligible).</li>
                <li>Dealers not in the file are left unchanged. <b>Nothing is deleted.</b></li>
                <li>To remove a TSM / Commando from a dealer, use <b>Edit</b> → “No TSM” / “No Commando”.</li>
                <li>Recommended: take a backup export before importing.</li>
              </ul>
              {preview.issues.length > 0 && <IssueTable issues={preview.issues} />}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18, flexWrap: "wrap" }}>
                <button onClick={handleExport} disabled={exporting || importing} style={toolBtn("#eff6ff", "#1e40af", "#bfdbfe", exporting || importing)}>
                  {exporting ? "Exporting…" : "⬇ Backup current mapping"}
                </button>
                <button onClick={() => setPreview(null)} disabled={importing} style={toolBtn("#f1f5f9", "#374151", "#e2e8f0", importing)}>Cancel</button>
                <button onClick={confirmImport} disabled={importing || preview.rows.length === 0}
                  style={toolBtn("#16a34a", "#fff", "#16a34a", importing || preview.rows.length === 0)}>
                  {importing ? "Importing…" : `Import ${preview.rows.length} row${preview.rows.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit modal ── */}
      {showForm && (
        <div onClick={closeForm}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 14, maxWidth: 640, width: "100%",
              maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ background: "#0a2540", padding: "16px 22px", borderRadius: "14px 14px 0 0",
              display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
                {editingId !== null ? "Edit Dealer Mapping" : "Add Dealer Mapping"}
              </span>
              <button onClick={closeForm}
                style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
                  borderRadius: 6, width: 28, height: 28, cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={handleSave} style={{ padding: 22 }}>
              {formError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7,
                  padding: "8px 12px", fontSize: 12, color: "#991b1b", marginBottom: 14 }}>⚠ {formError}</div>
              )}

              {/* ── Dealer source toggle: ERP dropdown vs manual entry ── */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={() => setDealerSourceMode("erp")}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                    cursor: "pointer", border: `1.5px solid ${dealerSourceMode === "erp" ? "#2563eb" : "#e2e8f0"}`,
                    background: dealerSourceMode === "erp" ? "#eff6ff" : "#fff",
                    color: dealerSourceMode === "erp" ? "#1e40af" : "#6b7280" }}>
                  🔍 Pick from ERP
                </button>
                <button type="button" onClick={() => setDealerSourceMode("manual")}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                    cursor: "pointer", border: `1.5px solid ${dealerSourceMode === "manual" ? "#2563eb" : "#e2e8f0"}`,
                    background: dealerSourceMode === "manual" ? "#eff6ff" : "#fff",
                    color: dealerSourceMode === "manual" ? "#1e40af" : "#6b7280" }}>
                  ✎ Enter manually
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>
                    Dealer Name *{dealerSourceMode === "erp" && (
                      <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6, color: "#9ca3af" }}>
                        (select — auto-fills Code/City/State/Team)
                      </span>
                    )}
                  </label>
                  {dealerSourceMode === "erp" ? (
                    <>
                      <DealerSearchSelect
                        dealers={erpDealers} loading={erpLoading}
                        value={selectedErpDealerCode} onSelect={handleErpDealerSelect}/>
                      {form.dealerName && !selectedErpDealerCode && (
                        <div style={{ fontSize: 11, color: "#92400e", marginTop: 4 }}>
                          Currently: <b>{form.dealerName}</b> — pick from the list above, or switch to "Enter manually" to keep this.
                        </div>
                      )}
                      {!erpLoading && erpDealers.length === 0 && (
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                          No ERP dealers loaded — use "Enter manually" instead.
                        </div>
                      )}
                    </>
                  ) : (
                    <input style={inputStyle} value={form.dealerName} required
                      placeholder="Dealer name"
                      onChange={(e) => setForm((f) => ({ ...f, dealerName: e.target.value }))} />
                  )}
                </div>
                <div>
                  <label style={labelStyle}>
                    Dealer Code{dealerSourceMode === "erp" && selectedErpDealerCode && (
                      <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 4, color: "#16a34a" }}>✓ auto</span>
                    )}
                  </label>
                  <input style={{ ...inputStyle, background: dealerSourceMode === "erp" && selectedErpDealerCode ? "#f0fdf4" : "#fff" }}
                    value={form.dealerCode ?? ""} placeholder="e.g. D00123"
                    readOnly={dealerSourceMode === "erp" && !!selectedErpDealerCode}
                    onChange={(e) => setForm((f) => ({ ...f, dealerCode: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><label style={labelStyle}>City</label>
                  <input style={inputStyle} value={form.city ?? ""} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></div>
                <div><label style={labelStyle}>State</label>
                  <input style={inputStyle} value={form.state ?? ""} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} /></div>
              </div>

              <div style={{ height: 1, background: "#e2e8f0", margin: "14px 0" }} />

              <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 10px" }}>
                RSM / TSM / Commando — search &amp; select from the Staff logins (Users → Staff tab), or just type a name if it's not listed yet.
                TSM and Commando are optional — choose “No TSM / No Commando” to leave them blank.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><label style={labelStyle}>RSM Name *</label>
                  <SearchableSelect options={rsmOptions} value={form.rsm}
                    onChange={pickStaff("RSM", "rsm", "rsmEmail")}
                    placeholder="Search or type RSM name…" allowCreate={true} loading={erpLoading}/></div>
                <div><label style={labelStyle}>RSM Email</label>
                  <input style={inputStyle} type="email" value={form.rsmEmail ?? ""} onChange={(e) => setForm((f) => ({ ...f, rsmEmail: e.target.value }))} /></div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><label style={labelStyle}>TSM Name</label>
                  <SearchableSelect options={tsmSelectOptions} value={form.tsm ?? ""}
                    onChange={pickOptionalStaff("TSM", "tsm", "tsmEmail")}
                    placeholder="Search or type TSM name…" allowCreate={true} loading={erpLoading}/>
                  {form.tsm?.trim()
                    ? <button type="button" onClick={() => clearStaff("tsm", "tsmEmail")} style={removeLinkStyle}>
                        ✕ Remove TSM (save as blank)</button>
                    : editingId !== null && <div style={blankHintStyle}>No TSM mapped — will save as blank.</div>}
                </div>
                <div><label style={labelStyle}>TSM Email</label>
                  <input style={inputStyle} type="email" value={form.tsmEmail ?? ""} onChange={(e) => setForm((f) => ({ ...f, tsmEmail: e.target.value }))} /></div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><label style={labelStyle}>Commando Name</label>
                  <SearchableSelect options={commandoSelectOptions} value={form.commando ?? ""}
                    onChange={pickOptionalStaff("Commando", "commando", "commandoEmail")}
                    placeholder="Search or type Commando name…" allowCreate={true} loading={erpLoading}/>
                  {form.commando?.trim()
                    ? <button type="button" onClick={() => clearStaff("commando", "commandoEmail")} style={removeLinkStyle}>
                        ✕ Remove Commando (save as blank)</button>
                    : editingId !== null && <div style={blankHintStyle}>No Commando mapped — will save as blank.</div>}
                </div>
                <div><label style={labelStyle}>Commando Email</label>
                  <input style={inputStyle} type="email" value={form.commandoEmail ?? ""} onChange={(e) => setForm((f) => ({ ...f, commandoEmail: e.target.value }))} /></div>
              </div>

              {([["RSM", form.rsm, form.rsmEmail], ["TSM", form.tsm, form.tsmEmail], ["Commando", form.commando, form.commandoEmail]] as [string, string | null | undefined, string | null | undefined][])
                .filter(([, n, e]) => !!n?.trim() && isInactiveStaff(n, e))
                .map(([role, n]) => (
                  <div key={role} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "7px 12px",
                    fontSize: 12, color: "#991b1b", marginBottom: 10 }}>
                    ⚠ {role} "{n}" is <b>Inactive</b> — pick an active {role}{role !== "RSM" ? ` or "No ${role}"` : ""} before saving.
                  </div>
                ))}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Dealer Email</label>
                <input style={inputStyle} value={form.dealerEmail ?? ""} placeholder="Comma-separate if more than one"
                  onChange={(e) => setForm((f) => ({ ...f, dealerEmail: e.target.value }))} />
              </div>

              <div style={{ height: 1, background: "#e2e8f0", margin: "14px 0" }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
                <div><label style={labelStyle}>Eligibility</label>
                  <select style={inputStyle} value={form.isEligible ? "yes" : "no"}
                    onChange={(e) => setForm((f) => ({ ...f, isEligible: e.target.value === "yes" }))}>
                    <option value="yes">Eligible</option><option value="no">Non-Eligible</option>
                  </select></div>
                <div><label style={labelStyle}>Dealer Type{typeAuto && <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6, color: "#16a34a" }}>🔒 from RRERP</span>}</label>
                  <select style={{ ...inputStyle, background: typeAuto ? "#f0fdf4" : "#fff", cursor: typeAuto ? "not-allowed" : "pointer" }}
                    value={form.dealerType ?? "Old"} disabled={!!typeAuto || typeLoading}
                    onChange={(e) => setForm((f) => ({ ...f, dealerType: e.target.value }))}>
                    <option value="Old">Old</option><option value="New">New</option>
                  </select>
                  <div style={{ fontSize: 10, color: typeAuto ? "#166534" : "#9ca3af", marginTop: 3 }}>
                    {typeLoading ? "Checking RRERP…"
                      : typeAuto ? typeAuto.reason
                      : form.dealerCode
                        ? <button type="button" onClick={() => autoType(form.dealerCode ?? "")}
                            style={{ background: "none", border: "none", color: "#2563eb", fontSize: 10, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                            Get Old / New from RRERP</button>
                        : "Manual dealer (no Dealer Code) — choose Old / New"}
                  </div></div>
              </div>
              <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 18px" }}>
                These two fields drive the RSM Form (auto-filled, locked) and the Dashboard bucket
                (Eligible Old / Eligible New / Non-Eligible).
              </p>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" onClick={closeForm}
                  style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#374151",
                    borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={saving}
                  style={{ background: saving ? "#9ca3af" : "#16a34a", color: "#fff", border: "none",
                    borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
                  {saving ? "Saving…" : editingId !== null ? "Save Changes" : "+ Add Mapping"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueTable({ issues }: { issues: BulkImportError[] }) {
  return (
    <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #fecaca", borderRadius: 8, marginTop: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#fef2f2", position: "sticky", top: 0 }}>
            <th style={{ padding: "6px 10px", textAlign: "left", width: 70 }}>Row</th>
            <th style={{ padding: "6px 10px", textAlign: "left", width: 220 }}>Dealer</th>
            <th style={{ padding: "6px 10px", textAlign: "left" }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((e, i) => (
            <tr key={`${e.sourceRow}-${i}`} style={{ borderTop: "1px solid #fee2e2" }}>
              <td style={{ padding: "5px 10px", fontFamily: "monospace" }}>{e.sourceRow}</td>
              <td style={{ padding: "5px 10px" }}>{e.dealerName || "—"}</td>
              <td style={{ padding: "5px 10px", color: "#991b1b" }}>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
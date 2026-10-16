// src/pages/StaffDashboard.tsx
// Staff (RSM / TSM / Commando / ZSM) view of their team's proposals.
// Mirrors DealerDashboard's Post-Activity (Photos / Invoices / History) exactly,
// and opens proposals in a DealerDashboard-style read+log modal (not the
// Approver's edit/approve/reject modal — staff can view + log actuals only).
//
// CN (Credit Note): each approved activity's Post-Activity section shows the
// Credit Note panel. RSM → Approve / Reject CN. RSM/TSM/Commando → upload the
// dealer's invoice in BGauss's name. A banner lists CNs awaiting the RSM.
//
// Data: GET /api/proposals/my-team-proposals → ProposalResponse[]
// (all proposals of dealers mapped to this person in Dealer Mapping).

import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { DealerLoginResponse } from "../services/dealerAuthService";
import { getDealerToken } from "../services/dealerAuthService";
import { API_BASE_URL } from "../authConfig";
import type { ProposalResponse } from "../services/proposalService";
import CnPanel from "../components/CnPanel";
import { fetchCnReport, type CnReportRow } from "../services/cnService";
import "./DealerDashboard.css";

// ─── Formatters ───────────────────────────────────────────────────────────
const inrCompact = (v: number) => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${Math.round(v)}`;
};
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const API_BASE = (API_BASE_URL ?? "").replace(/\/$/, "");

// ─── GPS helper (same as DealerDashboard) ──────────────────────────────────
function captureGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}
const mapsUrl = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;
const DEFAULT_PLAN_PER_SETUP = 35;
// Local-date ISO (no UTC shift — toISOString() can roll back a day in IST)
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Post-Activity actual dates: proposal month + next month only (local dates, no UTC shift).
// e.g. September 2026 -> 2026-09-01 .. 2026-10-31; December 2026 -> 2026-12-01 .. 2027-01-31
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function getActualDateRange(month?: string | null, year?: string | number | null) {
  const mi = MONTHS.indexOf((month ?? "").trim());
  const y  = parseInt(String(year ?? ""), 10) || new Date().getFullYear();
  if (mi < 0) {
    const now = new Date();
    return { min: isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
             max: isoLocal(new Date(now.getFullYear(), now.getMonth() + 2, 0)),
             label: "current and next month" };
  }
  const nextName = MONTHS[(mi + 1) % 12];
  const nextYear = mi === 11 ? y + 1 : y;
  return { min: isoLocal(new Date(y, mi, 1)), max: isoLocal(new Date(y, mi + 2, 0)),
           label: `${MONTHS[mi]} ${y} – ${nextName} ${nextYear}` };
}

// ─── Media helpers ──────────────────────────────────────────────────────────
function mediaIcon(t: string | null) {
  if (!t) return "📎";
  if (t.startsWith("image/")) return "🖼";
  if (t.includes("pdf")) return "📄";
  if (t.startsWith("video/")) return "🎬";
  return "📎";
}
function isImage(t: string | null) { return !!t?.startsWith("image/"); }
function isVideo(t: string | null) { return !!t?.startsWith("video/"); }

function MediaViewer({ url, name, type, onClose }: { url: string; name: string; type: string | null; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ maxWidth: "92vw", maxHeight: "92vh", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: -40, right: 0, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 18, cursor: "pointer", borderRadius: 6, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        {isImage(type)
          ? <img src={url} alt={name} style={{ maxWidth: "88vw", maxHeight: "82vh", borderRadius: 8, display: "block" }} />
          : isVideo(type)
          ? <video src={url} controls autoPlay style={{ maxWidth: "88vw", maxHeight: "82vh", borderRadius: 8 }} />
          : <div style={{ background: "#fff", borderRadius: 12, padding: "40px 56px", textAlign: "center", minWidth: 300 }}>
              <div style={{ fontSize: 52, marginBottom: 14 }}>{mediaIcon(type)}</div>
              <p style={{ fontWeight: 600, marginBottom: 18, color: "#0a2540" }}>{name}</p>
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "#1e3a5f", color: "#fff", padding: "11px 28px", borderRadius: 8, textDecoration: "none", fontWeight: 600 }}>Open / Download ↗</a>
            </div>}
      </div>
    </div>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────
interface ProofMedia { id: string; fileUrl: string; fileName: string; fileType: string; capturedAt: string; latitude?: number | null; longitude?: number | null; }
interface DailyEntry {
  date: string; setupCount: number;
  enquiryPlanned: number; enquiryActual: number;
  testDrivePlanned: number; testDriveActual: number;
  bookingActual: number; retailActual: number; leadsPunched: number;
}
interface ActualEntry {
  actualStartDate: string; actualEndDate: string;
  mediaFile: File | null; mediaFileUrl: string | null; mediaFileName: string | null; mediaFileType: string | null;
  uploading: boolean; proofUploading: boolean; invoiceUploading: boolean;
  proofMedia: ProofMedia[]; invoiceMedia: ProofMedia[]; dailyEntries: DailyEntry[];
}

function buildDailyEntries(start?: string | null, end?: string | null): DailyEntry[] {
  if (!start || !end) return [];
  const entries: DailyEntry[] = [];
  const s = new Date(start), e = new Date(end), today = new Date();
  const cap = e < today ? e : today;
  for (const d = new Date(s); d <= cap; d.setDate(d.getDate() + 1)) {
    entries.push({ date: isoLocal(d), setupCount: 0, enquiryPlanned: 0, enquiryActual: 0, testDrivePlanned: 0, testDriveActual: 0, bookingActual: 0, retailActual: 0, leadsPunched: 0 });
  }
  return entries;
}

// ─── KPI Card ───────────────────────────────────────────────────────────────
const KpiCard = ({ label, value, sub, color, active, onClick, hint }: { label: string; value: string; sub?: string; color: string; active?: boolean; onClick?: () => void; hint?: string }) => (
  <div className="dash-kpi-card" onClick={onClick} style={{ borderTop: `4px solid ${color}`, cursor: onClick ? "pointer" : "default", outline: active ? `2px solid ${color}` : "none", background: active ? "#f0f9ff" : "#fff" }} title={hint}>
    <div className="dash-kpi-label">{label}</div>
    <div className="dash-kpi-value" style={{ color }}>{value}</div>
    {sub && <div className="dash-kpi-sub">{sub}</div>}
  </div>
);

// ─── Status Pill ────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Pending: { bg: "#fef3c7", color: "#92400e" },
  Approved: { bg: "#dcfce7", color: "#166534" },
  Rejected: { bg: "#fee2e2", color: "#991b1b" },
  NeedsRevision: { bg: "#fef9c3", color: "#713f12" },
};
const StatusPill = ({ status }: { status: string }) => {
  const c = STATUS_COLORS[status] ?? { bg: "#f1f5f9", color: "#374151" };
  return <span style={{ background: c.bg, color: c.color, borderRadius: 12, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{status === "NeedsRevision" ? "↩ Needs Revision" : status}</span>;
};

type ActiveFilter = "All" | "Pending" | "Approved" | "Rejected" | "NeedsRevision";

// ═══════════════════════════════════════════════════════════════════════════
export default function StaffDashboard({ staff }: { staff: DealerLoginResponse }) {
  const navigate = useNavigate();
  const isRsm = (staff.role ?? "").toUpperCase() === "RSM";

  const [proposals, setProposals] = useState<ProposalResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<ProposalResponse | null>(null);
  const [actualsData, setActualsData] = useState<Record<string, ActualEntry>>({});
  const [actualsLoading, setActualsLoading] = useState(false);
  const [openActualsId, setOpenActualsId] = useState<string | null>(null);
  const [openActualsPanel, setOpenActualsPanel] = useState<Record<string, "photos" | "invoices" | "history">>({});
  const toggleActualsPanel = (activityId: string, panel: "photos" | "invoices" | "history") =>
    setOpenActualsPanel((prev) => ({ ...prev, [activityId]: prev[activityId] === panel ? (undefined as any) : panel }));
  const [mediaViewer, setMediaViewer] = useState<{ url: string; name: string; type: string } | null>(null);

  // ── CN: activities waiting for action by this staff member ──────────────────
  const [cnAwaitingRsm, setCnAwaitingRsm] = useState<CnReportRow[]>([]);
  const [cnAwaitingInvoice, setCnAwaitingInvoice] = useState<CnReportRow[]>([]);

  const showToast = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // ── Load: /api/proposals/my-team-proposals must return ProposalResponse[] ──
  const loadProposals = useCallback(async () => {
    setLoading(true); setFetchError(null);
    try {
      const token = getDealerToken();
      if (!token) throw new Error("Not signed in.");
      const res = await fetch(`${API_BASE}/api/proposals/my-team-proposals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to load proposals (${res.status})`);
      }
      const data: ProposalResponse[] = await res.json();
      setProposals(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load proposals.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCnPending = useCallback(async () => {
    try {
      const [rsm, inv] = await Promise.all([
        fetchCnReport({ status: "SentForRsmApproval" }),
        fetchCnReport({ status: "RsmApproved" }),
      ]);
      setCnAwaitingRsm(rsm);
      setCnAwaitingInvoice(inv.filter((r) => !r.hasFinalInvoice));
    } catch { /* banner is informational — ignore */ }
  }, []);

  useEffect(() => { loadProposals(); loadCnPending(); }, [loadProposals, loadCnPending]);

  // ── Filters ────────────────────────────────────────────────────────────────
  const months = useMemo(() => ["All", ...Array.from(new Set(proposals.map((p) => p.month))).sort()], [proposals]);
  const years = useMemo(() => ["All", ...Array.from(new Set(proposals.map((p) => (p as any).year).filter(Boolean))).sort()], [proposals]);

  const baseFiltered = useMemo(() => proposals.filter((p) => {
    if (activeFilter !== "All" && p.status !== activeFilter) return false;
    if (monthFilter !== "All" && p.month !== monthFilter) return false;
    if (yearFilter !== "All" && (p as any).year !== yearFilter) return false;
    return true;
  }), [proposals, activeFilter, monthFilter, yearFilter]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return baseFiltered;
    return baseFiltered.filter((p) => [p.dealerName, p.month, p.location, p.status, p.tokenNumber, p.rsmName, (p as any).tsmName, p.commandoName].join(" ").toLowerCase().includes(q));
  }, [baseFiltered, search]);

  const hasFilter = activeFilter !== "All" || monthFilter !== "All" || yearFilter !== "All";
  const clearAll = () => { setActiveFilter("All"); setMonthFilter("All"); setYearFilter("All"); setSearch(""); };

  const src = hasFilter ? baseFiltered : proposals;
  const stats = useMemo(() => ({
    total: src.length,
    pending: src.filter((p) => p.status === "Pending").length,
    approved: src.filter((p) => p.status === "Approved").length,
    rejected: src.filter((p) => p.status === "Rejected").length,
    revision: src.filter((p) => p.status === "NeedsRevision").length,
    budget: src.filter((p) => p.status === "Approved").reduce((s, p) => s + p.totalBudget, 0),
    retail: src.reduce((s, p) => s + p.totalRetailTarget, 0),
  }), [src]);

  // ── Post-Activity init (same shape as DealerDashboard) ──────────────────────
  const initActuals = useCallback((p: ProposalResponse) => {
    const init: Record<string, ActualEntry> = {};
    p.activities.forEach((a) => {
      init[a.id] = {
        actualStartDate: a.actualStartDate?.split("T")[0] ?? "",
        actualEndDate: a.actualEndDate?.split("T")[0] ?? "",
        mediaFile: null, mediaFileUrl: a.mediaFileUrl ?? null,
        mediaFileName: a.mediaFileName ?? null, mediaFileType: a.mediaFileType ?? null,
        uploading: false, proofUploading: false, invoiceUploading: false,
        invoiceMedia: (a.mediaFiles ?? [])
          .filter((m) => m.fileType?.includes("pdf") || (!m.fileType?.startsWith("image/") && !m.fileType?.startsWith("video/")))
          .map((m) => ({ id: m.id, fileUrl: m.fileUrl, fileName: m.fileName, fileType: m.fileType, capturedAt: m.capturedAt ?? new Date().toISOString(), latitude: null, longitude: null })),
        proofMedia: (a.mediaFiles ?? [])
          .filter((m) => m.fileType?.startsWith("image/") || m.fileType?.startsWith("video/"))
          .map((m) => ({ id: m.id, fileUrl: m.fileUrl, fileName: m.fileName, fileType: m.fileType, capturedAt: m.capturedAt ?? new Date().toISOString(), latitude: m.latitude ?? null, longitude: m.longitude ?? null })),
        dailyEntries: (() => {
          const serverDaily = (a as any).dailyData;
          if (serverDaily) {
            try { const parsed = JSON.parse(serverDaily) as DailyEntry[]; if (Array.isArray(parsed) && parsed.length > 0) return parsed; } catch {}
          }
          return buildDailyEntries(a.actualStartDate ?? a.startDate, a.actualEndDate ?? a.endDate);
        })(),
      };
    });
    setActualsData(init);
  }, []);

  const openModal = (p: ProposalResponse) => {
    setSelected(p);
    initActuals(p);
    setOpenActualsId(null);
    setOpenActualsPanel({});
  };
  const closeModal = () => { setSelected(null); setActualsData({}); setOpenActualsId(null); setOpenActualsPanel({}); loadCnPending(); };

  // Open a proposal straight at one activity's Post-Activity (used by CN banner)
  const openActivity = (proposalId: string, activityId: string) => {
    const p = proposals.find((x) => x.id === proposalId);
    if (!p) { showToast("Proposal not found in your list — refresh the page.", false); return; }
    openModal(p);
    setOpenActualsId(activityId);
  };

  const setActualField = (id: string, key: "actualStartDate" | "actualEndDate", v: string) =>
    setActualsData((prev) => ({ ...prev, [id]: { ...prev[id], [key]: v } }));

  const setDailyField = (activityId: string, date: string, key: keyof DailyEntry, v: number) =>
    setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], dailyEntries: prev[activityId].dailyEntries.map((e) => (e.date === date ? { ...e, [key]: v } : e)) } }));

  const rebuildDailyEntries = (activityId: string, startDate: string, endDate: string) => {
    const fresh = buildDailyEntries(startDate, endDate);
    setActualsData((prev) => {
      const existing = prev[activityId]?.dailyEntries ?? [];
      const merged = fresh.map((ne) => existing.find((e) => e.date === ne.date) ?? ne);
      return { ...prev, [activityId]: { ...prev[activityId], dailyEntries: merged } };
    });
  };

  const toggleActuals = (activityId: string) => setOpenActualsId((prev) => (prev === activityId ? null : activityId));

  // ── Uploads — same staff JWT used for the dashboard's own auth ─────────────
  const staffJwt = () => getDealerToken() ?? "";

  const uploadFileStaff = async (file: File): Promise<{ url: string; fileName: string; fileType: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const resp = await fetch(`${API_BASE}/api/media/upload`, { method: "POST", headers: { Authorization: `Bearer ${staffJwt()}` }, body: fd });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    return { url: data.url || data.fileUrl, fileName: data.fileName || file.name, fileType: data.fileType || file.type };
  };

  const saveMediaToDb = async (proposalId: string, activityId: string, payload: object) => {
    const resp = await fetch(`${API_BASE}/api/proposals/${proposalId}/activities/${activityId}/media`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt()}` }, body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return await resp.json();
  };

  const handleProofUpload = async (activityId: string, files: FileList) => {
    const geoPromise = captureGeo();
    const proposalId = selected?.id;
    if (!proposalId) { showToast("No proposal selected.", false); return; }
    const fileArray = Array.from(files);
    setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], proofUploading: true } }));
    try {
      const geo = await geoPromise;
      const capturedAt = new Date().toISOString();
      for (const file of fileArray) {
        const uploaded = await uploadFileStaff(file);
        const saved = await saveMediaToDb(proposalId, activityId, { fileUrl: uploaded.url, fileName: uploaded.fileName, fileType: uploaded.fileType, capturedAt, latitude: geo?.lat ?? null, longitude: geo?.lng ?? null });
        const proof: ProofMedia = { id: saved.id ?? crypto.randomUUID(), fileUrl: saved.fileUrl ?? uploaded.url, fileName: saved.fileName ?? uploaded.fileName, fileType: saved.fileType ?? uploaded.fileType, capturedAt: saved.capturedAt ?? capturedAt, latitude: saved.latitude ?? geo?.lat ?? null, longitude: saved.longitude ?? geo?.lng ?? null };
        setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], proofMedia: [...prev[activityId].proofMedia, proof] } }));
      }
      showToast(geo ? "Photo(s) saved with GPS 📍" : "Photo(s) saved (no GPS)", true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed.", false);
    } finally {
      setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], proofUploading: false } }));
    }
  };

  const removeProof = (activityId: string, id: string) =>
    setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], proofMedia: prev[activityId].proofMedia.filter((m) => m.id !== id) } }));

  const handleInvoiceUpload = async (activityId: string, files: FileList) => {
    const proposalId = selected?.id;
    if (!proposalId) return;
    const fileArray = Array.from(files);
    setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], invoiceUploading: true } }));
    try {
      for (const file of fileArray) {
        const uploaded = await uploadFileStaff(file);
        const saved = await saveMediaToDb(proposalId, activityId, { fileUrl: uploaded.url, fileName: uploaded.fileName, fileType: uploaded.fileType, capturedAt: new Date().toISOString(), latitude: null, longitude: null });
        const inv: ProofMedia = { id: saved.id ?? crypto.randomUUID(), fileUrl: saved.fileUrl ?? uploaded.url, fileName: saved.fileName ?? uploaded.fileName, fileType: saved.fileType ?? uploaded.fileType, capturedAt: saved.capturedAt ?? new Date().toISOString(), latitude: null, longitude: null };
        setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], invoiceMedia: [...prev[activityId].invoiceMedia, inv] } }));
      }
      showToast(`${fileArray.length} invoice${fileArray.length > 1 ? "s" : ""} uploaded.`, true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed.", false);
    } finally {
      setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], invoiceUploading: false } }));
    }
  };

  const removeInvoice = (activityId: string, id: string) =>
    setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], invoiceMedia: prev[activityId].invoiceMedia.filter((m) => m.id !== id) } }));

  const handleDateWiseUpload = async (activityId: string, entryDate: string, files: FileList) => {
    const geoPromise = captureGeo();
    const proposalId = selected?.id;
    if (!proposalId) { showToast("No proposal selected.", false); return; }
    const fileArray = Array.from(files);
    try {
      const geo = await geoPromise;
      for (const file of fileArray) {
        const uploaded = await uploadFileStaff(file);
        const saved = await saveMediaToDb(proposalId, activityId, { fileUrl: uploaded.url, fileName: uploaded.fileName, fileType: uploaded.fileType, capturedAt: `${entryDate}T12:00:00.000Z`, latitude: geo?.lat ?? null, longitude: geo?.lng ?? null });
        const proof: ProofMedia = { id: saved.id ?? crypto.randomUUID(), fileUrl: saved.fileUrl ?? uploaded.url, fileName: saved.fileName ?? uploaded.fileName, fileType: saved.fileType ?? uploaded.fileType, capturedAt: saved.capturedAt ?? `${entryDate}T12:00:00.000Z`, latitude: saved.latitude ?? geo?.lat ?? null, longitude: saved.longitude ?? geo?.lng ?? null };
        setActualsData((prev) => ({ ...prev, [activityId]: { ...prev[activityId], proofMedia: [...prev[activityId].proofMedia, proof] } }));
      }
      showToast(geo ? `Photo saved for ${entryDate} with GPS 📍` : `Photo saved for ${entryDate}`, true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed.", false);
    }
  };

  // ── Save actuals — backend route is PATCH (PUT returned 405) ──────────────
  const saveActuals = async () => {
    if (!selected || actualsLoading) return;
    {
      const rng = getActualDateRange(selected.month, (selected as any).year);
      const bad = selected.activities.find(a => {
        const d = actualsData[a.id];
        return [d?.actualStartDate, d?.actualEndDate].some(v => !!v && (v < rng.min || v > rng.max));
      });
      if (bad) { showToast(`"${bad.activityType}": actual dates must be within ${rng.label}.`, false); return; }
      const badOrder = selected.activities.find(a => {
        const d = actualsData[a.id];
        return !!d?.actualStartDate && !!d?.actualEndDate && d.actualEndDate < d.actualStartDate;
      });
      if (badOrder) { showToast(`"${badOrder.activityType}": Actual End cannot be before Actual Start.`, false); return; }
    }
    setActualsLoading(true);
    try {
      const payload = selected.activities.map((a) => {
        const d = actualsData[a.id];
        return {
          activityId: a.id,
          actualStartDate: d?.actualStartDate || null,
          actualEndDate: d?.actualEndDate || null,
          mediaFileUrl: d?.mediaFileUrl ?? null,
          mediaFileName: d?.mediaFileName ?? null,
          mediaFileType: d?.mediaFileType ?? null,
          dailyData: d?.dailyEntries?.length ? JSON.stringify(d.dailyEntries) : null,
        };
      });
      const resp = await fetch(`${API_BASE}/api/proposals/${selected.id}/actuals`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt()}` }, body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error((await resp.text()) || `Save failed (${resp.status})`);
      const updated: ProposalResponse = await resp.json();
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setSelected(updated);
      initActuals(updated);
      showToast("Actuals saved.", true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed.", false);
    } finally {
      setActualsLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="dash-loading"><div className="dash-spinner" /><p>Loading your team's proposals…</p></div>
  );
  if (fetchError) return (
    <div className="dash-error">
      <h3>Failed to load proposals</h3>
      <p>{fetchError}</p>
      <button className="dash-retry-btn" onClick={() => window.location.reload()}>Retry</button>
    </div>
  );

  const cnBannerRows = isRsm ? cnAwaitingRsm : [];

  return (
    <div className="dash-root">
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: toast.ok ? "#166534" : "#991b1b", color: "#fff", borderRadius: 10, padding: "12px 20px", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", gap: 8 }}>
          {toast.ok ? "✓" : "✕"} {toast.msg}
        </div>
      )}
      {mediaViewer && <MediaViewer {...mediaViewer} onClose={() => setMediaViewer(null)} />}

      <div className="dash-header">
        <div>
          <h1 className="dash-title">{staff.displayName}'s Dashboard</h1>
          <p className="dash-subtitle">
            {staff.role} · {staff.dealerCode ? `Code: ${staff.dealerCode}` : staff.email} — proposals for your dealers
            {" · "}{proposals.length} proposal{proposals.length !== 1 ? "s" : ""} · {stats.approved} approved · {stats.pending} pending
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => navigate("/cn-tracker")}
            style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            💳 CN Tracker
          </button>
          <button className="dash-add-btn" onClick={() => navigate("/staff-proposal")}>+ New Proposal</button>
        </div>
      </div>

      {/* ══ CN — awaiting this RSM's approval ══ */}
      {cnBannerRows.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: "#92400e", fontSize: 13, marginBottom: 8 }}>
            💳 {cnBannerRows.length} Credit Note request{cnBannerRows.length !== 1 ? "s" : ""} awaiting your approval
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cnBannerRows.slice(0, 10).map((r) => (
              <div key={r.activityId} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                <span style={{ fontFamily: "monospace", color: "#1e3a5f", fontWeight: 600 }}>{r.tokenNumber}</span>
                <span style={{ fontWeight: 600, color: "#0a2540" }}>{r.dealerName}</span>
                <span style={{ color: "#6b7280" }}>{r.activityName} · {r.month} {r.year}</span>
                <span style={{ color: "#374151" }}>Leads {r.actualLeads}/{r.approvedLeads} · Retail {r.actualRetail}/{r.approvedRetail}</span>
                <button onClick={() => openActivity(r.proposalId, r.activityId)}
                  style={{ marginLeft: "auto", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Review →
                </button>
              </div>
            ))}
            {cnBannerRows.length > 10 && <span style={{ fontSize: 11, color: "#92400e" }}>+{cnBannerRows.length - 10} more — open CN Tracker.</span>}
          </div>
        </div>
      )}

      {/* ══ CN — RSM-approved, waiting for the BGauss-name invoice ══ */}
      {cnAwaitingInvoice.length > 0 && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderLeft: "4px solid #3b82f6", borderRadius: 8, padding: "10px 16px", marginBottom: 14, fontSize: 12, color: "#1e40af" }}>
          <strong>🧾 {cnAwaitingInvoice.length} CN{cnAwaitingInvoice.length !== 1 ? "s" : ""} approved — waiting for the dealer's invoice in BGauss's name.</strong>{" "}
          Follow up with the dealer, or upload it from Post-Activity → Credit Note:
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {cnAwaitingInvoice.slice(0, 8).map((r) => (
              <button key={r.activityId} onClick={() => openActivity(r.proposalId, r.activityId)}
                style={{ background: "#fff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                {r.dealerName} · {r.activityName}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dash-filter-bar">
        <select className="dash-filter-select" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}>
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
          <option value="NeedsRevision">Needs Revision</option>
        </select>
        <select className="dash-filter-select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{m === "All" ? "All Months" : m}</option>)}
        </select>
        <select className="dash-filter-select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          {years.map((y) => <option key={y} value={y}>{y === "All" ? "All Years" : y}</option>)}
        </select>
        <div style={{ position: "relative", flex: "1 1 180px" }}>
          <input className="dash-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dealer, RSM, TSM, token…" />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>✕</button>}
        </div>
        {hasFilter && <button className="dash-clear-btn" onClick={clearAll}>Clear all ✕</button>}
      </div>

      <div className="dash-kpi-grid">
        <KpiCard label="Total Proposals" value={String(stats.total)} sub={inrCompact(stats.budget) + " approved budget"} color="#0a2540" active={activeFilter === "All"} onClick={() => setActiveFilter("All")} />
        <KpiCard label="⏳ Pending" value={String(stats.pending)} color="#f59e0b" active={activeFilter === "Pending"} onClick={() => setActiveFilter(activeFilter === "Pending" ? "All" : "Pending")} />
        <KpiCard label="✓ Approved" value={String(stats.approved)} color="#16a34a" active={activeFilter === "Approved"} onClick={() => setActiveFilter(activeFilter === "Approved" ? "All" : "Approved")} />
        <KpiCard label="✕ Rejected" value={String(stats.rejected)} color="#dc2626" active={activeFilter === "Rejected"} onClick={() => setActiveFilter(activeFilter === "Rejected" ? "All" : "Rejected")} />
        <KpiCard label="↩ Needs Revision" value={String(stats.revision)} color="#f59e0b" active={activeFilter === "NeedsRevision"} onClick={() => setActiveFilter(activeFilter === "NeedsRevision" ? "All" : "NeedsRevision")} />
        <KpiCard label="🎯 Retail Target" value={String(stats.retail)} color="#7c3aed" />
        <KpiCard label="₹ Approved Budget" value={inrCompact(stats.budget)} color="#0369a1" />
      </div>

      <div className="dash-section">
        <div className="dash-section-head">
          <h2 className="dash-section-title">📋 Proposals<span style={{ fontSize: 12, fontWeight: 400, color: "#64748b", marginLeft: 10 }}>{filtered.length} of {proposals.length}</span></h2>
        </div>
        {filtered.length === 0 ? (
          <div className="dash-empty">
            <div className="dd-empty-icon">📭</div>
            <div className="dd-empty-title">{proposals.length === 0 ? "No proposals yet" : "No proposals match your filters"}</div>
            <div className="dd-empty-sub">{proposals.length === 0 ? "No proposals found for your dealers yet." : "Try clearing your filters."}</div>
          </div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr>
                <th>Token</th><th>Dealer</th><th>Month</th><th>Year</th>
                <th>Activities</th><th>Budget</th><th>Retail</th><th>Status</th><th>Submitted</th><th>Action</th>
              </tr></thead>
              <tbody>
                {[...filtered].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()).map((p) => (
                  <tr key={p.id} style={{ cursor: "pointer", background: p.status === "NeedsRevision" ? "#fffbeb" : undefined }} onClick={() => openModal(p)}>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "#1e3a5f", fontWeight: 600 }}>{p.tokenNumber ?? "—"}</td>
                    <td style={{ fontWeight: 600 }}>{p.dealerName}<div style={{ fontSize: 11, color: "#6b7280", fontWeight: 400 }}>{p.location}, {p.state}</div></td>
                    <td>{p.month}</td>
                    <td>{(p as any).year ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>
                      {p.activities.slice(0, 2).map((a) => a.activityType).join(", ")}
                      {p.activities.length > 2 && <span style={{ color: "#94a3b8" }}> +{p.activities.length - 2}</span>}
                    </td>
                    <td style={{ fontWeight: 600 }}>{inrCompact(p.totalBudget)}</td>
                    <td>{p.totalRetailTarget}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td style={{ fontSize: 11, color: "#6b7280" }}>{fmtDate(p.createdAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openModal(p)} className="dd-view-btn">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ══ PROPOSAL DETAIL MODAL — view + Post-Activity + CN, no edit/approve/reject ══ */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.52)", zIndex: 1000, overflowY: "auto", padding: "20px 12px" }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div style={{ background: "#fff", borderRadius: 14, maxWidth: 940, margin: "0 auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}>
            <div style={{ background: "#0a2540", padding: "18px 24px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{selected.tokenNumber}</div>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>{selected.dealerName} · {selected.month} {(selected as any).year ?? ""}</div>
              </div>
              <StatusPill status={selected.status} />
              <button onClick={closeModal} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>

            <div style={{ padding: "20px 24px 24px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 16 }}>
                {([
                  ["Location", selected.location], ["State", selected.state],
                  ["Month", selected.month], ["Year", (selected as any).year ?? "—"],
                  ["RSM", selected.rsmName], ["TSM", (selected as any).tsmName ?? "—"],
                  ["Commando", selected.commandoName ?? "—"], ["Type", selected.type],
                  ["Total Budget", "₹" + Math.round(selected.totalBudget).toLocaleString("en-IN")],
                  ["Retail Target", String(selected.totalRetailTarget)],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                    <div style={{ fontSize: 13, color: "#0a2540", fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>

              {selected.approverNote && (
                <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#78350f" }}>
                  <strong>Approver note:</strong> {selected.approverNote}
                </div>
              )}
              {(selected as any).checkerRemarks && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7, padding: "9px 14px", fontSize: 12, color: "#78350f", marginBottom: 12 }}>
                  <strong>Checker note:</strong> {(selected as any).checkerRemarks}
                </div>
              )}

              <div style={{ fontWeight: 700, fontSize: 13, color: "#0a2540", marginBottom: 8 }}>Activities ({selected.activities.length})</div>

              {selected.activities.length > 0 && (
                <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 16 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
                    <thead>
                      <tr style={{ background: "#0a2540" }}>
                        <th style={{ padding: "8px 8px", color: "#e2e8f0", textAlign: "left", fontSize: 10 }}>#</th>
                        <th style={{ padding: "8px 8px", color: "#e2e8f0", textAlign: "left", fontSize: 10, minWidth: 120 }}>Activity Name</th>
                        <th style={{ padding: "8px 6px", color: "#e2e8f0", textAlign: "center", fontSize: 10 }}>Type</th>
                        <th style={{ padding: "8px 6px", color: "#e2e8f0", textAlign: "center", fontSize: 10 }}>Lead</th>
                        <th style={{ padding: "8px 6px", color: "#e2e8f0", textAlign: "center", fontSize: 10 }}>Retail</th>
                        <th style={{ padding: "8px 8px", color: "#e2e8f0", textAlign: "center", fontSize: 10 }}>Dates</th>
                        <th style={{ padding: "8px 6px", color: "#e2e8f0", textAlign: "right", fontSize: 10 }}>Budget (₹)</th>
                        {selected.status === "Approved" && <th style={{ padding: "8px 8px", color: "#6ee7b7", textAlign: "center", fontSize: 10 }}>Post-Activity / CN</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.activities.map((a, ai) => (
                        <tr key={a.id} style={{ background: ai % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 10px", color: "#6b7280", fontSize: 11, fontWeight: 700 }}>{String.fromCharCode(65 + ai)}</td>
                          <td style={{ padding: "7px 8px", fontWeight: 700, color: "#0a2540", fontSize: 11 }}>{a.activityType}</td>
                          <td style={{ padding: "7px 6px", textAlign: "center" }}>
                            {a.category && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: a.category === "ATL" ? "#eff6ff" : "#dcfce7", color: a.category === "ATL" ? "#1e40af" : "#166534" }}>{a.category}</span>}
                          </td>
                          <td style={{ padding: "7px 6px", textAlign: "center", fontSize: 11 }}>{a.leadTarget}</td>
                          <td style={{ padding: "7px 6px", textAlign: "center", fontSize: 11 }}>{a.retailTarget}</td>
                          <td style={{ padding: "7px 8px", fontSize: 10, color: "#374151", whiteSpace: "nowrap" }}>{fmtDate(a.startDate)}<br />→ {fmtDate(a.endDate)}</td>
                          <td style={{ padding: "7px 6px", textAlign: "right", fontWeight: 600, color: "#0a2540", fontSize: 11 }}>₹{Math.round(a.budget || 0).toLocaleString("en-IN")}</td>
                          {selected.status === "Approved" && (
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <button onClick={() => toggleActuals(a.id)} style={{ background: openActualsId === a.id ? "#0a2540" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, margin: "0 auto" }}>
                                📋 {openActualsId === a.id ? "Close ▲" : "Post-Activity ▼"}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ══ POST-ACTIVITY ACCORDION — same as DealerDashboard ══ */}
              {selected.status === "Approved" && selected.activities.map((a) => {
                const d = actualsData[a.id];
                if (openActualsId !== a.id || !d) return null;
                const range = getActualDateRange(selected.month, (selected as any).year);
                const outOfRange = (v: string) => !!v && (v < range.min || v > range.max);
                return (
                  <div key={`actuals-${a.id}`} style={{ marginTop: 10, borderRadius: 10, overflow: "hidden", border: "2px solid #bbf7d0" }}>
                    <div style={{ padding: "14px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                        <span style={{ background: "#16a34a", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>📋 Post-Activity</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#0a2540" }}>{a.activityType}</span>
                        {a.category && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 3, background: a.category === "ATL" ? "#eff6ff" : "#dcfce7", color: a.category === "ATL" ? "#1e40af" : "#166534" }}>{a.category}</span>}
                        <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>Planned: {fmtDate(a.startDate)} → {fmtDate(a.endDate)}</span>
                      </div>

                      {(outOfRange(d.actualStartDate) || outOfRange(d.actualEndDate)) && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#991b1b" }}>
                          ⚠ Actual dates are outside <strong>{range.label}</strong>. Correct them before saving.
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12, background: "#ecfdf5", borderRadius: 8, padding: "10px 12px", border: "1px solid #bbf7d0" }}>
                        <div>
                          <label style={{ fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Actual Start</label>
                          <input type="date" value={d.actualStartDate} min={range.min} max={range.max}
                            onChange={(e) => { const v = e.target.value; if (outOfRange(v)) { showToast(`Actual dates must be within ${range.label}.`, false); return; } setActualField(a.id, "actualStartDate", v); rebuildDailyEntries(a.id, v, d.actualEndDate); }}
                            style={{ border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 9px", fontSize: 12, outline: "none", background: "#fff" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Actual End</label>
                          <input type="date" value={d.actualEndDate} min={d.actualStartDate && !outOfRange(d.actualStartDate) ? d.actualStartDate : range.min} max={range.max}
                            onChange={(e) => { const v = e.target.value; if (outOfRange(v)) { showToast(`Actual dates must be within ${range.label}.`, false); return; } if (v && d.actualStartDate && v < d.actualStartDate) { showToast("Actual End cannot be before Actual Start.", false); return; } setActualField(a.id, "actualEndDate", v); rebuildDailyEntries(a.id, d.actualStartDate, v); }}
                            style={{ border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 9px", fontSize: 12, outline: "none", background: "#fff" }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#6b7280", alignSelf: "center", lineHeight: 1.4 }}>Allowed:<br /><strong style={{ color: "#166534" }}>{range.label}</strong></div>
                        {(a.actualStartDate || a.actualEndDate) && <div style={{ fontSize: 11, color: "#166534", fontWeight: 600 }}>✓ {fmtDate(a.actualStartDate)} → {fmtDate(a.actualEndDate)}</div>}

                        <div style={{ display: "flex", gap: 7, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
                          <button onClick={() => toggleActualsPanel(a.id, "photos")} style={{ display: "flex", alignItems: "center", gap: 5, background: openActualsPanel[a.id] === "photos" ? "#16a34a" : "#fff", color: openActualsPanel[a.id] === "photos" ? "#fff" : "#166534", border: "1.5px solid #16a34a", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            📸 Photos{d.proofMedia.length > 0 && <span style={{ background: "rgba(0,0,0,0.15)", borderRadius: 10, padding: "0px 6px", fontSize: 10, fontWeight: 800, marginLeft: 2 }}>{d.proofMedia.length}</span>}
                            <span style={{ fontSize: 9, opacity: 0.7 }}>{openActualsPanel[a.id] === "photos" ? "▲" : "▼"}</span>
                          </button>
                          <button onClick={() => toggleActualsPanel(a.id, "invoices")} style={{ display: "flex", alignItems: "center", gap: 5, background: openActualsPanel[a.id] === "invoices" ? "#1e3a5f" : "#fff", color: openActualsPanel[a.id] === "invoices" ? "#fff" : "#374151", border: "1.5px solid #e2e8f0", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            🧾 Invoices{d.invoiceMedia.length > 0 && <span style={{ background: "rgba(0,0,0,0.15)", borderRadius: 10, padding: "0px 6px", fontSize: 10, fontWeight: 800, marginLeft: 2 }}>{d.invoiceMedia.length}</span>}
                            <span style={{ fontSize: 9, opacity: 0.7 }}>{openActualsPanel[a.id] === "invoices" ? "▲" : "▼"}</span>
                          </button>
                          <button onClick={() => { if (d.actualStartDate && d.actualEndDate) toggleActualsPanel(a.id, "history"); }} disabled={!d.actualStartDate || !d.actualEndDate}
                            title={!d.actualStartDate || !d.actualEndDate ? "Select actual start & end dates first" : "View date-wise history"}
                            style={{ display: "flex", alignItems: "center", gap: 5, background: openActualsPanel[a.id] === "history" ? "#0a2540" : "#fff", color: openActualsPanel[a.id] === "history" ? "#fff" : (!d.actualStartDate || !d.actualEndDate) ? "#cbd5e1" : "#374151", border: `1.5px solid ${(!d.actualStartDate || !d.actualEndDate) ? "#e2e8f0" : "#0a2540"}`, borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: (!d.actualStartDate || !d.actualEndDate) ? "not-allowed" : "pointer", opacity: (!d.actualStartDate || !d.actualEndDate) ? 0.45 : 1, whiteSpace: "nowrap" }}>
                            📊 History{d.dailyEntries.length > 0 && <span style={{ background: "rgba(0,0,0,0.15)", borderRadius: 10, padding: "0px 6px", fontSize: 10, fontWeight: 800, marginLeft: 2 }}>{d.dailyEntries.length}d</span>}
                            <span style={{ fontSize: 9, opacity: 0.7 }}>{openActualsPanel[a.id] === "history" ? "▲" : "▼"}</span>
                          </button>
                          <div style={{ width: "1px", height: 24, background: "#d1d5db", margin: "0 2px" }} />
                          <button onClick={saveActuals} disabled={actualsLoading} style={{ background: "#16a34a", color: "#fff", border: "none", padding: "5px 16px", borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: actualsLoading ? "not-allowed" : "pointer", opacity: actualsLoading ? 0.7 : 1, whiteSpace: "nowrap" }}>{actualsLoading ? "Saving…" : "💾 Save"}</button>
                          <button onClick={() => { setOpenActualsId(null); setOpenActualsPanel((prev) => ({ ...prev, [a.id]: undefined as any })); }} style={{ background: "#f1f5f9", color: "#374151", border: "1px solid #e2e8f0", padding: "5px 10px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>✕</button>
                        </div>
                      </div>


                      {openActualsPanel[a.id] === "photos" && (
                        <div style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 9, padding: "12px 14px", marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#0a2540" }}>📸 Activity Proof / Photos</span>
                            <span style={{ fontSize: 11, color: "#6b7280" }}>GPS + timestamp auto-captured</span>
                            <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, background: d.proofUploading ? "#f1f5f9" : "#16a34a", color: d.proofUploading ? "#6b7280" : "#fff", border: d.proofUploading ? "1px dashed #d1d5db" : "none", borderRadius: 7, padding: "5px 13px", cursor: d.proofUploading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {d.proofUploading ? "⏳ Uploading…" : "＋ Add Photos"}
                              <input type="file" multiple accept="image/*,video/*,.pdf" style={{ display: "none" }} disabled={d.proofUploading} onChange={(e) => { if (e.target.files && e.target.files.length) handleProofUpload(a.id, e.target.files); e.target.value = ""; }} />
                            </label>
                          </div>
                          {d.proofMedia.length === 0 ? (
                            <div style={{ border: "2px dashed #bbf7d0", borderRadius: 8, padding: "18px", textAlign: "center", color: "#6b7280", fontSize: 12 }}><div style={{ fontSize: 26, marginBottom: 4 }}>📷</div>No photos uploaded yet.</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              {d.proofMedia.map((m, pi) => {
                                const url = m.fileUrl.startsWith("http") ? m.fileUrl : `${API_BASE}${m.fileUrl}`;
                                const uploadTime = new Date(m.capturedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
                                return (
                                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: "6px 10px" }}>
                                    <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 5, overflow: "hidden", background: "#dcfce7", border: "1px solid #bbf7d0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setMediaViewer({ url, name: m.fileName, type: m.fileType })}>
                                      {isImage(m.fileType) ? <img src={url} alt={m.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : isVideo(m.fileType) ? <video src={url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>{mediaIcon(m.fileType)}</span>}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: "#0a2540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{pi + 1} · {m.fileName}</div>
                                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>🕐 {uploadTime}{m.latitude != null && m.longitude != null && <a href={mapsUrl(m.latitude!, m.longitude!)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 8, color: "#16a34a", textDecoration: "none", fontWeight: 600, fontSize: 10 }}>📍 GPS</a>}{(m.latitude == null || m.longitude == null) && <span style={{ marginLeft: 8, color: "#9ca3af", fontSize: 10 }}>No GPS</span>}</div>
                                    </div>
                                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                                      <button type="button" onClick={() => setMediaViewer({ url, name: m.fileName, type: m.fileType })} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 5, padding: "3px 7px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>View</button>
                                      <button type="button" onClick={() => removeProof(a.id, m.id)} style={{ background: "#fee2e2", border: "none", color: "#991b1b", borderRadius: 5, padding: "3px 7px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>✕</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {openActualsPanel[a.id] === "invoices" && (
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: "12px 14px", marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#0a2540" }}>🧾 Invoice / Bill Upload</span>
                            <span style={{ fontSize: 11, color: "#6b7280" }}>PDF / image · multiple files supported</span>
                            <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, background: d.invoiceUploading ? "#f1f5f9" : "#1e3a5f", color: d.invoiceUploading ? "#6b7280" : "#fff", border: d.invoiceUploading ? "1px dashed #d1d5db" : "none", borderRadius: 7, padding: "5px 13px", cursor: d.invoiceUploading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {d.invoiceUploading ? "⏳ Uploading…" : "＋ Add Invoice"}
                              <input type="file" multiple accept="application/pdf,image/*" style={{ display: "none" }} disabled={d.invoiceUploading} onChange={(e) => { if (e.target.files && e.target.files.length) handleInvoiceUpload(a.id, e.target.files); e.target.value = ""; }} />
                            </label>
                          </div>
                          {d.invoiceMedia.length === 0 ? (
                            <div style={{ border: "2px dashed #e2e8f0", borderRadius: 8, padding: "18px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}><div style={{ fontSize: 22, marginBottom: 4 }}>🧾</div>No invoices uploaded yet.</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                              {d.invoiceMedia.map((inv, ii) => {
                                const url = inv.fileUrl.startsWith("http") ? inv.fileUrl : `${API_BASE}${inv.fileUrl}`;
                                const icon = inv.fileType?.includes("pdf") ? "📄" : inv.fileType?.startsWith("image/") ? "🖼" : "📎";
                                return (
                                  <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, padding: "6px 10px" }}>
                                    <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: "#0a2540", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{ii + 1} · {inv.fileName}</div>
                                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>{new Date(inv.capturedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</div>
                                    </div>
                                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#2563eb", fontWeight: 600, textDecoration: "none", flexShrink: 0 }}>View ↗</a>
                                    <button type="button" onClick={() => removeInvoice(a.id, inv.id)} style={{ background: "#fee2e2", border: "none", color: "#991b1b", borderRadius: 5, padding: "3px 7px", fontSize: 10, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>✕</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {openActualsPanel[a.id] === "history" && d.actualStartDate && d.actualEndDate && (
                        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden", marginBottom: 10 }}>
                          <div style={{ background: "#0a2540", padding: "9px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>📊 Daily Activity History</span>
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>{fmtDate(d.actualStartDate)} → {fmtDate(d.actualEndDate)}</span>
                            {d.dailyEntries.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "#86efac", fontWeight: 600 }}>{d.dailyEntries.length} day{d.dailyEntries.length !== 1 ? "s" : ""}</span>}
                          </div>
                          {d.dailyEntries.length === 0 ? (
                            <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No entries yet for this date range.</div>
                          ) : (
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 660 }}>
                                <thead>
                                  <tr style={{ background: "#1e293b" }}>
                                    <th style={{ padding: "8px 10px", textAlign: "left", color: "#e2e8f0", fontSize: 10, fontWeight: 700, width: 95 }}>Date</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#fde68a", fontSize: 10, fontWeight: 700 }}>Setup<br />Count</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#93c5fd", fontSize: 10, fontWeight: 700 }}>Enquiry<br />Plan</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#6ee7b7", fontSize: 10, fontWeight: 700 }}>Enquiry<br />Actual</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#93c5fd", fontSize: 10, fontWeight: 700 }}>Test Drive<br />Plan</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#6ee7b7", fontSize: 10, fontWeight: 700 }}>Test Drive<br />Actual</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#c4b5fd", fontSize: 10, fontWeight: 700 }}>Booking</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#fbbf24", fontSize: 10, fontWeight: 700 }}>Retail</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#a5b4fc", fontSize: 10, fontWeight: 700 }}>LMS Leads<br />Punched</th>
                                    <th style={{ padding: "8px 8px", textAlign: "center", color: "#e2e8f0", fontSize: 10, fontWeight: 700 }}>Media</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.dailyEntries.map((entry, ei) => {
                                    const pctC = (actual: number, planned: number) => { if (!actual) return ""; const r = planned > 0 ? actual / planned : 1; return r >= 0.9 ? "#d1fae5" : r >= 0.6 ? "#fef3c7" : "#fee2e2"; };
                                    const entryDate = entry.date;
                                    const photosOnDay = d.proofMedia.filter((m) => m.capturedAt.startsWith(entryDate));
                                    const invoicesOnDay = d.invoiceMedia.filter((m) => m.capturedAt.startsWith(entryDate));
                                    const hasAnyData = entry.enquiryActual > 0 || entry.testDriveActual > 0 || entry.bookingActual > 0 || entry.retailActual > 0 || entry.leadsPunched > 0 || photosOnDay.length > 0 || invoicesOnDay.length > 0;
                                    return (
                                      <tr key={entry.date} style={{ background: ei % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9", opacity: hasAnyData ? 1 : 0.5 }}>
                                        <td style={{ padding: "5px 10px", fontWeight: 600, color: "#374151", whiteSpace: "nowrap", fontSize: 11 }}>{entry.date}</td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} max={20} style={{ width: 40, textAlign: "center", border: "1px solid #fde68a", borderRadius: 4, padding: "2px", fontSize: 11, outline: "none", background: "#fefce8", fontWeight: 700 }}
                                            value={(entry as any).setupCount || ""} placeholder="0" title="Setup Count — Enquiry Plan & TD Plan = 35 × this value"
                                            onChange={(ev) => { const sc = parseInt(ev.target.value) || 0; setDailyField(a.id, entry.date, "setupCount" as any, sc); setDailyField(a.id, entry.date, "enquiryPlanned", sc * DEFAULT_PLAN_PER_SETUP); setDailyField(a.id, entry.date, "testDrivePlanned", sc * DEFAULT_PLAN_PER_SETUP); }} />
                                        </td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} style={{ width: 48, textAlign: "center", border: "1px solid #e2e8f0", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", background: "#f8fafc", color: (entry as any).setupCount > 0 ? "#1e40af" : "inherit", fontWeight: (entry as any).setupCount > 0 ? 700 : 400 }}
                                            value={entry.enquiryPlanned || ""} placeholder="0" readOnly={(entry as any).setupCount > 0} title={(entry as any).setupCount > 0 ? "Auto-calculated (35 × Setup Count)" : "Enter manually"}
                                            onChange={(e) => !(entry as any).setupCount && setDailyField(a.id, entry.date, "enquiryPlanned", parseInt(e.target.value) || 0)} />
                                        </td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} style={{ width: 48, textAlign: "center", border: "1px solid #bbf7d0", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", background: pctC(entry.enquiryActual, entry.enquiryPlanned) || "#fff", fontWeight: entry.enquiryActual > 0 ? 700 : 400 }}
                                            value={entry.enquiryActual || ""} placeholder="0" onChange={(e) => setDailyField(a.id, entry.date, "enquiryActual", parseInt(e.target.value) || 0)} />
                                        </td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} style={{ width: 48, textAlign: "center", border: "1px solid #e2e8f0", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", background: "#f8fafc" }}
                                            value={entry.testDrivePlanned || ""} placeholder="0" readOnly onChange={(e) => setDailyField(a.id, entry.date, "testDrivePlanned", parseInt(e.target.value) || 0)} />
                                        </td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} style={{ width: 48, textAlign: "center", border: "1px solid #bbf7d0", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", background: pctC(entry.testDriveActual, entry.testDrivePlanned) || "#fff", fontWeight: entry.testDriveActual > 0 ? 700 : 400 }}
                                            value={entry.testDriveActual || ""} placeholder="0" onChange={(e) => setDailyField(a.id, entry.date, "testDriveActual", parseInt(e.target.value) || 0)} />
                                        </td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} style={{ width: 48, textAlign: "center", border: "1px solid #e9d5ff", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", background: entry.bookingActual > 0 ? "#fdf4ff" : "#fff", fontWeight: entry.bookingActual > 0 ? 700 : 400, color: entry.bookingActual > 0 ? "#7c3aed" : "inherit" }}
                                            value={entry.bookingActual || ""} placeholder="0" onChange={(e) => setDailyField(a.id, entry.date, "bookingActual", parseInt(e.target.value) || 0)} />
                                        </td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} style={{ width: 48, textAlign: "center", border: "1px solid #fde68a", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", background: entry.retailActual > 0 ? "#fef9c3" : "#fff", fontWeight: entry.retailActual > 0 ? 700 : 400, color: entry.retailActual > 0 ? "#92400e" : "inherit" }}
                                            value={entry.retailActual || ""} placeholder="0" onChange={(e) => setDailyField(a.id, entry.date, "retailActual", parseInt(e.target.value) || 0)} />
                                        </td>
                                        <td style={{ padding: "4px 5px", textAlign: "center" }}>
                                          <input type="number" min={0} style={{ width: 48, textAlign: "center", border: "1px solid #c7d2fe", borderRadius: 4, padding: "3px", fontSize: 11, outline: "none", background: entry.leadsPunched > 0 ? "#eef2ff" : "#fff", fontWeight: entry.leadsPunched > 0 ? 700 : 400, color: entry.leadsPunched > 0 ? "#4338ca" : "inherit" }}
                                            value={entry.leadsPunched || ""} placeholder="0" onChange={(e) => setDailyField(a.id, entry.date, "leadsPunched", parseInt(e.target.value) || 0)} />
                                        </td>
                                        <td style={{ padding: "4px 8px", textAlign: "center" }}>
                                          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
                                            {photosOnDay.slice(0, 2).map((m) => {
                                              const url = m.fileUrl.startsWith("http") ? m.fileUrl : `${API_BASE}${m.fileUrl}`;
                                              return (
                                                <div key={m.id} style={{ width: 26, height: 26, borderRadius: 3, overflow: "hidden", cursor: "pointer", border: "1px solid #bbf7d0", flexShrink: 0 }} onClick={() => setMediaViewer({ url, name: m.fileName, type: m.fileType })}>
                                                  {isImage(m.fileType) ? <img src={url} alt={m.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14, lineHeight: "26px", display: "block", textAlign: "center" }}>{mediaIcon(m.fileType)}</span>}
                                                </div>
                                              );
                                            })}
                                            {photosOnDay.length > 2 && <span style={{ fontSize: 9, color: "#16a34a", fontWeight: 700 }}>+{photosOnDay.length - 2}</span>}
                                            {invoicesOnDay.length > 0 && <span style={{ fontSize: 10, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 3, padding: "1px 4px", color: "#374151", whiteSpace: "nowrap" }}>🧾{invoicesOnDay.length}</span>}
                                            {photosOnDay.length === 0 && invoicesOnDay.length === 0 && <span style={{ color: "#e2e8f0", fontSize: 10 }}>—</span>}
                                            <label title={`Upload photo for ${entryDate}`} style={{ cursor: "pointer", fontSize: 11, color: "#60a5fa", marginLeft: 2 }}>
                                              📷
                                              <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }} onChange={(ev) => { if (!ev.target.files?.length) return; handleDateWiseUpload(a.id, entryDate, ev.target.files); ev.target.value = ""; }} />
                                            </label>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr style={{ background: "#0a2540", borderTop: "2px solid #1e3a5f" }}>
                                    <td style={{ padding: "7px 10px", fontWeight: 800, color: "#fbbf24", fontSize: 11 }}>TOTAL</td>
                                    <td style={{ padding: "7px 6px", textAlign: "center", fontWeight: 700, fontSize: 12, color: "#fde68a" }}>{d.dailyEntries.reduce((s, e) => s + (Number((e as any).setupCount) || 0), 0)}</td>
                                    {(["enquiryPlanned", "enquiryActual", "testDrivePlanned", "testDriveActual", "bookingActual", "retailActual", "leadsPunched"] as (keyof DailyEntry)[]).map((key, ki) => (
                                      <td key={key} style={{ padding: "7px 6px", textAlign: "center", fontWeight: 700, fontSize: 12, color: [0, 2].includes(ki) ? "#93c5fd" : [1, 3].includes(ki) ? "#6ee7b7" : ki === 4 ? "#c4b5fd" : ki === 5 ? "#fbbf24" : "#a5b4fc" }}>{d.dailyEntries.reduce((s, e) => s + (Number((e as any)[key]) || 0), 0)}</td>
                                    ))}
                                    <td style={{ padding: "7px 8px", textAlign: "center" }}><span style={{ fontSize: 10, color: "#94a3b8" }}>{d.proofMedia.length > 0 && `📸${d.proofMedia.length} `}{d.invoiceMedia.length > 0 && `🧾${d.invoiceMedia.length}`}</span></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          )}
                          <div style={{ padding: "7px 14px", fontSize: 11, color: "#6b7280", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>ℹ Green ≥90% · Yellow ≥60% · Red &lt;60% · Dim rows = no data yet</div>
                        </div>
                      )}

                      {/* ══ CREDIT NOTE (CN) — always last, after all Post-Activity panels ══ */}
                      <div style={{ marginTop: 14 }}>
                        <CnPanel proposalId={selected.id} activityId={a.id}
                          refreshKey={`${d.proofMedia.length}-${d.invoiceMedia.length}-${a.actualEndDate ?? ""}`}
                          onChanged={() => loadCnPending()} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
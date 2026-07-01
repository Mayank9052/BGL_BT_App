// DealerDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyDealerProposals } from "../services/proposalService";
import { getDealerUser, dealerLogout } from "../services/dealerAuthService";
import type { ProposalResponse } from "../services/proposalService";
import "./DashboardPage.css";

const inr = (v: number) => "₹ " + Math.round(v).toLocaleString("en-IN");
const inrCompact = (v: number): string => {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
};
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

type ActiveFilter = "All" | "Pending" | "Approved" | "Rejected";

interface DealerDashboardProps {
  onLogout?: () => void;
}

export default function DealerDashboard({ onLogout }: DealerDashboardProps) {
  const navigate = useNavigate();
  const [dealerUser] = useState(() => getDealerUser());

  const [proposals,   setProposals]   = useState<ProposalResponse[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError,   setDataError]   = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("All");
  const [monthFilter,  setMonthFilter]  = useState("All");

  useEffect(() => {
    if (!dealerUser) {
      onLogout?.();
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;
    setLoadingData(true);

    fetchMyDealerProposals()
      .then((data) => {
        if (!cancelled) setProposals(data);
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to load your proposals.";
        setDataError(message);

        if (message.includes("401") || message.includes("Not signed in")) {
          dealerLogout();
          onLogout?.();
          navigate("/", { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const months = useMemo(
    () => ["All", ...Array.from(new Set(proposals.map((p) => p.month)))],
    [proposals],
  );

  const filtered = useMemo(() =>
    proposals.filter((p) => {
      if (activeFilter !== "All" && p.status !== activeFilter) return false;
      if (monthFilter  !== "All" && p.month  !== monthFilter)  return false;
      return true;
    }),
  [proposals, activeFilter, monthFilter]);

  const stats = useMemo(() => {
    const approved = filtered.filter((p) => p.status === "Approved");
    const pending  = filtered.filter((p) => p.status === "Pending");
    const totalBudget       = filtered.reduce((s, p) => s + p.totalBudget, 0);
    const totalRetailTarget = filtered.reduce((s, p) => s + p.totalRetailTarget, 0);
    const totalLeadTarget   = filtered.reduce((s, p) => s + p.totalLeadTarget, 0);
    const cacList = filtered.filter((p) => p.cac > 0).map((p) => p.cac);
    const cplList = filtered.filter((p) => p.cpl > 0).map((p) => p.cpl);
    return {
      total: filtered.length,
      pending: pending.length,
      approved: approved.length,
      rejected: filtered.filter((p) => p.status === "Rejected").length,
      totalBudget,
      approvedBudget: approved.reduce((s, p) => s + p.totalBudget, 0),
      totalRetailTarget,
      totalLeadTarget,
      avgCac: cacList.length > 0 ? cacList.reduce((a, b) => a + b, 0) / cacList.length : 0,
      avgCpl: cplList.length > 0 ? cplList.reduce((a, b) => a + b, 0) / cplList.length : 0,
      activitiesCount: filtered.reduce((s, p) => s + p.activities.length, 0),
    };
  }, [filtered]);

  const activityBreakdown = useMemo(() => {
    const map: Record<string, {
      activityType: string; count: number; leadTarget: number; retailTarget: number;
      budget: number; pending: number; approved: number; rejected: number;
    }> = {};

    for (const p of filtered) {
      for (const a of p.activities) {
        if (!map[a.activityType]) map[a.activityType] = {
          activityType: a.activityType, count: 0, leadTarget: 0, retailTarget: 0,
          budget: 0, pending: 0, approved: 0, rejected: 0,
        };
        const r = map[a.activityType];
        r.count++;
        r.leadTarget   += a.leadTarget;
        r.retailTarget += a.retailTarget;
        r.budget       += a.budget + a.additionalBudget;
        if (p.status === "Pending")  r.pending++;
        if (p.status === "Approved") r.approved++;
        if (p.status === "Rejected") r.rejected++;
      }
    }
    return Object.values(map).sort((a, b) => b.budget - a.budget);
  }, [filtered]);

  if (!dealerUser) return null;

  const statusClass = (s: string) =>
    s === "Approved" ? "dash-badge dash-badge--approved"
    : s === "Rejected" ? "dash-badge dash-badge--rejected"
    : "dash-badge dash-badge--pending";

  return (
    <div className="dash-root">

      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 20, color: "#0a2540", margin: 0 }}>
          {dealerUser.dealerName || dealerUser.displayName}'s Dashboard
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
          Dealer Code: {dealerUser.dealerCode ?? "—"}
        </p>
      </div>

      {loadingData ? (
        <div className="dash-loading-inline">
          <div className="dash-spinner dash-spinner--sm" /><span>Loading your proposals…</span>
        </div>
      ) : dataError ? (
        <div className="dash-error-banner">⚠ {dataError}</div>
      ) : proposals.length === 0 ? (
        <div className="dash-empty">
          <span className="dash-empty-icon">📋</span>
          <p>No BTL proposals found for your dealership yet.</p>
          <p style={{ fontSize: 12, color: "#94a3b8" }}>
            Your RSM will submit activity proposals on your behalf — they'll appear here once submitted.
          </p>
        </div>
      ) : (
        <>
          <div className="dash-kpi-grid">
            <KpiCard icon="📄" label="Total Proposals" value={String(stats.total)}
              sub={`${stats.activitiesCount} activities`} accent="blue"
              active={activeFilter === "All"} onClick={() => setActiveFilter("All")} />
            <KpiCard icon="⏳" label="Pending" value={String(stats.pending)}
              sub="Awaiting approval" accent="amber"
              active={activeFilter === "Pending"} onClick={() => setActiveFilter((f) => f === "Pending" ? "All" : "Pending")} />
            <KpiCard icon="✅" label="Approved" value={String(stats.approved)}
              sub={`Budget: ${inrCompact(stats.approvedBudget)}`} accent="green"
              active={activeFilter === "Approved"} onClick={() => setActiveFilter((f) => f === "Approved" ? "All" : "Approved")} />
            <KpiCard icon="❌" label="Rejected" value={String(stats.rejected)}
              sub="" accent="red"
              active={activeFilter === "Rejected"} onClick={() => setActiveFilter((f) => f === "Rejected" ? "All" : "Rejected")} />
            <KpiCard icon="💰" label="Total Budget" value={inrCompact(stats.totalBudget)}
              sub={`Avg CAC ₹${Math.round(stats.avgCac).toLocaleString("en-IN")}`} accent="purple"
              onClick={() => setActiveFilter("All")} />
            <KpiCard icon="📊" label="Avg CPL" value={`₹${Math.round(stats.avgCpl).toLocaleString("en-IN")}`}
              sub={`${stats.totalLeadTarget.toLocaleString("en-IN")} total leads`} accent="blue"
              onClick={() => setActiveFilter("All")} />
          </div>

          <div className="dash-global-filter-bar">
            <div className="dash-global-filter-left">
              <span className="dash-filter-label">Month:</span>
              <select className="dash-filter-select dash-filter-select--inline"
                value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                {months.map((m) => <option key={m} value={m}>{m === "All" ? "All Months" : m}</option>)}
              </select>
            </div>
          </div>

          {activityBreakdown.length > 0 && (
            <section className="dash-section">
              <h2 className="dash-section-title">
                Activity Breakdown
                <span className="dash-count-chip">{activityBreakdown.length}</span>
              </h2>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th className="dash-th">Activity Type</th>
                      <th className="dash-th dash-th--right">Count</th>
                      <th className="dash-th dash-th--right">Lead Target</th>
                      <th className="dash-th dash-th--right">Retail Target</th>
                      <th className="dash-th dash-th--right">Budget (₹)</th>
                      <th className="dash-th dash-th--right">Pending</th>
                      <th className="dash-th dash-th--right">Approved</th>
                      <th className="dash-th dash-th--right">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityBreakdown.map((row, i) => (
                      <tr key={row.activityType} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                        <td className="dash-td dash-dealer-name">{row.activityType}</td>
                        <td className="dash-td dash-td--right">{row.count}</td>
                        <td className="dash-td dash-td--right">{row.leadTarget}</td>
                        <td className="dash-td dash-td--right">{row.retailTarget}</td>
                        <td className="dash-td dash-td--right dash-td--mono">{inr(row.budget)}</td>
                        <td className="dash-td dash-td--right">
                          {row.pending > 0 ? <span className="dash-badge dash-badge--pending">{row.pending}</span> : <span className="dash-muted">—</span>}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.approved > 0 ? <span className="dash-badge dash-badge--approved">{row.approved}</span> : <span className="dash-muted">—</span>}
                        </td>
                        <td className="dash-td dash-td--right">
                          {row.rejected > 0 ? <span className="dash-badge dash-badge--rejected">{row.rejected}</span> : <span className="dash-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="dash-section">
            <h2 className="dash-section-title">
              Your Proposals
              <span className="dash-count-chip">{filtered.length}</span>
            </h2>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="dash-th">Token</th>
                    <th className="dash-th">Month</th>
                    <th className="dash-th">Activities</th>
                    <th className="dash-th dash-th--right">Lead Target</th>
                    <th className="dash-th dash-th--right">Retail Target</th>
                    <th className="dash-th dash-th--right">Budget (₹)</th>
                    <th className="dash-th">Submitted</th>
                    <th className="dash-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id} className={i % 2 === 0 ? "dash-row-even" : "dash-row-odd"}>
                      <td className="dash-td" style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {p.tokenNumber ?? "—"}
                      </td>
                      <td className="dash-td">{p.month}</td>
                      <td className="dash-td">
                        {p.activities.slice(0, 2).map((a, ai) => (
                          <span key={ai} className="dash-state-tag" style={{ marginRight: 4 }}>{a.activityType}</span>
                        ))}
                        {p.activities.length > 2 && (
                          <span className="dash-muted">+{p.activities.length - 2}</span>
                        )}
                      </td>
                      <td className="dash-td dash-td--right">{p.totalLeadTarget}</td>
                      <td className="dash-td dash-td--right">{p.totalRetailTarget}</td>
                      <td className="dash-td dash-td--right dash-td--mono">{inr(p.totalBudget)}</td>
                      <td className="dash-td" style={{ fontSize: 12, color: "#64748b" }}>{fmtDate(p.createdAt)}</td>
                      <td className="dash-td">
                        <span className={statusClass(p.status)}>
                          {p.status === "NeedsRevision" ? "Needs Revision" : p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon, label, value, sub, accent, active, onClick,
}: {
  icon: string; label: string; value: string; sub: string;
  accent: "blue" | "amber" | "green" | "red" | "purple";
  active?: boolean; onClick: () => void;
}) {
  return (
    <button type="button"
      className={[
        "dash-kpi-card", "dash-kpi-card--clickable",
        `dash-kpi-card--${accent}`,
        active ? "dash-kpi-card--active" : "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}>
      <div className="dash-kpi-icon">{icon}</div>
      <div className="dash-kpi-body">
        <div className="dash-kpi-label">{label}</div>
        <div className="dash-kpi-value">{value}</div>
        {sub && <div className="dash-kpi-sub">{sub}</div>}
      </div>
      {active && <div className="dash-kpi-active-dot" />}
    </button>
  );
}
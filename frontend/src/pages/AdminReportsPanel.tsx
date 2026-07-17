// src/components/AdminReportsPanel.tsx
//
// Three admin-only reports modeled on the shared screenshots:
//   1. Daily Activity Sheet Summary (dealer-wise)
//   2. Lead Report (state-wise, Walkin/BTL/Referral/ATL/Digital)
//   3. Dealer Detail (per-dealer drill-down, replaces the exact daily-log
//      layout with real per-activity data — see note below)
//
// ── IMPORTANT — read before wiring real data in later ──────────────────────
// This system's database (Proposal / ProposalActivity / dealer master) has
// NO table for: daily enquiry counts, canopy/mela counts, test-ride counts,
// bookings, closing stock, or LMS leads/punched/gap. Those numbers live in a
// separate daily operations sheet that has never been ingested into this
// backend. Every column that needs that data is rendered as "—" with a
// tooltip, NOT invented. Columns backed by real data (dealer/state/RSM,
// retail & lead targets, BTL/ATL split, activity dates) are computed live
// from the `proposals` prop — no separate fetch, reuses what DashboardPage
// already loaded.
//
// When a real ops-data source/table exists, replace the `NA` placeholders
// below with actual lookups — the column structure is already in place.

import { useMemo, useState } from "react";
import type { ProposalResponse } from "../services/proposalService";
import "./AdminReportsPanel.css";

const NA = () => <span className="arp-na" title="Not tracked in this system yet — needs a daily-ops data source">—</span>;

const CURRENT_MONTH_NAME = new Date().toLocaleString("en-US", { month: "long" });

const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");

type ReportTab = "daily" | "leads" | "dealer";

interface Props {
  proposals: ProposalResponse[];
}

export default function AdminReportsPanel({ proposals }: Props) {
  const [tab, setTab] = useState<ReportTab>("daily");
  const [selectedDealer, setSelectedDealer] = useState<string>("");

  // Only proposals for the current calendar month feed the "MTD" columns,
  // matching the screenshots' "Daily Summary Sheet (03 July 2026)" framing.
  const mtdProposals = useMemo(
    () => proposals.filter((p) => p.month === CURRENT_MONTH_NAME && p.status !== "Rejected"),
    [proposals]
  );

  // ── Report 1: Daily Activity Sheet Summary (dealer-wise) ─────────────────
  const dealerSummaryRows = useMemo(() => {
    const map: Record<string, {
      dealer: string; location: string; state: string; team: string;
      retailTargetMtd: number; leadTargetMtd: number; activityCount: number;
    }> = {};
    for (const p of mtdProposals) {
      const key = p.dealerName;
      if (!map[key]) map[key] = {
        dealer: p.dealerName, location: p.location, state: p.state,
        team: p.rsmName || "—", retailTargetMtd: 0, leadTargetMtd: 0, activityCount: 0,
      };
      map[key].retailTargetMtd += p.totalRetailTarget;
      map[key].leadTargetMtd   += p.totalLeadTarget;
      map[key].activityCount   += p.activities.length;
    }
    return Object.values(map).sort((a, b) => a.dealer.localeCompare(b.dealer));
  }, [mtdProposals]);

  // ── Report 2: Lead Report (state-wise, with real BTL/ATL split) ──────────
  const stateLeadRows = useMemo(() => {
    const map: Record<string, {
      state: string; retailTargetMtd: number; leadTargetMtd: number;
      btlLeadTarget: number; atlLeadTarget: number;
    }> = {};
    for (const p of mtdProposals) {
      const key = p.state;
      if (!map[key]) map[key] = { state: p.state, retailTargetMtd: 0, leadTargetMtd: 0, btlLeadTarget: 0, atlLeadTarget: 0 };
      map[key].retailTargetMtd += p.totalRetailTarget;
      map[key].leadTargetMtd   += p.totalLeadTarget;
      for (const a of p.activities) {
        if (a.category === "BTL") map[key].btlLeadTarget += a.leadTarget;
        else if (a.category === "ATL") map[key].atlLeadTarget += a.leadTarget;
      }
    }
    return Object.values(map).sort((a, b) => a.state.localeCompare(b.state));
  }, [mtdProposals]);

  const stateLeadGrandTotal = useMemo(() => {
    if (!stateLeadRows.length) return null;
    return stateLeadRows.reduce((acc, r) => ({
      retailTargetMtd: acc.retailTargetMtd + r.retailTargetMtd,
      leadTargetMtd:   acc.leadTargetMtd   + r.leadTargetMtd,
      btlLeadTarget:   acc.btlLeadTarget   + r.btlLeadTarget,
      atlLeadTarget:   acc.atlLeadTarget   + r.atlLeadTarget,
    }), { retailTargetMtd: 0, leadTargetMtd: 0, btlLeadTarget: 0, atlLeadTarget: 0 });
  }, [stateLeadRows]);

  // ── Report 3: Dealer detail (real activity-level data, all months) ───────
  const dealerNames = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.dealerName))).sort(),
    [proposals]
  );
  const dealerDetailRows = useMemo(() => {
    if (!selectedDealer) return [];
    const rows: Array<{
      proposalMonth: string; status: string; activityType: string; category: string | null;
      startDate: string | null; endDate: string | null;
      leadTarget: number; retailTarget: number; budget: number;
    }> = [];
    for (const p of proposals.filter((p) => p.dealerName === selectedDealer)) {
      for (const a of p.activities) {
        rows.push({
          proposalMonth: p.month, status: p.status, activityType: a.activityType,
          category: a.category, startDate: a.startDate, endDate: a.endDate,
          leadTarget: a.leadTarget, retailTarget: a.retailTarget, budget: a.budget,
        });
      }
    }
    return rows.sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  }, [proposals, selectedDealer]);

  return (
    <section className="arp-section">
      <div className="arp-header">
        <h2 className="arp-title">
          📊 Operational Reports
          <span className="arp-admin-chip">Admin only</span>
        </h2>
        <div className="arp-tabs">
          <button className={`arp-tab${tab === "daily"  ? " arp-tab--active" : ""}`} onClick={() => setTab("daily")}>Daily Activity Summary</button>
          <button className={`arp-tab${tab === "leads"  ? " arp-tab--active" : ""}`} onClick={() => setTab("leads")}>Lead Report</button>
          <button className={`arp-tab${tab === "dealer" ? " arp-tab--active" : ""}`} onClick={() => setTab("dealer")}>Dealer Detail</button>
        </div>
      </div>

      <p className="arp-legend">
        <span className="arp-legend-dot arp-legend-dot--live" /> Live from proposals ({CURRENT_MONTH_NAME} MTD)
        &nbsp;&nbsp;
        <span className="arp-legend-dot arp-legend-dot--na" /> Not tracked yet — needs a daily-ops data source
      </p>

      {/* ══ Report 1 ══ */}
      {tab === "daily" && (
        dealerSummaryRows.length === 0 ? (
          <div className="arp-empty">No proposals for {CURRENT_MONTH_NAME} yet.</div>
        ) : (
          <div className="arp-table-wrap">
            <table className="arp-table">
              <thead>
                <tr>
                  <th>#</th><th>Dealer</th><th>Location</th><th>State</th><th>Zone</th>
                  <th>BG Team Member</th>
                  <th className="arp-group arp-group--enq">Canopy/Mela</th>
                  <th className="arp-group arp-group--enq">Enq. Planned</th>
                  <th className="arp-group arp-group--enq">Enq. Actual</th>
                  <th className="arp-group arp-group--enq">Hot</th>
                  <th className="arp-group arp-group--tr">TR Planned</th>
                  <th className="arp-group arp-group--tr">TR Actual</th>
                  <th className="arp-group arp-group--bk">Booking Today</th>
                  <th className="arp-group arp-group--bk">Booking In Hand</th>
                  <th className="arp-group arp-group--rt">Retail Today</th>
                  <th className="arp-group arp-group--rt">Activity Count (MTD)</th>
                  <th className="arp-group arp-group--rt">Retail Target (MTD)</th>
                  <th>Closing Stock</th>
                  <th>Lead Target (MTD)</th>
                  <th>Punched</th>
                  <th>Conv %</th>
                </tr>
              </thead>
              <tbody>
                {dealerSummaryRows.map((r, i) => (
                  <tr key={r.dealer} className={i % 2 === 0 ? "arp-row-even" : "arp-row-odd"}>
                    <td>{i + 1}</td>
                    <td className="arp-td-bold">{r.dealer}</td>
                    <td>{r.location}</td>
                    <td>{r.state}</td>
                    <td><NA /></td>
                    <td>{r.team}</td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td className="arp-td-live">{r.activityCount}</td>
                    <td className="arp-td-live arp-td-bold">{r.retailTargetMtd.toLocaleString("en-IN")}</td>
                    <td><NA /></td>
                    <td className="arp-td-live arp-td-bold">{r.leadTargetMtd.toLocaleString("en-IN")}</td>
                    <td><NA /></td>
                    <td><NA /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ══ Report 2 ══ */}
      {tab === "leads" && (
        stateLeadRows.length === 0 ? (
          <div className="arp-empty">No proposals for {CURRENT_MONTH_NAME} yet.</div>
        ) : (
          <div className="arp-table-wrap">
            <table className="arp-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Expected Leads (Wheat)</th>
                  <th className="arp-group arp-group--enq">Walkin MTD Ach.</th>
                  <th className="arp-group arp-group--tr">BTL Lead Target (MTD)</th>
                  <th className="arp-group arp-group--tr">BTL MTD Ach.</th>
                  <th className="arp-group arp-group--bk">Referral MTD Ach.</th>
                  <th className="arp-group arp-group--rt">ATL Lead Target (MTD)</th>
                  <th className="arp-group arp-group--rt">ATL MTD Ach.</th>
                  <th>Digital MTD Ach.</th>
                  <th>Total Leads Received</th>
                  <th>Leads Variance</th>
                  <th>Leads Achievement %</th>
                  <th className="arp-td-live">Retail Target (MTD)</th>
                  <th>MTD Retail Achieved</th>
                  <th>MTD Retail Ach. %</th>
                  <th>Retails/Enquiries %</th>
                </tr>
              </thead>
              <tbody>
                {stateLeadRows.map((r, i) => (
                  <tr key={r.state} className={i % 2 === 0 ? "arp-row-even" : "arp-row-odd"}>
                    <td className="arp-td-bold">{r.state}</td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td className="arp-td-live">{r.btlLeadTarget.toLocaleString("en-IN")}</td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td className="arp-td-live">{r.atlLeadTarget.toLocaleString("en-IN")}</td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td className="arp-td-live arp-td-bold">{r.retailTargetMtd.toLocaleString("en-IN")}</td>
                    <td><NA /></td>
                    <td><NA /></td>
                    <td><NA /></td>
                  </tr>
                ))}
              </tbody>
              {stateLeadGrandTotal && (
                <tfoot>
                  <tr className="arp-grand-total">
                    <td>Grand Total</td>
                    <td><NA /></td><td><NA /></td>
                    <td>{stateLeadGrandTotal.btlLeadTarget.toLocaleString("en-IN")}</td>
                    <td><NA /></td><td><NA /></td>
                    <td>{stateLeadGrandTotal.atlLeadTarget.toLocaleString("en-IN")}</td>
                    <td><NA /></td><td><NA /></td><td><NA /></td><td><NA /></td><td><NA /></td>
                    <td>{stateLeadGrandTotal.retailTargetMtd.toLocaleString("en-IN")}</td>
                    <td><NA /></td><td><NA /></td><td><NA /></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )
      )}

      {/* ══ Report 3 ══ */}
      {tab === "dealer" && (
        <div>
          <div className="arp-dealer-picker">
            <label>Select dealer:</label>
            <select value={selectedDealer} onChange={(e) => setSelectedDealer(e.target.value)}>
              <option value="">— Choose a dealer —</option>
              {dealerNames.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {!selectedDealer ? (
            <div className="arp-empty">Select a dealer to see their activity detail.</div>
          ) : dealerDetailRows.length === 0 ? (
            <div className="arp-empty">No proposals found for {selectedDealer}.</div>
          ) : (
            <>
              <p className="arp-note">
                Note: your daily enquiry/test-drive/booking log (as in the "Shirdi Eco, Ajmer"
                sheet) isn't tracked in this system — shown below is the real per-activity data
                this system does have for {selectedDealer}, across all their proposals.
              </p>
              <div className="arp-table-wrap">
                <table className="arp-table">
                  <thead>
                    <tr>
                      <th>Month</th><th>Status</th><th>Activity</th><th>Category</th>
                      <th>Start Date</th><th>End Date</th>
                      <th className="arp-td-live">Lead Target</th>
                      <th className="arp-td-live">Retail Target</th>
                      <th className="arp-td-live">Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealerDetailRows.map((r, i) => (
                      <tr key={i} className={i % 2 === 0 ? "arp-row-even" : "arp-row-odd"}>
                        <td>{r.proposalMonth}</td>
                        <td><span className={`arp-status arp-status--${r.status.toLowerCase()}`}>{r.status}</span></td>
                        <td className="arp-td-bold">{r.activityType}</td>
                        <td>{r.category ?? "—"}</td>
                        <td>{r.startDate ? r.startDate.split("T")[0] : "—"}</td>
                        <td>{r.endDate ? r.endDate.split("T")[0] : "—"}</td>
                        <td className="arp-td-live">{r.leadTarget}</td>
                        <td className="arp-td-live">{r.retailTarget}</td>
                        <td className="arp-td-live">{inr(r.budget)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

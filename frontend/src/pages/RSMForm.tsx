import { useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useNavigate } from "react-router-dom";
import { submitProposal } from "../services/proposalService";
import { fetchStates, fetchCitiesByState } from "../services/locationService";
import type { StateOption, CityOption } from "../types/location";
import "./RSMForm.css";

const LOCATION_TYPES = ["Old", "New"];
const ACTIVITY_TYPES = ["Old", "New"];
const ELIGIBILITY_OPTIONS = ["Eligible", "Not Eligible", "Pending Approval"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

const emptyActivity = (): ActivityRow => ({
  id: crypto.randomUUID(),
  activityType: "",
  target: "",
  startDate: "",
  endDate: "",
  budget: "",
  incentive: "",
  remarks: "",
});

const emptyHeader = (rsmName: string): ProposalHeader => ({
  state: "",
  stateId: null,
  location: "",
  type: "",
  dealerName: "",
  rsmName,
  commandoName: "",
  month: "",
  eligibility: "",
  remarks: "",
});

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const inr = (v: number) =>
  v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function RSMProposalForm() {
  const { instance, accounts } = useMsal();
  const navigate = useNavigate();
  const account = accounts[0];

  const [header, setHeader] = useState<ProposalHeader>(emptyHeader(account?.name ?? ""));
  const [activities, setActivities] = useState<ActivityRow[]>([emptyActivity()]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [states, setStates] = useState<StateOption[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    fetchStates(instance)
      .then(setStates)
      .catch(() => setLocationError("Could not load states. Please refresh the page."));
  }, [instance]);

  const { totalBudget, totalTarget, cac } = useMemo(() => {
    const totalBudget = activities.reduce(
      (s, a) => s + num(a.budget) + num(a.incentive),
      0
    );
    const totalTarget = activities.reduce((s, a) => s + num(a.target), 0);
    const cac = totalTarget > 0 ? totalBudget / totalTarget : 0;
    return { totalBudget, totalTarget, cac };
  }, [activities]);

  const setField = (key: keyof ProposalHeader, value: string) =>
    setHeader((h) => ({ ...h, [key]: value }));

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value ? Number(e.target.value) : null;
    const selected = states.find((s) => s.id === id) ?? null;

    setHeader((h) => ({ ...h, state: selected?.name ?? "", stateId: id, location: "" }));
    setCities([]);
    setLocationError(null);

    if (id) {
      setLoadingCities(true);
      fetchCitiesByState(id, instance)
        .then(setCities)
        .catch(() => setLocationError("Could not load cities for this state."))
        .finally(() => setLoadingCities(false));
    }
  };

  const setActivity = (id: string, key: keyof ActivityRow, value: string) =>
    setActivities((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [key]: value } : r))
    );

  const addActivity = () =>
    setActivities((rows) => [...rows, emptyActivity()]);

  const removeActivity = (id: string) =>
    setActivities((rows) =>
      rows.length > 1 ? rows.filter((r) => r.id !== id) : rows
    );

  const handleSignOut = () =>
    instance.logoutRedirect().catch(console.error);

  const resetForm = () => {
    setHeader(emptyHeader(account?.name ?? ""));
    setActivities([emptyActivity()]);
    setCities([]);
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);

    const payload = {
      state: header.state,
      location: header.location,
      type: header.type,
      dealerName: header.dealerName,
      rsmName: header.rsmName,
      commandoName: header.commandoName,
      month: header.month,
      eligibility: header.eligibility,
      remarks: header.remarks,
      submittedBy: account?.username ?? null,
      activities: activities.map((a) => ({
        activityType: a.activityType,
        target: num(a.target),
        startDate: a.startDate,
        endDate: a.endDate,
        budget: num(a.budget),
        incentive: num(a.incentive),
        remarks: a.remarks,
      })),
      totalBudget,
      totalTarget,
      cac,
    };

    try {
      await submitProposal(payload, instance);

      resetForm();
      setSubmitted(true); // show success overlay

      // ── Navigate to approver screen after 1.8 s ──────────────
      setTimeout(() => {
        navigate("/approver");
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
    // Note: setSubmitting(false) intentionally NOT called on success —
    // button stays disabled until navigation fires.
  };

  return (
    <div className="rsm-page">
      <header className="rsm-topbar">
        <div className="rsm-brand">
          <img
            src="/BGauss_Logo.png"
            alt="BGauss"
            className="rsm-brand-logo"
          />
          <span className="rsm-brand-text">BGauss</span>
          <span className="rsm-brand-divider" />
          <span className="rsm-brand-sub">RSM Proposal</span>
        </div>
        <div className="rsm-topbar-right">
          <button className="rsm-back-btn" onClick={() => navigate("/dashboard")}>
            ← Dashboard
          </button>
          {account?.name && <span className="rsm-user">{account.name}</span>}
          <button className="rsm-signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="rsm-main">
        <div className="rsm-card">
          <div className="rsm-card-head">
            <h1 className="rsm-title">New Activity Proposal</h1>
            <p className="rsm-subtitle">
              Submit a marketing / sales activity plan for approval.
            </p>
          </div>

          <section className="rsm-section">
            <h2 className="rsm-section-title">Proposal Details</h2>
            <div className="rsm-grid">
              <Field label="State">
                <select
                  className="rsm-input"
                  value={header.stateId ?? ""}
                  onChange={handleStateChange}
                >
                  <option value="">Select state</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="City">
                <select
                  className="rsm-input"
                  value={header.location}
                  onChange={(e) => setField("location", e.target.value)}
                  disabled={!header.stateId || loadingCities}
                >
                  <option value="">
                    {!header.stateId
                      ? "Select a state first"
                      : loadingCities
                      ? "Loading cities…"
                      : "Select city"}
                  </option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
                {locationError && <span className="rsm-field-error">{locationError}</span>}
              </Field>

              <Field label="Type">
                <select
                  className="rsm-input"
                  value={header.type}
                  onChange={(e) => setField("type", e.target.value)}
                >
                  <option value="">Select type</option>
                  {LOCATION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>

              <Field label="Dealer Name">
                <input
                  className="rsm-input"
                  placeholder="Dealer / outlet name"
                  value={header.dealerName}
                  onChange={(e) => setField("dealerName", e.target.value)}
                />
              </Field>

              <Field label="RSM / TSM Name">
                <input
                  className="rsm-input"
                  value={header.rsmName}
                  onChange={(e) => setField("rsmName", e.target.value)}
                />
              </Field>

              <Field label="Commando Name">
                <input
                  className="rsm-input"
                  placeholder="Field executive name"
                  value={header.commandoName}
                  onChange={(e) => setField("commandoName", e.target.value)}
                />
              </Field>

              <Field label="Month">
                <select
                  className="rsm-input"
                  value={header.month}
                  onChange={(e) => setField("month", e.target.value)}
                >
                  <option value="">Select month</option>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>

              <Field label="Eligibility">
                <select
                  className="rsm-input"
                  value={header.eligibility}
                  onChange={(e) => setField("eligibility", e.target.value)}
                >
                  <option value="">Select eligibility</option>
                  {ELIGIBILITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className="rsm-section">
            <div className="rsm-section-head">
              <h2 className="rsm-section-title">Activities (Activity-wise)</h2>
              <button className="rsm-add-btn" onClick={addActivity}>
                + Add activity
              </button>
            </div>

            <div className="rsm-table-wrap">
              <table className="rsm-table">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Target</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                    <th>Budget (₹)</th>
                    <th>Incentive (₹)</th>
                    <th>Remarks</th>
                    <th aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <select
                          className="rsm-input rsm-input-sm"
                          value={a.activityType}
                          onChange={(e) =>
                            setActivity(a.id, "activityType", e.target.value)
                          }
                        >
                          <option value="">Select</option>
                          {ACTIVITY_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="rsm-input rsm-input-sm"
                          value={a.target}
                          onChange={(e) =>
                            setActivity(a.id, "target", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="rsm-input rsm-input-sm"
                          value={a.startDate}
                          onChange={(e) =>
                            setActivity(a.id, "startDate", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="rsm-input rsm-input-sm"
                          value={a.endDate}
                          min={a.startDate || undefined}
                          onChange={(e) =>
                            setActivity(a.id, "endDate", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="rsm-input rsm-input-sm"
                          value={a.budget}
                          onChange={(e) =>
                            setActivity(a.id, "budget", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="rsm-input rsm-input-sm"
                          value={a.incentive}
                          onChange={(e) =>
                            setActivity(a.id, "incentive", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="rsm-input rsm-input-sm"
                          placeholder="Note for this activity"
                          value={a.remarks}
                          onChange={(e) =>
                            setActivity(a.id, "remarks", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="rsm-remove-btn"
                          onClick={() => removeActivity(a.id)}
                          disabled={activities.length === 1}
                          aria-label="Remove activity"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rsm-summary">
            <div className="rsm-summary-item">
              <span className="rsm-summary-label">Total Target</span>
              <span className="rsm-summary-value">{inr(totalTarget)}</span>
            </div>
            <div className="rsm-summary-item">
              <span className="rsm-summary-label">Total Budget (All Activity)</span>
              <span className="rsm-summary-value">₹ {inr(totalBudget)}</span>
            </div>
            <div className="rsm-summary-item rsm-summary-accent">
              <span className="rsm-summary-label">CAC (auto)</span>
              <span className="rsm-summary-value">
                ₹ {cac.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
            </div>
          </section>

          <section className="rsm-section">
            <Field label="Remarks (overall proposal)">
              <textarea
                className="rsm-input rsm-textarea"
                rows={3}
                placeholder="Any additional notes for the approver…"
                value={header.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
              />
            </Field>
          </section>

          <div className="rsm-actions">
            {submitted && <span className="rsm-success">✓ Proposal submitted</span>}
            {error && <span className="rsm-error">{error}</span>}
            <button
              className="rsm-submit-btn"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit proposal"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rsm-field">
      <label className="rsm-label">{label}</label>
      {children}
    </div>
  );
}

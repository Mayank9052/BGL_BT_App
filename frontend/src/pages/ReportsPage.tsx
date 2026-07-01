import { useState } from "react";
import { useMsal } from "@azure/msal-react";
import { downloadExcelReport, downloadPdfReport, fetchReportData } from "../services/reportService";
import { useAuthStore } from "../store/authStore";
import "./ReportsPage.css";

const AUTHORIZED_EMAIL = "oat@bgauss.com";

export default function ReportsPage() {
  const { instance } = useMsal();
  const { user } = useAuthStore();

  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly" | "custom">("monthly");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [dealerFilter, setDealerFilter] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.email?.toLowerCase() !== AUTHORIZED_EMAIL) {
    return (
      <div className="reports-denied">
        <h2>Access Restricted</h2>
        <p>Only authorized personnel can access reports.</p>
      </div>
    );
  }

  const filters = {
    period: period === "custom" ? undefined : period,
    from: period === "custom" ? from : undefined,
    to:   period === "custom" ? to   : undefined,
    state: stateFilter || undefined,
    dealer: dealerFilter || undefined,
  };

  const handlePreview = async () => {
    setLoading(true); setError(null);
    try { setPreview(await fetchReportData(filters, instance)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load report."); }
    finally { setLoading(false); }
  };

  const handleDownload = async (type: "excel" | "pdf") => {
    setDownloading(type); setError(null);
    try {
      if (type === "excel") await downloadExcelReport(filters, instance);
      else await downloadPdfReport(filters, instance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="reports-page">
      <h1>BTL Reports</h1>
      <p className="reports-sub">Download proposal & activity reports — daily, weekly, monthly, or custom range.</p>

      <div className="reports-filters">
        <div className="reports-field">
          <label>Period</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value as any)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {period === "custom" && (
          <>
            <div className="reports-field">
              <label>From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="reports-field">
              <label>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}

        <div className="reports-field">
          <label>State (optional)</label>
          <input type="text" placeholder="e.g. Maharashtra" value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)} />
        </div>
        <div className="reports-field">
          <label>Dealer (optional)</label>
          <input type="text" placeholder="Dealer name" value={dealerFilter}
            onChange={(e) => setDealerFilter(e.target.value)} />
        </div>
      </div>

      {error && <div className="reports-error">{error}</div>}

      <div className="reports-actions">
        <button className="reports-btn reports-btn--ghost" onClick={handlePreview} disabled={loading}>
          {loading ? "Loading…" : "Preview"}
        </button>
        <button className="reports-btn reports-btn--excel" onClick={() => handleDownload("excel")} disabled={downloading !== null}>
          {downloading === "excel" ? "Generating…" : "⬇ Download Excel"}
        </button>
        <button className="reports-btn reports-btn--pdf" onClick={() => handleDownload("pdf")} disabled={downloading !== null}>
          {downloading === "pdf" ? "Generating…" : "⬇ Download PDF"}
        </button>
      </div>

      {preview && (
        <div className="reports-preview">
          <div className="reports-preview-stats">
            <div><span>{preview.totalProposals}</span><label>Proposals</label></div>
            <div><span>{preview.totalActivities}</span><label>Activities</label></div>
            <div><span>₹{preview.totalBudget.toLocaleString("en-IN")}</span><label>Total Budget</label></div>
          </div>
          <p className="reports-preview-range">{preview.periodLabel}</p>
        </div>
      )}
    </div>
  );
}
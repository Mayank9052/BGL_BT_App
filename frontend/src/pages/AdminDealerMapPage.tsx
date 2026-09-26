// src/pages/AdminDealerMapPage.tsx
import { useEffect, useState, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import {
  fetchDealerTeamMappings, createDealerTeamMapping, updateDealerTeamMapping,
  deleteDealerTeamMapping, type DealerTeamMappingRow, type UpsertDealerTeamMapping,
} from "../services/dealerTeamMappingService";

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

  const load = useCallback(async (q?: string) => {
    setLoading(true); setError(null);
    try {
      setRows(await fetchDealerTeamMappings(instance, q));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dealer mappings.");
    } finally {
      setLoading(false);
    }
  }, [instance]);

  useEffect(() => { load(); }, [load]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openCreate = () => {
    setEditingId(null); setForm(emptyForm); setFormError(null); setShowForm(true);
  };
  const openEdit = (row: DealerTeamMappingRow) => {
    setEditingId(row.id);
    setForm({
      dealerName: row.dealerName, dealerCode: row.dealerCode ?? "", city: row.city ?? "", state: row.state ?? "",
      rsm: row.rsm, rsmEmail: row.rsmEmail ?? "", tsm: row.tsm ?? "", tsmEmail: row.tsmEmail ?? "",
      commando: row.commando ?? "", commandoEmail: row.commandoEmail ?? "", dealerEmail: row.dealerEmail ?? "",
      isEligible: row.isEligible, dealerType: row.dealerType ?? "Old",
    });
    setFormError(null);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setFormError(null); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.dealerName.trim()) { setFormError("Dealer name is required."); return; }
    if (!form.rsm.trim())        { setFormError("RSM name is required."); return; }
    setSaving(true); setFormError(null);
    try {
      if (editingId !== null) await updateDealerTeamMapping(editingId, form, instance);
      else                    await createDealerTeamMapping(form, instance);
      closeForm();
      await load(search || undefined);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: DealerTeamMappingRow) => {
    if (!window.confirm(`Remove "${row.dealerName}" from the dealer mapping?`)) return;
    try {
      await deleteDealerTeamMapping(row.id, instance);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete.");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0",
    fontSize: 13, outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase",
    letterSpacing: "0.04em", marginBottom: 4, display: "block",
  };

  return (
    <div style={{ padding: "2px 10px 40px", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0a2540", margin: "0 0 4px" }}>
            Dealer Mapping
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
            RSM / TSM / Commando assignment per dealer, plus eligibility and dealer-type classification —
            drives auto-fill in the RSM Proposal Form and the Old/New/Non-Eligible budget split on the Dashboard.
          </p>
        </div>
        <button onClick={openCreate}
          style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8,
            padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
          + Add Dealer Mapping
        </button>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "4px solid #ef4444",
          borderRadius: 8, padding: "11px 14px", marginBottom: 16, fontSize: 13, color: "#991b1b" }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search dealer name, code, RSM, TSM, city, state…"
          style={{ ...inputStyle, maxWidth: 400 }} />
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#0a2540" }}>
              {["Dealer", "Code", "City / State", "RSM", "TSM", "Commando", "Eligibility", "Type", ""].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#94a3b8",
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontStyle: "italic" }}>
                {search ? "No dealers match your search." : "No dealer mappings yet — click Add Dealer Mapping to create one."}
              </td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "9px 12px", fontWeight: 600, color: "#0a2540" }}>
                  {r.dealerName}
                  {r.dealerEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.dealerEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11, color: "#374151" }}>{r.dealerCode ?? "—"}</td>
                <td style={{ padding: "9px 12px", fontSize: 12 }}>{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ fontWeight: 600 }}>{r.rsm}</div>
                  {r.rsmEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.rsmEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <div>{r.tsm || <span style={{ color: "#cbd5e1" }}>—</span>}</div>
                  {r.tsmEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.tsmEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <div>{r.commando || <span style={{ color: "#cbd5e1" }}>—</span>}</div>
                  {r.commandoEmail && <div style={{ fontSize: 10, color: "#9ca3af" }}>{r.commandoEmail}</div>}
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12,
                    background: r.isEligible ? "#dcfce7" : "#fee2e2",
                    color: r.isEligible ? "#166534" : "#991b1b",
                  }}>
                    {r.isEligible ? "Eligible" : "Non-Eligible"}
                  </span>
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 12,
                    background: r.dealerType === "New" ? "#eff6ff" : "#f1f5f9",
                    color: r.dealerType === "New" ? "#1e40af" : "#374151",
                  }}>
                    {r.dealerType ?? "—"}
                  </span>
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openEdit(r)}
                      style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af",
                        borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      Edit
                    </button>
                    <button onClick={() => handleDelete(r)}
                      style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b",
                        borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      Delete
                    </button>
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
          <strong style={{ color: "#991b1b" }}>{rows.filter((r) => !r.isEligible).length}</strong> non-eligible
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
                  padding: "8px 12px", fontSize: 12, color: "#991b1b", marginBottom: 14 }}>
                  ⚠ {formError}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Dealer Name *</label>
                  <input style={inputStyle} value={form.dealerName}
                    onChange={(e) => setForm((f) => ({ ...f, dealerName: e.target.value }))} required />
                </div>
                <div>
                  <label style={labelStyle}>Dealer Code</label>
                  <input style={inputStyle} value={form.dealerCode ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, dealerCode: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>City</label>
                  <input style={inputStyle} value={form.city ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>State</label>
                  <input style={inputStyle} value={form.state ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
                </div>
              </div>

              <div style={{ height: 1, background: "#e2e8f0", margin: "14px 0" }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>RSM Name *</label>
                  <input style={inputStyle} value={form.rsm}
                    onChange={(e) => setForm((f) => ({ ...f, rsm: e.target.value }))} required />
                </div>
                <div>
                  <label style={labelStyle}>RSM Email</label>
                  <input style={inputStyle} type="email" value={form.rsmEmail ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, rsmEmail: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>TSM Name</label>
                  <input style={inputStyle} value={form.tsm ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, tsm: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>TSM Email</label>
                  <input style={inputStyle} type="email" value={form.tsmEmail ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, tsmEmail: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Commando Name</label>
                  <input style={inputStyle} value={form.commando ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, commando: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Commando Email</label>
                  <input style={inputStyle} type="email" value={form.commandoEmail ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, commandoEmail: e.target.value }))} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Dealer Email</label>
                <input style={inputStyle} type="email" value={form.dealerEmail ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, dealerEmail: e.target.value }))} />
              </div>

              <div style={{ height: 1, background: "#e2e8f0", margin: "14px 0" }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
                <div>
                  <label style={labelStyle}>Eligibility</label>
                  <select style={inputStyle} value={form.isEligible ? "yes" : "no"}
                    onChange={(e) => setForm((f) => ({ ...f, isEligible: e.target.value === "yes" }))}>
                    <option value="yes">Eligible</option>
                    <option value="no">Non-Eligible</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Dealer Type</label>
                  <select style={inputStyle} value={form.dealerType ?? "Old"}
                    onChange={(e) => setForm((f) => ({ ...f, dealerType: e.target.value }))}>
                    <option value="Old">Old</option>
                    <option value="New">New</option>
                  </select>
                </div>
              </div>
              <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 18px" }}>
                These two fields directly control which bucket (Eligible Old / Eligible New / Non-Eligible)
                this dealer's proposals fall into on the Dashboard's state-wise summary.
              </p>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" onClick={closeForm}
                  style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#374151",
                    borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  style={{ background: saving ? "#9ca3af" : "#16a34a", color: "#fff", border: "none",
                    borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700,
                    cursor: saving ? "not-allowed" : "pointer" }}>
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
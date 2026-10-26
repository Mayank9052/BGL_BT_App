// src/components/MultiSelectDropdown.tsx
// Checkbox multi-select dropdown — "All" when nothing is ticked.
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  label: string;                 // e.g. "States"
  options: string[];
  value: string[];               // [] = All
  onChange: (v: string[]) => void;
  width?: number;
  searchable?: boolean;          // search box inside the panel (default: true when > 8 options)
}

export default function MultiSelectDropdown({ label, options, value, onChange, width = 200, searchable }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const showSearch = searchable ?? options.length > 8;
  const visible = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  );
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  const text = value.length === 0 ? `All ${label}` : value.length === 1 ? value[0] : `${value.length} ${label} selected`;

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button type="button" onClick={() => setOpen((v) => !v)} title={value.join(", ")}
        style={{ width: "100%", height: 36, padding: "0 28px 0 10px", textAlign: "left", cursor: "pointer",
          border: `1.5px solid ${value.length ? "#2563eb" : "#e2e8f0"}`, borderRadius: 8, fontSize: 12,
          fontFamily: "inherit", background: value.length ? "#eff6ff" : "#fff", color: "#0a2540",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", position: "relative" }}>
        {text}
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%", zIndex: 60,
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 10px 28px rgba(0,0,0,.14)" }}>
          {showSearch && (
            <div style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`}
                style={{ width: "100%", height: 30, padding: "0 8px", border: "1px solid #e2e8f0", borderRadius: 6,
                  fontSize: 12, outline: "none", boxSizing: "border-box" }} />
            </div>
          )}
          <div style={{ display: "flex", gap: 12, padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>
            <button type="button" onClick={() => onChange(Array.from(new Set([...value, ...visible])))}
              style={{ background: "none", border: "none", color: "#2563eb", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              Select all{q ? " shown" : ""}
            </button>
            <button type="button" onClick={() => onChange([])}
              style={{ background: "none", border: "none", color: "#64748b", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              Clear
            </button>
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto", padding: "4px 0" }}>
            {visible.map((o) => (
              <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", background: value.includes(o) ? "#f0f9ff" : undefined }}>
                <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} style={{ accentColor: "#2563eb" }} />
                {o}
              </label>
            ))}
            {visible.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#9ca3af" }}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}
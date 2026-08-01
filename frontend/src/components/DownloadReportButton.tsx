import { useState, useRef, useEffect } from "react";
import { exportToCSV, exportToXLSX, exportToPDF, type ExportColumn } from "../utils/exportReport";

interface Props {
  filename: string;
  title: string;
  columns: ExportColumn[];
  rows: Record<string, any>[];
}

export default function DownloadReportButton({ filename, title, columns, rows }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handle = (fmt: "csv" | "xlsx" | "pdf") => {
    const opts = { filename, title, columns, rows };
    if (fmt === "csv") exportToCSV(opts);
    else if (fmt === "xlsx") exportToXLSX(opts);
    else exportToPDF(opts);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={rows.length === 0}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: rows.length === 0 ? "#f1f5f9" : "#0a2540",
          color: rows.length === 0 ? "#9ca3af" : "#fff",
          border: "none", borderRadius: 7, padding: "7px 14px",
          fontSize: 12, fontWeight: 700, cursor: rows.length === 0 ? "not-allowed" : "pointer",
        }}
      >
        ⬇ Download {open ? "▲" : "▼"}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 140, overflow: "hidden",
        }}>
          {[
            { fmt: "csv" as const,  label: "📄 CSV" },
            { fmt: "xlsx" as const, label: "📊 Excel (.xlsx)" },
            { fmt: "pdf" as const,  label: "🧾 PDF" },
          ].map(o => (
            <button key={o.fmt} onClick={() => handle(o.fmt)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "9px 14px", fontSize: 12.5, fontWeight: 600,
                background: "none", border: "none", cursor: "pointer", color: "#0a2540",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
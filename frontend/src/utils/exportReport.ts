import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportColumn {
  header: string;
  key: string;
}

export interface ExportOptions {
  filename: string;       // without extension
  title: string;          // shown at top of PDF
  columns: ExportColumn[];
  rows: Record<string, any>[];
}

// ── CSV ──────────────────────────────────────────────────────────────────
export function exportToCSV({ filename, columns, rows }: ExportOptions) {
  const header = columns.map(c => `"${c.header.replace(/"/g, '""')}"`).join(",");
  const body = rows.map(r =>
    columns.map(c => {
      const v = r[c.key] ?? "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(",")
  ).join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${filename}.csv`);
}

// ── XLSX ─────────────────────────────────────────────────────────────────
export function exportToXLSX({ filename, columns, rows }: ExportOptions) {
  const sheetData = [
    columns.map(c => c.header),
    ...rows.map(r => columns.map(c => r[c.key] ?? "")),
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  // Auto column width
  ws["!cols"] = columns.map(c => ({ wch: Math.max(c.header.length + 2, 10) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ── PDF ──────────────────────────────────────────────────────────────────
export function exportToPDF({ filename, title, columns, rows }: ExportOptions) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleString("en-IN"), 40, 56);

  autoTable(doc, {
    startY: 70,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? ""))),
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [10, 37, 64], textColor: 255, fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 20, right: 20 },
  });

  doc.save(`${filename}.pdf`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
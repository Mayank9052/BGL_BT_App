// src/utils/pdfTable.ts
// ONE safe way to get jsPDF + autoTable in the production (Vite/Rollup) build.
//
// Why: "jspdf-autotable" (".") points to a UMD/CommonJS bundle. In the production
// build Rollup's CommonJS interop sometimes hands back an object instead of the
// function, so `autoTable(doc, …)` fails with
//   "Report could not be created: (0 , wL.default) is not a function".
// Fix: load the real ES-module build ("jspdf-autotable/es") and, as a last resort,
// fall back to the classic plugin form doc.autoTable(...).
import { jsPDF } from "jspdf";
import * as AutoTableModule from "jspdf-autotable/es";
import type { UserOptions } from "jspdf-autotable/es";

type AutoTableFn = (doc: jsPDF, options: UserOptions) => void;

const resolveAutoTable = (): AutoTableFn => {
  const m = AutoTableModule as unknown as Record<string, unknown> & { default?: unknown };
  const candidates: unknown[] = [
    m.default,
    (m.default as { default?: unknown } | undefined)?.default,
    m.autoTable,
  ];
  for (const c of candidates) if (typeof c === "function") return c as AutoTableFn;
  if (typeof m.applyPlugin === "function") (m.applyPlugin as (j: typeof jsPDF) => void)(jsPDF);
  return (doc, options) => {
    const plugin = (doc as unknown as { autoTable?: (o: UserOptions) => void }).autoTable;
    if (typeof plugin !== "function") throw new Error("PDF table library failed to load — refresh the page (Ctrl+F5) and try again.");
    plugin.call(doc, options);
  };
};

export const autoTable: AutoTableFn = resolveAutoTable();
export { jsPDF };
export type { UserOptions };

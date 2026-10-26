BGauss BTL — Daily Activity Report: filters + Daily Report as PPT / PDF / Excel + Admin Delete (26.10.2026)

COPY (new / updated files)
  frontend/src/components/MultiSelectDropdown.tsx
  frontend/src/utils/dailyReportCore.ts      (NEW  - one definition of every table, used by all 3 formats)
  frontend/src/utils/dailyReportPpt.ts       (UPDATED - now built on dailyReportCore)
  frontend/src/utils/dailyReportPdf.ts       (NEW)
  frontend/src/utils/dailyReportExcel.ts     (NEW)
  frontend/public/ppt-assets/*               (brand images from Project_Towns_15_August_2026.pptx)
  Backend/Controllers/ProposalsController.cs (full file, with DELETE /api/proposals/{id})

PATCH existing files (from the BGL_BT_App folder)
  node apply-changes.mjs frontend      (part 1: filters, date range, Daily PPT, Delete, Send summary; skips if already done)
  node apply-changes-2.mjs frontend    (part 2: PPT / PDF / Excel buttons)

INSTALL + BUILD
  cd frontend
  npm i pptxgenjs@3.12.0 jspdf@2.5.2 jspdf-autotable@3.8.4 exceljs@4.4.0
  npm run build
  cd ../Backend && dotnet build

SAMPLE_Daily_Report_test-data.(pptx|pdf|xlsx) = generator output with dummy figures (layout check only).

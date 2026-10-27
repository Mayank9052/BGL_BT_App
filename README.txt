BGauss BTL — 27.10.2026 part 4
(icon Review/View/Delete with hover text · Download menu fix · PDF fix · Dealer Type override)

ORDER (parts 1–3 must already be applied)
 1. SQL      Backend/Sql/DealerMapping_TypeOverride.sql      (4 new columns)
 2. Model    add the properties in Backend/Models/DealerTeamMapping.ADD-THESE-PROPERTIES.cs
 3. Backend  replace Controllers/DealerTeamMappingController.cs and Controllers/ProposalsController.cs
             (cumulative — they include all 26.10 changes) → dotnet build → publish → restart
 4. Frontend copy:  src/utils/pdfTable.ts (NEW)
                    src/utils/dailyReportPdf.ts (replace)
                    src/components/DownloadReportButton.tsx + DownloadReportButton.css (replace)
             node apply-changes-4.mjs frontend
             npm run build
 5. Check:   Analytics → Daily Activity Report → Download ▾ → PDF / Excel / PPT / CSV
             Approver Dashboard → hover the icons in the Action column
             Dealer Mapping → Edit a dealer with a code → "Incorrect? Override"

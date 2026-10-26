BGauss BTL — 26.10.2026 part 3
(Dealer Active/Inactive · Old/New from RRERP · inactive staff · multi-select filters · bulk delete · default month)

ORDER
 1. SQL     Backend/Sql/DealerMapping_Status_TypeAuto.sql            (adds IsActive, DealerTypeUpdatedAt)
 2. Model   add the 2 properties in Backend/Models/DealerTeamMapping.ADD-THESE-PROPERTIES.cs
 3. Backend copy (replace):
              Services/DealerTypeService.cs                (NEW)
              Controllers/DealerTeamMappingController.cs
              Controllers/DealerEligibilityController.cs
              Controllers/ProposalsController.cs           (CAC limit now uses DealerTypeService)
              Program.cs                                   (+ AddScoped<DealerTypeService>)
            appsettings.json (optional):  "DealerType": { "NewWindowMonths": 3 }
            dotnet build  → publish → restart
 4. Frontend copy: src/services/dealerStatusService.ts (NEW), src/components/MultiSelectDropdown.tsx
            node apply-changes.mjs frontend      (part 1 — skipped if already applied)
            node apply-changes-2.mjs frontend    (part 2 — skipped if already applied)
            node apply-changes-3.mjs frontend    (this part)
            npm run build
 5. Dealer Mapping page → "↻ Old/New from RRERP" once (afterwards it runs automatically every 12 h).

// src/hooks/useDealerTeamLookup.ts
// React hook over fetchDealerTeamLookup() (DB: DealerTeamMappings) + createDealerTeamMatcher().
//   const { findDealerTeam, teamRows } = useDealerTeamLookup(instance);
//   const team = findDealerTeam(dealerCode, dealerName);   // OLD arg order kept
import { useEffect, useMemo, useState, useCallback } from "react";
import type { IPublicClientApplication } from "@azure/msal-browser";
import {
  fetchDealerTeamLookup,
  type DealerTeamLookupRow,
} from "../services/dealerTeamMappingService";
import { createDealerTeamMatcher } from "../utils/dealerTeamLookup";

export type DealerTeam = DealerTeamLookupRow;

export function useDealerTeamLookup(instance: IPublicClientApplication) {
  const [rows, setRows]       = useState<DealerTeamLookupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDealerTeamLookup(instance)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dealer team mapping.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [instance]);

  const matcher = useMemo(() => createDealerTeamMatcher(rows), [rows]);

  // (dealerCode, dealerName) — same order as the old dealerTeamMap.ts findDealerTeam
  const findDealerTeam = useCallback(
    (dealerCode: string, dealerName: string): DealerTeam | null => matcher(dealerName, dealerCode),
    [matcher],
  );

  return { findDealerTeam, teamRows: rows, loading, error };
}
// src/utils/dealerTeamLookup.ts
// Matches an ERP dealer / proposal to its DealerTeamMappings row.
// Order: Dealer Code → exact name → normalized name → UNIQUE token-subset match.
// An ambiguous token-subset match (2+ candidates) returns null instead of
// guessing — a wrong match would cc the wrong RSM/TSM/Commando.
import type { DealerTeamLookupRow } from "../services/dealerTeamMappingService";

const SUFFIXES = /\b(pvt|ltd|llp|private|limited|motors|automobiles|auto|mobility|ev|world|enterprise|enterprises|traders|trading)\b/g;

export function normalizeDealerName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DealerTeamMatcher<T> = (dealerName?: string | null, dealerCode?: string | null) => T | null;

export function createDealerTeamMatcher<T extends DealerTeamLookupRow>(rows: T[]): DealerTeamMatcher<T> {
  const byCode  = new Map<string, T>();
  const byLower = new Map<string, T>();
  const byNorm  = new Map<string, T>();
  const tokenized: Array<{ row: T; tokens: Set<string> }> = [];

  for (const r of rows) {
    const code = r.dealerCode?.trim().toLowerCase();
    if (code && !byCode.has(code)) byCode.set(code, r);
    const lower = r.dealerName.trim().toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, r);
    const norm = normalizeDealerName(r.dealerName);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, r);
    tokenized.push({ row: r, tokens: new Set(norm.split(" ").filter(Boolean)) });
  }

  return (dealerName, dealerCode) => {
    const code = dealerCode?.trim().toLowerCase();
    if (code) { const hit = byCode.get(code); if (hit) return hit; }
    if (!dealerName?.trim()) return null;

    const exact = byLower.get(dealerName.trim().toLowerCase());
    if (exact) return exact;

    const norm = normalizeDealerName(dealerName);
    if (!norm) return null;
    const normHit = byNorm.get(norm);
    if (normHit) return normHit;

    const input = new Set(norm.split(" ").filter(Boolean));
    let found: T | null = null;
    for (const { row, tokens } of tokenized) {
      const [small, big] = input.size <= tokens.size ? [input, tokens] : [tokens, input];
      if (small.size < 2) continue;
      let all = true;
      for (const t of small) { if (!big.has(t)) { all = false; break; } }
      if (!all) continue;
      if (found && found !== row) return null;   // ambiguous → do not guess
      found = row;
    }
    return found;
  };
}

/** One-off wrapper (builds the index each call — fine for ~200 rows). */
export function findDealerTeamFromRows<T extends DealerTeamLookupRow>(
  rows: T[], dealerName?: string | null, dealerCode?: string | null,
): T | null {
  return createDealerTeamMatcher(rows)(dealerName, dealerCode);
}
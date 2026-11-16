import { useCallback, useEffect, useState } from "react";
import type { MsalLike } from "../services/cnService";
import { fetchAccessMe, type AccessLevel, type AccessMe } from "../services/accountsAccessService";

export function useAccountsAccess(instance: MsalLike) {
  const [me, setMe] = useState<AccessMe | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true; setReady(false); setError(null);
    fetchAccessMe(instance)
      .then((x) => live && setMe(x))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load access rights."))
      .finally(() => live && setReady(true));
    return () => { live = false; };
  }, [instance]);

  // UI convenience only — the API enforces the same rules.
  const can = useCallback((page: string, level: AccessLevel) => {
    const p = me?.permissions.find((x) => x.pageKey === page);
    return !!p && p[level];
  }, [me]);

  return { me, ready, error, can, isAdmin: !!me?.isAdmin };
}
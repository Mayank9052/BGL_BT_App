// src/components/AutoUpdateChecker.tsx
// Mount this ONCE near the top of App.tsx (inside the router, outside any
// auth-gated route, so it runs for every user on every platform — desktop
// Chrome/Edge/Safari, Windows, macOS, iOS, Android — regardless of login).
//
// How it works:
// 1. On mount, and then every CHECK_INTERVAL_MS, fetch /version.json with
//    cache:"no-store" (bypasses the browser's HTTP cache entirely — this
//    request always hits the network, never a stale cached copy).
// 2. Compare the buildId it returns against the one stored in
//    sessionStorage from the last check.
// 3. If this is the FIRST load in this tab, just record the buildId (no
//    reload — nothing to compare against yet).
// 4. If a later check returns a DIFFERENT buildId than what's stored, a new
//    version has been deployed since this tab was opened. Clear the Cache
//    Storage API (in case a service worker or the browser cached old JS/CSS
//    chunks) and hard-reload the page, which pulls the fresh index.html and
//    fresh fingerprinted bundle files.
//
// This does NOT touch localStorage (so login tokens, dealer JWT, and user
// preferences survive the reload) — it only clears the Cache Storage API
// and forces a network-fresh page load.

import { useEffect, useRef } from "react";

const CHECK_INTERVAL_MS = 60_000; // check every 60s while the tab is open
const STORAGE_KEY = "bgauss_btl_build_id";

async function fetchBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.buildId === "string" ? data.buildId : null;
  } catch {
    return null; // offline or blocked — just skip this check, try again next interval
  }
}

async function clearCachesAndReload() {
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    // If a service worker was ever registered (now or in the past), drop it too.
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // Best-effort — proceed to reload regardless.
  } finally {
    // Bust any remaining disk/memory cache for the reload itself.
    window.location.reload();
  }
}

export default function AutoUpdateChecker() {
  const knownBuildId = useRef<string | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      const latest = await fetchBuildId();
      checking.current = false;
      if (cancelled || !latest) return;

      const stored = knownBuildId.current ?? sessionStorage.getItem(STORAGE_KEY);
      if (!stored) {
        // First check this tab has done — just record it, nothing to compare yet.
        knownBuildId.current = latest;
        sessionStorage.setItem(STORAGE_KEY, latest);
        return;
      }
      if (stored !== latest) {
        // A new build was deployed since this tab loaded. Force a clean reload.
        sessionStorage.setItem(STORAGE_KEY, latest);
        clearCachesAndReload();
      }
    };

    check(); // check immediately on mount too
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    // Also check the moment the tab regains focus/visibility — catches the
    // common case where someone leaves a tab open overnight through a deploy.
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null; // renders nothing — purely a background watcher
}

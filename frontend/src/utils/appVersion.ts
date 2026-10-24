// src/utils/appVersion.ts
//
// Auto-refresh after every deployment.
//
// How it works:
//   • Each build gets a unique BUILD ID (vite.config.ts → __APP_BUILD_ID__) and
//     writes /version.json with the same id.
//   • This watcher fetches /version.json (never cached) and compares.
//   • New version found:
//       - on app load / login / page navigation → clear browser caches + hard reload
//         immediately (user is between screens, nothing typed is lost)
//       - while the user is working on a page (timer / tab re-focus) → show a top
//         banner "New version available — Refresh now", and reload automatically
//         at their next page navigation. This avoids wiping a half-filled RSM form.
//   • Old JS chunk missing after deploy ("Failed to fetch dynamically imported
//     module") → reload immediately (the page is broken anyway).
//
// What is NOT cleared: localStorage (login / dealer token). Users stay signed in.

declare const __APP_BUILD_ID__: string;

const CURRENT_BUILD: string =
  typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "unknown";
const CHECK_EVERY_MS   = 5 * 60 * 1000;   // background check every 5 min
const NAV_THROTTLE_MS  = 60 * 1000;       // at most one network check per minute on navigation
const RELOAD_GUARD_KEY = "bgauss_reloaded_for_build"; // sessionStorage — stops reload loops

let pendingBuild: string | null = null;
let lastCheckAt = 0;
let started = false;

async function fetchLatestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: unknown };
    return typeof data.buildId === "string" && data.buildId ? data.buildId : null;
  } catch {
    return null; // offline / server restarting — try again later
  }
}

async function clearBrowserCaches(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* ignore */ }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* ignore */ }
}

async function hardReload(targetBuild: string): Promise<void> {
  // Loop guard: if we already reloaded once for this build and are STILL on the
  // old one (e.g. a proxy served stale index.html), don't reload again — show the banner.
  if (sessionStorage.getItem(RELOAD_GUARD_KEY) === targetBuild) {
    showBanner();
    return;
  }
  sessionStorage.setItem(RELOAD_GUARD_KEY, targetBuild);
  await clearBrowserCaches();
  window.location.reload();
}

type Reason = "load" | "nav" | "visible" | "timer";

async function check(reason: Reason): Promise<void> {
  if (pendingBuild) {
    if (reason === "load" || reason === "nav") await hardReload(pendingBuild);
    return;
  }
  const now = Date.now();
  if (reason === "nav" && now - lastCheckAt < NAV_THROTTLE_MS) return;
  lastCheckAt = now;

  const latest = await fetchLatestBuild();
  if (!latest) return;
  if (latest === CURRENT_BUILD) {
    sessionStorage.removeItem(RELOAD_GUARD_KEY); // we are up to date
    return;
  }
  pendingBuild = latest;
  if (reason === "load" || reason === "nav") await hardReload(latest);
  else showBanner();
}

// ── Banner (plain DOM, no React dependency) ─────────────────────────────────
function showBanner(): void {
  if (document.getElementById("bgauss-update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "bgauss-update-banner";
  bar.setAttribute("role", "status");
  bar.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
    "background:#0a2540", "color:#fff", "font:600 13px 'Segoe UI',Arial,sans-serif",
    "display:flex", "align-items:center", "justify-content:center", "gap:14px",
    "padding:9px 16px", "box-shadow:0 2px 10px rgba(0,0,0,.25)",
  ].join(";");

  const text = document.createElement("span");
  text.textContent = "A new version of the BTL portal is available. Save your work, then refresh.";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Refresh now";
  btn.style.cssText =
    "background:#16a34a;color:#fff;border:none;border-radius:6px;padding:6px 14px;font:700 12px 'Segoe UI',Arial,sans-serif;cursor:pointer";
  btn.onclick = async () => {
    sessionStorage.removeItem(RELOAD_GUARD_KEY); // explicit user action: always reload
    await clearBrowserCaches();
    window.location.reload();
  };

  bar.append(text, btn);
  document.body.appendChild(bar);
}

// ── Navigation hook (works with React Router — it uses pushState) ───────────
function watchNavigation(): void {
  const origPush = history.pushState.bind(history);
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    origPush(...args);
    void check("nav");
  };
  window.addEventListener("popstate", () => void check("nav"));
}

// ── Broken chunk after deploy → reload ─────────────────────────────────────
function watchChunkErrors(): void {
  const isChunkError = (msg: string) =>
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(msg);

  // Vite fires this when a lazy chunk / CSS fails to preload
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    void hardReload(pendingBuild ?? `chunk-${CURRENT_BUILD}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String((e.reason as { message?: string } | undefined)?.message ?? e.reason ?? "");
    if (isChunkError(msg)) void hardReload(pendingBuild ?? `chunk-${CURRENT_BUILD}`);
  });
}

/** Call once from main.tsx. Does nothing in `npm run dev`. */
export function startVersionWatcher(): void {
  if (started || import.meta.env.DEV) return;
  started = true;

  watchNavigation();
  watchChunkErrors();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check("visible");
  });
  window.setInterval(() => void check("timer"), CHECK_EVERY_MS);
  void check("load");
}

export const APP_BUILD_ID = CURRENT_BUILD;

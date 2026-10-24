// frontend/vite-version-plugin.ts
// Gives every `npm run build` a unique BUILD ID and writes dist/version.json.
// The app compares its own build id with /version.json to detect a new deployment.
import type { Plugin } from "vite";

// e.g. 20261024154512  (UTC yyyyMMddHHmmss)
export const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

export function versionFilePlugin(): Plugin {
  return {
    name: "bgauss-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }, null, 2),
      });
    },
  };
}

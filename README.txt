BGauss BTL — auto refresh after every deployment (24.10.2026)

1. frontend/vite-version-plugin.ts          → copy to frontend/ (next to vite.config.ts)
2. frontend/vite.config.ts                  → add BUILD_ID define + versionFilePlugin() (see below)
3. frontend/src/vite-env.d.ts               → add: declare const __APP_BUILD_ID__: string;
4. frontend/src/utils/appVersion.ts         → copy
5. frontend/src/main.tsx                    → call startVersionWatcher()
6. Backend/Program.cs                       → apply Program.StaticFiles.snippet.cs
7. Build frontend, copy dist/* (incl. version.json) to Backend/wwwroot, publish backend.

vite.config.ts:
  import { BUILD_ID, versionFilePlugin } from "./vite-version-plugin";
  export default defineConfig({
    define:  { __APP_BUILD_ID__: JSON.stringify(BUILD_ID) },
    plugins: [react(), versionFilePlugin()],
    // ...rest unchanged
  });

main.tsx (top, after imports):
  import { startVersionWatcher } from "./utils/appVersion";
  startVersionWatcher();

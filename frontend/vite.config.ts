// frontend\vite.config.ts
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// ── NEW: unique id for every `npm run build` (UTC yyyyMMddHHmmss) ────────────
// Baked into the JS as __APP_BUILD_ID__ and written to wwwroot/version.json.
// src/utils/appVersion.ts compares the two → new deploy detected → cache cleared + reload.
const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

function versionFilePlugin(): Plugin {
  return {
    name: 'bgauss-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }, null, 2),
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), versionFilePlugin()],
  build: {
    outDir: '../Backend/wwwroot',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5086',
        changeOrigin: true,
        secure: false,
      },
      // ── Media files (uploaded activity images/PDFs/videos) ──────────────
      // Physically served from Backend/wwwroot/uploads by ASP.NET's
      // UseStaticFiles(). Without this proxy, the dev server (port 5173)
      // has no idea what /uploads is and 404s on every thumbnail —
      // production doesn't need this because the built frontend and the
      // uploads folder live in the same wwwroot, served by the same process.
      '/uploads': {
        target: 'http://localhost:5086',
        changeOrigin: true,
        secure: false,
      },
    }
  }
})
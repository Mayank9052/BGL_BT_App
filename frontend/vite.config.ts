// frontend\vite.config.ts
// [BTL-2026-11-17] • Build output still goes to Backend/wwwroot.
//                  • emptyOutDir = false → wwwroot/uploads (photos, invoices) is never deleted.
//                    Old JS/CSS in wwwroot/assets is cleaned by the "prebuild" script in package.json.
//                  • Silenced 2 known, harmless build warnings (bundle size, SignalR comment).
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// ── unique id for every `npm run build` (UTC yyyyMMddHHmmss) ─────────────────
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
    emptyOutDir: false,                 // NEVER true — would delete wwwroot/uploads
    chunkSizeWarningLimit: 4000,        // known large single bundle (≈960 kB gzipped) — no warning
    rolldownOptions: {
      onLog(level, log, handler) {
        if (log.code === 'INVALID_ANNOTATION') return   // harmless comment in @microsoft/signalr
        handler(level, log)
      },
    },
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
      // Served from Backend/wwwroot/uploads by ASP.NET UseStaticFiles().
      // The dev server (5173) proxies /uploads so thumbnails work locally.
      '/uploads': {
        target: 'http://localhost:5086',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
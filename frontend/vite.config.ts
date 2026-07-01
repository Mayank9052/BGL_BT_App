import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
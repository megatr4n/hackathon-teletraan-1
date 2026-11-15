import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { createRequire } from 'node:module'

const resolve = createRequire(import.meta.url).resolve

export default defineConfig({
  resolve: { alias: { assert: resolve('assert/'), events: resolve('events/'), buffer: resolve('buffer/'), process: resolve('process/browser') }, dedupe: ['react','react-dom','react-redux','styled-components'] },
  define: { global: 'globalThis' },
  optimizeDeps: {
    include: ['jspdf', 'svg2pdf.js', 'three'],
    esbuildOptions: {
      // Kepler's transitive Node shims also reference process without importing it.
      inject: [fileURLToPath(new URL('./shims/process.mjs', import.meta.url))],
    },
  },
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api/v2': {target: process.env.VITE_FIRMS_API || 'http://127.0.0.1:8000', changeOrigin:true},
    },
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../config', import.meta.url))],
    },
  },
  build: {
    rollupOptions: { output: { manualChunks: { map: ['maplibre-gl'] } } },
    chunkSizeWarningLimit: 1200,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Splits the always-loaded React/routing/data/auth stack into its
        // own chunk, separate from app code (2026-09-06, per Maro: "improve
        // frontend loading speed"). Without this, that whole stack was
        // baked into the entry chunk alongside the app's own code, so a
        // returning visitor's browser had to re-download React itself on
        // every single deploy — this chunk's content only changes when
        // these specific dependencies are upgraded, so browsers can cache
        // it across deploys that touch only app code (the common case).
        // Heavy, already-lazy-loaded deps (three.js, web-ifc, exceljs,
        // xlsx, recharts) are deliberately left alone — they already load
        // only when their owning module (FourD, Scheduling exports,
        // Dashboard) is visited, and folding them in here would make
        // returning visitors download them unconditionally instead.
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/@tanstack/react-query') ||
            id.includes('node_modules/@auth0/auth0-react') ||
            id.includes('node_modules/axios') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor'
          }
        },
      },
    },
  },
})

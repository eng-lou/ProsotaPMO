import { defineConfig } from '../frontend/node_modules/vite/dist/node/index.js'
import react from '../frontend/node_modules/@vitejs/plugin-react/dist/index.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import theme from '../frontend/tailwind.config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(here, '../frontend/package.json'))
const tailwind = require('tailwindcss')
const autoprefixer = require('autoprefixer')
export default defineConfig({
  root: path.join(here, '../frontend'),
  envDir: path.join(here, 'build-env'),
  plugins: [react(), {
    name: 'desktop-html',
    transformIndexHtml(html) {
      return html.replace(/<link\b[^>]*https:\/\/fonts\.[^>]*>/g, '')
        .replace('<title>Prosota</title>', '<title>Prosota Desktop Preview</title>')
    },
  }],
  css: { postcss: { plugins: [
    tailwind({ ...theme, content: [path.join(here, '../frontend/index.html'), path.join(here, '../frontend/src/**/*.{js,ts,jsx,tsx}')] }),
    autoprefixer(),
  ] } },
  define: {
    'import.meta.env.VITE_API_URL': '""',
    'import.meta.env.VITE_AUTH0_DOMAIN': '""',
    'import.meta.env.VITE_AUTH0_CLIENT_ID': '""',
    'import.meta.env.VITE_AUTH0_AUDIENCE': '""',
  },
  resolve: { alias: {
    '@': path.join(here, '../frontend/src'),
    '@auth0/auth0-react': path.join(here, 'ui/auth.tsx'),
    '@vercel/speed-insights/react': path.join(here, 'ui/noTelemetry.tsx'),
  } },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true },
})

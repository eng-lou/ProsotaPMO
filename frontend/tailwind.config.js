/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Class-driven, not 'media' (2026-07-25, per Maro's own light/dark theme
  // toggle) — the toggle is the source of truth (ThemeContext.tsx adds/
  // removes 'dark' on <html>), not the OS's prefers-color-scheme; light is
  // the deliberate default regardless of OS setting.
  darkMode: 'class',
  theme: {
    extend: {
      // Prosota brand palette (2026-07-25) — lifted straight from the real
      // marketing site's own :root CSS variables
      // (C:\Users\Maro\Documents\ProsotaPMO\source\prosota-site.html), so
      // the app shell (Sidebar/Layout/login) matches the actual brand
      // instead of generic Tailwind gray/blue. Named `prosota-*` rather
      // than overriding Tailwind's own gray/blue tokens, since only the
      // shell adopts these in this pass — the other 100+ existing
      // components keep using plain gray/blue untouched.
      colors: {
        prosota: {
          ink: '#060E18',
          panel: '#0C1A2E',
          panel2: '#101F36',
          line: '#1C3049',
          azure: '#2E7DF7',
          cyan: '#3DD6EE',
          amber: '#F2A73B',
          paper: '#E6EDF7',
          muted: '#8CA2BE',
        },
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}

import { createContext, useContext, useEffect, useState } from 'react'

// Light/dark theme toggle (2026-07-25, per Maro: "Light Mode and Dark Mode
// Exist" — a real toggle, not just a one-off dark reskin). Light is the
// deliberate unconditional default on first visit — confirmed with Maro —
// so this never reads prefers-color-scheme; only an explicit toggle (or a
// previously-persisted choice) ever switches it. Same plain
// load-once/save-on-change localStorage convention as viewerSettings.ts/
// renderCaptureSettings.ts elsewhere in this app, just a single value
// rather than a settings object.
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'prosota_theme'

function loadTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme)

  // Tailwind's darkMode:'class' strategy (tailwind.config.js) keys every
  // dark: variant in the app off this one class on <html> — this is the
  // only place that ever touches it.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage unavailable (private browsing, quota) — the toggle still
      // works for the rest of this session, it just won't persist.
    }
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

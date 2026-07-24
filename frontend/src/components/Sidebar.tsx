import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { resetAllDismissedWarnings, useDismissedWarningsCount } from '@/lib/confirmWithDontAsk'
import { loadHiddenNavPanels, saveHiddenNavPanels } from '@/lib/hiddenNavPanels'
import { useProject } from '@/lib/ProjectContext'
import { useTheme } from '@/lib/ThemeContext'
import { ProsotaLogo } from './ProsotaLogo'

// Exported (2026-07-25) — Layout.tsx's own document-title effect reuses
// this same route->label mapping rather than duplicating it, so the
// browser tab title and this nav list can never drift out of sync.
export const NAV = [
  { to: '/dashboard', label: 'Controls Dashboard' },
  { to: '/scheduling', label: 'Scheduling' },
  { to: '/4d', label: '4D' },
  { to: '/risks', label: 'Risk Register' },
  { to: '/costs', label: 'Cost Plan' },
  { to: '/icd', label: 'ICD Tracker' },
  { to: '/files', label: 'File Manager' },
  { to: '/periods', label: 'Period Manager' },
  { to: '/exports', label: 'Export Centre' },
]

export function Sidebar() {
  const { user, logout } = useAuth0()
  const { selectedProject, clearProject } = useProject()
  const navigate = useNavigate()
  const dismissedCount = useDismissedWarningsCount()
  // Which panels are hidden from the list below (2026-07-10, per Maro) —
  // hiding one only removes it from this list; its route still works if
  // visited directly, nothing is actually disabled.
  const [hiddenPanels, setHiddenPanels] = useState<Set<string>>(loadHiddenNavPanels)
  const [hidePanelsOpen, setHidePanelsOpen] = useState(false)
  const toggleHiddenPanel = (to: string) => {
    setHiddenPanels(prev => {
      const next = new Set(prev)
      if (next.has(to)) next.delete(to)
      else next.add(to)
      saveHiddenNavPanels(next)
      return next
    })
  }

  const handleSwitchProject = () => {
    clearProject()
    navigate('/projects')
  }

  const { theme, toggleTheme } = useTheme()

  return (
    <aside className="no-print flex flex-col w-60 min-h-screen bg-white text-gray-900 dark:bg-prosota-ink dark:text-prosota-paper shrink-0 border-r border-gray-200 dark:border-prosota-line">
      <div className="flex items-center gap-2.5 px-6 py-5 border-b border-gray-200 dark:border-prosota-line">
        <ProsotaLogo size={24} />
        <span className="font-display text-lg font-bold tracking-tight">Prosota</span>
      </div>

      {selectedProject && (
        <div className="px-4 py-3 border-b border-gray-200 dark:border-prosota-line">
          <p className="text-xs text-gray-500 dark:text-prosota-muted mb-0.5">Project</p>
          <p className="text-sm font-medium text-gray-900 dark:text-prosota-paper truncate">{selectedProject.name}</p>
          {selectedProject.client_name && (
            <p className="text-xs text-gray-500 dark:text-prosota-muted truncate">{selectedProject.client_name}</p>
          )}
          <button
            onClick={handleSwitchProject}
            className="text-xs text-blue-600 dark:text-prosota-cyan hover:text-blue-500 mt-1"
          >
            Switch project
          </button>
        </div>
      )}

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.filter(({ to }) => !hiddenPanels.has(to)).map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white dark:bg-prosota-azure'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-prosota-muted dark:hover:bg-prosota-panel dark:hover:text-prosota-paper'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-gray-200 dark:border-prosota-line">
        <button
          onClick={toggleTheme}
          title="Switch between light and dark mode"
          className="w-full text-left text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper transition-colors mb-2"
        >
          {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
        </button>
        {dismissedCount > 0 && (
          <button
            onClick={() => {
              if (window.confirm(
                `Show all ${dismissedCount} dismissed warning${dismissedCount === 1 ? '' : 's'} again? ` +
                `Any "don't show this again" warning you've dismissed will start reappearing.`
              )) resetAllDismissedWarnings()
            }}
            title="Warnings you've dismissed with 'don't show this again' are hidden until reset here"
            className="w-full text-left text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper transition-colors mb-2"
          >
            ⚙ Reset {dismissedCount} dismissed warning{dismissedCount === 1 ? '' : 's'}
          </button>
        )}
        <button
          onClick={() => setHidePanelsOpen(o => !o)}
          title="Choose which panels show up in the list above — hiding one doesn't disable it, its page still works if you go there directly"
          className="w-full text-left text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper transition-colors mb-2"
        >
          ⚙ {hidePanelsOpen ? 'Hide panels ▴' : 'Hide panels…'}
        </button>
        {hidePanelsOpen && (
          <div className="mb-2 space-y-1 max-h-48 overflow-y-auto">
            {NAV.map(({ to, label }) => (
              <label key={to} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted px-1">
                <input type="checkbox" checked={hiddenPanels.has(to)} onChange={() => toggleHiddenPanel(to)} />
                {label}
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500 dark:text-prosota-muted truncate mb-2">{user?.email}</p>
        <button
          onClick={() => {
            // Auth0's logout redirect is a same-tab page navigation, not a
            // tab close, so sessionStorage (and the project selection in it)
            // survives it — meaning signing back in used to always resume
            // whatever project was last selected, with no way to land on the
            // selector fresh (2026-07-05, per Maro: "when I sign in it goes
            // straight into the project"). Clearing it here, on a deliberate
            // sign-out, is the actual point where "start over" should mean it.
            clearProject()
            logout({ logoutParams: { returnTo: window.location.origin } })
          }}
          className="w-full text-left text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}

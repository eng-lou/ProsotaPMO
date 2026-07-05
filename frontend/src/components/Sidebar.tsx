import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { resetAllDismissedWarnings, useDismissedWarningsCount } from '@/lib/confirmWithDontAsk'
import { useProject } from '@/lib/ProjectContext'

const NAV = [
  { to: '/dashboard', label: 'Controls Dashboard' },
  { to: '/scheduling', label: 'Scheduling' },
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

  const handleSwitchProject = () => {
    clearProject()
    navigate('/projects')
  }

  return (
    <aside className="no-print flex flex-col w-60 min-h-screen bg-gray-900 text-white shrink-0">
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-lg font-bold tracking-tight">ProsotaPMO</span>
      </div>

      {selectedProject && (
        <div className="px-4 py-3 border-b border-gray-700">
          <p className="text-xs text-gray-400 mb-0.5">Project</p>
          <p className="text-sm font-medium text-white truncate">{selectedProject.name}</p>
          {selectedProject.client_name && (
            <p className="text-xs text-gray-400 truncate">{selectedProject.client_name}</p>
          )}
          <button
            onClick={handleSwitchProject}
            className="text-xs text-blue-400 hover:text-blue-300 mt-1"
          >
            Switch project
          </button>
        </div>
      )}

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-gray-700">
        {dismissedCount > 0 && (
          <button
            onClick={() => {
              if (window.confirm(
                `Show all ${dismissedCount} dismissed warning${dismissedCount === 1 ? '' : 's'} again? ` +
                `Any "don't show this again" warning you've dismissed will start reappearing.`
              )) resetAllDismissedWarnings()
            }}
            title="Warnings you've dismissed with 'don't show this again' are hidden until reset here"
            className="w-full text-left text-xs text-gray-400 hover:text-white transition-colors mb-2"
          >
            ⚙ Reset {dismissedCount} dismissed warning{dismissedCount === 1 ? '' : 's'}
          </button>
        )}
        <p className="text-xs text-gray-400 truncate mb-2">{user?.email}</p>
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
          className="w-full text-left text-xs text-gray-400 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}

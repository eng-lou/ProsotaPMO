import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useProject } from '@/lib/ProjectContext'
import { NAV, Sidebar } from './Sidebar'

// Dynamic browser tab title (2026-07-25, quality-of-life pass alongside the
// branding/theme work — confirmed via grep that document.title was never
// set anywhere in this app before, so every page/project showed the same
// bare "Prosota" tab regardless of where you actually were, unhelpful with
// several tabs open). Reuses Sidebar.tsx's own NAV list for the route->
// label mapping so this can never drift out of sync with the nav itself.
function useDocumentTitle() {
  const location = useLocation()
  const { selectedProject } = useProject()
  useEffect(() => {
    const page = NAV.find(({ to }) => location.pathname.startsWith(to))?.label
    document.title = [page, selectedProject?.name, 'Prosota'].filter(Boolean).join(' — ')
  }, [location.pathname, selectedProject])
}

export function Layout({ children }: { children: React.ReactNode }) {
  useDocumentTitle()
  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-prosota-ink">
      <Sidebar />
      {/* Full page-content dark-mode pass (2026-08-03) — every routed page
          now carries its own dark: variants (see that session's plan), so
          this can finally follow the outer wrapper's own dark:bg-prosota-ink
          instead of the light-only bg-gray-50 the original shell-only pass
          (2026-07-25) deliberately pinned here to avoid dark-on-dark text. */}
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-prosota-ink">{children}</main>
    </div>
  )
}

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
      {/* Always light, no dark: variant (2026-07-25 fix) — page content
          (Dashboard.tsx and everything else routed here) isn't part of this
          pass's dark-mode scope (see this session's own plan on the scope
          boundary) and has no dark-aware text colors of its own yet; without
          an explicit background here, this <main> stayed transparent and
          inherited the wrapper div's own dark:bg-prosota-ink, rendering
          every page's already-dark text unreadably dark-on-dark instead of
          the intended "dark chrome around still-light content." */}
      <main className="flex-1 overflow-auto bg-gray-50">{children}</main>
    </div>
  )
}

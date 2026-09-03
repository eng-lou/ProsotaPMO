import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AiMessage } from '@/lib/aiAssistant'
import { AiFourDBridgeProvider } from '@/lib/aiFourDBridge'
import { useProject } from '@/lib/ProjectContext'
import { NAV, Sidebar } from './Sidebar'

// Lazy (2026-09-03 perf pass, per Maro: "switching between modules...
// takes a longer time") — PoePanel pulls in aiAttachments.ts's own `xlsx`
// (SheetJS, genuinely heavy) for spreadsheet attachments, plus its own
// chat/tool-call UI. Layout wraps every routed page, so a static import
// here put all of that in the one shared chunk every visitor downloads on
// first load, whether or not they ever open Poe — same root cause, and same
// fix, as App.tsx's own per-route lazy imports (named export, hence the
// same .then() adapter React.lazy needs).
const PoePanel = lazy(() => import('./PoePanel').then(m => ({ default: m.PoePanel })))

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
  const { selectedProject } = useProject()
  // Poe launcher moved here from Sidebar's own bottom utility stack
  // (2026-08-31, per Maro's screenshot: "right now its just under feedback
  // so can be easily missed" — squeezed between Hide panels/Feedback/sign-
  // out as a plain gray text link, the same low-emphasis treatment as
  // "Reset dismissed warnings," for what's meant to be a flagship feature).
  // A fixed floating button, mounted once at the Layout level rather than
  // inside Sidebar, is the standard "always reachable, never buried in a
  // settings list" pattern for a chat assistant (Intercom/Drift, etc.) —
  // also means it now floats over every page's own content, not just
  // whatever's visible in the sidebar's own scroll area.
  const [poeOpen, setPoeOpen] = useState(false)
  // Conversation history lifted up here, not owned by PoePanel itself
  // (2026-08-31, per Maro: "when i hit close and reopen poe, the history
  // is completely gone") — PoePanel only mounts while poeOpen is true, so
  // any state it held locally was destroyed by the unmount on Close, not
  // just on an actual page refresh (the only loss the plan's own v1
  // deviation note ever intended). Living here instead means it now
  // survives Close/reopen and even route navigation (Layout stays mounted
  // across every page), and is only ever lost on a genuine refresh.
  const [poeMessages, setPoeMessages] = useState<AiMessage[]>([])
  return (
    // AiFourDBridgeProvider wraps both <main> (where FourD.tsx registers its
    // own tool handlers when mounted, see aiFourDBridge.tsx's own header on
    // why this can't be a normal top-down Context) and PoePanel (which
    // reads them) as siblings under the one shared provider instance.
    <AiFourDBridgeProvider>
      <div className="flex min-h-screen bg-gray-50 dark:bg-prosota-ink">
        <Sidebar />
        {/* Full page-content dark-mode pass (2026-08-03) — every routed page
            now carries its own dark: variants (see that session's plan), so
            this can finally follow the outer wrapper's own dark:bg-prosota-ink
            instead of the light-only bg-gray-50 the original shell-only pass
            (2026-07-25) deliberately pinned here to avoid dark-on-dark text. */}
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-prosota-ink">{children}</main>
        {selectedProject && !poeOpen && (
          <button
            onClick={() => setPoeOpen(true)}
            aria-label="Open Poe — Planning Operations Expert"
            title="Poe — Planning Operations Expert. Ask about this project's schedule, risk, resources, cost, or ICD status — or ask it to review site photos, PDFs, and spreadsheets you attach"
            className="no-print fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-prosota-amber text-prosota-ink pl-4 pr-5 py-3 shadow-lg shadow-black/20 font-display font-semibold text-sm hover:brightness-105 active:brightness-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-prosota-amber dark:focus-visible:ring-offset-prosota-ink"
          >
            <span aria-hidden="true" className="text-lg leading-none">🪶</span>
            Poe
          </button>
        )}
        {poeOpen && selectedProject && (
          <Suspense fallback={null}>
            <PoePanel
              projectId={selectedProject.id}
              onClose={() => setPoeOpen(false)}
              messages={poeMessages}
              onMessagesChange={setPoeMessages}
            />
          </Suspense>
        )}
      </div>
    </AiFourDBridgeProvider>
  )
}

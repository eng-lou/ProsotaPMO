import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { Layout } from './components/Layout'
import { ProsotaLogo } from './components/ProsotaLogo'
import { AuthTokenProvider } from './lib/AuthTokenProvider'
import { ConfirmHost } from './lib/confirmWithDontAsk'
import { ProjectProvider, useProject } from './lib/ProjectContext'
import { ThemeProvider } from './lib/ThemeContext'
import { ProjectSelector } from './modules/projects/ProjectSelector'

// Lazy (2026-07-20, FourD; extended 2026-07-21 to every other routed
// module) — FourD pulls in Three.js, react-three-fiber/drei,
// recharts, and ~50 sibling files; statically importing it
// put all of that (confirmed via a real `npm run build`: ~3.8MB raw / ~1MB
// gzipped) in the main bundle for every user, even one who only ever opens
// /dashboard. That fix was scoped to FourD alone at the time, but
// Scheduling/Dashboard/RiskRegister/CostPlan/IcdTracker were left eagerly
// imported here too — confirmed via a real build that they were the actual
// bulk of a 3.1MB main chunk vite's own build output was warning about
// (per Maro: "carry on with optimisations"), same root cause as FourD's
// original one, just never extended past it. `<Routes>` only ever renders
// one of these at a time by construction, so a user on any one route was
// always paying to download every *other* route's code too. Every one of
// these five is a named export, not a default one, hence the same .then()
// adapter React.lazy needs that FourD's own comment already explains.
const FourD = lazy(() => import('./modules/fourD/FourD').then(m => ({ default: m.FourD })))
const Scheduling = lazy(() => import('./modules/scheduling/Scheduling').then(m => ({ default: m.Scheduling })))
const Dashboard = lazy(() => import('./modules/dashboard/Dashboard').then(m => ({ default: m.Dashboard })))
const RiskRegister = lazy(() => import('./modules/risks/RiskRegister').then(m => ({ default: m.RiskRegister })))
const CostPlan = lazy(() => import('./modules/costs/CostPlan').then(m => ({ default: m.CostPlan })))
const IcdTracker = lazy(() => import('./modules/icd/IcdTracker').then(m => ({ default: m.IcdTracker })))

const Placeholder = ({ title, subtitle = 'Coming soon.' }: { title: string; subtitle?: string }) => (
  <div className="p-8">
    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
    <p className="text-gray-500 mt-2">{subtitle}</p>
  </div>
)

function LoginPage() {
  const { loginWithRedirect } = useAuth0()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-prosota-ink">
      <div className="text-center">
        <ProsotaLogo size={40} className="mx-auto mb-3" />
        <h1 className="font-display text-3xl font-bold text-gray-900 dark:text-prosota-paper mb-1">Prosota</h1>
        <p className="text-gray-500 dark:text-prosota-muted mb-8">Planning Platform</p>
        <button
          onClick={() => loginWithRedirect()}
          className="bg-blue-600 dark:bg-prosota-azure text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Sign in
        </button>
      </div>
    </div>
  )
}

// Keeps FourD mounted for the whole authenticated session instead of
// letting react-router unmount/remount it per navigation (2026-07-11, per
// Maro: "if i leave the 4d panel, my imported 3d/ifc data leaves as well")
// — imported 3D/IFC files aren't stored anywhere (not the backend, not the
// browser, see FourD.tsx's own header), so they only ever exist in this
// component's live state; a route-driven unmount threw all of it away the
// moment you navigated elsewhere. Hidden via CSS (`hidden`, display:none)
// rather than not rendered, and `active` also drops Viewport3D's Canvas to
// frameloop="never" while hidden (Viewport3D.tsx) so it isn't burning
// GPU/CPU in the background on every other tab — resumes instantly, no
// re-init, the moment you navigate back.
function PersistentFourD() {
  const location = useLocation()
  const active = location.pathname === '/4d'
  // hasEverBeenActive (2026-07-20) — the component (and its lazy chunk)
  // isn't even mounted until the very first visit to /4d, so a user who
  // never opens it never pays for FourD at all, not even the Suspense
  // fallback flash. Once mounted, it never unmounts (per this component's
  // own header above) — same "flips true once, stays true" pattern
  // FourD.tsx's own hasEverBeenActive uses internally for its data fetches.
  const [hasEverBeenActive, setHasEverBeenActive] = useState(active)
  useEffect(() => {
    if (active) setHasEverBeenActive(true)
  }, [active])

  if (!hasEverBeenActive) return null

  return (
    <div className={active ? 'h-full' : 'hidden'}>
      <Suspense fallback={<div className="p-8 text-gray-400 dark:text-prosota-muted text-sm">Loading 4D…</div>}>
        <FourD active={active} />
      </Suspense>
    </div>
  )
}

function AuthenticatedApp() {
  const { selectedProject } = useProject()

  // A SINGLE <BrowserRouter> for the whole app, not one recreated per branch
  // below — two separate router instances that get mounted/unmounted as
  // `selectedProject` flips used to exist here, and "Switch project" called
  // navigate() on the *old* router right as it was being torn down and
  // replaced by a brand-new one, which is exactly the kind of thing that
  // makes navigation land somewhere unexpected (2026-07-05, per Maro:
  // "I can't return to that selector page... it goes straight into the
  // project"). One router, mounted once, with the content underneath it
  // switching instead of the router itself.
  return (
    <BrowserRouter>
      {!selectedProject ? (
        <Routes>
          <Route path="*" element={<ProjectSelector />} />
        </Routes>
      ) : (
        <Layout>
          <PersistentFourD />
          {/* One shared boundary, not one per lazy route (2026-07-21) —
              <Routes> only ever mounts one matched route at a time, so at
              most one of these five lazy chunks is ever loading at once;
              a single fallback here is exactly as correct as wrapping each
              <Route> individually and doesn't repeat the same fallback
              markup five times. */}
          <Suspense fallback={<div className="p-8 text-gray-400 dark:text-prosota-muted text-sm">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/projects" element={<ProjectSelector />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/scheduling" element={<Scheduling />} />
              <Route path="/risks" element={<RiskRegister />} />
              <Route path="/costs" element={<CostPlan />} />
              <Route path="/icd" element={<IcdTracker />} />
              <Route path="/files" element={<Placeholder title="File Manager" />} />
              <Route path="/periods" element={<Placeholder title="Period Manager" />} />
              <Route path="/exports" element={<Placeholder title="Export Centre" />} />
            </Routes>
          </Suspense>
        </Layout>
      )}
    </BrowserRouter>
  )
}

function AuthGate() {
  const { isLoading, isAuthenticated } = useAuth0()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:bg-prosota-ink">
        <span className="text-gray-400 dark:text-prosota-muted text-sm">Loading…</span>
      </div>
    )
  }

  if (!isAuthenticated) return <LoginPage />

  return (
    <AuthTokenProvider>
      <ProjectProvider>
        <AuthenticatedApp />
        <ConfirmHost />
      </ProjectProvider>
    </AuthTokenProvider>
  )
}

// ThemeProvider wraps everything, including the pre-auth screens
// (2026-07-25, per Maro's own light/dark toggle) — the login screen and
// auth-loading spinner are real, always-visible chrome too, same reasoning
// as the Sidebar, so the persisted theme choice should already apply to
// them rather than only kicking in once someone's signed in.
export default function App() {
  return (
    <ThemeProvider>
      <AuthGate />
    </ThemeProvider>
  )
}

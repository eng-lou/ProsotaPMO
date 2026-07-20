import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { Layout } from './components/Layout'
import { AuthTokenProvider } from './lib/AuthTokenProvider'
import { ConfirmHost } from './lib/confirmWithDontAsk'
import { ProjectProvider, useProject } from './lib/ProjectContext'
import { ProjectSelector } from './modules/projects/ProjectSelector'
import { Scheduling } from './modules/scheduling/Scheduling'
import { Dashboard } from './modules/dashboard/Dashboard'
import { RiskRegister } from './modules/risks/RiskRegister'
import { CostPlan } from './modules/costs/CostPlan'
import { IcdTracker } from './modules/icd/IcdTracker'
import { FourD } from './modules/fourD/FourD'

const Placeholder = ({ title, subtitle = 'Coming soon.' }: { title: string; subtitle?: string }) => (
  <div className="p-8">
    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
    <p className="text-gray-500 mt-2">{subtitle}</p>
  </div>
)

function LoginPage() {
  const { loginWithRedirect } = useAuth0()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Prosota</h1>
        <p className="text-gray-500 mb-8">Planning Platform</p>
        <button
          onClick={() => loginWithRedirect()}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
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
  return (
    <div className={active ? 'h-full' : 'hidden'}>
      <FourD active={active} />
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
        </Layout>
      )}
    </BrowserRouter>
  )
}

export default function App() {
  const { isLoading, isAuthenticated } = useAuth0()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-400 text-sm">Loading…</span>
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

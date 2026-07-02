import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { Layout } from './components/Layout'
import { AuthTokenProvider } from './lib/AuthTokenProvider'
import { ProjectProvider, useProject } from './lib/ProjectContext'
import { ProjectSelector } from './modules/projects/ProjectSelector'
import { Scheduling } from './modules/scheduling/Scheduling'
import { RiskRegister } from './modules/risks/RiskRegister'
import { CostPlan } from './modules/costs/CostPlan'
import { IcdTracker } from './modules/icd/IcdTracker'

const Placeholder = ({ title }: { title: string }) => (
  <div className="p-8">
    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
    <p className="text-gray-500 mt-2">Coming soon.</p>
  </div>
)

function LoginPage() {
  const { loginWithRedirect } = useAuth0()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">ProsotaPMO</h1>
        <p className="text-gray-500 mb-8">Project Controls Platform</p>
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

function AuthenticatedApp() {
  const { selectedProject } = useProject()

  // No project selected — show the selector without the shell layout
  if (!selectedProject) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<ProjectSelector />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/projects" element={<ProjectSelector />} />
          <Route path="/dashboard" element={<Placeholder title="Controls Dashboard" />} />
          <Route path="/scheduling" element={<Scheduling />} />
          <Route path="/risks" element={<RiskRegister />} />
          <Route path="/costs" element={<CostPlan />} />
          <Route path="/icd" element={<IcdTracker />} />
          <Route path="/files" element={<Placeholder title="File Manager" />} />
          <Route path="/periods" element={<Placeholder title="Period Manager" />} />
          <Route path="/exports" element={<Placeholder title="Export Centre" />} />
        </Routes>
      </Layout>
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
      </ProjectProvider>
    </AuthTokenProvider>
  )
}

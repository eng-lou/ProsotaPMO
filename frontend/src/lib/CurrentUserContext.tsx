import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'

export interface CurrentUser {
  id: string
  org_id: string
  email: string
  display_name: string
  role: string
  status: string
  is_super_user: boolean
  requested_title: string | null
  requested_organisation: string | null
  requested_at: string | null
}

interface CurrentUserContextValue {
  currentUser: CurrentUser | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null)

// Fetched once here (2026-08-25, trial/beta access gate) rather than inline
// per-component — App.tsx needs this before it can decide whether to show
// AccessPendingScreen or the real app, and Sidebar needs `is_super_user` to
// decide whether to show the Access Requests admin panel trigger. Same
// createContext/useX pattern as ProjectContext.tsx.
export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = async () => {
    setLoading(true)
    try {
      const res = await api.get<CurrentUser>('/api/v1/users/me')
      setCurrentUser(res.data)
      setError(null)
    } catch {
      setError('Could not load your account. Try refreshing the page.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refetch() }, [])

  return (
    <CurrentUserContext.Provider value={{ currentUser, loading, error, refetch }}>
      {children}
    </CurrentUserContext.Provider>
  )
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext)
  if (!ctx) throw new Error('useCurrentUser must be used within CurrentUserProvider')
  return ctx
}

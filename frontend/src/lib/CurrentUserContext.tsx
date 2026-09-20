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

  // Bounded retry (2 extra attempts, short backoff) before surfacing `error`
  // — AccessGate.tsx (App.tsx) treats an unresolved `error` differently from
  // a real "not approved" status, but only once this actually gives up. The
  // underlying flakiness this exists for (a cold Auth0 token acquisition on
  // a brand-new browser profile — e.g. the CEF panel embedded in the
  // Unreal desktop shell, which has no cached localStorage token the way a
  // normal warm browser session does, per AuthTokenProvider.tsx's own
  // getTokenWithRetry) is often transient and resolves itself within a
  // second or two, so it's worth a couple of quick retries here rather than
  // failing on the very first hiccup.
  const RETRY_DELAYS_MS = [1000, 2000]

  const refetch = async () => {
    setLoading(true)
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await api.get<CurrentUser>('/api/v1/users/me')
        setCurrentUser(res.data)
        setError(null)
        break
      } catch {
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
          continue
        }
        setError('Could not load your account. Try refreshing the page.')
        break
      }
    }
    setLoading(false)
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

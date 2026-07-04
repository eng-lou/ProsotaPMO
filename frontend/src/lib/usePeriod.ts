import { useEffect, useState } from 'react'
import { api } from './api'
import type { Period } from './types'

// Every module (Risks, Cost Plan, ...) is period-scoped, but Period Manager
// doesn't exist yet. This is a stopgap: use the project's live period, or
// auto-create "Period 1" if none exists yet — not the real Period Manager.
export function useActivePeriod(projectId: string | undefined) {
  const [period, setPeriod] = useState<Period | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const bootstrap = async () => {
    if (!projectId) return
    try {
      setLoading(true)
      // The find-or-create used to happen here, client-side (fetch periods,
      // create one if the list was empty) — two of these racing for the same
      // brand-new project could both see an empty list and both create a
      // "Period 1", silently splitting the project's data across two "live"
      // periods (see backend migration a3f9c02e5b71). One atomic backend call
      // now does the whole thing, with a DB-level constraint as the real
      // guard against the race.
      const { data } = await api.post<Period>('/api/v1/periods/bootstrap', null, {
        params: { project_id: projectId },
      })
      setPeriod(data)
    } catch {
      setError('Failed to load period')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Reschedule (and anything else that writes period.start_date server-side)
  // needs a way to pull the fresh value back in — this hook previously only
  // ever fetched once on mount, so the Reschedule panel's "Data Date" reverted
  // to showing the original value the next time it was reopened, even though
  // the backend (and everything derived from it, like PV) had genuinely moved.
  return { period, loading, error, refetch: bootstrap }
}

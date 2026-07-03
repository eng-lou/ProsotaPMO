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
      const { data: periods } = await api.get<Period[]>('/api/v1/periods/', {
        params: { project_id: projectId },
      })
      let active = periods.find(p => p.freeze_status === 'live') ?? periods[0] ?? null

      if (!active) {
        const { data: created } = await api.post<Period>('/api/v1/periods/', {
          project_id: projectId,
          period_label: 'Period 1',
          freeze_status: 'live',
        })
        active = created
      }
      setPeriod(active)
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

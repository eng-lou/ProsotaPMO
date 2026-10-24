import { useCallback, useEffect, useRef, useState } from 'react'
import type { BaselineSet } from '@/modules/dashboard/types'
import { api } from './api'

export type BaselineModule = 'risk' | 'cost' | 'icd' | 'schedule'

// Controls Dashboard Phase 1b — same create/list shape as
// useScheduleSubprojects, plus the two capture actions (one-click
// "capture everything now", and manually linking an already-existing
// standalone module baseline into a set).
export function useBaselineSets(projectId: string | undefined) {
  const [baselineSets, setBaselineSets] = useState<BaselineSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    if (!projectId) return
    const version = ++requestVersion.current
    setLoading(true)
    setError(false)
    try {
      const { data } = await api.get<BaselineSet[]>('/api/v1/baseline-sets/', { params: { project_id: projectId } })
      if (version === requestVersion.current) setBaselineSets(data)
    } catch {
      if (version === requestVersion.current) setError(true)
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
    return () => { requestVersion.current++ }
  }, [load])

  const captureAll = async (name: string, baselineDate: string, periodId: string, schedulePeriodId: string) => {
    const { data } = await api.post<BaselineSet>('/api/v1/baseline-sets/capture-all', {
      project_id: projectId, name, baseline_date: baselineDate, period_id: periodId, schedule_period_id: schedulePeriodId,
    })
    await load()
    return data
  }

  // A bare, empty set — used by the "Link Existing" flow (BaselineComparison.tsx)
  // to bundle already-existing standalone module baselines together, as
  // opposed to captureAll's "snapshot everything right now" path.
  const createSet = async (name: string, baselineDate: string) => {
    const { data } = await api.post<BaselineSet>('/api/v1/baseline-sets/', {
      project_id: projectId, name, baseline_date: baselineDate,
    })
    await load()
    return data
  }

  const linkBaseline = async (module: BaselineModule, baselineId: string, baselineSetId: string | null) => {
    await api.post('/api/v1/baseline-sets/link', { module, baseline_id: baselineId, baseline_set_id: baselineSetId })
  }

  return { baselineSets, loading, error, captureAll, createSet, linkBaseline, refetch: load }
}

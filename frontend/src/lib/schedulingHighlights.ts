import { useEffect, useState } from 'react'
import type { FilterCondition, SchedulingHighlight } from '@/modules/scheduling/types'
import { api } from './api'

// Named, saved, per-project custom row highlights (2026-07-06, per Maro,
// "works exactly like the filter") — same create/list/update/delete shape as
// useSchedulingFilters, minus the Show/Hide per-row mode: a highlight never
// removes an activity from the list, it only tints matching rows (with the
// single shared GanttStyle.highlight_color), so there's nothing to invert.
// Condition evaluation itself is unchanged from evaluateFilter/
// evaluateCondition (schedulingFilters.ts) — a SchedulingHighlight has the
// exact same {conditions, match_mode} shape a SchedulingFilter does.
export function useSchedulingHighlights(projectId: string | undefined) {
  const [highlights, setHighlights] = useState<SchedulingHighlight[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<SchedulingHighlight[]>('/api/v1/scheduling-highlights/', { params: { project_id: projectId } })
      setHighlights(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => {
    await api.post('/api/v1/scheduling-highlights/', { project_id: projectId, name, match_mode: matchMode, conditions })
    await load()
  }

  const update = async (highlightId: string, name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => {
    await api.patch(`/api/v1/scheduling-highlights/${highlightId}`, { name, match_mode: matchMode, conditions })
    await load()
  }

  const remove = async (highlightId: string) => {
    await api.delete(`/api/v1/scheduling-highlights/${highlightId}`)
    await load()
  }

  return { highlights, loading, create, update, remove, refetch: load }
}

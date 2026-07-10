import { useEffect, useState } from 'react'
import type { ScheduleSubproject } from '@/modules/scheduling/types'
import { api } from './api'

// Named, saved, per-project sub-project tags (2026-07-06, per Maro —
// docs/SUBPROJECT_FLOAT_PLAN.md, private docs repo) — same create/list/
// update/delete shape as useSchedulingFilters, minus match_mode/conditions.
export function useScheduleSubprojects(projectId: string | undefined) {
  const [subprojects, setSubprojects] = useState<ScheduleSubproject[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<ScheduleSubproject[]>('/api/v1/schedule-subprojects/', { params: { project_id: projectId } })
      setSubprojects(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, rootWbsId: string) => {
    await api.post('/api/v1/schedule-subprojects/', { project_id: projectId, name, root_wbs_id: rootWbsId })
    await load()
  }

  const update = async (subprojectId: string, name: string, rootWbsId: string) => {
    await api.patch(`/api/v1/schedule-subprojects/${subprojectId}`, { name, root_wbs_id: rootWbsId })
    await load()
  }

  const remove = async (subprojectId: string) => {
    await api.delete(`/api/v1/schedule-subprojects/${subprojectId}`)
    await load()
  }

  return { subprojects, loading, create, update, remove, refetch: load }
}

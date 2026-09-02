import { useEffect, useState } from 'react'
import { api } from './api'
import type { DashboardFilterCondition } from './dashboardFilters'

// Mirrors backend app/schemas/dashboard_layout.py:DashboardLayoutConfig
// exactly — x/y/w/h are the same units react-grid-layout's own LayoutItem
// uses, no translation layer.
export interface DashboardWidgetConfig {
  id: string
  widget_type: string
  x: number
  y: number
  w: number
  h: number
  // Per-widget filter (2026-09-02, per Maro: "what if you allowed
  // flexibility to those widgets" -> "see how we use the filters/
  // highlights in the schedule. functionality is definitely there") —
  // same {field, operator, value} condition language as Scheduling's own
  // Filters/Highlights (see lib/dashboardFilters.ts's own header for the
  // full "why", and widgets.tsx's own WidgetProps.filterConditions header
  // for the current list of widgets that read it); everything else
  // ignores both fields. Optional/undefined for every pre-existing saved
  // layout.
  filter?: DashboardFilterCondition[]
  filter_match_mode?: 'all' | 'any'
}

export interface DashboardLayoutConfig {
  widgets: DashboardWidgetConfig[]
}

export interface DashboardLayout {
  id: string
  project_id: string
  name: string
  is_active: boolean
  config: DashboardLayoutConfig
  created_at: string
  updated_at: string
}

// The currently-applied layout's config (or the built-in defaults if none
// is applied) — consumed once on mount by DashboardGrid.tsx (2026-07-20,
// per Maro: "think powerbi" — dockable/resizable/repositionable dashboard
// widgets). Same active-config/create-then-apply shape as
// frontend/src/modules/fourD/dockLayouts.ts's own two hooks — see
// dashboard_layout.py's backend header for why they mirror each other.
export function useActiveDashboardConfig(projectId: string | undefined) {
  const [config, setConfig] = useState<DashboardLayoutConfig>({ widgets: [] })
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return config
    setLoading(true)
    try {
      const { data } = await api.get<DashboardLayoutConfig>('/api/v1/dashboard-layouts/active-config', { params: { project_id: projectId } })
      setConfig(data)
      return data
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return { config, loading, refetch: load }
}

// Manages the saved-layouts library — same create(don't apply)/apply/
// delete/update/reset shape as useDockLayouts.
export function useDashboardLayouts(projectId: string | undefined) {
  const [layouts, setLayouts] = useState<DashboardLayout[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<DashboardLayout[]>('/api/v1/dashboard-layouts/', { params: { project_id: projectId } })
      setLayouts(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, config: DashboardLayoutConfig) => {
    const { data } = await api.post<DashboardLayout>('/api/v1/dashboard-layouts/', { project_id: projectId, name, config })
    await load()
    return data
  }

  const update = async (layoutId: string, name: string, config: DashboardLayoutConfig) => {
    await api.patch(`/api/v1/dashboard-layouts/${layoutId}`, { name, config })
    await load()
  }

  const apply = async (layoutId: string): Promise<DashboardLayoutConfig> => {
    const { data } = await api.post<DashboardLayout>(`/api/v1/dashboard-layouts/${layoutId}/apply`)
    await load()
    return data.config
  }

  const remove = async (layoutId: string) => {
    await api.delete(`/api/v1/dashboard-layouts/${layoutId}`)
    await load()
  }

  const reset = async () => {
    await api.post('/api/v1/dashboard-layouts/reset', null, { params: { project_id: projectId } })
    await load()
  }

  return { layouts, loading, create, update, apply, remove, reset, refetch: load }
}

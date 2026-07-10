import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

// Mirrors backend app/schemas/dock_layout.py:DockLayoutConfig exactly.
export interface DockLayoutConfig {
  open_windows: string[]
  window_dock: Record<string, 'top' | 'bottom'>
  top_dock_height: number
  bottom_dock_height: number
  top_split_ratios: number[]
  bottom_split_ratios: number[]
  properties_open: boolean
  data_panel_open: boolean
}

export const DEFAULT_DOCK_CONFIG: DockLayoutConfig = {
  open_windows: [],
  window_dock: {},
  top_dock_height: 320,
  bottom_dock_height: 320,
  top_split_ratios: [],
  bottom_split_ratios: [],
  properties_open: true,
  data_panel_open: true,
}

export interface DockLayout {
  id: string
  project_id: string
  name: string
  is_active: boolean
  config: DockLayoutConfig
  created_at: string
  updated_at: string
}

// The currently-applied layout's config (or the built-in defaults if none is
// applied) — consumed once on mount by FourD.tsx to restore a project's
// saved dock arrangement (2026-07-11, per Maro: "allow me to save layout,
// edit, delete... create different dockable layouts sizes etc."). Same
// active-config/create-then-apply shape as frontend/src/lib/ganttLayout.ts's
// own useActiveGanttStyle/useGanttLayouts — see dock_layout.py's backend
// header for why they mirror each other.
export function useActiveDockConfig(projectId: string | undefined) {
  const [config, setConfig] = useState<DockLayoutConfig>(DEFAULT_DOCK_CONFIG)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<DockLayoutConfig>('/api/v1/dock-layouts/active-config', { params: { project_id: projectId } })
      setConfig(data)
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

// Manages the saved-layouts library for DockLayoutMenu — same
// create(don't apply)/apply/delete/update/reset shape as useGanttLayouts.
export function useDockLayouts(projectId: string | undefined) {
  const [layouts, setLayouts] = useState<DockLayout[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<DockLayout[]>('/api/v1/dock-layouts/', { params: { project_id: projectId } })
      setLayouts(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, config: DockLayoutConfig) => {
    await api.post('/api/v1/dock-layouts/', { project_id: projectId, name, config })
    await load()
  }

  const update = async (layoutId: string, name: string, config: DockLayoutConfig) => {
    await api.patch(`/api/v1/dock-layouts/${layoutId}`, { name, config })
    await load()
  }

  const apply = async (layoutId: string): Promise<DockLayoutConfig> => {
    const { data } = await api.post<DockLayout>(`/api/v1/dock-layouts/${layoutId}/apply`)
    await load()
    return data.config
  }

  const remove = async (layoutId: string) => {
    await api.delete(`/api/v1/dock-layouts/${layoutId}`)
    await load()
  }

  const reset = async () => {
    await api.post('/api/v1/dock-layouts/reset', null, { params: { project_id: projectId } })
    await load()
  }

  return { layouts, loading, create, update, apply, remove, reset, refetch: load }
}

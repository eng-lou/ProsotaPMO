import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

// Mirrors backend app/schemas/element_keyframe.py exactly — see
// element_keyframe.py's model docstring for the full rationale (per-field,
// keyed by (project_id, source_kind, element_ref) rather than an FK to any
// one ModelElementLink, so a custom motion path is a property of the
// element itself — this is what lets Mode B below work with zero Activity
// involved at all).
// path_progress (2026-07-11) — see path_follower.py's own docstring: reuses
// this exact date-keyed shape for "how far along its bound Path a target
// currently is," rather than a new value store of its own.
export type KeyframeField = 'pos_x' | 'pos_y' | 'pos_z' | 'rot_x' | 'rot_y' | 'rot_z' | 'scale_x' | 'scale_y' | 'scale_z' | 'path_progress'

export interface ElementKeyframe {
  id: string
  project_id: string
  source_kind: 'ifc' | 'mesh'
  element_ref: string
  field: KeyframeField
  date: string
  value: number
  created_at: string
  updated_at: string
}

export function useElementKeyframes(projectId: string | undefined) {
  const [keyframes, setKeyframes] = useState<ElementKeyframe[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<ElementKeyframe[]>('/api/v1/element-keyframes/', { params: { project_id: projectId } })
      setKeyframes(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Insert-or-overwrite at the exact same (element, field, date) — see
  // element_keyframes.py's own POST route docstring. Re-keying the same spot
  // (e.g. nudging a value at an already-keyed date) updates it in place
  // rather than erroring or duplicating.
  const upsert = async (sourceKind: 'ifc' | 'mesh', elementRef: string, field: KeyframeField, date: Date, value: number): Promise<ElementKeyframe> => {
    const { data } = await api.post<ElementKeyframe>('/api/v1/element-keyframes/', {
      project_id: projectId, source_kind: sourceKind, element_ref: elementRef, field, date: date.toISOString(), value,
    })
    await load()
    return data
  }

  const remove = async (keyframeId: string) => {
    await api.delete(`/api/v1/element-keyframes/${keyframeId}`)
    await load()
  }

  return { keyframes, loading, upsert, remove, refetch: load }
}

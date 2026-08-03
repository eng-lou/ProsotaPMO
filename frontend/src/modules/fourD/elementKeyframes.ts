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
// visible (2026-07-12) — see annotation.py's own docstring: 0/1, whether a
// Placemark/Footnote is showing at a given date.
// anim_start/anim_end (2026-07-30, per Maro: "this segment needs to work
// independent of [a scheduled Activity]... if i keyframe i should see the
// path actor in the timeline with both keyframes so i can drag, delete
// etc") — Path/Zone's own line-draw/border-draw reveal window (see
// paths.ts/zones.ts's own `animate` field header). Only ever written for
// source_kind 'path'/'zone'; the keyframe's own `date` *is* the reveal
// window's start/end instant, `value` is unused (always 0), same "a
// marker keyframe with no meaningful value" convention as `visible`.
// target_x/y/z, focal_length, clip_start, clip_end (2026-08-03, per Maro:
// "add separate cameras... keyframe the positions of this camera") — a
// named Camera's (cameras.ts) own transform/lens fields. Always
// source_kind="camera" with element_ref=camera.id (NOT the pre-existing
// ""-sentinel "camera follows a path" usage of source_kind="camera" —
// see backend schemas/element_keyframe.py's own comment on the two).
export type KeyframeField = 'pos_x' | 'pos_y' | 'pos_z' | 'rot_x' | 'rot_y' | 'rot_z' | 'scale_x' | 'scale_y' | 'scale_z' | 'path_progress' | 'visible' | 'anim_start' | 'anim_end' | 'target_x' | 'target_y' | 'target_z' | 'focal_length' | 'clip_start' | 'clip_end'

export interface ElementKeyframe {
  id: string
  project_id: string
  source_kind: 'ifc' | 'mesh' | 'camera' | 'annotation' | 'path' | 'zone'
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
  const upsert = async (sourceKind: 'ifc' | 'mesh' | 'camera' | 'annotation' | 'path' | 'zone', elementRef: string, field: KeyframeField, date: Date, value: number): Promise<ElementKeyframe> => {
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

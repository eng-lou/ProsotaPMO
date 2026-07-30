import { api } from '@/lib/api'

// Frontend for path.py's backend — Blender's own Curve object, scoped down
// to what this app needs (2026-07-11, per Maro: "in blender you can add a
// curve, edit it and set a path from point a to be... i can then place an
// object to follow that path"). Points are stored/edited as one whole array
// (see path.py's own docstring for why), same JSONB-blob convention as
// MaterialPreset's config — the frontend's own PathGizmo rewrites this array
// wholesale on every point add/move/remove, never a per-point PATCH.
export interface PathPoint {
  x: number
  y: number
  z: number
}

// 'solid' | 'dashed' — a plain string, not a union alias, mirrors every
// other loose "kind"-style field already on this type (nothing enforces it
// beyond the value PathsPanel.tsx's own <select> writes).
export type PathLineStyle = 'solid' | 'dashed'

export interface Path {
  id: string
  project_id: string
  name: string
  points: PathPoint[]
  closed: boolean
  visible: boolean
  // Route display styling (2026-07-29, per Maro's site-logistics reference
  // — e.g. a dashed, colored, arrowed, labeled haul route). Purely a
  // display concern — PathFollower's own interpolation along `points`
  // never reads any of these. See PathGizmo.tsx for how each renders.
  color: string
  line_style: PathLineStyle
  show_arrow: boolean
  show_label: boolean
  line_width: number
  dash_size: number
  gap_size: number
  // Line-draw animation (2026-07-29, per Maro: "animate the line itself so
  // it looks like its coming from the first point to the last with the
  // arrow as well if enabled"). animation_loop repeats the reveal every
  // (end - start) once `now` passes the end instant, instead of holding
  // fully-drawn. The reveal window's own start/end instants are NOT
  // fields here (2026-07-30 rework, per Maro: "this segment needs to work
  // independent of [a scheduled Activity]... if i keyframe i should see
  // the path actor in the timeline with both keyframes so i can drag,
  // delete etc") — they're ElementKeyframe rows instead (elementKeyframes.ts,
  // source_kind='path', element_ref=this path's own id, field='anim_start'/
  // 'anim_end'), resolved per-path in FourD.tsx and passed into
  // PathGizmo.tsx as plain `Date | null` props rather than read off this
  // type directly.
  animate: boolean
  animation_loop: boolean
  created_at: string
  updated_at: string
}

export async function listPaths(projectId: string): Promise<Path[]> {
  const res = await api.get<Path[]>('/api/v1/paths/', { params: { project_id: projectId } })
  return res.data
}

export async function createPath(data: {
  project_id: string
  name?: string
  points?: PathPoint[]
  closed?: boolean
  visible?: boolean
  color?: string
  line_style?: PathLineStyle
  show_arrow?: boolean
  show_label?: boolean
  line_width?: number
  dash_size?: number
  gap_size?: number
  animate?: boolean
  animation_loop?: boolean
}): Promise<Path> {
  const res = await api.post<Path>('/api/v1/paths/', data)
  return res.data
}

export async function updatePath(id: string, data: Partial<{
  name: string
  points: PathPoint[]
  closed: boolean
  visible: boolean
  color: string
  line_style: PathLineStyle
  show_arrow: boolean
  show_label: boolean
  line_width: number
  dash_size: number
  gap_size: number
  animate: boolean
  animation_loop: boolean
}>): Promise<Path> {
  const res = await api.patch<Path>(`/api/v1/paths/${id}`, data)
  return res.data
}

export async function deletePath(id: string): Promise<void> {
  await api.delete(`/api/v1/paths/${id}`)
}

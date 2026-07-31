import { api } from '@/lib/api'

// Frontend for zone.py's backend — a filled, labeled ground-plane area
// (2026-07-29, per Maro's own site-logistics reference screenshots: a
// "PROJECT SITE" style boundary). See zone.py's own docstring for why this
// is a separate resource from Path rather than a mode bolted onto it — a
// Zone's points are a flat footprint (up-axis coordinate always 0, ignored
// by zoneGeometry.ts), with `elevation` as the one separately-editable
// "how high off the ground" scalar.
export interface ZonePoint {
  x: number
  y: number
  z: number
}

// Same loose-string convention as PathLineStyle (paths.ts) — nothing
// enforces it beyond the value ZonesPanel.tsx's own <select> writes.
export type ZoneBorderStyle = 'solid' | 'dashed'

// 2026-07-30, per Maro: "the radial zone for things like crane clearance
// etc" — a second footprint kind alongside the original "polygon": circle
// zones store exactly one point (the center) in `points` and use `radius`
// instead of tracing corners. See zone.py's own matching docstring for why
// this is a fixed-at-creation `shape` field rather than inferred from
// points.length, and ZonesPanel.tsx's "+ Zone"/"+ Circle" buttons for the
// only place it's actually chosen.
export type ZoneShape = 'polygon' | 'circle'

// 'draw' | 'flash' — same loose-string convention. See ZoneGizmo.tsx for
// what each actually does; ZonesPanel.tsx's own <select> writes the value.
export type ZoneAnimationMode = 'draw' | 'flash'

export interface Zone {
  id: string
  project_id: string
  name: string
  shape: ZoneShape
  points: ZonePoint[]
  // Only meaningful for shape="circle" — see this file's own ZoneShape
  // header for the full "why".
  radius: number
  elevation: number
  fill_color: string
  fill_opacity: number
  border_color: string
  border_width: number
  border_style: ZoneBorderStyle
  border_dash_size: number
  border_gap_size: number
  visible: boolean
  // Reveal animation (2026-07-29, per Maro: "the animation will go like
  // path to set the border then the fill, can also set a flashing zone
  // animation"). animation_mode picks 'draw' (border traces in, then fill
  // fades in) vs 'flash' (fill opacity pulses for as long as `animate` is
  // on). The reveal window's own start/end instants are NOT fields here
  // (2026-07-30 rework — see Path's own matching header in paths.ts for
  // the full "why") — they're ElementKeyframe rows instead
  // (source_kind='zone', field='anim_start'/'anim_end'), resolved
  // per-zone in FourD.tsx and passed into ZoneGizmo.tsx as plain
  // `Date | null` props.
  animate: boolean
  animation_loop: boolean
  animation_mode: ZoneAnimationMode
  created_at: string
  updated_at: string
}

export async function listZones(projectId: string): Promise<Zone[]> {
  const res = await api.get<Zone[]>('/api/v1/zones/', { params: { project_id: projectId } })
  return res.data
}

export async function createZone(data: {
  project_id: string
  name?: string
  shape?: ZoneShape
  points?: ZonePoint[]
  radius?: number
  elevation?: number
  fill_color?: string
  fill_opacity?: number
  border_color?: string
  border_width?: number
  border_style?: ZoneBorderStyle
  border_dash_size?: number
  border_gap_size?: number
  visible?: boolean
  animate?: boolean
  animation_loop?: boolean
  animation_mode?: ZoneAnimationMode
}): Promise<Zone> {
  const res = await api.post<Zone>('/api/v1/zones/', data)
  return res.data
}

export async function updateZone(id: string, data: Partial<{
  name: string
  shape: ZoneShape
  points: ZonePoint[]
  radius: number
  elevation: number
  fill_color: string
  fill_opacity: number
  border_color: string
  border_width: number
  border_style: ZoneBorderStyle
  border_dash_size: number
  border_gap_size: number
  visible: boolean
  animate: boolean
  animation_loop: boolean
  animation_mode: ZoneAnimationMode
}>): Promise<Zone> {
  const res = await api.patch<Zone>(`/api/v1/zones/${id}`, data)
  return res.data
}

export async function deleteZone(id: string): Promise<void> {
  await api.delete(`/api/v1/zones/${id}`)
}

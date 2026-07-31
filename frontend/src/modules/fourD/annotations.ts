import { api } from '@/lib/api'

// Frontend for annotation.py's backend — a Placemark/Comment in the 4D
// viewport (2026-07-12, per Maro's Navisworks reference — first the
// toolbar screenshot, then the fuller "3D Notations" property-panel one
// that showed both as the same kind of spatial marker). See
// annotation.py's own docstring for the full shape rationale (why kind is
// explicit rather than derived, why source_kind/element_ref is a loose ref
// not an FK, why Comment folded in here instead of staying its own
// CameraView-attached table, and why Footnote — a third kind here until
// 2026-08-06 — was scrapped for being functionally identical to Comment).
export type AnnotationKind = 'placemark' | 'comment'
export type AnnotationIcon = 'pin' | 'flag' | 'comment' | 'warning'
export type AnnotationBoxShape = 'rounded' | 'rectangle'

export interface Annotation {
  id: string
  project_id: string
  kind: AnnotationKind
  position_x: number
  position_y: number
  position_z: number
  source_kind: 'ifc' | 'mesh' | null
  element_ref: string | null
  text: string
  icon: AnnotationIcon
  visible: boolean
  // Style — mirrors the reference's own Design/Colors property grid
  // exactly (see annotation.py's own docstring for the field-by-field
  // mapping). Drives AnnotationMarker.tsx's rendering, not just cosmetic
  // metadata.
  has_background: boolean
  background_color: string
  // 2026-07-30, per Maro: "opacity controls for the background fill" —
  // 0..1 multiplier on background_color, only while has_background is on
  // (same boolean-then-dial split Zone's own fill_opacity already uses).
  background_opacity: number
  border_color: string
  thick_border: boolean
  text_color: string
  font_size: number
  // Behaviour — camera-distance culling (reference's own "Hide if closer/
  // farther than"), applied every frame in AnnotationMarker.tsx alongside
  // Mode A/B-resolved visibility. null = that bound is off.
  hide_closer_than: number | null
  hide_farther_than: number | null
  // Comment callout box shape (2026-07-30, per Maro: "allow me to pick a
  // standard rectangle shape") — meaningless for kind="placemark".
  box_shape: AnnotationBoxShape
  // Bent leader (2026-08-06, per Maro: "how the leader works... needs some
  // work") — see annotation.py's own matching docstring for the full
  // shape: from the effective target (leaderTargetObject's live position
  // if bound, else this row's own position_x/y/z) up by leader_offset_y to
  // an elbow, then across by leader_offset_x/z to the callout. x/z are
  // dragged in the viewport (AnnotationMarker.tsx); y is a plain numeric
  // field, same convention as Zone's own `elevation`.
  leader_offset_x: number
  leader_offset_y: number
  leader_offset_z: number
  // 2026-07-30, per Maro: "hide the leader completely to show just the
  // text box if i want" — independent of animate above, only ever hides
  // the connecting line; the box/dot are untouched.
  leader_visible: boolean
  // Whole-annotation reveal animation (2026-08-06; scope corrected
  // 2026-07-30, per Maro: "the animate leader feature is not just about
  // the leader its the whole thing" — renamed from animate_leader/
  // leader_animation_loop to match) — independent of Mode A/B position
  // animation and of any Activity; resolved via ElementKeyframe's existing
  // anim_start/anim_end (source_kind="annotation"), same pattern as
  // Path/Zone's own animate/animation_loop.
  animate: boolean
  animation_loop: boolean
  // 2026-07-30, per Maro pointing at a Blender GeometryNodes callout
  // modifier's own controls and asking for "everything" — see
  // annotation.py's own matching docstring for the full mapping and why
  // rotation/scale apply only to the callout box's flat Html overlay, not
  // the 3D leader line/dot. Meaningless for kind="placemark".
  leader_dot_radius: number
  leader_color: string
  leader_rotation: number
  leader_scale: number
  // Same request extended to Placemark (2026-07-30, per Maro: "and the
  // pin and flag and warning") — scale (multiplier) / rotate (degrees,
  // additive to the balloon's own fixed -45° tilt) around the balloon's
  // own tip. Meaningless for kind="comment".
  placemark_scale: number
  placemark_rotation: number
  created_at: string
  updated_at: string
}

export interface AnnotationCreate {
  project_id: string
  kind: AnnotationKind
  position_x: number
  position_y: number
  position_z: number
  source_kind?: 'ifc' | 'mesh' | null
  element_ref?: string | null
  text?: string
  icon?: AnnotationIcon
  visible?: boolean
  has_background?: boolean
  background_color?: string
  background_opacity?: number
  border_color?: string
  thick_border?: boolean
  text_color?: string
  font_size?: number
  hide_closer_than?: number | null
  hide_farther_than?: number | null
  box_shape?: AnnotationBoxShape
  leader_offset_x?: number
  leader_offset_y?: number
  leader_offset_z?: number
  leader_visible?: boolean
  animate?: boolean
  animation_loop?: boolean
  leader_dot_radius?: number
  leader_color?: string
  leader_rotation?: number
  leader_scale?: number
  placemark_scale?: number
  placemark_rotation?: number
}

export type AnnotationUpdate = Partial<Omit<AnnotationCreate, 'project_id' | 'kind'>>

export async function listAnnotations(projectId: string): Promise<Annotation[]> {
  const res = await api.get<Annotation[]>('/api/v1/annotations/', { params: { project_id: projectId } })
  return res.data
}

export async function createAnnotation(data: AnnotationCreate): Promise<Annotation> {
  const res = await api.post<Annotation>('/api/v1/annotations/', data)
  return res.data
}

export async function updateAnnotation(id: string, data: AnnotationUpdate): Promise<Annotation> {
  const res = await api.patch<Annotation>(`/api/v1/annotations/${id}`, data)
  return res.data
}

export async function deleteAnnotation(id: string): Promise<void> {
  await api.delete(`/api/v1/annotations/${id}`)
}

import { api } from '@/lib/api'

// Frontend for annotation.py's backend — a Placemark/Footnote/Comment in
// the 4D viewport (2026-07-12, per Maro's Navisworks reference — first the
// toolbar screenshot, then the fuller "3D Notations" property-panel one
// that showed all three as the same kind of spatial marker). See
// annotation.py's own docstring for the full shape rationale (why kind is
// explicit rather than derived, why source_kind/element_ref is a loose ref
// not an FK, why Comment folded in here instead of staying its own
// CameraView-attached table).
export type AnnotationKind = 'placemark' | 'footnote' | 'comment'
export type AnnotationIcon = 'pin' | 'flag' | 'comment' | 'warning'
export type AnnotationStatus = 'open' | 'resolved'

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
  border_color: string
  thick_border: boolean
  text_color: string
  font_size: number
  // Behaviour — camera-distance culling (reference's own "Hide if closer/
  // farther than"), applied every frame in AnnotationMarker.tsx alongside
  // Mode A/B-resolved visibility. null = that bound is off.
  hide_closer_than: number | null
  hide_farther_than: number | null
  // Only meaningful for kind="comment" (2026-07-12, per Maro: "so what's
  // the difference [between Comment and Footnote]") — a Footnote is a
  // permanent technical callout with nothing to resolve; a Comment is a
  // review note you close out once it's addressed.
  status: AnnotationStatus
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
  border_color?: string
  thick_border?: boolean
  text_color?: string
  font_size?: number
  hide_closer_than?: number | null
  hide_farther_than?: number | null
  status?: AnnotationStatus
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

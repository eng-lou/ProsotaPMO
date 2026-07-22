import { api } from '@/lib/api'

// Frontend for element_transform.py's backend (2026-07-11) — persists a
// manual position/rotation/scale edit made via the gizmo or the Properties
// panel, for a whole imported model/mesh or one specific IFC sub-element.
// See element_transform.py's own docstring for why this uses SectionBox's
// model3d_file_id-FK + optional element_ref pattern rather than
// ModelElementLink's loose identity, and why it's an upsert (save) rather
// than separate create/update calls.
export interface ElementTransform {
  id: string
  project_id: string
  model3d_file_id: string
  element_ref: string | null
  position_x: number
  position_y: number
  position_z: number
  rotation_x: number
  rotation_y: number
  rotation_z: number
  scale_x: number
  scale_y: number
  scale_z: number
  // "Set Pivot" (2026-07-12) — see elementPivot.ts's own header. null (all
  // three, always together) means "use the source file's own original
  // origin."
  pivot_x: number | null
  pivot_y: number | null
  pivot_z: number | null
  // "Pivot Rotation" (2026-07-22) — pivot_x/y/z's rotational counterpart,
  // same null-means-no-override convention. See elementPivot.ts's own
  // header for what it's for.
  pivot_rotation_x: number | null
  pivot_rotation_y: number | null
  pivot_rotation_z: number | null
  created_at: string
  updated_at: string
}

export interface TransformValues {
  position_x: number
  position_y: number
  position_z: number
  rotation_x: number
  rotation_y: number
  rotation_z: number
  scale_x: number
  scale_y: number
  scale_z: number
  pivot_x: number | null
  pivot_y: number | null
  pivot_z: number | null
  pivot_rotation_x: number | null
  pivot_rotation_y: number | null
  pivot_rotation_z: number | null
}

export async function listElementTransforms(projectId: string): Promise<ElementTransform[]> {
  const res = await api.get<ElementTransform[]>('/api/v1/element-transforms/', { params: { project_id: projectId } })
  return res.data
}

export async function saveElementTransform(data: {
  model3d_file_id: string
  element_ref?: string | null
} & TransformValues): Promise<ElementTransform> {
  const res = await api.post<ElementTransform>('/api/v1/element-transforms/', data)
  return res.data
}

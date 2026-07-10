import { api } from '@/lib/api'

// Frontend for section_box.py's backend — replicates Blender's "Section
// Box" plugin (2026-07-09, per Maro, walked through via screenshots): a
// draggable clipping box scoped to a whole imported model, one individual
// IFC element (by GlobalId), or a whole plain mesh import. See
// section_box.py's own docstring for why model3d_file_id is a real FK
// (unlike ModelElementLink/ElementKeyframe's deliberately loose string
// identity) and why bounds are stored in the target's own local space.
export interface SectionBox {
  id: string
  project_id: string
  model3d_file_id: string
  element_ref: string | null
  name: string
  min_x: number
  min_y: number
  min_z: number
  max_x: number
  max_y: number
  max_z: number
  active: boolean
  visible: boolean
  created_at: string
  updated_at: string
}

export interface SectionBoxBounds {
  min_x: number
  min_y: number
  min_z: number
  max_x: number
  max_y: number
  max_z: number
}

export async function listSectionBoxes(projectId: string): Promise<SectionBox[]> {
  const res = await api.get<SectionBox[]>('/api/v1/section-boxes/', { params: { project_id: projectId } })
  return res.data
}

export async function createSectionBox(data: {
  model3d_file_id: string
  element_ref?: string | null
  name?: string
} & SectionBoxBounds): Promise<SectionBox> {
  const res = await api.post<SectionBox>('/api/v1/section-boxes/', data)
  return res.data
}

export async function updateSectionBox(id: string, data: Partial<SectionBoxBounds> & {
  name?: string
  active?: boolean
  visible?: boolean
}): Promise<SectionBox> {
  const res = await api.patch<SectionBox>(`/api/v1/section-boxes/${id}`, data)
  return res.data
}

export async function deleteSectionBox(id: string): Promise<void> {
  await api.delete(`/api/v1/section-boxes/${id}`)
}

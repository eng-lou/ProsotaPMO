import { api } from '@/lib/api'

// The API stores the cut elevations. The viewer builds selectable meshes from the original IFC on load.
export interface ElementSplit {
  id: string
  project_id: string
  source_kind: 'ifc'
  element_ref: string
  // Metres, already converted from the file's own declared unit — sorted
  // ascending, one row per split *element* (not per cut).
  cut_elevations_m: number[]
  created_at: string
  updated_at: string
}

export async function listElementSplits(projectId: string): Promise<ElementSplit[]> {
  const res = await api.get<ElementSplit[]>('/api/v1/element-splits/', { params: { project_id: projectId } })
  return res.data
}

export async function createElementSplit(data: {
  project_id: string
  source_kind: 'ifc'
  element_ref: string
  cut_elevations_m: number[]
}): Promise<ElementSplit> {
  const res = await api.post<ElementSplit>('/api/v1/element-splits/', data)
  return res.data
}

export async function updateElementSplit(id: string, cutElevationsM: number[]): Promise<ElementSplit> {
  const res = await api.patch<ElementSplit>(`/api/v1/element-splits/${id}`, { cut_elevations_m: cutElevationsM })
  return res.data
}

export async function deleteElementSplit(id: string): Promise<void> {
  await api.delete(`/api/v1/element-splits/${id}`)
}

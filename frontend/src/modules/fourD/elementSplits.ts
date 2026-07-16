import { api } from '@/lib/api'

// Frontend for element_split.py's backend (2026-07-15, per Maro: "vertical
// elements are modeled this way which seems like it spans across several
// levels at once, which is unreasonable in the construction process unless
// its a prefab installation... I want to be able to split an element by
// levels"). Only ever records WHICH elevations to cut an element at — the
// actual per-level slices are generated client-side every time the model
// loads (elementSplitTargets.ts), as clipped clones of the one real mesh.
// No geometry is ever produced or stored here; see element_split.py's own
// docstring for the full reasoning.
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

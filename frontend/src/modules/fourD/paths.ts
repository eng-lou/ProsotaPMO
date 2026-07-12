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

export interface Path {
  id: string
  project_id: string
  name: string
  points: PathPoint[]
  closed: boolean
  visible: boolean
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
}): Promise<Path> {
  const res = await api.post<Path>('/api/v1/paths/', data)
  return res.data
}

export async function updatePath(id: string, data: Partial<{
  name: string
  points: PathPoint[]
  closed: boolean
  visible: boolean
}>): Promise<Path> {
  const res = await api.patch<Path>(`/api/v1/paths/${id}`, data)
  return res.data
}

export async function deletePath(id: string): Promise<void> {
  await api.delete(`/api/v1/paths/${id}`)
}

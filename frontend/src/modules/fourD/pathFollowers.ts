import { api } from '@/lib/api'

// Frontend for path_follower.py's backend — Blender's own "Follow Path"
// constraint, binding one target (a mesh or ifc element; camera deliberately
// left for a later pass, see this session's own scoping decision) to a Path
// (paths.ts). See path_follower.py's own docstring for why this is a
// separate row from ElementKeyframe rather than a field on it: "which path"
// is a rare-to-change structural binding, "how far along it, when" reuses
// ElementKeyframe's own date-keyed machinery unchanged via field=
// "path_progress" (elementKeyframes.ts).
export type PathFollowerTargetKind = 'camera' | 'mesh' | 'ifc'

export interface PathFollower {
  id: string
  project_id: string
  path_id: string
  target_kind: PathFollowerTargetKind
  element_ref: string
  orient_to_path: boolean
  // Yaw correction, in degrees, applied on top of the lookAt orientation
  // (2026-08-06) — see path_follower.py's own docstring for why: not every
  // imported model was authored with three.js's -Z-is-forward convention,
  // so this compensates per-binding rather than assuming one true answer.
  heading_offset_deg: number
  created_at: string
  updated_at: string
}

export async function listPathFollowers(projectId: string): Promise<PathFollower[]> {
  const res = await api.get<PathFollower[]>('/api/v1/path-followers/', { params: { project_id: projectId } })
  return res.data
}

// PUT (upsert), not POST — re-points an existing binding for the same
// (target_kind, element_ref) rather than erroring/duplicating, matching
// path_followers.py's own route docstring on why this is idempotent-replace.
export async function upsertPathFollower(data: {
  project_id: string
  path_id: string
  target_kind: PathFollowerTargetKind
  element_ref?: string
  orient_to_path?: boolean
  heading_offset_deg?: number
}): Promise<PathFollower> {
  const res = await api.put<PathFollower>('/api/v1/path-followers/', data)
  return res.data
}

export async function updatePathFollower(id: string, data: Partial<{
  path_id: string
  orient_to_path: boolean
  heading_offset_deg: number
}>): Promise<PathFollower> {
  const res = await api.patch<PathFollower>(`/api/v1/path-followers/${id}`, data)
  return res.data
}

export async function deletePathFollower(id: string): Promise<void> {
  await api.delete(`/api/v1/path-followers/${id}`)
}

import { api } from '@/lib/api'

// Frontend for element_parent.py's backend — crane-style rigging
// (2026-07-12, per Maro): mesh-kind only in v1 (see that model's own
// docstring on why), one parent per child, upsert-repoints rather than
// duplicates (mirrors pathFollowers.ts's own upsertPathFollower).
export interface ElementParent {
  id: string
  project_id: string
  child_element_ref: string
  parent_element_ref: string
  created_at: string
  updated_at: string
}

export async function listElementParents(projectId: string): Promise<ElementParent[]> {
  const res = await api.get<ElementParent[]>('/api/v1/element-parents/', { params: { project_id: projectId } })
  return res.data
}

// PUT (upsert), not POST — re-parenting a child re-points its existing row
// rather than erroring/duplicating, matching element_parents.py's own
// route docstring.
export async function upsertElementParent(data: {
  project_id: string
  child_element_ref: string
  parent_element_ref: string
}): Promise<ElementParent> {
  const res = await api.put<ElementParent>('/api/v1/element-parents/', data)
  return res.data
}

export async function deleteElementParent(id: string): Promise<void> {
  await api.delete(`/api/v1/element-parents/${id}`)
}

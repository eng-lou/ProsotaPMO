import { api } from '@/lib/api'

// Frontend for collection.py/collection_member.py's backend — Blender-style
// user-defined element grouping (2026-07-11, per Maro): freely group IFC
// sub-elements and whole mesh-kind objects together, independent of the
// IFC import's own spatial hierarchy, then select/hide/isolate by the
// group. See collection_member.py's own docstring for why membership uses
// the same loose (source_kind, element_ref) identity ModelElementLink does
// (not a real FK — a collection spans elements from multiple files, so
// there's no single file to hang a hard FK off, unlike SectionBox).
export interface CollectionMember {
  id: string
  collection_id: string
  source_kind: 'ifc' | 'mesh'
  element_ref: string
  element_label: string
  created_at: string
}

export interface Collection {
  id: string
  project_id: string
  parent_collection_id: string | null
  name: string
  sort_order: number | null
  created_at: string
  updated_at: string
  members: CollectionMember[]
}

export async function listCollections(projectId: string): Promise<Collection[]> {
  const res = await api.get<Collection[]>('/api/v1/collections/', { params: { project_id: projectId } })
  return res.data
}

export async function createCollection(data: {
  project_id: string
  name?: string
  parent_collection_id?: string | null
}): Promise<Collection> {
  const res = await api.post<Collection>('/api/v1/collections/', data)
  return res.data
}

export async function updateCollection(id: string, data: {
  name?: string
  parent_collection_id?: string | null
}): Promise<Collection> {
  const res = await api.patch<Collection>(`/api/v1/collections/${id}`, data)
  return res.data
}

export async function deleteCollection(id: string): Promise<void> {
  await api.delete(`/api/v1/collections/${id}`)
}

export async function addCollectionMember(data: {
  collection_id: string
  source_kind: 'ifc' | 'mesh'
  element_ref: string
  element_label: string
}): Promise<CollectionMember> {
  const res = await api.post<CollectionMember>('/api/v1/collection-members/', data)
  return res.data
}

export async function removeCollectionMember(id: string): Promise<void> {
  await api.delete(`/api/v1/collection-members/${id}`)
}

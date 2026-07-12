import { api } from '@/lib/api'

// Frontend for clash_test.py/clash_result.py's backend — Navisworks-style
// Clash Detective (2026-07-12, per Maro). group_a_collection_id/
// group_b_collection_id reuse Collections (collections.ts) as the two
// "selection sets" a test compares — see clash_test.py's own docstring on
// why. Geometry is only ever computed client-side (sceneClash.ts); this
// file only persists test definitions and their last-run results.
export interface ClashResult {
  id: string
  clash_test_id: string
  element_a_source_kind: 'ifc' | 'mesh'
  element_a_ref: string
  element_a_label: string
  element_b_source_kind: 'ifc' | 'mesh'
  element_b_ref: string
  element_b_label: string
  distance_mm: number | null
  status: 'new' | 'reviewed' | 'approved'
  comment: string | null
  created_at: string
  updated_at: string
}

export interface ClashTest {
  id: string
  project_id: string
  name: string
  group_a_collection_id: string
  group_b_collection_id: string
  test_type: 'hard' | 'clearance'
  tolerance_mm: number
  last_run_at: string | null
  created_at: string
  updated_at: string
  results: ClashResult[]
}

export interface ClashResultPair {
  element_a_source_kind: 'ifc' | 'mesh'
  element_a_ref: string
  element_a_label: string
  element_b_source_kind: 'ifc' | 'mesh'
  element_b_ref: string
  element_b_label: string
  distance_mm: number | null
}

export async function listClashTests(projectId: string): Promise<ClashTest[]> {
  const res = await api.get<ClashTest[]>('/api/v1/clash-tests/', { params: { project_id: projectId } })
  return res.data
}

export async function createClashTest(data: {
  project_id: string
  name?: string
  group_a_collection_id: string
  group_b_collection_id: string
  test_type?: 'hard' | 'clearance'
  tolerance_mm?: number
}): Promise<ClashTest> {
  const res = await api.post<ClashTest>('/api/v1/clash-tests/', data)
  return res.data
}

export async function updateClashTest(id: string, data: {
  name?: string
  group_a_collection_id?: string
  group_b_collection_id?: string
  test_type?: 'hard' | 'clearance'
  tolerance_mm?: number
}): Promise<ClashTest> {
  const res = await api.patch<ClashTest>(`/api/v1/clash-tests/${id}`, data)
  return res.data
}

export async function deleteClashTest(id: string): Promise<void> {
  await api.delete(`/api/v1/clash-tests/${id}`)
}

export async function replaceClashResults(clashTestId: string, pairs: ClashResultPair[]): Promise<ClashTest> {
  const res = await api.put<ClashTest>(`/api/v1/clash-tests/${clashTestId}/results`, pairs)
  return res.data
}

export async function updateClashResult(id: string, data: {
  status?: 'new' | 'reviewed' | 'approved'
  comment?: string | null
}): Promise<ClashResult> {
  const res = await api.patch<ClashResult>(`/api/v1/clash-results/${id}`, data)
  return res.data
}

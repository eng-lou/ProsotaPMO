import { api } from '@/lib/api'

// Frontend for progress_variance_test.py/progress_variance_result.py's
// backend — detects when the 4D schedule says an element is complete but a
// real site scan shows otherwise (2026-08-20, per Maro's own correction to
// the original ask, see the approved plan). Mirrors clashTests.ts's own
// shape closely: group_a_collection_id reuses Collections the same way
// Clash Detective's Group A does; site_capture_id (siteCaptures.ts) stands
// in for Clash Detective's Group B — the "other side" of this test is a
// point cloud, not a second set of BIM elements. Geometry/density querying
// only ever happens client-side (progressVarianceEngine.ts); this file only
// persists test definitions and their last-run results.
export interface ProgressVarianceResult {
  id: string
  progress_variance_test_id: string
  element_source_kind: 'ifc' | 'mesh'
  element_ref: string
  element_label: string
  point_count: number
  coverage_percent: number
  confirmed_in_scan: boolean
  status: 'new' | 'reviewed' | 'approved'
  comment: string | null
  created_at: string
  updated_at: string
}

export interface ProgressVarianceTest {
  id: string
  project_id: string
  name: string
  group_a_collection_id: string
  site_capture_id: string
  min_coverage_percent: number
  last_run_at: string | null
  created_at: string
  updated_at: string
  results: ProgressVarianceResult[]
}

export interface ProgressVarianceResultElement {
  element_source_kind: 'ifc' | 'mesh'
  element_ref: string
  element_label: string
  point_count: number
  coverage_percent: number
  confirmed_in_scan: boolean
}

// Rolls a test's own per-element coverage up to whichever Activity(s)
// each element is linked to via the existing ModelElementLink table
// (2026-08-21, per Maro: reuse the schedule's own existing element
// links, don't build a parallel system) — see the backend's own
// ActivityProgressSuggestion docstring for the full reasoning. Read-only:
// "Apply" is a plain PATCH against the existing activities endpoint's
// own pct_complete field, not a write path through this test at all.
export interface ActivityProgressSuggestion {
  activity_id: string
  activity_code: string
  activity_name: string
  current_pct_complete: string | null
  scan_suggested_pct_complete: number
  linked_element_count: number
  matched_element_count: number
}

export async function getActivityProgressSuggestions(testId: string): Promise<ActivityProgressSuggestion[]> {
  const res = await api.get<ActivityProgressSuggestion[]>(`/api/v1/progress-variance-tests/${testId}/activity-progress-suggestions`)
  return res.data
}

export async function listProgressVarianceTests(projectId: string): Promise<ProgressVarianceTest[]> {
  const res = await api.get<ProgressVarianceTest[]>('/api/v1/progress-variance-tests/', { params: { project_id: projectId } })
  return res.data
}

export async function createProgressVarianceTest(data: {
  project_id: string
  name?: string
  group_a_collection_id: string
  site_capture_id: string
  min_coverage_percent?: number
}): Promise<ProgressVarianceTest> {
  const res = await api.post<ProgressVarianceTest>('/api/v1/progress-variance-tests/', data)
  return res.data
}

export async function updateProgressVarianceTest(id: string, data: {
  name?: string
  group_a_collection_id?: string
  site_capture_id?: string
  min_coverage_percent?: number
}): Promise<ProgressVarianceTest> {
  const res = await api.patch<ProgressVarianceTest>(`/api/v1/progress-variance-tests/${id}`, data)
  return res.data
}

export async function deleteProgressVarianceTest(id: string): Promise<void> {
  await api.delete(`/api/v1/progress-variance-tests/${id}`)
}

export async function replaceProgressVarianceResults(
  testId: string, elements: ProgressVarianceResultElement[],
): Promise<ProgressVarianceTest> {
  const res = await api.put<ProgressVarianceTest>(`/api/v1/progress-variance-tests/${testId}/results`, elements)
  return res.data
}

export async function updateProgressVarianceResult(id: string, data: {
  status?: 'new' | 'reviewed' | 'approved'
  comment?: string | null
}): Promise<ProgressVarianceResult> {
  const res = await api.patch<ProgressVarianceResult>(`/api/v1/progress-variance-results/${id}`, data)
  return res.data
}

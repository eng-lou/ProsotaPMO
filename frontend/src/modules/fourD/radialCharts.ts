import { api } from '@/lib/api'
import type { ScopeFilter } from './scheduleScope'

// Frontend for radial_chart.py's backend — a screen-space progress-ring
// HUD widget (2026-07-31, per Maro's own Synchro-style reference
// screenshot). See that model's own docstring for why this is a distinct
// resource from Zone/Annotation/Path: it's pinned to a location on the 2D
// viewport itself (position_x_pct/position_y_pct, percent-of-viewport, not
// a 3D world position), and its progress is never stored — it's computed
// live client-side from whichever Activities match udf_field_definition_id/
// udf_value as of the scrubbed Animation Timeline date (radialChartProgress.ts).
export type RadialChartCenterMode = 'percentage' | 'icon'

// RadialChart's own scope filter fields are exactly ScopeFilter's shape
// (see scheduleScope.ts) — extended here rather than duplicated, so the two
// can never silently drift apart. scope_mode "all" (the default) = every
// Activity in the project, same as before this field existed.
export interface RadialChart extends ScopeFilter {
  id: string
  project_id: string
  title: string
  visible: boolean
  position_x_pct: number
  position_y_pct: number
  radius_px: number
  thickness_px: number
  border_color: string
  track_color: string
  progress_color: string
  fill_color: string
  text_color: string
  font_size: number
  center_mode: RadialChartCenterMode
  icon_storage_filename: string | null
  created_at: string
  updated_at: string
}

export async function listRadialCharts(projectId: string): Promise<RadialChart[]> {
  const res = await api.get<RadialChart[]>('/api/v1/radial-charts/', { params: { project_id: projectId } })
  return res.data
}

export async function createRadialChart(data: {
  project_id: string
  title?: string
  visible?: boolean
  position_x_pct?: number
  position_y_pct?: number
  radius_px?: number
  thickness_px?: number
  border_color?: string
  track_color?: string
  progress_color?: string
  fill_color?: string
  text_color?: string
  font_size?: number
  center_mode?: RadialChartCenterMode
  scope_mode?: RadialChart['scope_mode']
  udf_field_definition_id?: string | null
  udf_value?: string | null
  wbs_node_activity_id?: string | null
}): Promise<RadialChart> {
  const res = await api.post<RadialChart>('/api/v1/radial-charts/', data)
  return res.data
}

export async function updateRadialChart(id: string, data: Partial<{
  title: string
  visible: boolean
  position_x_pct: number
  position_y_pct: number
  radius_px: number
  thickness_px: number
  border_color: string
  track_color: string
  progress_color: string
  fill_color: string
  text_color: string
  font_size: number
  center_mode: RadialChartCenterMode
  scope_mode: RadialChart['scope_mode']
  udf_field_definition_id: string | null
  udf_value: string | null
  wbs_node_activity_id: string | null
}>): Promise<RadialChart> {
  const res = await api.patch<RadialChart>(`/api/v1/radial-charts/${id}`, data)
  return res.data
}

export async function deleteRadialChart(id: string): Promise<void> {
  await api.delete(`/api/v1/radial-charts/${id}`)
}

// Multipart upload (2026-07-31, same "real file on disk, not base64 in a
// JSON column" reasoning as materialPresets.ts's own uploads) — sets
// center_mode to "icon" server-side as part of the same request, so a
// caller never has to sequence "upload, then separately PATCH center_mode."
export async function uploadRadialChartIcon(id: string, file: File): Promise<RadialChart> {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<RadialChart>(`/api/v1/radial-charts/${id}/icon`, form)
  return res.data
}

// Authenticated blob fetch (no static file mount exists for uploads — same
// convention as materialPresets.ts's own loadPresetAsTextureSet) — callers
// turn the blob into an <img> src via URL.createObjectURL.
export async function fetchRadialChartIconBlob(id: string): Promise<Blob> {
  const res = await api.get<Blob>(`/api/v1/radial-charts/${id}/icon`, { responseType: 'blob' })
  return res.data
}

// Pre-loads every "icon" mode chart's own image into a real
// HTMLImageElement (2026-07-31) — canvas drawImage needs an already-loaded
// image synchronously; Capture/Export Video's own composeExportFrame call
// happens either once or on every recorded video frame, neither of which
// can await a fetch mid-draw. Called once up front by Viewport3D.tsx's own
// handleCaptureImage/handleExportVideo, not cached across calls — a handful
// of small PNGs is cheap enough to just refetch per export.
export async function loadRadialChartIcons(charts: RadialChart[]): Promise<Map<string, HTMLImageElement>> {
  const result = new Map<string, HTMLImageElement>()
  await Promise.all(charts.filter(c => c.center_mode === 'icon' && c.icon_storage_filename).map(async chart => {
    const blob = await fetchRadialChartIconBlob(chart.id)
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>(resolve => {
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = url
    })
    result.set(chart.id, img)
  }))
  return result
}

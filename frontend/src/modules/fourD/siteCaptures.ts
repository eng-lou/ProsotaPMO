import { api } from '@/lib/api'
import type { Model3DFile } from './model3dFiles'
import type { UpAxis } from './upAxis'

export type SiteCaptureKind = 'xyz' | 'e57'

// Frontend for site_capture.py's backend (2026-08-20) — a dated point-cloud
// scan uploaded for the Progress Variance engine (progressVarianceEngine.ts).
// Round-trips the raw bytes the same way model3dFiles.ts does (upload/
// download/delete against local disk) — see that model's own docstring for
// why this holds the precision point cloud only, not Part A's already-live-
// preview-only textured OBJ.
export interface SiteCapture {
  id: string
  project_id: string
  name: string
  captured_at: string
  kind: SiteCaptureKind
  source_up_axis: UpAxis
  size_bytes: number
  force_visible: boolean
  created_at: string
  updated_at: string
}

export async function listSiteCaptures(projectId: string): Promise<SiteCapture[]> {
  const res = await api.get<SiteCapture[]>('/api/v1/site-captures/', { params: { project_id: projectId } })
  return res.data
}

export async function uploadSiteCapture(
  projectId: string, name: string, capturedAt: string, kind: SiteCaptureKind, sourceUpAxis: UpAxis, file: Blob,
  onProgress?: (percent: number) => void,
): Promise<SiteCapture> {
  const form = new FormData()
  form.append('project_id', projectId)
  form.append('name', name)
  form.append('captured_at', capturedAt)
  form.append('kind', kind)
  form.append('source_up_axis', sourceUpAxis)
  form.append('file', file, name)
  const res = await api.post<SiteCapture>('/api/v1/site-captures/', form, {
    onUploadProgress: onProgress
      ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)) }
      : undefined,
  })
  return res.data
}

export async function updateSiteCapture(id: string, data: {
  name?: string
  captured_at?: string
  force_visible?: boolean
}): Promise<SiteCapture> {
  const res = await api.patch<SiteCapture>(`/api/v1/site-captures/${id}`, data)
  return res.data
}

// Converts a raw kind='e57' capture into a plain kind='xyz' one, server-
// side (2026-08-20, per Maro's own real 14.4GB, 105-scan MatterPak
// export) — see site_capture.py's own convert_capture for the full "why
// server-side, not in the browser" story. No axios timeout is set
// anywhere in this app's shared client (`@/lib/api`), so this plain await
// is fine even though the request itself can genuinely take minutes for
// a large multi-scan file — there's no client-side deadline to hit.
export async function convertSiteCapture(id: string): Promise<SiteCapture> {
  const res = await api.post<SiteCapture>(`/api/v1/site-captures/${id}/convert`)
  return res.data
}

// "Generate IFC" (2026-08-20, per Maro: "pointcloud to ifc" / "build") —
// runs Cloud2BIM (backend/app/services/cloud2bim/, vendored from
// https://github.com/VaclavNezerka/Cloud2BIM) server-side against this
// capture's own xyz point cloud, registering the result as a normal
// Model3DFile (kind='ifc') — loadable through this app's existing IFC
// pipeline, not a new rendering path. Can genuinely take minutes for a
// real multi-storey scan (see the backend endpoint's own header); same
// "no axios timeout, this is fine" reasoning as convertSiteCapture above.
export async function generateIfcFromCapture(id: string): Promise<Model3DFile> {
  const res = await api.post<Model3DFile>(`/api/v1/site-captures/${id}/generate-ifc`)
  return res.data
}

export async function downloadSiteCapture(id: string): Promise<Blob> {
  const res = await api.get<Blob>(`/api/v1/site-captures/${id}/download`, { responseType: 'blob' })
  return res.data
}

export async function deleteSiteCapture(id: string): Promise<void> {
  await api.delete(`/api/v1/site-captures/${id}`)
}

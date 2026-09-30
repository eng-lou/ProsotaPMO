import { api, downloadLargeBlob } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
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

// Direct-to-R2 upload (2026-08-23) — same three-step presign/PUT/record
// flow as model3dFiles.ts's own uploadModel3DFile; see that function's own
// header for the full "why" (Vercel's hard 4.5MB Function body cap), which
// matters even more here — a real raw .e57 export routinely runs into the
// GB range (see site_capture.py's own MAX_UPLOAD_BYTES comment).
export async function uploadSiteCapture(
  projectId: string, name: string, capturedAt: string, kind: SiteCaptureKind, sourceUpAxis: UpAxis, file: Blob,
  onProgress?: (percent: number) => void,
): Promise<SiteCapture> {
  const contentType = file.type || 'application/octet-stream'
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/site-captures/presign', { name, content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, file, contentType, onProgress)
  const res = await api.post<SiteCapture>('/api/v1/site-captures/', {
    project_id: projectId, name, captured_at: capturedAt, kind, source_up_axis: sourceUpAxis,
    storage_key: presigned.storage_key,
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
// server-side, not in the browser" story. The request can genuinely take
// minutes for a large multi-scan file, so it opts out of the shared
// client's 25s total timeout (`@/lib/api`, added 2026-09-16 — this comment
// used to say no timeout existed, which stopped being true then).
export async function convertSiteCapture(id: string): Promise<SiteCapture> {
  const res = await api.post<SiteCapture>(`/api/v1/site-captures/${id}/convert`, undefined, { timeout: 0 })
  return res.data
}

export async function downloadSiteCapture(id: string): Promise<Blob> {
  return downloadLargeBlob(`/api/v1/site-captures/${id}/download`)
}

export async function deleteSiteCapture(id: string): Promise<void> {
  await api.delete(`/api/v1/site-captures/${id}`)
}

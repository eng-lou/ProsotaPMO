import { api } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'

export interface P6ImportSummary {
  schedule_variant_id: string
  schedule_period_id: string
  variant_name: string
  calendar_count: number
  resource_count: number
  activity_count: number
  relationship_count: number
  assignment_count: number
  udf_value_count: number
  skipped: string[]
}

// Direct-to-R2 upload (2026-09-03, per Maro: a real production import of a
// genuine P6 export — EC00630.xml — failed outright with only the generic
// "check it's a real PMXML" fallback, no useful detail). Root cause: this
// used to post the raw file straight through this backend's own request
// body, which Vercel serverless functions hard-cap at 4.5MB — a real
// project's PMXML export routinely exceeds that, and a body-size rejection
// at the platform layer never reaches FastAPI at all, so there's no
// HTTPException `.detail` for P6ImportDialog.tsx's own error handling to
// surface. Same presign-then-PUT-then-notify shape as every other
// large-file upload in this app (see aiAttachments.ts's own header) — the
// browser PUTs the file's own bytes straight to R2, then this backend only
// ever receives a small JSON body (project_id + storage_key), never
// subject to the cap regardless of how large the real export is.
export async function importP6Xml(projectId: string, file: File): Promise<P6ImportSummary> {
  const { data: presign } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/p6-import/presign', { name: file.name },
  )
  await uploadDirectToStorage(presign.upload_url, file, 'application/xml')
  const res = await api.post<P6ImportSummary>('/api/v1/p6-import/xml', {
    project_id: projectId, storage_key: presign.storage_key,
  })
  return res.data
}

import { api } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'

// Upload directly to storage to avoid the server request-body limit.
export async function generateConceptRenderBlob(blob: Blob, prompt: string, creativity: number): Promise<Blob> {
  const contentType = 'image/png'
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/ai/concept-render/presign', { content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, blob, contentType)
  const { data } = await api.post<{ download_url: string }>('/api/v1/ai/concept-render/', {
    storage_key: presigned.storage_key, prompt, creativity,
  }, { timeout: 300_000 })
  // Plain fetch, not the shared `api` axios instance — same reasoning as
  // directUpload.ts's own header: download_url is a presigned R2 GET url,
  // a third-party-from-the-browser's-perspective origin that must never see
  // this app's own Auth0 bearer token.
  const res = await fetch(data.download_url)
  if (!res.ok) throw new Error(`Failed to download concept render (HTTP ${res.status})`)
  return await res.blob()
}

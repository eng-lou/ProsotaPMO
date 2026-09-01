import { api } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'

// AI Enhance (2026-09-01, per AI_RENDER_ENHANCEMENT_SCOPE.md) — faithful
// super-resolution (Real-ESRGAN via fal.ai) on Capture Image's own raw 3D
// canvas, before Viewport3D.tsx's own overlay compositing draws Gantt/
// Table/titles/etc on top — so AI-generated pixels never touch already-
// sharp vector text/UI, only the actual IFC/Tiles render content. Stills
// only, on demand at capture time — never during normal interactive
// rendering (see the scope doc's own "Daily use" decision).
//
// Same three-step direct-to-R2 shape as model3dFiles.ts's own
// uploadModel3DFile (presign, PUT straight to R2, then a small JSON call
// that does the real work) — a supersampled 4K capture routinely exceeds
// Vercel's 4.5MB request-body cap, so the raw frame can't go through this
// backend's own request body either.
export async function upscaleCanvasBlob(blob: Blob): Promise<Blob> {
  const contentType = 'image/png'
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/ai/upscale/presign', { content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, blob, contentType)
  const { data } = await api.post<{ download_url: string }>('/api/v1/ai/upscale/', {
    storage_key: presigned.storage_key,
  })
  // Plain fetch, not the shared `api` axios instance — same reasoning as
  // directUpload.ts's own header: download_url is a presigned R2 GET url,
  // a third-party-from-the-browser's-perspective origin that must never see
  // this app's own Auth0 bearer token.
  const res = await fetch(data.download_url)
  if (!res.ok) throw new Error(`Failed to download enhanced image (HTTP ${res.status})`)
  return await res.blob()
}

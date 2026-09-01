import { api } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'

// AI Concept Render (2026-09-02, per Maro's own live A/B test showing
// fal.ai's faithful Real-ESRGAN barely changes flat-shaded CAD geometry,
// vs. Gemini/GPT's generative "upscale" producing a dramatically more
// photorealistic result) — a separate, clearly-labeled generative mode
// alongside (not replacing) aiUpscale.ts's own faithful pipeline. The
// guardrail prompt that keeps this from inventing new objects lives
// server-side (ai_concept_render.py's own header) so it can't be bypassed
// from here — this file only ever forwards the user's own *additional*
// prompt text, on top of that guardrail, never in place of it.
//
// Same three-step direct-to-R2 shape as aiUpscale.ts's own
// upscaleCanvasBlob (presign, PUT straight to R2, then a small JSON call
// that does the real work) — see that file's own header for the full
// "why" (Vercel's 4.5MB request-body cap).
export async function generateConceptRenderBlob(blob: Blob, prompt: string, alsoUpscale: boolean): Promise<Blob> {
  const contentType = 'image/png'
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/ai/concept-render/presign', { content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, blob, contentType)
  const { data } = await api.post<{ download_url: string }>('/api/v1/ai/concept-render/', {
    storage_key: presigned.storage_key, prompt, also_upscale: alsoUpscale,
  })
  // Plain fetch, not the shared `api` axios instance — same reasoning as
  // directUpload.ts's own header: download_url is a presigned R2 GET url,
  // a third-party-from-the-browser's-perspective origin that must never see
  // this app's own Auth0 bearer token.
  const res = await fetch(data.download_url)
  if (!res.ok) throw new Error(`Failed to download concept render (HTTP ${res.status})`)
  return await res.blob()
}

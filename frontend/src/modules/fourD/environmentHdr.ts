import { api, downloadLargeBlob } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
import {
  decompressIfGzip, getOrDownloadFile, maybeCompress, pruneCachedFiles, putCachedFile, storedContentType,
} from '@/lib/fileCache'

// "Upload a HDR of mine" (2026-07-11, per Maro) — lets the viewport's
// default environment map (see Viewport3D.tsx's own header on why one's
// needed at all — GLTFLoader's default material is fully metallic and
// needs reflected environment light to not look flat gray) be swapped for
// a user-supplied .hdr/.exr instead of always fetching drei's CDN preset.
// Saved per project since 2026-09-30 (per Maro — it used to be
// session-only and had to be re-uploaded every visit): stored in R2 via
// the environment-maps backend (one per project), cached locally and
// gzipped when that pays off, same as models (see lib/fileCache.ts).
//
// drei's useEnvironment only recognises a file's HDR/EXR format from its
// URL string (see @react-three/drei/core/useEnvironment.js's getLoader) —
// a plain blob: URL has no extension and fails that check, so this reads
// the file as a data: URL and rewrites its MIME prefix to application/hdr
// or application/exr, the exact prefixes useEnvironment special-cases.
export async function loadCustomEnvironment(file: File): Promise<{ name: string; url: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const mime = ext === 'hdr' ? 'application/hdr' : ext === 'exr' ? 'application/exr' : null
  if (!mime) throw new Error(`Unsupported environment file type: .${ext ?? '?'} — supported: .hdr, .exr`)

  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
  const base64 = raw.slice(raw.indexOf(',') + 1)
  return { name: file.name, url: `data:${mime};base64,${base64}` }
}

export interface SavedEnvironment {
  id: string
  project_id: string
  name: string
  size_bytes: number
}

// The project's saved environment as a ready-to-use {name, url}, or null
// when it has none. Cache-first, like models.
export async function loadSavedEnvironment(
  projectId: string,
): Promise<{ saved: SavedEnvironment; env: { name: string; url: string } } | null> {
  const { data: saved } = await api.get<SavedEnvironment | null>('/api/v1/environment-maps/', { params: { project_id: projectId } })
  if (!saved) return null
  const stored = await getOrDownloadFile(
    'environment', projectId, saved.id,
    () => downloadLargeBlob(`/api/v1/environment-maps/${saved.id}/download`), saved.size_bytes,
  )
  const file = new File([await decompressIfGzip(stored)], saved.name)
  return { saved, env: await loadCustomEnvironment(file) }
}

// Uploads straight to R2 (presign + PUT), replacing the project's previous
// environment server-side.
export async function saveEnvironment(projectId: string, file: File): Promise<SavedEnvironment> {
  const stored = await maybeCompress(file)
  const contentType = storedContentType(stored, file)
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/environment-maps/presign', { name: file.name, content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, stored, contentType)
  const { data: saved } = await api.post<SavedEnvironment>('/api/v1/environment-maps/', {
    project_id: projectId, name: file.name, storage_key: presigned.storage_key,
  })
  void putCachedFile('environment', projectId, saved.id, stored)
  void pruneCachedFiles('environment', projectId, [saved.id])
  return saved
}

export async function deleteSavedEnvironment(env: Pick<SavedEnvironment, 'id' | 'project_id'>): Promise<void> {
  await api.delete(`/api/v1/environment-maps/${env.id}`)
  void pruneCachedFiles('environment', env.project_id, [])
}

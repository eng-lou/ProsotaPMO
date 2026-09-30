import { api, downloadLargeBlob } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
import {
  decompressIfGzip, getOrDownloadFile, maybeCompress, pruneCachedFiles, putCachedFile, storedContentType,
} from '@/lib/fileCache'
import type { UpAxis } from './upAxis'

export type Model3DKind = 'ifc' | 'mesh'

// "Unload Selected"/"Reload IFC" (2026-07-26, per Maro: "if i refresh, i
// expect the elements i unloaded to stay unloaded... give me an option to
// reload ifc which can identify the elements unloaded") — guid is the
// GlobalId (matches ModelElementLink.element_ref's own convention: stable
// across a fresh re-parse of the same file, unlike expressID). name/
// type_name are captured once at unload time so the "Reload IFC" picker can
// show a real list without re-parsing the file.
export interface UnloadedElementInfo {
  guid: string
  name: string
  type_name: string
}

export interface Model3DFile {
  id: string
  project_id: string
  name: string
  kind: Model3DKind
  source_up_axis: UpAxis
  size_bytes: number
  created_at: string
  updated_at: string
  // Nullable at the backend (see model3d_file.py's own schema comment) — a
  // fresh import has never had anything unloaded yet.
  unloaded_elements: UnloadedElementInfo[] | null
  // True only for a particle/multi-node-style embedded animation this app
  // can never bake to schedule keyframes (see embeddedAnimationBake.ts's
  // own findSingleAnimatedNode) — tells FourD.tsx's restore-on-mount path
  // to keep the raw animation on the reloaded object instead of stripping
  // it, so Viewport3D.tsx's EmbeddedAnimationLoop still has something to
  // play after a refresh, not just right after the original import.
  keep_raw_animation: boolean
}

// Frontend for model3d_file.py's backend (2026-07-09, per Maro: "keep the
// models and associated data similar to the persistent data in Schedule. so
// i dont have to repeat my actions import again") — unlike
// modelElementLinks.ts's element_ref (a bare filename/GlobalId, since that
// backend never stores the file itself), this one actually round-trips the
// raw bytes: upload on import, download on restore, delete on unload. See
// backend/app/models/model3d_file.py's own header for the local-disk
// storage design (Maro's explicit choice over cloud object storage).
export async function listModel3DFiles(projectId: string): Promise<Model3DFile[]> {
  const res = await api.get<Model3DFile[]>('/api/v1/model3d-files/', { params: { project_id: projectId } })
  return res.data
}

// Direct-to-R2 upload (2026-08-23, replacing this function's own former
// single multipart POST) — see backend/app/services/object_storage.py's
// own header for the full "why" (Vercel Functions hard-cap request bodies
// at 4.5MB; a real IFC import routinely exceeds that). Three steps: ask
// the backend for a presigned url (no file bytes involved yet), PUT the
// file straight to R2 with it (never touching our own backend), then tell
// the backend the upload finished so it can record the metadata — that
// last call is a small JSON body regardless of how large the file itself
// was, so it never risks the same 4.5MB cap.
//
// onProgress (2026-07-28, per Maro: "show a percentage save") — still a
// real byte-count-based percentage of the actual file transfer (now the
// direct-to-R2 PUT, uploadDirectToStorage's own XHR progress, not axios')
// not a guess. Optional so every other caller (there are none yet, but
// this mirrors downloadModel3DFile's own plain-Promise shape) doesn't need
// to pass one.
//
// Compression + local caching (2026-09-30) — see lib/fileCache.ts. Stored
// bytes may be gzipped; size_bytes (read back from R2) is the stored size,
// which nothing displays. IFC always compresses well, so it skips sampling.
export async function uploadModel3DFile(
  projectId: string, name: string, kind: Model3DKind, sourceUpAxis: UpAxis, file: Blob,
  onProgress?: (percent: number) => void, keepRawAnimation = false,
): Promise<Model3DFile> {
  const stored = await maybeCompress(file, kind === 'ifc')
  const contentType = storedContentType(stored, file)
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/model3d-files/presign', { name, content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, stored, contentType, onProgress)
  const res = await api.post<Model3DFile>('/api/v1/model3d-files/', {
    project_id: projectId, name, kind, source_up_axis: sourceUpAxis,
    storage_key: presigned.storage_key, keep_raw_animation: keepRawAnimation,
  })
  // Seeds the local cache with exactly the bytes now in storage, so the
  // first reload after an import doesn't download them. A model's bytes
  // never change under the same id (a re-import replaces the row — new id —
  // see model3d_file.py's create_file), so caching by id is safe.
  void putCachedFile('model', res.data.project_id, res.data.id, stored)
  return res.data
}

// Cache-first; unpacks gzip on the way out, whether cached or downloaded.
export async function downloadModel3DFile(
  file: Pick<Model3DFile, 'id' | 'project_id'> & { size_bytes?: number },
): Promise<Blob> {
  const stored = await getOrDownloadFile(
    'model', file.project_id, file.id,
    () => downloadLargeBlob(`/api/v1/model3d-files/${file.id}/download`), file.size_bytes,
  )
  return decompressIfGzip(stored)
}

export const pruneModel3DFileCache = (projectId: string, keepFileIds: string[]) =>
  pruneCachedFiles('model', projectId, keepFileIds)

export async function deleteModel3DFile(fileId: string): Promise<void> {
  await api.delete(`/api/v1/model3d-files/${fileId}`)
}

// Full replacement, not append/remove-by-guid — see the backend's own
// update_unloaded_elements header for why: the caller always resolves the
// complete current set before calling this.
export async function updateUnloadedElements(fileId: string, unloadedElements: UnloadedElementInfo[]): Promise<Model3DFile> {
  const res = await api.patch<Model3DFile>(`/api/v1/model3d-files/${fileId}/unloaded-elements`, { unloaded_elements: unloadedElements })
  return res.data
}

import { api, downloadLargeBlob } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
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
// Compression (2026-09-30, per Maro: "build compression") — models are
// gzipped in the browser before the PUT, so storage holds and every later
// download transfers the smaller copy. Measured on real files: IFC 4-5x
// (MEP-Optimized 126MB -> 30MB), OBJ 83% smaller, FBX 10-30%, GLB anywhere
// from 1% (texture-heavy site GLBs — embedded JPG/PNG is already
// compressed) to 41% (geometry-heavy). Because that varies per file, not
// per format, every model is sampled first (see worthCompressing). Nothing server-side needs to know — downloadModel3DFile
// recognises gzip by its own 2-byte magic number and unpacks it, and no
// IFC/OBJ/GLB/FBX file ever starts with those bytes, so every file
// uploaded before this change still loads unchanged. size_bytes (read back
// from R2) becomes the stored, compressed size; nothing displays it.
export async function uploadModel3DFile(
  projectId: string, name: string, kind: Model3DKind, sourceUpAxis: UpAxis, file: Blob,
  onProgress?: (percent: number) => void, keepRawAnimation = false,
): Promise<Model3DFile> {
  const stored = await maybeCompress(kind, file)
  const contentType = stored === file ? (file.type || 'application/octet-stream') : 'application/gzip'
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/model3d-files/presign', { name, content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, stored, contentType, onProgress)
  const res = await api.post<Model3DFile>('/api/v1/model3d-files/', {
    project_id: projectId, name, kind, source_up_axis: sourceUpAxis,
    storage_key: presigned.storage_key, keep_raw_animation: keepRawAnimation,
  })
  // Seeds the local model cache (see below) with exactly the bytes now in
  // storage, so the first reload after an import doesn't download them.
  void cacheModel3DFile(res.data, stored)
  return res.data
}

const gzip = (blob: Blob) => new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()

// Compresses three 1MB samples (start/middle/end) before committing to the
// whole file — ~30ms, and it spares a large texture-heavy GLB ~1s per
// 100MB of compression work that would only save ~1%. IFC is always worth it.
const SAMPLE_BYTES = 1024 * 1024
async function worthCompressing(kind: Model3DKind, file: Blob): Promise<boolean> {
  if (kind === 'ifc' || file.size <= 3 * SAMPLE_BYTES) return true
  const mid = Math.floor(file.size / 2 - SAMPLE_BYTES / 2)
  const sample = new Blob([
    file.slice(0, SAMPLE_BYTES), file.slice(mid, mid + SAMPLE_BYTES), file.slice(file.size - SAMPLE_BYTES),
  ])
  return (await gzip(sample)).size < sample.size * 0.9
}

async function maybeCompress(kind: Model3DKind, file: Blob): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return file
  try {
    if (!(await worthCompressing(kind, file))) return file
    const gz = await gzip(file)
    // Only worth it if it actually saves something meaningful.
    return gz.size < file.size * 0.9 ? gz : file
  } catch (err) {
    console.warn('Model compression failed, uploading uncompressed', err)
    return file
  }
}

async function isGzip(blob: Blob): Promise<boolean> {
  if (blob.size < 2) return false
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  return head[0] === 0x1f && head[1] === 0x8b
}

async function decompressIfGzip(blob: Blob): Promise<Blob> {
  if (!(await isGzip(blob))) return blob
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob()
}

// Local model cache (2026-09-30, per Maro: "isnt there anyway to speed the
// download") — every reload used to re-download every model from R2 (~189MB
// for the NBU clinic set), because the download endpoint redirects to a
// freshly *signed* URL each time, so the browser's own HTTP cache never
// matches. A model's bytes never change under the same id (a re-import
// replaces the row, i.e. a new id — see model3d_file.py's create_file), so
// this keeps each file in the browser's on-disk Cache Storage keyed by
// project + id: after the first download (or the upload itself, see
// uploadModel3DFile) a reload reads from local disk, no network.
// Every cache call is best-effort — an unavailable/full cache just falls
// back to the network, never fails the load.
const MODEL_CACHE_NAME = 'prosota-model-files-v1'
const cacheKey = (projectId: string, fileId: string) => `/__model-file-cache/${projectId}/${fileId}`

async function openModelCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(MODEL_CACHE_NAME)
  } catch {
    return null
  }
}

export async function cacheModel3DFile(file: Pick<Model3DFile, 'id' | 'project_id'>, blob: Blob): Promise<void> {
  const cache = await openModelCache()
  try {
    await cache?.put(cacheKey(file.project_id, file.id), new Response(blob))
  } catch (err) {
    console.warn('Could not cache model file locally', err)
  }
}

export async function downloadModel3DFile(
  file: Pick<Model3DFile, 'id' | 'project_id'> & { size_bytes?: number },
): Promise<Blob> {
  const cache = await openModelCache()
  try {
    const hit = await cache?.match(cacheKey(file.project_id, file.id))
    if (hit) {
      const blob = await hit.blob()
      // Size check guards against a truncated write (tab closed mid-put).
      // The cache holds the stored (possibly gzipped) bytes, same as
      // size_bytes, and is unpacked on the way out like a download is.
      if (file.size_bytes === undefined || blob.size === file.size_bytes) return await decompressIfGzip(blob)
      await cache?.delete(cacheKey(file.project_id, file.id))
    }
  } catch {
    // fall through to the network
  }
  const blob = await downloadLargeBlob(`/api/v1/model3d-files/${file.id}/download`)
  void cacheModel3DFile(file, blob)
  return decompressIfGzip(blob)
}

// Drops cached copies of this project's files that no longer exist
// server-side (deleted, or replaced by a re-import under a new id), so the
// cache doesn't grow forever. Scoped to one project so it never touches
// another project's still-valid entries.
export async function pruneModel3DFileCache(projectId: string, keepFileIds: string[]): Promise<void> {
  const cache = await openModelCache()
  if (!cache) return
  try {
    const keep = new Set(keepFileIds.map(id => cacheKey(projectId, id)))
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname
      if (path.startsWith(`/__model-file-cache/${projectId}/`) && !keep.has(path)) await cache.delete(req)
    }
  } catch {
    // best-effort
  }
}

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

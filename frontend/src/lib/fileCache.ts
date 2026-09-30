// Shared by every stored-file feature that reloads large files from R2
// (models, material preset textures, environment HDRs, textured OBJ sets).
// Two independent tools:
//
// 1. Local file cache (2026-09-30, per Maro: "isnt there anyway to speed the
//    download") — every reload used to re-download every stored file,
//    because each download endpoint redirects to a freshly *signed* R2 URL,
//    so the browser's own HTTP cache never matches. Callers only cache
//    files whose bytes never change under the same id (a replacement always
//    gets a new id), so an entry keyed by namespace + project + id is
//    always valid. Lives in the browser's on-disk Cache Storage. Every call
//    is best-effort: an unavailable/full cache falls back to the network
//    and never fails a load.
//
// 2. Upload compression (2026-09-30, per Maro: "build compression") — files
//    are gzipped in the browser before upload when it pays off, so storage
//    holds and every later download transfers the smaller copy. Measured on
//    real files: IFC 4-5x (MEP-Optimized 126MB -> 30MB), OBJ 83% smaller,
//    FBX 10-30%, GLB 1% (texture-heavy — embedded JPG/PNG is already
//    compressed) to 41% (geometry-heavy). Because that varies per file, not
//    per format, a file is sampled first (worthCompressing). Nothing
//    server-side needs to know: decompressIfGzip recognises gzip by its
//    2-byte magic number (1f 8b), which no IFC/OBJ/GLB/FBX/HDR/EXR file
//    starts with, so files uploaded before this still load unchanged.

const CACHE_NAME = 'prosota-files-v1'
// Superseded same-day by CACHE_NAME's namespaced layout — deleted once so
// its entries don't sit on disk forever.
const OLD_CACHE_NAMES = ['prosota-model-files-v1']

export type FileCacheNamespace = 'model' | 'texture' | 'environment'

const keyFor = (ns: FileCacheNamespace, projectId: string, id: string) => `/__file-cache/${ns}/${projectId}/${id}`

let oldCachesDeleted = false
async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    if (!oldCachesDeleted) {
      oldCachesDeleted = true
      for (const name of OLD_CACHE_NAMES) void caches.delete(name)
    }
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

export async function putCachedFile(ns: FileCacheNamespace, projectId: string, id: string, blob: Blob): Promise<void> {
  const cache = await openCache()
  try {
    await cache?.put(keyFor(ns, projectId, id), new Response(blob))
  } catch (err) {
    console.warn('Could not cache file locally', err)
  }
}

// expectedSize (when known) guards against a truncated write, e.g. the tab
// closing mid-put: a size mismatch is treated as a miss and evicted.
export async function getCachedFile(
  ns: FileCacheNamespace, projectId: string, id: string, expectedSize?: number,
): Promise<Blob | null> {
  const cache = await openCache()
  try {
    const hit = await cache?.match(keyFor(ns, projectId, id))
    if (!hit) return null
    const blob = await hit.blob()
    if (expectedSize === undefined || blob.size === expectedSize) return blob
    await cache?.delete(keyFor(ns, projectId, id))
  } catch {
    // treat as a miss
  }
  return null
}

// Cache-first fetch: returns the cached bytes, or downloads and caches them.
export async function getOrDownloadFile(
  ns: FileCacheNamespace, projectId: string, id: string, download: () => Promise<Blob>, expectedSize?: number,
): Promise<Blob> {
  const cached = await getCachedFile(ns, projectId, id, expectedSize)
  if (cached) return cached
  const blob = await download()
  void putCachedFile(ns, projectId, id, blob)
  return blob
}

// Drops cached entries of one namespace+project whose ids no longer exist
// server-side (deleted, or replaced under a new id), so the cache doesn't
// grow forever. Scoped so it never touches another project's valid entries.
export async function pruneCachedFiles(ns: FileCacheNamespace, projectId: string, keepIds: string[]): Promise<void> {
  const cache = await openCache()
  if (!cache) return
  try {
    const prefix = `/__file-cache/${ns}/${projectId}/`
    const keep = new Set(keepIds.map(id => keyFor(ns, projectId, id)))
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname
      if (path.startsWith(prefix) && !keep.has(path)) await cache.delete(req)
    }
  } catch {
    // best-effort
  }
}

const gzip = (blob: Blob) => new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()

// Compresses three 1MB samples (start/middle/end) before committing to the
// whole file — ~50ms, and it spares e.g. a large texture-heavy GLB ~1s per
// 100MB of compression work that would only save ~1%.
const SAMPLE_BYTES = 1024 * 1024
async function worthCompressing(file: Blob): Promise<boolean> {
  if (file.size <= 3 * SAMPLE_BYTES) return true
  const mid = Math.floor(file.size / 2 - SAMPLE_BYTES / 2)
  const sample = new Blob([
    file.slice(0, SAMPLE_BYTES), file.slice(mid, mid + SAMPLE_BYTES), file.slice(file.size - SAMPLE_BYTES),
  ])
  return (await gzip(sample)).size < sample.size * 0.9
}

// Returns the gzipped file when that saves at least 10%, else the original.
// skipSample: for formats known to always compress well (IFC).
export async function maybeCompress(file: Blob, skipSample = false): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return file
  try {
    if (!skipSample && !(await worthCompressing(file))) return file
    const gz = await gzip(file)
    return gz.size < file.size * 0.9 ? gz : file
  } catch (err) {
    console.warn('Compression failed, uploading uncompressed', err)
    return file
  }
}

export const storedContentType = (stored: Blob, original: Blob) =>
  stored === original ? (original.type || 'application/octet-stream') : 'application/gzip'

async function isGzip(blob: Blob): Promise<boolean> {
  if (blob.size < 2) return false
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  return head[0] === 0x1f && head[1] === 0x8b
}

export async function decompressIfGzip(blob: Blob): Promise<Blob> {
  if (!(await isGzip(blob))) return blob
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob()
}

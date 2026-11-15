import { geometryDataBytes, type IfcGeometryData } from './ifcGeometryData'

const MAX_ENTRY = 256 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024
// The key includes the actual file contents, parser version and extraction
// schema. Filenames/mtime are not identities (IFC reloads often reuse both).
export async function ifcGeometryCacheKey(file: Blob) {
  const hashes: string[] = []
  for (let at = 0; at < file.size; at += 8 * 1024 * 1024) {
    const bytes = await file.slice(at, at + 8 * 1024 * 1024).arrayBuffer()
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    hashes.push(Array.from(hash, b => b.toString(16).padStart(2, '0')).join(''))
  }
  return `web-ifc-0.0.77/geometry-1/${file.size}/${hashes.join('')}`
}

async function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('prosota-ifc-geometry-v1', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('geometry'); request.result.createObjectStore('entries', { keyPath: 'key' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Geometry cache is busy'))
  })
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error) })
}
export async function readIfcGeometryCache(key: string): Promise<IfcGeometryData | null> {
  let db: IDBDatabase | undefined
  try {
    db = await openCache()
    const value = await result<IfcGeometryData | undefined>(db.transaction('geometry').objectStore('geometry').get(key))
    if (value?.version !== 1 || !Array.isArray(value.geometries) || !Array.isArray(value.placements)) return null
    const ids = new Set(value.geometries.map(g => g.id))
    if (!value.geometries.every(g => Number.isInteger(g.id) && g.vertices instanceof Float32Array && g.vertices.length % 6 === 0
      && g.indices instanceof Uint32Array && g.indices.length % 3 === 0)) return null
    if (!value.placements.every(p => ids.has(p.geometryExpressID) && Number.isInteger(p.expressID)
      && Array.isArray(p.matrix) && p.matrix.length === 16 && p.matrix.every(Number.isFinite)
      && p.color && [p.color.x, p.color.y, p.color.z, p.color.w].every(Number.isFinite))) return null
    return value
  } catch { return null } finally { db?.close() }
}
export async function writeIfcGeometryCache(key: string, data: IfcGeometryData) {
  const bytes = geometryDataBytes(data)
  if (bytes > MAX_ENTRY) return false
  let db: IDBDatabase | undefined
  try {
    db = await openCache()
    const tx = db.transaction(['geometry', 'entries'], 'readwrite'), done = completed(tx)
    // Attach a handler immediately: quota errors may abort before getAll completes.
    void done.catch(() => {})
    const entries = await result<{key: string; bytes: number; time: number}[]>(tx.objectStore('entries').getAll())
    let total = entries.filter(e => e.key !== key).reduce((sum, e) => sum + e.bytes, 0) + bytes
    for (const old of entries.sort((a,b) => a.time - b.time)) {
      if (total <= MAX_TOTAL) break
      if (old.key === key) continue
      tx.objectStore('geometry').delete(old.key); tx.objectStore('entries').delete(old.key); total -= old.bytes
    }
    tx.objectStore('geometry').put(data, key)
    tx.objectStore('entries').put({ key, bytes, time: Date.now() })
    await done; return true
  } catch { return false } finally { db?.close() }
}

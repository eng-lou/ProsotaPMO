import type { ClashSnapshotElement } from './clashGeometry'
export async function packGeometry(geometry: ClashSnapshotElement[]): Promise<string> {
  const stream = new Blob([JSON.stringify(geometry)]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
export async function unpackSnapshot<T extends { geometry?: ClashSnapshotElement[]; geometry_z?: string }>(snapshot: T): Promise<T> {
  snapshot = await readClashTransfer(snapshot)
  if (!snapshot.geometry_z) return snapshot
  const bytes = Uint8Array.from(atob(snapshot.geometry_z), c => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return { ...snapshot, geometry: JSON.parse(await new Response(stream).text()) }
}

export async function geometryFingerprint(elements: ClashSnapshotElement[]): Promise<string> {
  const parts: string[] = []
  const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  for (const element of elements) {
    parts.push(element.key)
    for (const mesh of element.meshes) {
      parts.push(await hash(new Float32Array(mesh.positions).buffer), await hash(new Uint32Array(mesh.indices).buffer))
    }
  }
  return hash(new TextEncoder().encode(parts.join('|')).buffer)
}


export async function readClashTransfer<T>(value: T, signal?: AbortSignal): Promise<T> {
  const url = (value as { snapshot_url?: string }).snapshot_url
  if (!url) return value
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
  if (!response.ok) throw new Error('Could not download clash evidence. Reopen the report to retry.')
  const stream = response.body!.pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text()) as T
}

export async function compressClashUpload(value: unknown): Promise<Blob> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}

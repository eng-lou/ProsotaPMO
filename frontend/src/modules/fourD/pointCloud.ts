import * as THREE from 'three'

// Reality Captures' precision data source (2026-08-20, per Maro: the
// decimated OBJ mesh loadTexturedObj (import3d.ts) loads is real, but
// it's a simplified, lossy export built for fast web viewing — for the
// Progress Variance engine's own precision requirement, the *raw* scan
// data matters, not a simplified mesh of it). Matterport's own MatterPak
// export ships this as a plain `cloud.xyz` — `x y z r g b` per line, no
// header, real-world metre scale (confirmed directly against a real
// export: 13.5 million points, ~521MB) — needs no parsing library at all,
// unlike E57 (see the plan's own write-up on why E57 support is a later,
// separate spike against `three-e57-loader` rather than the starting
// point: its own JS ecosystem is thin and unverified, where `.xyz` is
// trivial and already in hand).

export interface PointCloudChunk {
  // Flat, interleaved-by-index arrays (positions[i*3..i*3+2], same i into
  // colors) rather than an array of {x,y,z,r,g,b} objects — 13.5M small
  // objects would be a real GC/memory problem at this scale; typed arrays
  // are also exactly what THREE.BufferGeometry wants directly, no
  // conversion needed at render time.
  positions: Float32Array
  colors: Uint8Array
  count: number
}

// Split across multiple chunks, not one flat array (2026-08-21, per a
// real 232M-point/9.3GB single-scan E57 export from Maro — confirmed
// directly against this browser: a single ArrayBuffer over 2,147,483,647
// bytes (2^31-1) throws "Array buffer allocation failed", well below what
// 232M points needs for even positions alone (232M * 3 * 4 = 2.78GB)).
// Every chunk's own arrays stay under CHUNK_MAX_POINTS so no single
// allocation can ever approach that ceiling, however large the capture —
// full precision is kept for both rendering and Progress Variance
// querying, nothing here decimates.
export interface PointCloudData {
  chunks: PointCloudChunk[]
  count: number
}

// 100M points * 3 floats * 4 bytes = 1.2GB — comfortably under the
// ~179M-point ceiling a single Float32Array position buffer can reach
// before the 2^31-1-byte ArrayBuffer cap above, with real margin to
// spare rather than cutting it exactly at the edge.
const CHUNK_MAX_POINTS = 100_000_000

// Bytes-per-line estimate used only to pre-size each chunk's initial
// typed arrays and avoid repeated regrowth passes — real MatterPak/E57-
// converted lines run ~35-45 bytes (confirmed against both a 521MB/13.5M-
// point MatterPak export and a 9.3GB/232M-point E57 conversion, ~40
// bytes/line). Previously 16, which for a large file over-allocated by
// ~2.5x for no benefit now that chunking (not one giant buffer) is what
// actually bounds memory.
const MIN_BYTES_PER_LINE = 32
const INITIAL_MIN_POINTS = 1_000_000

export type PointCloudProgress = (bytesRead: number, totalBytes: number) => void

// Streams the file in chunks (File.stream(), not file.text()) — a 521MB
// file read as one JS string, then .split('\n')'d into 13.5 million
// string slices, is both a large transient allocation and slow; streaming
// + manual line-buffering across chunk boundaries keeps memory bounded to
// the output typed arrays plus one chunk at a time.
export async function parseXyzFile(file: File, onProgress?: PointCloudProgress): Promise<PointCloudData> {
  const estimatedTotal = Math.max(INITIAL_MIN_POINTS, Math.ceil(file.size / MIN_BYTES_PER_LINE))
  const chunks: PointCloudChunk[] = []
  let totalFinalized = 0
  let positions = new Float32Array(0)
  let colors = new Uint8Array(0)
  let capacity = 0
  let count = 0

  // Sizes the next chunk off however many points are still estimated to
  // be left (clamped to CHUNK_MAX_POINTS) — accurate enough to avoid
  // needless regrowth on the common case without ever risking a single
  // allocation anywhere near the 2GB ceiling.
  const startChunk = () => {
    capacity = Math.max(INITIAL_MIN_POINTS, Math.min(CHUNK_MAX_POINTS, estimatedTotal - totalFinalized))
    positions = new Float32Array(capacity * 3)
    colors = new Uint8Array(capacity * 3)
    count = 0
  }
  const finalizeChunk = () => {
    if (count === 0) return
    chunks.push({ positions: positions.subarray(0, count * 3), colors: colors.subarray(0, count * 3), count })
    totalFinalized += count
  }
  startChunk()

  const ensureCapacity = () => {
    if (count < capacity) return
    if (capacity >= CHUNK_MAX_POINTS) {
      // Current chunk is at its hard cap — seal it and start a fresh one
      // rather than ever growing a single buffer past CHUNK_MAX_POINTS.
      finalizeChunk()
      startChunk()
      return
    }
    const nextCapacity = Math.min(CHUNK_MAX_POINTS, capacity * 2)
    const nextPositions = new Float32Array(nextCapacity * 3)
    nextPositions.set(positions.subarray(0, count * 3))
    positions = nextPositions
    const nextColors = new Uint8Array(nextCapacity * 3)
    nextColors.set(colors.subarray(0, count * 3))
    colors = nextColors
    capacity = nextCapacity
  }

  const processLine = (line: string) => {
    if (line.length === 0) return
    const parts = line.split(' ')
    if (parts.length < 6) return
    const x = parseFloat(parts[0])
    const y = parseFloat(parts[1])
    const z = parseFloat(parts[2])
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return
    ensureCapacity()
    const i3 = count * 3
    positions[i3] = x
    positions[i3 + 1] = y
    positions[i3 + 2] = z
    colors[i3] = Number(parts[3]) | 0
    colors[i3 + 1] = Number(parts[4]) | 0
    colors[i3 + 2] = Number(parts[5]) | 0
    count += 1
  }

  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  let leftover = ''
  let bytesRead = 0
  // Confirmed directly (2026-08-21, against the same real 232M-point
  // file): without this, the tab goes fully unresponsive — not crashed,
  // not slow, just dead to input, screenshots, and even DevTools — for
  // the entire multi-minute parse. `await reader.read()` on a Blob-backed
  // stream resolves fast enough that the loop never naturally reaches a
  // macrotask boundary; it just chains microtasks back-to-back, which
  // starves rendering/input/the extension's own script injection the
  // whole time. A `setTimeout` yield forces a real macrotask boundary.
  // Time-based (every ~50ms of work), not per chunk or per line — a fixed
  // per-chunk yield would mean tens of thousands of ~4ms setTimeout waits
  // for a file with this many stream chunks, adding minutes of pure
  // overhead; this keeps the tab responsive for a cost too small to
  // measure against the parse itself.
  let lastYield = performance.now()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    onProgress?.(bytesRead, file.size)
    const text = leftover + decoder.decode(value, { stream: true })
    const lines = text.split('\n')
    leftover = lines.pop() ?? ''
    for (const line of lines) processLine(line)
    if (performance.now() - lastYield > 50) {
      await new Promise(resolve => setTimeout(resolve, 0))
      lastYield = performance.now()
    }
  }
  if (leftover.length > 0) processLine(leftover)

  // Trim the final chunk to its real count — subarray is a view (no
  // copy), so the actual over-allocated buffer stays retained for the
  // object's lifetime; a known, deliberate memory-vs-simplicity tradeoff
  // for a one-off import, not revisited unless it proves a real problem
  // in practice.
  finalizeChunk()

  return { chunks, count: totalFinalized }
}

// A uniform spatial grid over the point cloud (2026-08-20) — the Progress
// Variance engine's own "does this element's bounding volume actually
// contain scanned matter" query needs a fast spatial lookup; three-mesh-
// bvh (already used by Clash Detective, sceneClash.ts) only indexes
// triangulated mesh geometry, not a scattered point cloud, so it doesn't
// apply here. A hand-rolled uniform grid (bucket points into fixed-size
// cells, O(1) average lookup) is simple enough to write and verify
// directly rather than pull in and trust a second unverified dependency
// on top of the still-unverified E57 one (see the plan's own reasoning).
//
// Cell keys are packed into a single JS number (17 bits per axis, ±65,536
// cells around origin) rather than string-keyed ("${cx},${cy},${cz}") —
// 13.5 million string allocations for the Map's own keys would be a real
// memory/GC cost; three packed 17-bit integers safely fit Number's
// 53-bit-safe-integer range with room to spare (2^51 total). 65,536 cells
// in each direction is enough headroom at any realistic cellSize (e.g.
// 13km of range at a 0.2m cell) for a single building/site capture.
const AXIS_BITS = 17
const AXIS_OFFSET = 1 << (AXIS_BITS - 1) // 65536
const AXIS_BASE = 1 << AXIS_BITS // 131072

// Packs (chunkIndex, indexWithinChunk) into one bucket entry — chunks
// hold up to CHUNK_MAX_POINTS (100M) points each, so a multiplier above
// that with room to spare avoids any collision between a low chunk index
// and a high in-chunk index; still nowhere near Number's 2^53-safe-
// integer range even with the chunk index up in the hundreds.
const CHUNK_INDEX_MULTIPLIER = 200_000_000

export class PointCloudIndex {
  readonly cellSize: number
  private readonly cellToIndices = new Map<number, number[]>()
  private readonly cloud: PointCloudData

  constructor(cloud: PointCloudData, cellSize: number) {
    this.cloud = cloud
    this.cellSize = cellSize
    const { chunks } = cloud
    for (let c = 0; c < chunks.length; c++) {
      const { positions, count } = chunks[c]
      const base = c * CHUNK_INDEX_MULTIPLIER
      for (let i = 0; i < count; i++) {
        const i3 = i * 3
        const key = this.cellKey(positions[i3], positions[i3 + 1], positions[i3 + 2])
        let bucket = this.cellToIndices.get(key)
        if (!bucket) { bucket = []; this.cellToIndices.set(key, bucket) }
        bucket.push(base + i)
      }
    }
  }

  private cellKey(x: number, y: number, z: number): number {
    const cx = Math.floor(x / this.cellSize) + AXIS_OFFSET
    const cy = Math.floor(y / this.cellSize) + AXIS_OFFSET
    const cz = Math.floor(z / this.cellSize) + AXIS_OFFSET
    return (cx * AXIS_BASE + cy) * AXIS_BASE + cz
  }

  // Counts real scan points inside (or touching) a world-space box —
  // capped at `limit` (default a small number) since the caller (the
  // variance engine) only ever needs "is there *some* real density here,"
  // not an exact count; stopping early keeps a query over a large/dense
  // region cheap.
  countPointsInBox(box: THREE.Box3, limit = 50): number {
    const minCellX = Math.floor(box.min.x / this.cellSize)
    const minCellY = Math.floor(box.min.y / this.cellSize)
    const minCellZ = Math.floor(box.min.z / this.cellSize)
    const maxCellX = Math.floor(box.max.x / this.cellSize)
    const maxCellY = Math.floor(box.max.y / this.cellSize)
    const maxCellZ = Math.floor(box.max.z / this.cellSize)

    const { chunks } = this.cloud
    let found = 0
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        for (let cz = minCellZ; cz <= maxCellZ; cz++) {
          const key = ((cx + AXIS_OFFSET) * AXIS_BASE + (cy + AXIS_OFFSET)) * AXIS_BASE + (cz + AXIS_OFFSET)
          const bucket = this.cellToIndices.get(key)
          if (!bucket) continue
          for (const packed of bucket) {
            const positions = chunks[Math.floor(packed / CHUNK_INDEX_MULTIPLIER)].positions
            const i3 = (packed % CHUNK_INDEX_MULTIPLIER) * 3
            if (
              positions[i3] >= box.min.x && positions[i3] <= box.max.x &&
              positions[i3 + 1] >= box.min.y && positions[i3 + 1] <= box.max.y &&
              positions[i3 + 2] >= box.min.z && positions[i3 + 2] <= box.max.z
            ) {
              found += 1
              if (found >= limit) return found
            }
          }
        }
      }
    }
    return found
  }

  // Does real scan matter exist within `radius` of one world-space point
  // (2026-08-21, Progress Variance's own surface-coverage query — see
  // surfaceSampling.ts's own header for why per-point proximity, not
  // countPointsInBox's whole-bounding-volume count, is what "60% of this
  // wall is poured" actually needs). Same cell-grid as countPointsInBox,
  // just walking the (typically 3x3x3, more if radius exceeds cellSize)
  // neighbourhood around one point instead of an arbitrary box, and
  // short-circuiting on the first real hit — a surface sample only ever
  // needs a yes/no answer, never a count.
  hasPointNear(x: number, y: number, z: number, radius: number): boolean {
    const radiusSq = radius * radius
    const minCellX = Math.floor((x - radius) / this.cellSize)
    const minCellY = Math.floor((y - radius) / this.cellSize)
    const minCellZ = Math.floor((z - radius) / this.cellSize)
    const maxCellX = Math.floor((x + radius) / this.cellSize)
    const maxCellY = Math.floor((y + radius) / this.cellSize)
    const maxCellZ = Math.floor((z + radius) / this.cellSize)

    const { chunks } = this.cloud
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        for (let cz = minCellZ; cz <= maxCellZ; cz++) {
          const key = ((cx + AXIS_OFFSET) * AXIS_BASE + (cy + AXIS_OFFSET)) * AXIS_BASE + (cz + AXIS_OFFSET)
          const bucket = this.cellToIndices.get(key)
          if (!bucket) continue
          for (const packed of bucket) {
            const positions = chunks[Math.floor(packed / CHUNK_INDEX_MULTIPLIER)].positions
            const i3 = (packed % CHUNK_INDEX_MULTIPLIER) * 3
            const dx = positions[i3] - x
            const dy = positions[i3 + 1] - y
            const dz = positions[i3 + 2] - z
            if (dx * dx + dy * dy + dz * dz <= radiusSq) return true
          }
        }
      }
    }
    return false
  }
}

// Rendering the full 13.5M-point cloud as one draw call is fine for
// modern hardware (a plain THREE.Points buffer, no per-point objects), but
// a hard cap keeps a first-pass import from ever locking up a weaker
// machine — subsamples evenly (every Nth point) rather than the first N,
// so sparse/dense regions of the scan aren't biased differently. The
// *index* above always uses the full, non-decimated cloud regardless —
// visual decimation never affects Progress Variance precision.
const MAX_RENDERED_POINTS = 4_000_000

export function createPointCloudObject(cloud: PointCloudData, maxPoints = MAX_RENDERED_POINTS): THREE.Points {
  const stride = Math.max(1, Math.ceil(cloud.count / maxPoints))
  const renderCount = Math.ceil(cloud.count / stride)
  const positions = new Float32Array(renderCount * 3)
  const colors = new Float32Array(renderCount * 3)
  let out = 0
  // Strides across chunk boundaries as if the cloud were still one flat
  // array — chunk order matches parse order, so "every Nth point" here
  // samples the exact same global sequence chunking never touched.
  let chunkStart = 0
  let nextGlobal = 0
  for (const chunk of cloud.chunks) {
    const chunkEnd = chunkStart + chunk.count
    while (nextGlobal < chunkEnd) {
      const i3 = (nextGlobal - chunkStart) * 3
      const o3 = out * 3
      positions[o3] = chunk.positions[i3]
      positions[o3 + 1] = chunk.positions[i3 + 1]
      positions[o3 + 2] = chunk.positions[i3 + 2]
      // THREE.Color expects 0-1 float components, not the source's 0-255 —
      // vertex colours read straight from the geometry attribute otherwise
      // render far too bright/clipped.
      colors[o3] = chunk.colors[i3] / 255
      colors[o3 + 1] = chunk.colors[i3 + 1] / 255
      colors[o3 + 2] = chunk.colors[i3 + 2] / 255
      out += 1
      nextGlobal += stride
    }
    chunkStart = chunkEnd
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, out * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, out * 3), 3))
  const material = new THREE.PointsMaterial({ size: 0.02, vertexColors: true, sizeAttenuation: true })
  return new THREE.Points(geometry, material)
}

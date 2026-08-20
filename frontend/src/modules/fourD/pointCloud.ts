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

export interface PointCloudData {
  // Flat, interleaved-by-index arrays (positions[i*3..i*3+2], same i into
  // colors) rather than an array of {x,y,z,r,g,b} objects — 13.5M small
  // objects would be a real GC/memory problem at this scale; typed arrays
  // are also exactly what THREE.BufferGeometry wants directly, no
  // conversion needed at render time.
  positions: Float32Array
  colors: Uint8Array
  count: number
}

// Conservative (deliberately generous) bytes-per-line estimate used only
// to pre-size the initial typed arrays and avoid repeated regrowth for a
// large file — real MatterPak lines run ~35-45 bytes; 16 as a divisor
// over-estimates point count (allocates more than needed) rather than
// under, since under-estimating means more copy-and-grow passes on an
// already multi-hundred-MB buffer.
const MIN_BYTES_PER_LINE = 16
const INITIAL_MIN_POINTS = 1_000_000

export type PointCloudProgress = (bytesRead: number, totalBytes: number) => void

// Streams the file in chunks (File.stream(), not file.text()) — a 521MB
// file read as one JS string, then .split('\n')'d into 13.5 million
// string slices, is both a large transient allocation and slow; streaming
// + manual line-buffering across chunk boundaries keeps memory bounded to
// the output typed arrays plus one chunk at a time.
export async function parseXyzFile(file: File, onProgress?: PointCloudProgress): Promise<PointCloudData> {
  const initialCapacity = Math.max(INITIAL_MIN_POINTS, Math.ceil(file.size / MIN_BYTES_PER_LINE))
  let positions = new Float32Array(initialCapacity * 3)
  let colors = new Uint8Array(initialCapacity * 3)
  let count = 0

  const ensureCapacity = (extra: number) => {
    const capacity = positions.length / 3
    if (count + extra <= capacity) return
    const nextCapacity = Math.ceil(Math.max(capacity * 2, count + extra))
    const nextPositions = new Float32Array(nextCapacity * 3)
    nextPositions.set(positions.subarray(0, count * 3))
    positions = nextPositions
    const nextColors = new Uint8Array(nextCapacity * 3)
    nextColors.set(colors.subarray(0, count * 3))
    colors = nextColors
  }

  const processLine = (line: string) => {
    if (line.length === 0) return
    const parts = line.split(' ')
    if (parts.length < 6) return
    const x = parseFloat(parts[0])
    const y = parseFloat(parts[1])
    const z = parseFloat(parts[2])
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return
    ensureCapacity(1)
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
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    onProgress?.(bytesRead, file.size)
    const text = leftover + decoder.decode(value, { stream: true })
    const lines = text.split('\n')
    leftover = lines.pop() ?? ''
    for (const line of lines) processLine(line)
  }
  if (leftover.length > 0) processLine(leftover)

  // Trim to the real count — subarray is a view (no copy), so the actual
  // over-allocated buffer stays retained for the object's lifetime; a
  // known, deliberate memory-vs-simplicity tradeoff for a one-off import,
  // not revisited unless it proves a real problem in practice.
  return {
    positions: positions.subarray(0, count * 3),
    colors: colors.subarray(0, count * 3),
    count,
  }
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

export class PointCloudIndex {
  readonly cellSize: number
  private readonly cellToIndices = new Map<number, number[]>()
  private readonly cloud: PointCloudData

  constructor(cloud: PointCloudData, cellSize: number) {
    this.cloud = cloud
    this.cellSize = cellSize
    const { positions, count } = cloud
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const key = this.cellKey(positions[i3], positions[i3 + 1], positions[i3 + 2])
      let bucket = this.cellToIndices.get(key)
      if (!bucket) { bucket = []; this.cellToIndices.set(key, bucket) }
      bucket.push(i)
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

    const { positions } = this.cloud
    let found = 0
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        for (let cz = minCellZ; cz <= maxCellZ; cz++) {
          const key = ((cx + AXIS_OFFSET) * AXIS_BASE + (cy + AXIS_OFFSET)) * AXIS_BASE + (cz + AXIS_OFFSET)
          const bucket = this.cellToIndices.get(key)
          if (!bucket) continue
          for (const i of bucket) {
            const i3 = i * 3
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
  for (let i = 0; i < cloud.count; i += stride) {
    const i3 = i * 3
    const o3 = out * 3
    positions[o3] = cloud.positions[i3]
    positions[o3 + 1] = cloud.positions[i3 + 1]
    positions[o3 + 2] = cloud.positions[i3 + 2]
    // THREE.Color expects 0-1 float components, not the source's 0-255 —
    // vertex colours read straight from the geometry attribute otherwise
    // render far too bright/clipped.
    colors[o3] = cloud.colors[i3] / 255
    colors[o3 + 1] = cloud.colors[i3 + 1] / 255
    colors[o3 + 2] = cloud.colors[i3 + 2] / 255
    out += 1
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({ size: 0.02, vertexColors: true, sizeAttenuation: true })
  return new THREE.Points(geometry, material)
}

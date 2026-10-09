import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export interface ClashGeometry { positions: number[]; indices: number[] }
export interface ClashSnapshotElement { key: string; meshes: ClashGeometry[] }
export interface GeometryHit { a: string; b: string; distanceMm: number | null; point: [number, number, number] }
export interface GeometryResult { hits: GeometryHit[]; warnings: string[] }
const identity = new THREE.Matrix4()

function build(data: ClashGeometry) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
  geometry.setIndex(data.indices)
  geometry.computeBoundingBox()
  const bvh = new MeshBVH(geometry)
  // Weld duplicated face vertices before checking edge incidence. A bounding box
  // alone is never treated as a solid; open surfaces receive no inside/outside claim.
  const edges = new Map<string, number>()
  const vertices = new Map<string, number>()
  const ids: number[] = []
  const parent: number[] = []
  const representatives: THREE.Vector3[] = []
  const epsilon = Math.max(1e-9, geometry.boundingBox!.getSize(new THREE.Vector3()).length() * 1e-8)
  for (let i = 0; i < data.positions.length; i += 3) {
    const key = data.positions.slice(i, i + 3).map(v => Math.round(v / epsilon)).join(',')
    let id = vertices.get(key)
    if (id === undefined) { id = vertices.size; vertices.set(key, id); parent.push(id); representatives.push(new THREE.Vector3(...data.positions.slice(i, i + 3) as [number, number, number])) }
    ids.push(id)
  }
  const root = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  let degenerate = false
  for (let i = 0; i < data.indices.length; i += 3) {
    const triangle = data.indices.slice(i, i + 3).map(j => ids[j])
    if (new Set(triangle).size !== 3) { degenerate = true; continue }
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3]
      parent[root(a)] = root(b)
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  const samples = representatives.filter((_, i) => root(i) === i)
  return { geometry, bvh, box: geometry.boundingBox!, closed: !degenerate && edges.size > 0 && [...edges.values()].every(n => n === 2), samples, epsilon }
}
type Built = ReturnType<typeof build>
function contains(solid: Built, points: THREE.Vector3[]) {
  if (!solid.closed) return false
  const directions = [new THREE.Vector3(1, .371, .529).normalize(), new THREE.Vector3(.217, 1, .413).normalize(), new THREE.Vector3(.319, .271, 1).normalize()]
  return points.some(point => {
    if (!solid.box.containsPoint(point)) return false
    let votes = 0
    for (const direction of directions) {
      const hits = solid.bvh.raycast(new THREE.Ray(point, direction), THREE.DoubleSide).map(h => h.distance).sort((a, b) => a - b)
      if (hits.some(d => d < solid.epsilon)) return true
      const unique = hits.filter((d, i) => i === 0 || d - hits[i - 1] > solid.epsilon)
      if (unique.length % 2) votes++
    }
    return votes >= 2
  })
}

export function computeClashes(elements: ClashSnapshotElement[], aKeys: string[], bKeys: string[], kind: 'hard' | 'clearance', toleranceMm: number, metresPerUnit = 1, progress?: (done: number, total: number) => void): GeometryResult {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0 || !Number.isFinite(metresPerUnit) || metresPerUnit <= 0) throw new Error('Invalid clash tolerance or scene units')
  const gap = toleranceMm / (1000 * metresPerUnit)
  const built = new Map<string, { parts: Built[]; box: THREE.Box3 }>()
  const warnings: string[] = []
  try {
    for (const el of elements) {
      const parts = el.meshes.map(build)
      built.set(el.key, { parts, box: parts.reduce((box, p) => box.union(p.box), new THREE.Box3()) })
      if (parts.some(p => !p.closed)) warnings.push(`${el.key}: open/non-manifold mesh; surface intersections tested, containment requires a closed enclosing mesh.`)
    }
    const orderedB = [...new Set(bKeys)].map(key => ({ key, ...built.get(key)! })).sort((a, b) => a.box.min.x - b.box.min.x)
    const seen = new Set<string>()
    const hits: GeometryHit[] = []
    const uniqueA = [...new Set(aKeys)]
    for (let i = 0; i < uniqueA.length; i++) {
      const aKey = uniqueA[i], a = built.get(aKey)!
      const expanded = a.box.clone().expandByScalar(kind === 'clearance' ? gap : 0)
      for (const b of orderedB) {
        if (b.box.min.x > expanded.max.x) break
        if (b.key === aKey || b.box.max.x < expanded.min.x || !expanded.intersectsBox(b.box)) continue
        const pair = [aKey, b.key].sort(), pairKey = JSON.stringify(pair)
        if (seen.has(pairKey)) continue
        seen.add(pairKey)
        let distance = Infinity
        let point = a.box.clone().intersect(b.box).getCenter(new THREE.Vector3())
        for (const ap of a.parts) for (const bp of b.parts) {
          if (!ap.box.clone().expandByScalar(kind === 'clearance' ? gap : 0).intersectsBox(bp.box)) continue
          if (ap.bvh.intersectsGeometry(bp.geometry, identity) || contains(ap, bp.samples) || contains(bp, ap.samples)) {
            distance = 0
            // Coplanar triangles do not have a unique contact point. Use a stable
            // approximate marker rather than the BVH's undefined coplanar edge.
            point = ap.box.clone().intersect(bp.box).getCenter(new THREE.Vector3())
            break
          }
          if (kind === 'clearance') {
            const closest = ap.bvh.closestPointToGeometry(bp.geometry, identity, undefined, undefined, 0, gap)
            // maxThreshold prunes bounds, but a leaf can still yield a larger distance.
            if (closest && closest.distance <= gap && closest.distance < distance) { distance = closest.distance; point = closest.point.clone() }
          }
        }
        if (distance !== Infinity) hits.push({ a: pair[0], b: pair[1], distanceMm: kind === 'hard' ? null : distance * 1000 * metresPerUnit, point: point.toArray() as [number, number, number] })
      }
      progress?.(i + 1, uniqueA.length)
    }
    return { hits, warnings: warnings.slice(0, 100) }
  } finally {
    for (const e of built.values()) for (const part of e.parts) part.geometry.dispose()
  }
}

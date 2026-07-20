import * as THREE from 'three'
import type { IfcUnitDisplay } from './ifcUnitDisplay'
import type { MeasurementKind, MeasurementPoint } from './measurements'

// Pure geometry math for the Measure tool (2026-07-19) — kept separate from
// MeasurementGizmo.tsx's own click-handling/React glue the same way
// sceneClash.ts/sectionBoxGeometry.ts already split their own math out from
// their gizmo components.
//
// Every function here takes scene-space points/meshes and a toMetres factor
// (ifcModel.ts's getLengthUnitToMetres — the source IFC file's own
// LENGTHUNIT, defaulting to 1 for a plain mesh import with no declared
// unit at all) and returns a real metre/m² number — see measurement.py's
// own model docstring for why a measurement is the one feature in this app
// that doesn't skip that conversion.

export function distanceMetres(a: MeasurementPoint, b: MeasurementPoint, toMetres: number): number {
  const dx = (a.x - b.x) * toMetres
  const dy = (a.y - b.y) * toMetres
  const dz = (a.z - b.z) * toMetres
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export interface FacePatchResult {
  areaMetres: number
  // Scene-space, same "opaque array the frontend owns" convention every
  // other Measurement points array already uses — the patch's own real
  // outer boundary (traced from actual mesh edges, not a convex hull — see
  // this function's own header for why that distinction matters for a
  // non-convex or holed face).
  outlinePointsScene: MeasurementPoint[]
  // Every other closed boundary loop found inside the patch (2026-07-19,
  // per Maro: "can it detect and exclude the voids?") — a real opening
  // (window/duct/etc. cut into a slab) has no triangles under it at all, so
  // areaMetres above is already net of every hole simply because there's
  // nothing there to sum; this is purely the extra loops needed to *draw*
  // each hole's own outline too, not something the area math needs.
  holeLoopsScene: MeasurementPoint[][]
}

// How close two triangles' own face normals need to be (as a dot product)
// to count as "the same flat face" (2026-07-19) — compared against the
// clicked (seed) triangle's own normal, not neighbour-to-neighbour, so a
// gently curved surface (e.g. a faceted cylinder) stops at a real angle
// change instead of slowly drifting all the way around it one small step
// at a time. ~5 degrees: tight enough to stop at a real corner/edge, loose
// enough to absorb ordinary export-tessellation noise on a nominally flat
// face.
const FACE_NORMAL_DOT_THRESHOLD = 0.996

// "Click a surface, get its area" (2026-07-19, per Maro: "maybe i can also
// click element surfaces and it gives me the area") — flood-fills every
// triangle connected to the clicked one that shares (within tolerance) its
// own face normal, entirely in world space (mesh.matrixWorld applied to
// every vertex up front) so the area is correct even under non-uniform
// scale without a separate normal-matrix correction. Requires indexed
// geometry — web-ifc's own exported meshes always are, so this only ever
// returns null for a hand-authored non-indexed mesh import, an edge case
// worth surfacing as "can't measure this" rather than silently guessing.
export function measureFacePatch(mesh: THREE.Mesh, seedFaceIndex: number, toMetres: number): FacePatchResult | null {
  const geometry = mesh.geometry
  const index = geometry.index
  const position = geometry.attributes.position
  if (!index || !position) return null
  const triCount = index.count / 3
  if (seedFaceIndex < 0 || seedFaceIndex >= triCount) return null

  const worldPositions: THREE.Vector3[] = []
  for (let i = 0; i < position.count; i++) {
    worldPositions.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
  }

  // Weld tolerance for adjacency purposes only (2026-07-19 fix, per Maro:
  // "look at this nonsense" — flood fill was still stopping at essentially
  // one triangle on a completely different element than last time, so the
  // earlier winding fix wasn't the real root cause). Real IFC/BIM
  // tessellation routinely emits UNWELDED geometry — every triangle gets
  // its own independent 3 vertex slots in the buffer, even where it
  // physically touches a neighbouring triangle at the exact same point, no
  // shared index at all. Matching adjacency by raw vertex index (as
  // before) found zero neighbours on data like that — two triangles
  // touching at the same real-world point but each owning their own copy
  // of that point never registered as adjacent, so the flood fill could
  // never expand past the seed triangle on ANY mesh built this way. Keying
  // the adjacency map by rounded real-world position instead (1mm
  // tolerance, converted to this mesh's own raw scene units via toMetres)
  // finds the true neighbours regardless of whether the buffer itself
  // shares indices — the same "weld by proximity" approach any mesh
  // pipeline uses to fix unwelded data.
  const eps = 0.001 / toMetres
  const posKey = (v: THREE.Vector3) => `${Math.round(v.x / eps)}_${Math.round(v.y / eps)}_${Math.round(v.z / eps)}`

  const triVerts: [number, number, number][] = []
  const triNormals: THREE.Vector3[] = []
  const triAreas: number[] = []
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const edgeToTris = new Map<string, number[]>()
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2)
    triVerts.push([a, b, c])
    const va = worldPositions[a], vb = worldPositions[b], vc = worldPositions[c]
    const cr = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va))
    triAreas.push(0.5 * cr.length())
    triNormals.push(cr.lengthSq() > 0 ? cr.normalize() : new THREE.Vector3(0, 0, 1))
    const keyA = posKey(va), keyB = posKey(vb), keyC = posKey(vc)
    for (const [p, q] of [[keyA, keyB], [keyB, keyC], [keyC, keyA]] as [string, string][]) {
      const key = edgeKey(p, q)
      const list = edgeToTris.get(key)
      if (list) list.push(t)
      else edgeToTris.set(key, [t])
    }
  }

  const seedNormal = triNormals[seedFaceIndex]
  const visited = new Set<number>([seedFaceIndex])
  const queue = [seedFaceIndex]
  while (queue.length > 0) {
    const t = queue.pop()!
    const [a, b, c] = triVerts[t]
    const keyA = posKey(worldPositions[a]), keyB = posKey(worldPositions[b]), keyC = posKey(worldPositions[c])
    for (const [p, q] of [[keyA, keyB], [keyB, keyC], [keyC, keyA]] as [string, string][]) {
      for (const neighbour of edgeToTris.get(edgeKey(p, q)) ?? []) {
        if (visited.has(neighbour)) continue
        // Math.abs, not a plain signed dot (2026-07-19 fix, per Maro: "area
        // by face is still producing silly triangles") — real IFC/Revit
        // exports routinely triangulate a nominally flat face with
        // inconsistent winding order from one triangle to the next (a
        // common, harmless export quirk, not a modelling error), which
        // flips that triangle's cross-product normal to point the opposite
        // way even though it's genuinely coplanar. A signed comparison
        // treated that flip as "a different face" and stopped the flood
        // fill dead at the first inconsistently-wound triangle, capturing
        // only a tiny sliver instead of the real face. Two triangles that
        // are anti-parallel because of winding, not because they're
        // actually opposite faces (e.g. a slab's top vs. underside), are
        // never edge-adjacent in a normal solid mesh anyway — top/bottom
        // only connect via the perimeter's side faces — so this can't
        // accidentally bridge across a real physical edge the way it might
        // first seem.
        if (Math.abs(triNormals[neighbour].dot(seedNormal)) < FACE_NORMAL_DOT_THRESHOLD) continue
        visited.add(neighbour)
        queue.push(neighbour)
      }
    }
  }

  let areaScene = 0
  for (const t of visited) areaScene += triAreas[t]

  // Real boundary tracing (2026-07-19, replacing an earlier convex-hull
  // outline, per Maro: "can it detect and exclude the voids?" — a hull by
  // definition paints over any concave notch or hole, so it could never
  // have shown either correctly). A boundary edge of the patch is one used
  // by exactly one of the patch's own triangles — same position-keyed edge
  // map already built above, just counted only across `visited` triangles
  // this time, so an edge shared between two DIFFERENT visited triangles
  // (a true interior edge) is correctly excluded, and one where the other
  // side belongs to a triangle that never got flood-filled in (outside the
  // patch entirely, OR the inner edge of a hole with nothing on its far
  // side) correctly counts as boundary either way.
  const keyToPosition = new Map<string, THREE.Vector3>()
  const boundaryAdjacency = new Map<string, Set<string>>()
  const localEdgeCount = new Map<string, number>()
  for (const t of visited) {
    const [a, b, c] = triVerts[t]
    const keyA = posKey(worldPositions[a]), keyB = posKey(worldPositions[b]), keyC = posKey(worldPositions[c])
    keyToPosition.set(keyA, worldPositions[a])
    keyToPosition.set(keyB, worldPositions[b])
    keyToPosition.set(keyC, worldPositions[c])
    for (const [p, q] of [[keyA, keyB], [keyB, keyC], [keyC, keyA]] as [string, string][]) {
      const key = edgeKey(p, q)
      localEdgeCount.set(key, (localEdgeCount.get(key) ?? 0) + 1)
    }
  }
  for (const t of visited) {
    const [a, b, c] = triVerts[t]
    const keyA = posKey(worldPositions[a]), keyB = posKey(worldPositions[b]), keyC = posKey(worldPositions[c])
    for (const [p, q] of [[keyA, keyB], [keyB, keyC], [keyC, keyA]] as [string, string][]) {
      if ((localEdgeCount.get(edgeKey(p, q)) ?? 0) !== 1) continue
      if (!boundaryAdjacency.has(p)) boundaryAdjacency.set(p, new Set())
      if (!boundaryAdjacency.has(q)) boundaryAdjacency.set(q, new Set())
      boundaryAdjacency.get(p)!.add(q)
      boundaryAdjacency.get(q)!.add(p)
    }
  }

  // Undirected loop tracing, not a directed half-edge chain — the abs()
  // winding-tolerance fix above means triangles inside one patch can have
  // inconsistent winding, so there's no single consistent direction to
  // chain a boundary edge by; a clean manifold boundary vertex always has
  // exactly 2 boundary neighbours regardless of winding, so just walking
  // "the other one" each step traces a proper closed loop either way.
  const visitedVertexKeys = new Set<string>()
  const loops: string[][] = []
  for (const start of boundaryAdjacency.keys()) {
    if (visitedVertexKeys.has(start)) continue
    const loop: string[] = [start]
    visitedVertexKeys.add(start)
    let previous: string | null = null
    let current = start
    for (let guard = 0; guard < boundaryAdjacency.size + 1; guard++) {
      const neighbours = [...(boundaryAdjacency.get(current) ?? [])]
      const next = neighbours.find(n => n !== previous) ?? neighbours[0]
      if (next === undefined || next === start) break
      loop.push(next)
      visitedVertexKeys.add(next)
      previous = current
      current = next
    }
    if (loop.length >= 3) loops.push(loop)
  }

  // Each loop's own signed area in the seed plane's 2D basis — ranks which
  // one is the real outer boundary (always the largest, since every hole
  // sits strictly inside it) vs. every hole.
  const origin = worldPositions[triVerts[seedFaceIndex][0]]
  const uAxis = new THREE.Vector3().subVectors(worldPositions[triVerts[seedFaceIndex][1]], origin).normalize()
  const vAxis = new THREE.Vector3().crossVectors(seedNormal, uAxis).normalize()
  const toPoint = (key: string): MeasurementPoint => {
    const p = keyToPosition.get(key)!
    return { x: p.x, y: p.y, z: p.z }
  }
  const projectedArea = (loop: string[]) => {
    const pts = loop.map(key => {
      const rel = new THREE.Vector3().subVectors(keyToPosition.get(key)!, origin)
      return { u: rel.dot(uAxis), v: rel.dot(vAxis) }
    })
    let sum = 0
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length]
      sum += p1.u * p2.v - p2.u * p1.v
    }
    return Math.abs(sum) / 2
  }

  const loopsByArea = loops.map(loop => ({ loop, area: projectedArea(loop) })).sort((a, b) => b.area - a.area)
  const outlinePointsScene = (loopsByArea[0]?.loop ?? []).map(toPoint)
  const holeLoopsScene = loopsByArea.slice(1).map(({ loop }) => loop.map(toPoint))

  return { areaMetres: areaScene * toMetres * toMetres, outlinePointsScene, holeLoopsScene }
}

// How close the cursor needs to be, in screen pixels, to a candidate
// vertex/edge before it wins over the raw raycast hit point (2026-07-19,
// per Maro: "I need points to snap to element points edges corners. learn
// from blender" — Blender's own Measure tool snaps by cursor proximity in
// screen space, not a fixed real-world distance, so the same corner is
// easy to hit whether the camera is close or far away). ~20px matches
// Blender's own typical vertex-snap radius.
const SNAP_PIXEL_RADIUS = 20

function worldToScreenPx(point: THREE.Vector3, camera: THREE.Camera, viewportWidth: number, viewportHeight: number) {
  const ndc = point.clone().project(camera)
  return { x: (ndc.x * 0.5 + 0.5) * viewportWidth, y: (-ndc.y * 0.5 + 0.5) * viewportHeight }
}

// Snaps a clicked point to the nearest vertex, or failing that the nearest
// point along an edge, ANYWHERE in the clicked mesh (2026-07-19 fix, per
// Maro: "the white ring is glitchy, its simply not detecting the corners" —
// the original version only checked the 3 vertices/edges of whichever one
// triangle the raycast happened to hit; a flat rectangular face is almost
// always 2 triangles split by a diagonal, so 2 of its 4 real corners sit on
// the *other* triangle and were silently never checked at all depending on
// which side of the diagonal the cursor landed on — that's exactly the
// "flickers as you cross the diagonal, misses half the corners" symptom).
// Scans every vertex/edge in the mesh's own geometry instead — a real,
// known cost (same "accept it for now, revisit if a genuinely huge single
// element makes it slow" tradeoff this codebase already makes elsewhere,
// e.g. materializeAll), but bounded to one BIM element's own geometry, not
// the whole scene, so it's the same order of cost measureFacePatch already
// pays on every click. Returns null (no snap, caller keeps the raw raycast
// hit point) when nothing is within SNAP_PIXEL_RADIUS — Blender's own ruler
// falls back to a freeform point the same way when nothing is close enough.
export function findSnapPoint(
  object: THREE.Mesh, camera: THREE.Camera,
  cursorPx: { x: number; y: number }, viewportWidth: number, viewportHeight: number,
): MeasurementPoint | null {
  const geometry = object.geometry
  const index = geometry.index
  const position = geometry.attributes.position
  if (!index || !position) return null
  const triCount = index.count / 3

  const screenDistance = (p: THREE.Vector3) => {
    const s = worldToScreenPx(p, camera, viewportWidth, viewportHeight)
    return Math.hypot(s.x - cursorPx.x, s.y - cursorPx.y)
  }

  const worldPositions: THREE.Vector3[] = []
  for (let i = 0; i < position.count; i++) {
    worldPositions.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld))
  }

  let best: { point: THREE.Vector3; distance: number } | null = null
  for (const v of worldPositions) {
    const d = screenDistance(v)
    if (d <= SNAP_PIXEL_RADIUS && (!best || d < best.distance)) best = { point: v, distance: d }
  }

  // Every unique edge across the whole mesh, deduped (each internal edge is
  // shared by 2 triangles) — same edgeKey convention measureFacePatch uses.
  const seenEdges = new Set<string>()
  for (let t = 0; t < triCount; t++) {
    const ids: [number, number, number] = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as [number, number][]) {
      const a = ids[i], b = ids[j]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      const p1 = worldPositions[a], p2 = worldPositions[b]
      // Nearest point on the edge found in SCREEN space (project both
      // endpoints, find the closest parameter t along that 2D segment to
      // the cursor), then that same t is applied back to the real 3D edge
      // — an approximation (perspective projection isn't perfectly linear
      // in t), but a standard, visually-correct one: what you see as
      // "closest along this edge" on screen is what gets picked.
      const s1 = worldToScreenPx(p1, camera, viewportWidth, viewportHeight)
      const s2 = worldToScreenPx(p2, camera, viewportWidth, viewportHeight)
      const dx = s2.x - s1.x, dy = s2.y - s1.y
      const lenSq = dx * dx + dy * dy
      let tt = lenSq > 0 ? ((cursorPx.x - s1.x) * dx + (cursorPx.y - s1.y) * dy) / lenSq : 0
      tt = Math.max(0, Math.min(1, tt))
      const edgePoint = p1.clone().lerp(p2, tt)
      const d = screenDistance(edgePoint)
      if (d <= SNAP_PIXEL_RADIUS && (!best || d < best.distance)) best = { point: edgePoint, distance: d }
    }
  }

  return best ? { x: best.point.x, y: best.point.y, z: best.point.z } : null
}

// Display formatting for an already-real-metres Measurement.value (2026-07-19)
// — deliberately its own small function rather than reusing
// ifcUnitDisplay.ts's toDisplayLength: that one converts a *raw model-space*
// length using one specific model's own declared unit, but value here has
// already been normalized to real metres regardless of source model (see
// measurement.py's own docstring), so there's no per-model unit left to
// detect — 'auto' has nothing to fall back to and is treated as metric.
export function formatMeasurementValue(kind: MeasurementKind, valueMetres: number, preference: IfcUnitDisplay): string {
  const imperial = preference === 'imperial'
  if (kind === 'length') {
    const v = imperial ? valueMetres / 0.3048 : valueMetres
    return `${v.toFixed(2)} ${imperial ? 'ft' : 'm'}`
  }
  const v = imperial ? valueMetres / (0.3048 * 0.3048) : valueMetres
  return `${v.toFixed(2)} ${imperial ? 'ft²' : 'm²'}`
}

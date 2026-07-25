import * as THREE from 'three'
import { captureBaseline, captureOriginalGeometry, captureOriginalMaterial } from './elementBaseline'

// Split out of ifcModel.ts (2026-07-17) specifically so Viewport3D.tsx can
// import ensureMaterialized statically without pulling 'web-ifc' into the
// main bundle — ifcModel.ts's own header explains why that matters (~2.95MB
// -> 6.6MB when it briefly leaked in). Everything in this file is plain
// three.js manipulation with zero web-ifc dependency, so it's safe and
// cheap for Viewport3D.tsx to import directly at the top, unlike ifcModel.ts
// itself (which Viewport3D.tsx only ever reaches via a type-only import +
// dynamic import() inside the one effect that actually needs it).

export interface BatchInstanceInfo {
  geometryId: number
  instanceId: number
  color: THREE.Color
  colorAlpha: number
  matrix: THREE.Matrix4
}

// One shared THREE.BatchedMesh carries every element in the file (2026-07-17,
// per Maro: "improve the original Prosota web version... the recommended
// strong fix" — the root cause this whole module was originally diagnosed
// for: one THREE.Mesh + one unique THREE.MeshStandardMaterial per element
// means element count directly becomes draw-call count).
//
// Originally scoped to only *repeated* geometry (e.g. typical fasteners/
// members reused via IfcMappedItem) — broadened to *every* element
// (2026-07-21, per Maro, after the repeated-only version made no measurable
// difference against real combined multi-discipline files: a real building's
// actual schedulable elements — walls, beams, slabs, ducts — are almost all
// *unique* geometry, so the repeated-only net only ever caught a small
// minority of fasteners/brackets, never the elements a construction schedule
// actually sequences. THREE.BatchedMesh doesn't require repeated geometry —
// adding N different geometries, each with its own single instance, gets the
// exact same draw-call consolidation). Anything with a mirrored (negative-
// determinant) placement still keeps the individual THREE.Mesh path
// unconditionally (ifcModel.ts's own loadIfcModel — BatchedMesh.setMatrixAt
// explicitly doesn't support negative scale), so every existing per-element
// feature needs zero changes for it. A batched element only ever costs a
// real THREE.Mesh the moment something actually needs to touch it
// individually — see ensureMaterialized below, the one primitive every
// feature that needs a specific expressID's real Object3D calls before
// manipulating it.
export interface BatchState {
  mesh: THREE.BatchedMesh
  // An array, not a single BatchInstanceInfo — one expressID can carry more
  // than one placed geometry piece (a real, documented pattern in this
  // codebase — see elementSplitTargets.ts's own "31 truss members, one
  // wall/beam" comment), and if two or more of those pieces both happen to
  // be repeated-geometry (batched), a single-slot map would silently drop
  // every piece but the last one added, leaving earlier pieces' batch
  // instances orphaned (still rendering, but unreachable — a real,
  // concrete duplicate-geometry bug, not a hypothetical one).
  byExpressId: Map<number, BatchInstanceInfo[]>
  // The reverse of byExpressId — Viewport3D.tsx's raycast hit resolution
  // gets an instanceId back from THREE.BatchedMesh.raycast's own
  // intersection.batchId, and needs to go the other way, from "which
  // instance got hit" to "which IFC element is that". One instanceId is
  // always exactly one specific piece, so this direction stays 1:1.
  expressIdByInstanceId: Map<number, number>
  // Keyed by web-ifc's own geometryExpressID, not our synthetic geometryId
  // — getExpressIdWorldBounds needs to go from "which instance" back to
  // "which shape" to compute a world-space bounding box without
  // materializing anything.
  geometryByIfcId: Map<number, { geometry: THREE.BufferGeometry; geometryId: number }>
  // Keyed by THREE.BatchedMesh's own synthetic geometryId (the id
  // `batchedMesh.addGeometry()` returns) — 2026-07-21 perf fix, per Maro:
  // "generating the 4D link... literally cripples the platform" for real
  // multi-file models. ensureMaterialized used to find a batched instance's
  // source geometry by scanning every entry of geometryByIfcId.values()
  // looking for a matching geometryId — an O(n) scan, per instance, on top
  // of the O(n) traverse this whole file's other fix (the expressID mesh
  // index below) already went after. Built once alongside geometryByIfcId
  // in ifcModel.ts's loadIfcModel (same geometryId, just the other key),
  // turning that scan into an O(1) lookup too.
  geometryById: Map<number, THREE.BufferGeometry>
}

// Every element that's a real, individual THREE.Mesh right now — whether it
// was never batched (unique geometry, placed directly in loadIfcModel's Pass
// 3) or was pulled out of the batch later by ensureMaterialized — kept on
// rootObject.userData so any caller with just an Object3D reference can reach
// it (same idiom as userData.batch itself). 2026-07-21 perf fix, per Maro:
// ensureMaterialized used to answer "is this expressID already materialized?"
// by calling rootObject.traverse() — a walk of the *entire* model's object
// graph — on every single call. Schedule generation
// (ifcScheduleExtraction.ts) calls ensureMaterialized once per candidate
// schedulable element (thousands, for a real building), making that a
// genuinely O(n²) cost in element count — confirmed as the actual mechanism
// behind "generating the 4D link... cripples the platform" for real
// multi-discipline files. finalizeIndividualMesh (below) is the one place a
// mesh becomes real either way, so registering it there is the single choke
// point that keeps this index complete without any other call site needing
// to know it exists.
function getMeshIndex(rootObject: THREE.Object3D): Map<number, THREE.Mesh[]> {
  let index = rootObject.userData.expressIdMeshIndex as Map<number, THREE.Mesh[]> | undefined
  if (!index) {
    index = new Map()
    rootObject.userData.expressIdMeshIndex = index
  }
  return index
}

// Whether this expressID actually has real, placeable geometry — either
// still in the shared batch, or already an individual mesh (2026-07-21,
// per Maro: "select from spatial/class select and it turned up empty
// everytime" on a real hotel model, but "works fine when i click directly
// in viewport" — that contrast is the tell. A raycast click can only ever
// land on something that's actually rendered; IfcDataPanel.tsx's own
// storey/class selectors instead read straight off the IFC data model
// (getSpatialStructure's tree, GetLineIDsWithType) and can name entities
// that were never placeable at all — an IfcCurtainWall is routinely just a
// semantic container in a real Revit export, with zero geometry of its
// own; the actual visible mullions/glazing are separate IfcMember/IfcPlate
// elements underneath it (already discovered and worked around once
// before in this exact codebase — see ifcScheduleExtraction.ts's own
// isCurtainWallMember/CURTAIN_WALL_NAME_KEYWORDS header). Selecting a
// geometry-less expressID and then hitting Isolate hides literally
// everything else with nothing of its own to show in exchange — the empty
// viewport this was reported against. Every expressID with real geometry
// ends up in exactly one of these two places at import time (ifcModel.ts's
// loadIfcModel Pass 3: the shared batch for a non-mirrored placement,
// finalizeIndividualMesh's own getMeshIndex registration for the mirrored-
// fallback path) — neither ever gets an entry for one that never had
// placed geometry to begin with, so this is a direct, complete check, not
// a heuristic.
export function hasGeometry(rootObject: THREE.Object3D, expressID: number): boolean {
  const batch = rootObject.userData.batch as BatchState | null | undefined
  if (batch?.byExpressId.has(expressID)) return true
  const meshIndex = rootObject.userData.expressIdMeshIndex as Map<number, THREE.Mesh[]> | undefined
  return meshIndex?.has(expressID) ?? false
}

export function buildElementMaterial(color: { x: number; y: number; z: number; w: number }): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color.x, color.y, color.z),
    transparent: color.w < 1,
    opacity: color.w,
    side: THREE.DoubleSide,
  })
}

export function finalizeIndividualMesh(mesh: THREE.Mesh, expressID: number, matrix: THREE.Matrix4, group: THREE.Object3D) {
  mesh.applyMatrix4(matrix)
  mesh.userData.expressID = expressID
  // Registers into getMeshIndex's own map — see that function's header.
  // Runs here rather than at each of this function's two call sites (initial
  // load's Pass 3, and ensureMaterialized's batch pull-out below) so neither
  // has to separately remember to do it.
  const index = getMeshIndex(group)
  const existing = index.get(expressID)
  if (existing) existing.push(mesh); else index.set(expressID, [mesh])
  // Its real placement within the model, not 0/0/0 — captured here, right
  // after applyMatrix4 decomposes the placement matrix into this mesh's
  // own local position/rotation/scale, so TransformPanel.tsx's
  // hover-Backspace reset can snap a hand-edited field back to what this
  // element actually started at (2026-07-09, per Maro — see
  // elementBaseline.ts's own header for the full story).
  captureBaseline(mesh)
  // The element's own real colour — captured so clearing a manual texture
  // override later can actually restore it, instead of leaving the
  // last-applied override showing forever (2026-07-09, per Maro: "when i
  // change the material and delete the material, it doesn't actually go
  // back to the default").
  captureOriginalMaterial(mesh)
  // 2026-07-11, per Maro — see geometrySubdivision.ts's own header:
  // Viewport3D.tsx swaps mesh.geometry to a subdivided copy whenever
  // displacement mapping + a subdivision level are active on this element,
  // and needs this snapshot to swap back to whenever they aren't.
  captureOriginalGeometry(mesh)
  group.add(mesh)
}

// Takes the model's root Object3D directly (not the full IfcModelHandle) —
// `rootObject.userData.batch` is set at import time by ifcModel.ts's own
// loadIfcModel, the same userData-threading idiom this module family
// already uses for expressID/sceneObjectId/standardMaterial, so any caller
// that already has a reference to the model's root (Viewport3D.tsx's
// handleClick, in particular, which only ever deals in Object3D refs walked
// up an e.object.parent chain) can call this without needing the
// IfcModelHandle itself, or a heavy import of ifcModel.ts/web-ifc.
//
// Idempotent and safe to call unconditionally: returns the (first, if
// several) existing mesh if this element was already individual (unique
// geometry, or a previously-materialized batched one), materializes every
// batched piece belonging to this expressID out of the shared batch on
// first touch otherwise (see BatchState.byExpressId's own header — one
// expressID can genuinely own more than one piece), or returns null if
// expressID isn't a real geometry-bearing element (or this root has no
// batch at all). Deliberately permanent, not a pop-back-into-the-batch-
// when-deselected round trip — the whole point of batching is the bulk of
// a real file that nobody ever individually touches in a given session; a
// handful of elements a user actually selects/edits/animates becoming
// ordinary meshes for the rest of that session is a non-issue, and
// round-tripping would add real complexity (re-syncing every edit back
// into the batch's per-instance matrix/colour) for no real benefit.
export function ensureMaterialized(rootObject: THREE.Object3D, expressID: number): THREE.Mesh | null {
  // O(1) index lookup, not a full-model traverse (2026-07-21 perf fix) —
  // see getMeshIndex's own header for the real, measured cost this used to
  // have at schedule-generation scale.
  const existing = getMeshIndex(rootObject).get(expressID)
  if (existing && existing.length > 0) return existing[0]

  const batch = rootObject.userData.batch as BatchState | null | undefined
  const infos = batch?.byExpressId.get(expressID)
  if (!batch || !infos || infos.length === 0) return null

  let firstMesh: THREE.Mesh | null = null
  for (const info of infos) {
    batch.mesh.setVisibleAt(info.instanceId, false)
    // Also pulls this instance out of the batched-edges overlay, if one is
    // currently built (2026-07-25 — see buildEdgesBatch's own header) — an
    // O(1) swap-remove, not a rebuild, so a click-driven materialization (the
    // common case, per this function's own header) stays cheap even with
    // Edges on. Left as an orphaned, no-longer-referenced instance otherwise:
    // the individual mesh created just below gets its own real EdgesGeometry
    // overlay from Viewport3D.tsx's per-mesh pass, same as any other
    // never-batched element — leaving this one in the edges batch too would
    // double-draw its outline at its old (frozen) position forever, visibly
    // wrong the moment this element is later moved.
    removeFromEdgesBatch(rootObject, info)

    // O(1) via geometryById (2026-07-21 perf fix) — this used to scan every
    // entry of geometryByIfcId.values() looking for a matching geometryId,
    // an O(n) cost per instance on top of the traverse fixed above.
    const sourceGeometry = batch.geometryById.get(info.geometryId)
    if (!sourceGeometry) continue

    // Cloned, not shared with the cache entry — every other existing
    // per-mesh code path (subdivision swap, dispose-on-unload) assumes it
    // exclusively owns mesh.geometry; sharing the same BufferGeometry
    // object across N materialized instances of the same repeated shape
    // would work for plain rendering but silently violate that assumption
    // the moment any one of them gets individually modified or disposed.
    const geometry = sourceGeometry.clone()
    const mesh = new THREE.Mesh(geometry, buildElementMaterial({ x: info.color.r, y: info.color.g, z: info.color.b, w: info.colorAlpha }))
    finalizeIndividualMesh(mesh, expressID, info.matrix, rootObject)
    batch.expressIdByInstanceId.delete(info.instanceId)
    firstMesh = firstMesh ?? mesh
  }
  batch.byExpressId.delete(expressID)
  return firstMesh
}

// Batched Edges overlay (2026-07-25, per Maro: edges only ever worked on an
// individually-clicked/materialized element, never on the ~100%-batched bulk
// of a real file — "edge seems to not work unless i click an individual
// element" — plus "ensure to optimise as performance is very important" on
// the fix itself). THREE.BatchedMesh (the main shared batch above) can't
// carry this: it extends THREE.Mesh, and WebGLRenderer picks triangles vs.
// lines from the object's own class flags, not from geometry content — a
// BatchedMesh is always drawn as triangles, full stop, no matter what
// topology you feed addGeometry. One THREE.InstancedMesh per UNIQUE shape
// (not per placement) is the real alternative: each holds that one shape's
// own THREE.EdgesGeometry, instanced across however many times it repeats.
// For this app's own real 35k-unique-shape/265k-placement high-rise file,
// that's ~35k draw calls for the edges overlay specifically — far more than
// the model's own single BatchedMesh draw call, but a small fraction of the
// 265k a naive per-placement mesh would cost, and only paid at all while
// Edges/Hidden-Line is actually switched on (built lazily, disposed the
// instant it's switched off — see Viewport3D.tsx's own heavy-pass call
// site). thresholdAngle=15 (vs EdgesGeometry's own 1° default) deliberately
// keeps only real silhouette/crease edges, not near-planar shading noise —
// fewer line segments per shape, cheaper for every one of those ~35k draws.
// MeshBasicMaterial + wireframe:true, not LineBasicMaterial (2026-07-25 fix
// — caught live: the first real attempt used LineBasicMaterial and rendered
// as a garbled black mass, not thin edge lines). Confirmed directly in this
// project's own bundled three.js source (WebGLRenderer.js): the renderer
// picks gl.LINES vs. gl.TRIANGLES from the object's own class flags, not
// from the geometry's index topology — `object.isMesh` (true for
// InstancedMesh, same as BatchedMesh above) always draws gl.TRIANGLES
// *unless* `material.wireframe === true`, in which case it draws gl.LINES
// off the exact same index buffer instead. THREE.LineBasicMaterial has no
// real `wireframe` property at all (irrelevant to line-family objects), so
// it was always falling through to the TRIANGLES branch — reading
// EdgesGeometry's own line-index PAIRS three-at-a-time as if they were
// triangle triples, producing exactly the corrupted, overlapping mass this
// was caught against. MeshBasicMaterial's wireframe flag is the one
// documented, intentional way to get gl.LINES out of a Mesh-family object
// (InstancedMesh/BatchedMesh have no true Line-family equivalent) — the
// same underlying gl.drawElements(gl.LINES, ...) call a real
// THREE.LineSegments would make, just reached through the "isMesh" branch
// instead of the "isLine" one.
const EDGES_LINE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x1f2937, wireframe: true })
const EDGES_THRESHOLD_ANGLE = 15

export interface EdgesBatchEntry {
  mesh: THREE.InstancedMesh
  // Both directions of the same mapping — which of THIS entry's own local
  // instance slots (0..mesh.count-1) a given real batch instanceId
  // currently occupies, and the reverse. Needed for the swap-remove trick
  // removeFromEdgesBatch uses: THREE.InstancedMesh has no per-instance
  // hide, only a mutable `.count` saying how many of its instances (always
  // the first `count`) get drawn — "removing" instance N means swapping
  // whichever instance currently sits at the last active slot into N's
  // place, then shrinking count by one, an O(1) removal with no rebuild.
  localIndexByInstanceId: Map<number, number>
  instanceIdByLocalIndex: Map<number, number>
}
export interface EdgesBatch {
  entries: Map<number, EdgesBatchEntry>
}

// Built fresh every time Viewport3D.tsx's heavy pass decides the batch's
// edges overlay needs rebuilding (isolate/hide/showFaces/showEdges/
// renderMode actually changed) — see that call site for why a full rebuild
// there, rather than incremental sync, is the right cost/complexity trade:
// those are deliberate, relatively rare user actions, unlike the
// materialize-on-click path above, which genuinely needs to stay O(1).
// Only ever includes instances THREE.BatchedMesh.getVisibleAt already says
// are on screen right now (isolate/hide's own real, live verdict — see
// ModelObjects' own batched-visibility block, Viewport3D.tsx) — an
// isolated-out or hidden element gets no edges overlay instance at all,
// rather than one that then has to be hidden by some other means
// InstancedMesh doesn't cheaply support per-instance anyway.
export function buildEdgesBatch(rootObject: THREE.Object3D): EdgesBatch {
  const batch = rootObject.userData.batch as BatchState | undefined
  const entries = new Map<number, EdgesBatchEntry>()
  if (!batch) return { entries }

  const instancesByGeometryId = new Map<number, BatchInstanceInfo[]>()
  for (const infos of batch.byExpressId.values()) {
    for (const info of infos) {
      if (!batch.mesh.getVisibleAt(info.instanceId)) continue
      const arr = instancesByGeometryId.get(info.geometryId)
      if (arr) arr.push(info); else instancesByGeometryId.set(info.geometryId, [info])
    }
  }

  for (const [geometryId, infos] of instancesByGeometryId) {
    const sourceGeometry = batch.geometryById.get(geometryId)
    if (!sourceGeometry || infos.length === 0) continue
    // The shape's own real, standalone geometry (same source
    // ensureMaterialized/getExpressIdWorldBounds already read) — never the
    // shared BatchedMesh's own internal concatenated buffer, which is
    // exactly the mistake the 2026-07-19 "star burst" bug already made and
    // documented above (ModelObjects' own wantsEdges comment): that buffer
    // has every distinct shape's geometry concatenated with no per-instance
    // transform applied, so edges computed from it would overlap at one
    // shared local origin regardless of this fix.
    const edgesGeometry = new THREE.EdgesGeometry(sourceGeometry, EDGES_THRESHOLD_ANGLE)
    const mesh = new THREE.InstancedMesh(edgesGeometry, EDGES_LINE_MATERIAL, infos.length)
    mesh.userData.isEdgesBatchMesh = true
    // Purely decorative — never a raycast target (2026-07-25) — a
    // LineSegments-shaped hit test racing the real shaded mesh underneath
    // for the same click would be, at best, redundant, and at worst pick the
    // wrong thing.
    mesh.raycast = () => {}
    // No frustum culling (matches the main batch's own known-flicker-prone
    // per-object test — see loadIfcModel's own perObjectFrustumCulled
    // header) — an InstancedMesh's default aggregate-bounds test is exactly
    // as prone to the same continuous-rotation floating-point flicker for a
    // shape whose instances span a large area; not worth the risk for a
    // decorative overlay.
    mesh.frustumCulled = false
    const localIndexByInstanceId = new Map<number, number>()
    const instanceIdByLocalIndex = new Map<number, number>()
    infos.forEach((info, i) => {
      mesh.setMatrixAt(i, info.matrix)
      localIndexByInstanceId.set(info.instanceId, i)
      instanceIdByLocalIndex.set(i, info.instanceId)
    })
    mesh.instanceMatrix.needsUpdate = true
    entries.set(geometryId, { mesh, localIndexByInstanceId, instanceIdByLocalIndex })
  }
  return { entries }
}

// Disposes every entry's own EdgesGeometry (the InstancedMesh's shared
// EDGES_LINE_MATERIAL is a single module-level singleton, never owned by
// any one entry, so it's never disposed here) — does NOT remove the meshes
// from the scene graph; the caller (Viewport3D.tsx) already has the object
// references it added and is responsible for object.remove(entry.mesh) too.
export function disposeEdgesBatch(edgesBatch: EdgesBatch): void {
  for (const entry of edgesBatch.entries.values()) entry.mesh.geometry.dispose()
}

// The O(1) swap-remove ensureMaterialized calls above for every instance it
// pulls out of the main batch — a no-op (cheap: one property read, one Map
// miss) when Edges has never been toggled on this session, since
// rootObject.userData.edgesBatch simply won't exist yet.
function removeFromEdgesBatch(rootObject: THREE.Object3D, info: BatchInstanceInfo): void {
  const edgesBatch = rootObject.userData.edgesBatch as EdgesBatch | undefined
  const entry = edgesBatch?.entries.get(info.geometryId)
  if (!entry) return
  const localIndex = entry.localIndexByInstanceId.get(info.instanceId)
  if (localIndex === undefined) return
  const lastIndex = entry.mesh.count - 1
  if (localIndex !== lastIndex) {
    const lastInstanceId = entry.instanceIdByLocalIndex.get(lastIndex)!
    const tempMatrix = new THREE.Matrix4()
    entry.mesh.getMatrixAt(lastIndex, tempMatrix)
    entry.mesh.setMatrixAt(localIndex, tempMatrix)
    entry.localIndexByInstanceId.set(lastInstanceId, localIndex)
    entry.instanceIdByLocalIndex.set(localIndex, lastInstanceId)
  }
  entry.mesh.count = lastIndex
  entry.mesh.instanceMatrix.needsUpdate = true
  entry.localIndexByInstanceId.delete(info.instanceId)
  entry.instanceIdByLocalIndex.delete(lastIndex)
}

// For TimelinePlayback's batched-visibility fast path (Viewport3D.tsx,
// 2026-07-21) — per Maro, after the O(n²)/un-batching fixes above still
// weren't enough: every schedule-linked element gets materialized into its
// own individual mesh + unique material specifically so it can animate,
// which means draw-call count still equals *linked* element count even
// with batching preserved for everything else — the real ceiling for a
// six-combined-discipline schedule where most elements end up linked. Most
// schedule-generated links use the plain default profile (opacity 0->1, no
// transform at all — confirmed by tracing DEFAULT_ANIMATION_CONFIG through
// computeAppliedAnimationStateAt), which needs nothing more than a per-
// instance visible/hidden flip — something THREE.BatchedMesh already does
// natively (setVisibleAt, itself internally diffed and O(1) draw-call cost
// regardless of instance count) with zero shader work and zero
// materialization. Returns null (not eligible) if the element isn't
// currently batched at all — already individual, for any reason — so the
// caller falls back to the existing full-materialization path unchanged.
export function getBatchedInstanceInfo(
  rootObject: THREE.Object3D, expressID: number,
): { mesh: THREE.BatchedMesh; instances: { instanceId: number; baseColor: THREE.Color }[] } | null {
  const materialized = getMeshIndex(rootObject).get(expressID)
  if (materialized && materialized.length > 0) return null

  const batch = rootObject.userData.batch as BatchState | null | undefined
  const infos = batch?.byExpressId.get(expressID)
  if (!batch || !infos || infos.length === 0) return null

  return { mesh: batch.mesh, instances: infos.map(info => ({ instanceId: info.instanceId, baseColor: info.color })) }
}

// For schedule extraction (ifcScheduleExtraction.ts) — 2026-07-21 perf fix,
// per Maro: extraction only ever needs a world-space bounding box to
// estimate a length/area quantity (measureElement), but it used to call
// ensureMaterialized for every candidate element to get one, which — combined
// with that function's own O(n) traverse (see getMeshIndex's header) —
// permanently un-batched essentially the *entire* model the moment a
// schedule was generated, since extraction touches nearly every schedulable
// element. This computes the same box a materialized mesh would have
// (THREE.Box3.setFromObject's own non-precise path: geometry.boundingBox
// transformed by the object's cached matrixWorld) directly from the batch's
// own stored geometry + instance matrix, without ever pulling the element out
// of the batch. Falls back to the real per-mesh path for anything already
// individual (never-batched, or previously materialized for some other
// reason) so behaviour is identical for those. Returns null only if the
// expressID genuinely has no geometry anywhere (batched or individual).
export function getExpressIdWorldBounds(rootObject: THREE.Object3D, expressID: number): THREE.Box3 | null {
  const materialized = getMeshIndex(rootObject).get(expressID)
  if (materialized && materialized.length > 0) {
    const box = new THREE.Box3()
    for (const mesh of materialized) box.union(new THREE.Box3().setFromObject(mesh))
    return box
  }

  const batch = rootObject.userData.batch as BatchState | null | undefined
  const infos = batch?.byExpressId.get(expressID)
  if (!batch || !infos || infos.length === 0) return null

  const box = new THREE.Box3()
  let any = false
  for (const info of infos) {
    const geometry = batch.geometryById.get(info.geometryId)
    if (!geometry) continue
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (!geometry.boundingBox) continue
    // rootObject.matrixWorld, not just info.matrix (2026-07-21) — info.matrix
    // is only this instance's placement *relative to rootObject*; the model
    // as a whole can itself be moved/rotated (TransformPanel edits on the
    // whole import) after load, exactly like the already-materialized branch
    // above accounts for via mesh.matrixWorld. Read as-is (no forced
    // recompute), matching Box3.setFromObject's own non-precise path, which
    // trusts whatever matrixWorld the last render tick already computed.
    const worldMatrix = rootObject.matrixWorld.clone().multiply(info.matrix)
    box.union(geometry.boundingBox.clone().applyMatrix4(worldMatrix))
    any = true
  }
  return any ? box : null
}

// For TimelinePlayback (Viewport3D.tsx) — a schedule-linked element can carry
// more than one placed geometry piece (see BatchState.byExpressId's own
// header), and animation needs to drive every piece in lockstep, not just
// the first one ensureMaterialized returns. Materializes on demand (a no-op
// if already real) then reads every piece back from the shared index.
export function getMaterializedMeshes(rootObject: THREE.Object3D, expressID: number): THREE.Mesh[] {
  ensureMaterialized(rootObject, expressID)
  return getMeshIndex(rootObject).get(expressID) ?? []
}

// For the handful of features that need to scan *every* element of a model
// at once (2026-07-17) — "Select Linked"/"Apply to Linked" comparing every
// element's material channel against a reference, for one — rather than
// one specific expressID. Those already do a plain `object.traverse`,
// which only ever sees real individual meshes; calling this first
// materializes whatever's still batched so that traversal actually covers
// every element instead of silently skipping however many happen to still
// be batched. A real, known cost (undoes this model's own batching, since
// "select linked" isn't a hot path worth writing bespoke batch-scanning
// logic for at this scope), not a bug — same "materialize is permanent"
// philosophy as ensureMaterialized itself.
export function materializeAll(rootObject: THREE.Object3D) {
  const batch = rootObject.userData.batch as BatchState | null | undefined
  if (!batch) return
  for (const expressID of [...batch.byExpressId.keys()]) {
    ensureMaterialized(rootObject, expressID)
  }
}

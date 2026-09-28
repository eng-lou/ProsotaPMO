import * as THREE from 'three'
import type { BatchState } from './elementBatching'

// A safe, hand-written clone for the Baseline Viewport pane (2026-07-12,
// per Maro's "advanced 4D" baseline-vs-actual compare request) — a
// THREE.Object3D can only ever belong to one scene graph, so showing the
// same imported model in a second <Canvas> needs a second copy of the
// hierarchy. Deliberately NOT `Object3D.clone()`: three.js's own
// `Object3D.copy()` does `this.userData = JSON.parse(JSON.stringify(source.userData))`,
// and by the time a mesh has been on screen for even a moment,
// Viewport3D.tsx's own ModelObjects has already attached real, non-JSON-
// serializable object references onto `userData` (`standardMaterial`,
// `subdividedGeometry`, `edgesHelper` — actual Material/BufferGeometry/
// Object3D instances) — JSON.stringify on those throws on a circular
// reference, or silently produces garbage. This walks the hierarchy by
// hand instead, copying only what the baseline pane actually needs:
// transform, and — for a Mesh — `.geometry`/`.material` copied *by
// reference* (three.js already supports one BufferGeometry/Material being
// referenced by meshes in different scenes; this is exactly what makes
// cloning cheap — no GPU buffers are duplicated, only the lightweight
// scene-graph nodes are) plus the one genuinely safe, plain-number
// userData key (`expressID`) IFC per-element features need.
//
// A Mesh's *real* PBR material — `userData.standardMaterial` if the
// primary viewport has already captured it (see ModelObjects' own header
// on why that capture exists), else `.material` itself if it hasn't run
// yet — not whatever render-mode stand-in (Gouraud/Phong/Hidden Line)
// might currently be swapped onto `.material`. This clone's own material
// (or the cloned batch's material below) is re-tagged the same way, into
// its own `userData.standardMaterial` — see that assignment's own comment
// for why: ComparisonViewportPane.tsx now DOES mirror the primary
// viewport's render mode (2026-09-01, per Maro — full parity was a
// deliberate reversal of this file's own original 2026-07-12 "always PBR"
// choice, see that pane's own render-mode effect), and needs a stable
// handle on the real material to swap the display material *from* every
// time the setting changes, not just once.
//
// Public entry point — thin wrapper around buildClone's own recursive
// descent: after the whole tree is built, this does one pass over the
// *finished clone* to populate its own `userData.expressIdMeshIndex` — the
// exact same `Map<number, THREE.Mesh[]>` shape elementBatching.ts's own
// getMeshIndex builds for a real model — and (since 2026-09-29) carries the
// cloned batch on `userData.batch`, the same idiom as a real model's root,
// so ensureMaterialized/getBatchedInstanceInfo/TimelinePlayback's batch
// fast path all work on this pane's copy exactly as they do on the primary
// viewport's.
export function cloneSceneHierarchy(object: THREE.Object3D): THREE.Object3D {
  const batch = (object.userData.batch as BatchState | null | undefined) ?? null
  const cloned: { batch: BatchState | null } = { batch: null }
  const clone = buildClone(object, batch, cloned)
  if (cloned.batch) clone.userData.batch = cloned.batch
  const index = new Map<number, THREE.Mesh[]>()
  clone.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    const expressID = child.userData.expressID as number | undefined
    if (expressID === undefined) return
    const existing = index.get(expressID)
    if (existing) existing.push(child); else index.set(expressID, [child])
  })
  clone.userData.expressIdMeshIndex = index
  return clone
}

type BatchedMeshInternals = THREE.BatchedMesh & {
  _maxInstanceCount: number
  _maxVertexCount: number
  _maxIndexCount: number
  _drawRanges: { start: number; count: number }[]
  _reservedRanges: { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number }[]
  _drawInfo: { visible: boolean; active: boolean; geometryIndex: number }[]
  _availableInstanceIds: number[]
  _bounds: { boxInitialized: boolean; box: THREE.Box3; sphereInitialized: boolean; sphere: THREE.Sphere }[]
  _geometryInitialized: boolean
  _geometryCount: number
  _multiDrawCounts: Int32Array
  _multiDrawStarts: Int32Array
  _visibilityChanged: boolean
  _matricesTexture: THREE.DataTexture | null
  _indirectTexture: THREE.DataTexture | null
  _colorsTexture: THREE.DataTexture | null
}

// A second THREE.BatchedMesh drawing the same instances as `batch.mesh`,
// sharing its vertex/index buffer (2026-09-29, per Maro: "noticeable lag
// while orbiting" — measured live on the 5-file NBU Medical Clinic set: the
// Baseline pane used to rebuild every still-batched element as its own
// THREE.Mesh, ~60,000 of them, costing 3.5-8.3 *seconds* of CPU per frame
// in draw-call overhead alone — 118,547 draw calls — while the primary
// viewport draws the same model in a handful). Mirrors BatchedMesh.copy()
// (three@0.169 source) field for field, except the geometry is shared by
// reference instead of cloned: one BufferGeometry can be drawn by several
// objects in different renderers (each WebGL context uploads its own GPU
// copy), so this costs no extra CPU-side vertex memory. Per-instance state
// (visibility, colour, the draw list) is this clone's own, so the pane's
// isolation/timeline never touch the primary viewport's batch.
function cloneBatch(batch: BatchState): BatchState {
  const src = batch.mesh as BatchedMeshInternals
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  const mesh = new THREE.BatchedMesh(src._maxInstanceCount, src._maxVertexCount, src._maxIndexCount, material) as BatchedMeshInternals
  mesh.geometry.dispose()
  mesh.geometry = src.geometry
  mesh.name = src.name
  mesh.perObjectFrustumCulled = src.perObjectFrustumCulled
  mesh.sortObjects = src.sortObjects
  mesh.boundingBox = src.boundingBox ? src.boundingBox.clone() : null
  mesh.boundingSphere = src.boundingSphere ? src.boundingSphere.clone() : null
  mesh._drawRanges = src._drawRanges.map(range => ({ ...range }))
  mesh._reservedRanges = src._reservedRanges.map(range => ({ ...range }))
  mesh._drawInfo = src._drawInfo.map(info => ({ ...info }))
  mesh._availableInstanceIds = src._availableInstanceIds.slice()
  mesh._bounds = src._bounds.map(bound => ({
    boxInitialized: bound.boxInitialized, box: bound.box.clone(),
    sphereInitialized: bound.sphereInitialized, sphere: bound.sphere.clone(),
  }))
  mesh._geometryInitialized = src._geometryInitialized
  mesh._geometryCount = src._geometryCount
  mesh._multiDrawCounts = src._multiDrawCounts.slice()
  mesh._multiDrawStarts = src._multiDrawStarts.slice()
  ;(mesh._matricesTexture!.image.data as Float32Array).set(src._matricesTexture!.image.data as Float32Array)
  mesh._matricesTexture!.needsUpdate = true
  if (src._colorsTexture) {
    mesh._colorsTexture = src._colorsTexture.clone()
    mesh._colorsTexture.image.data = (src._colorsTexture.image.data as Float32Array).slice()
    mesh._colorsTexture.needsUpdate = true
  }
  mesh._visibilityChanged = true
  mesh.position.copy(src.position)
  mesh.quaternion.copy(src.quaternion)
  mesh.scale.copy(src.scale)
  // Stable handle on the real material, same idiom as a plain clone Mesh
  // below — ComparisonViewportPane.tsx's render-mode effect swaps
  // `.material` to a variant and reads this back every time.
  mesh.userData.standardMaterial = material
  // The shared geometry belongs to the primary viewport's batch: never
  // dispose it from here (BatchedMesh.dispose() would).
  mesh.dispose = () => {
    mesh._matricesTexture?.dispose()
    mesh._indirectTexture?.dispose()
    mesh._colorsTexture?.dispose()
    return mesh
  }
  return {
    mesh,
    byExpressId: new Map([...batch.byExpressId].map(([id, infos]) => [id, infos.slice()])),
    expressIdByInstanceId: new Map(batch.expressIdByInstanceId),
    geometryByIfcId: batch.geometryByIfcId,
    geometryById: batch.geometryById,
  }
}

// Frees what cloneBatch (and the pane's render modes) created for one
// cloned batch — never the shared geometry.
export function disposeClonedBatch(batch: BatchState) {
  const material = batch.mesh.userData.standardMaterial as THREE.Material | undefined
  for (const key of ['lambertVariant', 'hiddenLineVariant']) {
    const variant = material?.userData[key] as THREE.Material | undefined
    variant?.dispose()
  }
  material?.dispose()
  batch.mesh.dispose()
}

function buildClone(object: THREE.Object3D, batch: BatchState | null, cloned: { batch: BatchState | null }): THREE.Object3D {
  // THREE.BatchedMesh extends THREE.Mesh (2026-07-24 fix, per Maro: the
  // Baseline pane showed a jumbled mess of disconnected, wrongly-angled
  // panels instead of the real building) — this used to fall into the
  // instanceof-Mesh branch below and wrap the *shared batch's own raw
  // internal geometry buffer* as if it were one plain mesh's shape, every
  // instance piled at its un-transformed local origin. First fixed by
  // exploding the batch into one plain Mesh per instance; since 2026-09-29
  // it's cloned as a real second batch instead — see cloneBatch's own
  // header for the measured cost of the old approach. A BatchedMesh is
  // always a leaf, so no children to recurse into.
  if ((object as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh) {
    if (!batch || object !== batch.mesh) return new THREE.Group()
    cloned.batch = cloneBatch(batch)
    cloned.batch.mesh.visible = object.visible
    return cloned.batch.mesh
  }

  const clone: THREE.Object3D = object instanceof THREE.Mesh
    ? new THREE.Mesh(object.geometry, (object.userData.standardMaterial as THREE.Material | THREE.Material[] | undefined) ?? object.material)
    : new THREE.Group()

  // Tag the clone's own real PBR material (2026-09-01, per Maro: "baseline
  // viewport isnt using the same render mode and effects settings") — a
  // stable reference ComparisonViewportPane.tsx's own render-mode effect
  // reads every time it re-swaps `.material` to a Gouraud/Hidden Line
  // stand-in, so switching *back* to Shaded/Flat later restores the real
  // material instead of stacking a stand-in built from the *previous*
  // stand-in. Same key/idiom as Viewport3D.tsx's own
  // `child.userData.standardMaterial = child.material` capture, deliberately
  // reused rather than a pane-local name, since it means the exact same
  // thing here: "the real material, regardless of what render mode has
  // since put on screen."
  if (clone instanceof THREE.Mesh) clone.userData.standardMaterial = clone.material

  clone.name = object.name
  clone.position.copy(object.position)
  clone.rotation.copy(object.rotation)
  clone.scale.copy(object.scale)
  clone.visible = object.visible
  if (object.userData.expressID !== undefined) clone.userData.expressID = object.userData.expressID
  // Per-piece identity + IFC transparency, for Realistic Materials mode's
  // per-piece classes and glass opacity (realisticMaterials.ts).
  if (object.userData.ifcGeometryId !== undefined) clone.userData.ifcGeometryId = object.userData.ifcGeometryId
  if (object.userData.ifcColorAlpha !== undefined) clone.userData.ifcColorAlpha = object.userData.ifcColorAlpha

  for (const child of object.children) {
    // Display-only companions the primary viewport builds on top of its
    // batch — Realistic mode's glass-only batch (realisticMaterials.ts) and
    // the batched Edges overlay (elementBatching.ts). The pane builds its
    // own from the cloned batch; cloning these would draw them twice.
    if (child.userData.isRealisticGlassBatch || child.userData.isEdgesBatchMesh) continue
    clone.add(buildClone(child, batch, cloned))
  }
  return clone
}

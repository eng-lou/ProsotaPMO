import * as THREE from 'three'
import { IfcAPI } from 'web-ifc'
import { captureBaseline, disposeMeshGeometries, disposeMeshMaterials } from './elementBaseline'
import { buildElementMaterial, finalizeIndividualMesh, type BatchState } from './elementBatching'
export { ensureMaterialized, type BatchInstanceInfo, type BatchState } from './elementBatching'

// "Import IFC" (2026-07-10, per Maro — linked github.com/ThatOpen/engine_components
// as "very important"). Uses web-ifc directly — the lower-level WASM parser
// ThatOpen's own engine_components is itself built on — rather than that
// higher-level framework, since it brought two separate peer-dependency
// conflicts with the react-three-fiber stack already in this project
// (three.js >=0.182 and camera-controls >=3.1.2, vs @react-three/drei's own
// camera-controls ^2.9.0 cap) with zero conflicts of its own. Its IfcLoader
// would have handed back a plain THREE.Object3D anyway, same as what's built
// here by hand from the raw geometry/property API.
//
// The geometry extraction and property/spatial-structure shapes below were
// verified empirically against two real sample files (a Revit-exported IFC4
// project and its IFC4 variant, both in the private docs repo) via a Node
// smoke test during development — not just API docs — specifically: vertex
// data is 6 floats per vertex (position xyz, normal xyz) interleaved;
// GetVertexDataSize()/GetIndexDataSize() are element counts, not bytes;
// property values arrive wrapped (`{value: ...}` for simple types,
// `{_representationValue: ...}` for measures) and need unwrapping.
//
// WASM is self-hosted (frontend/public/wasm-ifc/web-ifc.wasm, copied from
// node_modules/web-ifc at implementation time — needs re-copying if the
// web-ifc version ever changes) rather than pointed at a CDN, and forced
// single-threaded (no SharedArrayBuffer/COOP-COEP header requirements this
// app doesn't set up).
let apiPromise: Promise<IfcAPI> | null = null
function getApi(): Promise<IfcAPI> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new IfcAPI()
      api.SetWasmPath('/wasm-ifc/', true)
      await api.Init(undefined, true)
      return api
    })()
  }
  return apiPromise
}

// BatchState/BatchInstanceInfo/ensureMaterialized all live in
// elementBatching.ts, not here (2026-07-17) — see that file's own header:
// Viewport3D.tsx needs ensureMaterialized but must never statically import
// anything from this file (web-ifc weight), and BatchState/BatchInstanceInfo
// have zero web-ifc dependency of their own, so they moved with it.
export interface IfcModelHandle {
  api: IfcAPI
  modelID: number
  object: THREE.Group
  // Null only if the file had zero placeable geometry at all (2026-07-21 —
  // every element's geometry goes into the shared batch now, unique or
  // repeated; see elementBatching.ts's own header for why this changed).
  batch: BatchState | null
}

function colorToThree(c: { x: number; y: number; z: number; w: number }): THREE.Color {
  return new THREE.Color(c.x, c.y, c.z)
}

// Box-projected UVs (2026-07-11, per Maro: applied a concrete texture to
// slabs, got a flat, detail-less grey instead) — web-ifc's own interleaved
// vertex buffer is strictly position+normal, 6 floats per vertex (verified
// against a real file, see this file's own header); it carries no UV/
// texture-coordinate data at all, for any IFC geometry, ever. Without a
// `uv` attribute, three.js's MeshStandardMaterial has no coordinates to
// sample a `map` texture against and silently falls back to a flat,
// untextured surface — that flat grey slab was never a render-mode
// setting, it was a materially missing attribute. Generated here
// per-vertex from each vertex's own *local* position (stable under a later
// move/rotate, since TransformPanel edits the mesh's transform, not its
// geometry) using the dominant axis of that vertex's own normal to pick
// which two position components become U/V — the standard "box
// projection" technique for CAD/BREP geometry with no native UV unwrap.
// Exactly right (no seams) for the flat, axis-aligned faces that make up
// most structural BIM elements (slabs/walls/columns/beams); a genuinely
// curved face (this file has some curtain-wall panels) can show a seam
// where the dominant axis flips — true triplanar blending would avoid
// that, but needs a custom shader; deferred until it's actually reported
// as a problem. UVs are left in raw model-space units (1 UV unit = 1 raw
// unit, e.g. 1 foot for this file, see getLengthUnitToMetres's own header)
// rather than pre-scaled to some guessed tile size — TextureFields.tsx's
// own Tile Size control divides this back down via texture.repeat, so the
// actual visual tiling density is a live, adjustable choice, not baked in
// here.
//
// Factored out (2026-07-17) so ensureMaterialized below can build the
// exact same geometry shape a batched element would have gotten had it
// never been batched at all — one geometry-construction implementation,
// reused whether an element becomes a mesh eagerly at import or lazily on
// first interaction.
function buildGeometryFromIfc(vertexData: Float32Array, indexData: Uint32Array): THREE.BufferGeometry {
  const vertexCount = vertexData.length / 6
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  for (let v = 0, p = 0, u = 0; v < vertexData.length; v += 6, p += 3, u += 2) {
    positions[p] = vertexData[v]; positions[p + 1] = vertexData[v + 1]; positions[p + 2] = vertexData[v + 2]
    normals[p] = vertexData[v + 3]; normals[p + 1] = vertexData[v + 4]; normals[p + 2] = vertexData[v + 5]
    const nx = Math.abs(normals[p]), ny = Math.abs(normals[p + 1]), nz = Math.abs(normals[p + 2])
    if (nx >= ny && nx >= nz) { uvs[u] = positions[p + 1]; uvs[u + 1] = positions[p + 2] }
    else if (ny >= nx && ny >= nz) { uvs[u] = positions[p]; uvs[u + 1] = positions[p + 2] }
    else { uvs[u] = positions[p]; uvs[u + 1] = positions[p + 1] }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indexData, 1))
  return geometry
}

// Shared across every loadIfcModel call in this session (2026-07-19 fix,
// per Maro: "you've seriously fucked the coordinates of my ifc files, i
// imported site and structurals and facade etc. and they're in different
// positions" — a real, serious regression: the recenter-offset fix below
// originally computed a fresh offset *per file*, so site.ifc,
// structural.ifc, and facade.ifc each shifted to their own independent
// origin instead of all shifting together, destroying the real alignment
// between them that only exists because they share one real-world/site
// coordinate system. The fix has to be ONE offset shared by every file
// loaded this session, not one per file — computed from whichever file
// happens to load first, then reused verbatim for every subsequent one, so
// all of them shift by the exact same amount and their relative positions
// stay exactly as authored. Reset to null on a full page reload (this is
// just an in-memory module variable) — a new session recomputes fresh from
// whatever's imported first, same as before. Also explicitly reset by
// resetRecenterOffset below on a *project switch* — FourD.tsx stays
// mounted for the whole authenticated session (PersistentFourD, App.tsx)
// rather than remounting per project, so without an explicit reset a
// second project's own first file would silently reuse the first
// project's completely unrelated site coordinates as its offset.
let sharedRecenterOffset: THREE.Vector3 | null = null

// Called by FourD.tsx right before restoring/importing models for a
// newly-selected project (2026-07-19) — see sharedRecenterOffset's own
// header for why a project switch specifically needs this, unlike normal
// multi-file import within the same project.
export function resetRecenterOffset(): void {
  sharedRecenterOffset = null
}

export async function loadIfcModel(file: File): Promise<IfcModelHandle> {
  const api = await getApi()
  const buffer = new Uint8Array(await file.arrayBuffer())
  const modelID = api.OpenModel(buffer)

  const group = new THREE.Group()
  group.name = file.name

  const flatMeshes = api.LoadAllGeometry(modelID)
  const meshCount = flatMeshes.size()

  // Pass 1 (cheap — just reads the already-computed flatMesh structure, no
  // GetGeometry/GetVertexArray calls): tally how many placements reference
  // each geometryExpressID. Every geometry goes into the shared batch below
  // regardless of this count (2026-07-21 — see elementBatching.ts's own
  // header for why this used to stop at count > 1 and no longer does); the
  // count itself is still needed for BatchedMesh's fixed-capacity
  // construction (Pass 2) and to size each geometry's own instance array.
  const occurrenceCount = new Map<number, number>()
  // Recenter offset (2026-07-19 fix, per Maro: columns specifically
  // shaking while orbiting — confirmed via direct evidence, not assumed:
  // a real Frame Selected run logged its own computed box at
  // (417585, 224, -78735) to (417646, 259, -78660) — a real project sited
  // at real-world/site coordinates roughly 400,000 units from the three.js
  // origin. WebGL vertex math is 32-bit float throughout (~7 significant
  // decimal digits); at that magnitude there's only ~0.05 units of
  // precision left for anything *within* the model. An ordinary THREE.Mesh
  // survives this because three.js precomputes its camera-relative
  // modelViewMatrix on the CPU in full 64-bit JS doubles before the GPU
  // ever sees it — the dangerous "huge minus huge" cancellation happens
  // somewhere safe. THREE.BatchedMesh instead does the equivalent
  // per-instance matrix math *inside the GPU vertex shader*, in 32-bit
  // float the whole way through — the same huge-coordinate magnitude that's
  // harmless for a normal mesh becomes visible per-frame jitter for a
  // batched one, exactly matching "shakes, but stops the instant you select
  // it" (selecting materializes it onto the safe, CPU-precomputed
  // individual-mesh path). The standard fix for real-world-coordinate BIM/
  // GIS data is recentering near the origin at load time, not working
  // around float32 precision after the fact — every element's own
  // placement gets this same offset subtracted below (Pass 3), preserving
  // every relative position/rotation between elements exactly; only the
  // absolute reference point moves. The MEAN of every placement's own
  // translation is used as that reference (2026-07-19 fix, replacing an
  // initial version that just used the first placement found) — per Maro:
  // "shadows looking crazy, floating." A directional light's shadow camera
  // defaults to looking at world origin (0,0,0); the first-placement
  // version could recenter the whole model around an arbitrary corner
  // element rather than its middle, leaving the actual geometry sitting
  // well outside where the shadow camera was actually looking even after
  // recentering. The mean of every element's own origin is a cheap (no
  // extra geometry reads, just the translations Pass 1 already has to
  // iterate anyway), reasonable proxy for "the middle of the model" — not
  // a true geometric bounding-box centroid, but close enough to land the
  // recentered model right around the origin, exactly where the shadow
  // camera already expects it.
  // Only the FIRST file loaded this session actually computes an offset —
  // see sharedRecenterOffset's own header above for why every subsequent
  // file must reuse that exact same value instead of computing its own.
  const computingSharedOffset = sharedRecenterOffset === null
  let offsetSum: THREE.Vector3 | null = null
  let offsetCount = 0
  for (let i = 0; i < meshCount; i++) {
    const flatMesh = flatMeshes.get(i)
    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const placed = flatMesh.geometries.get(j)
      const geomId = placed.geometryExpressID
      occurrenceCount.set(geomId, (occurrenceCount.get(geomId) ?? 0) + 1)
      if (computingSharedOffset) {
        const t = placed.flatTransformation
        if (offsetSum === null) offsetSum = new THREE.Vector3(t[12], t[13], t[14])
        else offsetSum.add(new THREE.Vector3(t[12], t[13], t[14]))
        offsetCount++
      }
    }
  }
  if (computingSharedOffset && offsetSum && offsetCount > 0) {
    sharedRecenterOffset = offsetSum.divideScalar(offsetCount)
  }
  const recenterOffset = sharedRecenterOffset

  // Pass 2: build the BufferGeometry once per unique shape (also dedupes the
  // redundant GetGeometry/GetVertexArray calls the old one-call-per-placement
  // code used to make even for identical geometry — a free import-time
  // speedup, not just a rendering one), and tally the exact vertex/index/
  // instance totals THREE.BatchedMesh needs fixed at construction time (no
  // capacity growth in three@0.169 — verified directly in
  // node_modules/three/src/objects/BatchedMesh.js, not assumed).
  //
  // Every geometry, not just ones occurring more than once (2026-07-21 — see
  // elementBatching.ts's own header) — batching every shape (unique or
  // repeated) into the one shared BatchedMesh is what actually consolidates
  // a real building's draw calls, since most schedulable elements (walls,
  // beams, ducts) have unique geometry and the repeated-only version never
  // touched them at all.
  let totalVertexCount = 0
  let totalIndexCount = 0
  let totalInstanceCount = 0
  const batchGeometries = new Map<number, THREE.BufferGeometry>()
  for (const [geomId, count] of occurrenceCount) {
    const ifcGeom = api.GetGeometry(modelID, geomId)
    const vertexData = api.GetVertexArray(ifcGeom.GetVertexData(), ifcGeom.GetVertexDataSize())
    const indexData = api.GetIndexArray(ifcGeom.GetIndexData(), ifcGeom.GetIndexDataSize())
    batchGeometries.set(geomId, buildGeometryFromIfc(vertexData, indexData))
    totalVertexCount += vertexData.length / 6
    totalIndexCount += indexData.length
    totalInstanceCount += count
    ifcGeom.delete()
  }

  let batch: BatchState | null = null
  if (batchGeometries.size > 0) {
    // Base colour white — each batched element's own real colour rides on
    // its *per-instance* colour (setColorAt below), which three.js's
    // batching shader multiplies against this material colour; a non-white
    // base would tint every batched element uniformly regardless of its
    // own actual colour.
    const batchedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    const batchedMesh = new THREE.BatchedMesh(totalInstanceCount, totalVertexCount, totalIndexCount, batchedMaterial)
    batchedMesh.name = 'batched-elements'
    // Both default to true on THREE.BatchedMesh itself (verified directly
    // in node_modules/three/src/objects/BatchedMesh.js) — every frame the
    // camera moves, onBeforeRender re-runs a per-instance frustum-vs-
    // bounding-sphere test (perObjectFrustumCulled) and re-sorts draw order
    // by camera distance (sortObjects). 2026-07-19 fix, per Maro: "its some
    // elements mainly the columns" shaking while orbiting — columns are
    // exactly the kind of numerous element that ends up batched, and an
    // instance whose bounding sphere sits near a frustum
    // boundary can flip in/out of that per-frame test purely from floating-
    // point noise in the recomputed projection*view matrix during
    // continuous rotation, a well-documented flicker source for batched/
    // instanced rendering. Neither is actually needed here: this app's own
    // batched elements are opaque (no transparency-sort dependency) and
    // reasonably clustered per model (whole-batch culling via the
    // BatchedMesh's own aggregate bounds, still automatic, already skips
    // the draw call entirely once the whole thing is off-screen) — the
    // small GPU cost of drawing a handful of individually off-screen-but-
    // batch-in-view instances is a good trade for not flickering.
    batchedMesh.perObjectFrustumCulled = false
    batchedMesh.sortObjects = false
    const geometryByIfcId = new Map<number, { geometry: THREE.BufferGeometry; geometryId: number }>()
    // Keyed the other way round from geometryByIfcId (2026-07-21 perf fix)
    // — see BatchState.geometryById's own header in elementBatching.ts.
    const geometryById = new Map<number, THREE.BufferGeometry>()
    for (const [geomId, geometry] of batchGeometries) {
      const geometryId = batchedMesh.addGeometry(geometry)
      geometryByIfcId.set(geomId, { geometry, geometryId })
      geometryById.set(geometryId, geometry)
    }
    batch = { mesh: batchedMesh, byExpressId: new Map(), expressIdByInstanceId: new Map(), geometryByIfcId, geometryById }
    group.add(batchedMesh)
  }

  // Pass 3: place every element — a batch instance for anything whose
  // placement matrix isn't mirrored, or the individual THREE.Mesh path for
  // the (typically small) mirrored fraction. Same final visual result
  // either way, just a different draw-call cost.
  for (let i = 0; i < meshCount; i++) {
    const flatMesh = flatMeshes.get(i)
    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const placed = flatMesh.geometries.get(j)

      const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation)
      // Recenter near the origin (2026-07-19 fix) — see this function's own
      // recenterOffset comment above (Pass 1) for the full "why". Only the
      // translation (elements 12/13/14 in three.js's own column-major
      // Matrix4 layout) shifts; the rotation/scale sub-matrix, and thus
      // every element's orientation and every relative position between
      // elements, is untouched.
      if (recenterOffset) {
        matrix.elements[12] -= recenterOffset.x
        matrix.elements[13] -= recenterOffset.y
        matrix.elements[14] -= recenterOffset.z
      }
      // THREE.BatchedMesh.setMatrixAt explicitly does not support negatively
      // scaled matrices (documented directly on the method, not assumed) —
      // and real IFC files genuinely have these (IfcMappedItem reflections,
      // e.g. a mirrored fastener type placed on the opposite side of
      // something — the exact same class of data this session's Unreal work
      // already found in this file family). Anything with a negative
      // determinant falls back to the individual-mesh path unconditionally
      // — correctness over the batching win for the (typically small)
      // fraction of placements this affects.
      const isMirrored = matrix.determinant() < 0
      if (batch && !isMirrored) {
        const entry = batch.geometryByIfcId.get(placed.geometryExpressID)
        if (!entry) continue
        const instanceId = batch.mesh.addInstance(entry.geometryId)
        batch.mesh.setMatrixAt(instanceId, matrix)
        const color = colorToThree(placed.color)
        batch.mesh.setColorAt(instanceId, color)
        // Pushed onto an array, not a single-slot overwrite (2026-07-17) —
        // one expressID can genuinely own more than one placed geometry
        // piece; see BatchState.byExpressId's own header in
        // elementBatching.ts for why a single slot would silently drop
        // every piece but the last.
        const infos = batch.byExpressId.get(flatMesh.expressID) ?? []
        infos.push({ geometryId: entry.geometryId, instanceId, color, colorAlpha: placed.color.w, matrix })
        batch.byExpressId.set(flatMesh.expressID, infos)
        batch.expressIdByInstanceId.set(instanceId, flatMesh.expressID)
        continue
      }

      const ifcGeom = api.GetGeometry(modelID, placed.geometryExpressID)
      const vertexData = api.GetVertexArray(ifcGeom.GetVertexData(), ifcGeom.GetVertexDataSize())
      const indexData = api.GetIndexArray(ifcGeom.GetIndexData(), ifcGeom.GetIndexDataSize())
      const geometry = buildGeometryFromIfc(vertexData, indexData)
      const mesh = new THREE.Mesh(geometry, buildElementMaterial(placed.color))
      finalizeIndividualMesh(mesh, flatMesh.expressID, matrix, group)
      ifcGeom.delete()
    }
    // No flatMesh.delete() here despite web-ifc-api.d.ts declaring one
    // (2026-07-11 fix — real IFC file import threw "flatMesh.delete is not
    // a function") — IfcGeometry above is a genuine embind class_ instance
    // needing manual disposal, but FlatMesh comes back from LoadAllGeometry
    // as a plain value_object-converted JS struct with no delete method at
    // runtime in this web-ifc build; the .d.ts's delete(): void on it is
    // wrong. Nothing to free here either way — it's just a plain object.
  }

  // No axis-conversion rotation baked in here (2026-07-08 fix, per Maro:
  // default Rotation X showing -90 and the whole model rendering off-axis)
  // — this `group` is the exact object TransformPanel/gizmo edit, so baking
  // a fixed correction onto it made "no manual edits yet" look like
  // "rotated -90 already" and fought against Viewport3D.tsx's own Z-up/Y-up
  // display conversion (which was designed to correct Y-up-native content,
  // and IFC is natively Z-up already — the two corrections compounded
  // instead of cancelling). IFC is genuinely Z-up per its own spec; any
  // display-axis correction now lives entirely in Viewport3D.tsx's
  // axisCorrectionRotation (upAxis.ts), applied via a wrapper group around
  // this object rather than onto it.
  captureBaseline(group)
  // Same userData-threading idiom as expressID/sceneObjectId elsewhere in
  // this module — lets ensureMaterialized (and Viewport3D.tsx's raycast
  // hit resolution) reach the batch state from just an Object3D reference,
  // without needing the full IfcModelHandle in scope.
  group.userData.batch = batch
  return { api, modelID, object: group, batch }
}

// GlobalId -> expressID (2026-07-11) — model_element_link.py's ifc-kind
// links are keyed by GlobalId (stable across re-imports), but every mesh in
// `handle.object` is tagged with expressID (loadIfcModel above), a WASM-
// session-local numeric id — this is what the 4D timeline (Viewport3D.tsx's
// TimelinePlayback) needs to go from "which activity/element is this link
// about" to "which THREE.Mesh do I actually animate". web-ifc's own
// GetExpressIdFromGuid lazily builds and caches a full guid<->expressID map
// on first call (CreateIfcGuidToExpressIdMapping, verified in
// node_modules/web-ifc/web-ifc-api.js) — cheap enough to call per-link
// on demand rather than needing to tag every mesh with its GlobalId
// upfront, since a project typically links far fewer elements than a full
// IFC model contains.
export function getExpressIdFromGuid(handle: IfcModelHandle, guid: string): number | undefined {
  // The underlying map stores both directions (guid->expressID and
  // expressID->guid) in one Map, so web-ifc's own type can't narrow which
  // side a given key returns — coerce, since we only ever call this with a
  // guid key.
  const result = handle.api.GetExpressIdFromGuid(handle.modelID, guid)
  return result === undefined ? undefined : Number(result)
}

// GlobalId for a given expressID — the exact reverse of getExpressIdFromGuid
// above (2026-07-11, for Collections' "Add Selected" — needs an
// element_ref, and GlobalId is what that means for source_kind="ifc", same
// as ModelElementLink). Deliberately not routed through getElementInfo,
// which pays for two full property-set round trips just to read one field
// off the result — this is a single synchronous web-ifc call, same idiom
// as getExpressIdFromGuid itself.
export function getGuidFromExpressId(handle: IfcModelHandle, expressID: number): string | undefined {
  const result = handle.api.GetGuidFromExpressId(handle.modelID, expressID)
  return result === undefined ? undefined : String(result)
}

// A snapshot-quality type name for a given expressID — same reasoning as
// getGuidFromExpressId above (Collections' element_label needs *something*
// readable, not a full getElementInfo property-set fetch). Same
// GetNameFromTypeCode call getTypeCounts below already uses, just for one
// specific element instead of every type in the model.
export function getElementTypeName(handle: IfcModelHandle, expressID: number): string {
  return handle.api.GetNameFromTypeCode(handle.api.GetLineType(handle.modelID, expressID))
}

// Per-type counts within one already-known set of leaf expressIDs (2026-07-11,
// per Maro comparing against Bonsai/Blender's IFC panel — picking a storey
// there scopes the Class>Type>Occurrence list to just that storey's own
// elements, e.g. "IfcColumn 129" meaning 129 columns *on that level*, not
// getTypeCounts' whole-model 249). Reuses getElementTypeName per id rather
// than a new bulk web-ifc call — the input set here is one storey's worth of
// elements (already resolved from the spatial tree client-side), nowhere
// near getTypeCounts' whole-model GetLineIDsWithType scale.
export function groupExpressIdsByType(handle: IfcModelHandle, expressIds: number[]): { typeName: string; ids: number[] }[] {
  const groups = new Map<string, number[]>()
  for (const id of expressIds) {
    const typeName = getElementTypeName(handle, id)
    const existing = groups.get(typeName)
    if (existing) existing.push(id)
    else groups.set(typeName, [id])
  }
  return [...groups.entries()]
    .map(([typeName, ids]) => ({ typeName, ids }))
    .sort((a, b) => b.ids.length - a.ids.length)
}

export function disposeIfcModel(handle: IfcModelHandle) {
  // THREE.BatchedMesh extends THREE.Mesh, so the traversal below would
  // otherwise also match it and hand it to disposeMeshGeometries/
  // disposeMeshMaterials, both of which assume per-element userData
  // (originalGeometry, standardMaterial) the shared batch mesh never has —
  // it gets its own dedicated disposal below instead.
  const batchMesh = handle.batch?.mesh
  handle.object.traverse(child => {
    if (child instanceof THREE.Mesh && child !== batchMesh) {
      disposeMeshGeometries(child)
      disposeMeshMaterials(child, false)
    }
  })
  if (handle.batch) {
    handle.batch.mesh.material && (Array.isArray(handle.batch.mesh.material) ? handle.batch.mesh.material.forEach(m => m.dispose()) : handle.batch.mesh.material.dispose())
    handle.batch.mesh.dispose()
    for (const entry of handle.batch.geometryByIfcId.values()) entry.geometry.dispose()
  }
  handle.api.CloseModel(handle.modelID)
}

export function getTypeCounts(handle: IfcModelHandle): { typeName: string; count: number }[] {
  const types = handle.api.GetAllTypesOfModel(handle.modelID)
  return types
    .map(t => ({ typeName: t.typeName, count: handle.api.GetLineIDsWithType(handle.modelID, t.typeID).size() }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count)
}

// Every expressID of one IFC type (2026-07-11, per Maro: "select all the
// doors" — Select by Type) — getTypeCounts above already looks up typeID
// via the same GetAllTypesOfModel call, but only ever keeps the *count*,
// discarding the actual ids. Reuses the exact .size()/.get(i) Vector
// idiom this file already uses at loadIfcModel above for flatMeshes/
// geometries.
export function getExpressIdsForType(handle: IfcModelHandle, typeName: string): number[] {
  const match = handle.api.GetAllTypesOfModel(handle.modelID).find(t => t.typeName === typeName)
  if (!match) return []
  const ids = handle.api.GetLineIDsWithType(handle.modelID, match.typeID)
  const out: number[] = []
  for (let i = 0; i < ids.size(); i++) out.push(ids.get(i))
  return out
}

export interface IfcTreeNode {
  expressID: number
  type: string
  children: IfcTreeNode[]
}

export async function getSpatialTree(handle: IfcModelHandle): Promise<IfcTreeNode> {
  return handle.api.properties.getSpatialStructure(handle.modelID, false) as unknown as Promise<IfcTreeNode>
}

// Prefix multipliers for a plain IfcSIUnit (metres, optionally prefixed) —
// only reached when the project's own LENGTHUNIT isn't the
// IfcConversionBasedUnit case handled below (getLengthUnitToMetres's own
// header). Fixed by the IFC spec's own enumeration, not something that
// needed verifying against a real file the way the conversion-based branch
// did.
const SI_PREFIX_TO_METRES: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3,
  HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3,
  MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
}

// The project's own declared length unit, as a single "how many metres is
// one raw unit" factor (2026-07-11, per Maro comparing this app's storey
// elevations against Bonsai's own feet-inch display for the same file —
// see IfcDataPanel.tsx's formatElevation for what this feeds into).
// Verified against a real file (2018_Hospital_Structural.ifc) via a Node
// smoke test, not assumed from docs (this file's own header explains why
// that matters) — its IFCPROJECT.UnitsInContext declares LENGTHUNIT as an
// IfcConversionBasedUnit named "FOOT" with ConversionFactor.ValueComponent
// = 0.3048, and the raw Elevation values already sitting on its storeys
// (0, 19.5, 20, 35.5…) are exactly that project's own feet — confirmed by
// matching Bonsai's own Level 1/Level 2 TOS/Level 2/… ordering for the same
// file. A plain IfcSIUnit (metres, optionally milli/centi/kilo-prefixed)
// has no ConversionFactor of its own — resolved via the fixed prefix table
// above instead, per spec rather than another guess. Falls back to 1
// (assume metres, IFC's own default unit) if no project or no LENGTHUNIT
// entry is found — safer than inventing a factor.
export function getLengthUnitToMetres(handle: IfcModelHandle, projectExpressID: number): number {
  try {
    const project = handle.api.GetLine(handle.modelID, projectExpressID, true) as {
      UnitsInContext?: { Units?: Array<Record<string, any>> }
    }
    const units = project?.UnitsInContext?.Units
    const lengthUnit = units?.find(u => u.UnitType?.value === 'LENGTHUNIT')
    if (!lengthUnit) return 1
    if (lengthUnit.ConversionFactor) {
      const valueComponent = lengthUnit.ConversionFactor.ValueComponent
      const factor = valueComponent?._representationValue ?? valueComponent?.value
      return typeof factor === 'number' ? factor : 1
    }
    const prefix = lengthUnit.Prefix?.value as string | undefined
    return prefix ? (SI_PREFIX_TO_METRES[prefix] ?? 1) : 1
  } catch {
    return 1
  }
}

// IFC values arrive wrapped — simple types as {value}, measures (area/
// length/volume/etc) as {_representationValue} — verified against real
// property data (Pset_RoofCommon's ProjectedArea/TotalArea) during
// development.
function unwrapIfcValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v !== 'object') return String(v)
  const obj = v as Record<string, unknown>
  if ('value' in obj) return String(obj.value)
  if ('_representationValue' in obj) return String(obj._representationValue)
  return '—'
}

// Just the Name attribute for one element (2026-07-11, for Select by
// Storey's own button labels — "Ground Floor" not "IFCBUILDINGSTOREY
// #4231") — getSpatialTree's own nodes carry no Name at all
// (getSpatialStructure is called with includeProperties=false, since
// fetching every element's full property set just to build the tree would
// be far too slow for a large model); this fetches just the one attribute
// for a small, bounded set of nodes (a handful of storeys, not everything),
// via the same getItemProperties call getElementInfo already uses as its
// own first step — deliberately skipping the property-set fetch
// getElementInfo also does, unneeded here.
export async function getElementName(handle: IfcModelHandle, expressID: number): Promise<string> {
  const props = await handle.api.properties.getItemProperties(handle.modelID, expressID, false)
  return unwrapIfcValue(props.Name)
}

// Name + PredefinedType in one getItemProperties call (2026-07-13, for the
// IFC Schedule Wizard's own classifier — see ifcScheduleExtraction.ts's own
// header) — verified against the real reference file
// (2018_Hospital_Structural.ifc) that PredefinedType matters far more than
// raw IFC type alone for a Revit export: 538 of its 612 IfcSlab elements
// are 'Pile Cap-9 Pile:...' foundation elements with
// PredefinedType=.BASESLAB., not floor slabs, and Revit exported them as
// IfcSlab rather than IfcFooting anyway — only 74 are genuine .FLOOR.
// slabs. PredefinedType is IFC's own semantic tag for exactly this
// distinction, not a guess off the element's own free-text Name the way
// ifcScheduleExtraction.ts's material classifier already has to be for
// steel/concrete (no equivalent enum exists for that axis). Returns null
// when the element's own IFC type carries no PredefinedType attribute at
// all (verified: IfcColumn/IfcBeam/IfcWallStandardCase in IFC2X3 have none)
// rather than a guessed default.
export async function getElementNameAndPredefinedType(
  handle: IfcModelHandle, expressID: number,
): Promise<{ name: string; predefinedType: string | null }> {
  const props = await handle.api.properties.getItemProperties(handle.modelID, expressID, false)
  const predefinedType = props.PredefinedType === undefined || props.PredefinedType === null
    ? null
    : unwrapIfcValue(props.PredefinedType)
  return { name: unwrapIfcValue(props.Name), predefinedType }
}

// This element's own real, authored IfcElementQuantity area (NetArea
// preferred over GrossArea when both exist — Net excludes openings/voids,
// the more accurate "actual footprint" figure), instead of
// ifcScheduleExtraction.ts's own bounding-box approximation (2026-07-18,
// per Maro's own QA: "how are you deriving the area quantities, i dont see
// any area reference in the object informations per element" — confirmed
// the bounding-box method was silently overstating area for anything
// non-rectangular, since it never checked for a real Qto value in the
// first place). Returns null when the element carries no quantity set at
// all — verified against the real Snowdon sample files: none of the 6
// contain a single IfcElementQuantity entity (a common gap in Revit's
// default IFC export, "Export base quantities" not enabled at export time)
// — so this is forward-looking for IFC files from other tools that do
// populate it, not something that changes anything for those particular
// files. getPropertySets (not a dedicated "get quantities" call — web-ifc
// has none; IfcElementQuantity is fetched via the exact same
// IfcRelDefinesByProperties relationship as a plain IfcPropertySet, see
// PropsNames.psets in web-ifc's own source) returns a mix of both kinds;
// only the ones with a `.Quantities` array (not `.HasProperties`) are
// quantity sets.
export async function getElementQuantityArea(handle: IfcModelHandle, expressID: number): Promise<number | null> {
  const psets = await handle.api.properties.getPropertySets(handle.modelID, expressID, true, false)
  let grossArea: number | null = null
  for (const pset of psets as Record<string, unknown>[]) {
    const quantities = pset.Quantities
    if (!Array.isArray(quantities)) continue
    for (const q of quantities as Record<string, unknown>[]) {
      const name = unwrapIfcValue(q.Name)
      if (name !== 'NetArea' && name !== 'GrossArea') continue
      const value = Number(unwrapIfcValue(q.AreaValue))
      if (Number.isNaN(value)) continue
      if (name === 'NetArea') return value
      grossArea = value
    }
  }
  return grossArea
}

// A storey's own Elevation attribute, raw and unconverted (2026-07-11, per
// Maro comparing against Bonsai/Blender's IFC panel — its Spatial
// Decomposition list shows each storey's height). Not unit-converted to
// feet/metres: that needs reading the model's own IfcUnitAssignment (Revit
// exports are commonly millimetres, others metres), which nothing in this
// codebase parses yet and couldn't be verified here against a real file (no
// sample .ifc available in this environment, and this file's own header
// explains why that verification step matters before trusting a web-ifc
// property shape). Shown as whatever raw number the file itself stores, not
// a guessed unit.
export async function getElementElevation(handle: IfcModelHandle, expressID: number): Promise<string | null> {
  const props = await handle.api.properties.getItemProperties(handle.modelID, expressID, false)
  if (props.Elevation === undefined || props.Elevation === null) return null
  const value = unwrapIfcValue(props.Elevation)
  return value === '—' ? null : value
}

export interface IfcPropertySetView {
  name: string
  properties: { name: string; value: string }[]
}

export interface IfcElementInfo {
  expressID: number
  type: string
  name: string
  globalId: string
  objectType: string
  tag: string
  predefinedType: string
  propertySets: IfcPropertySetView[]
}

export async function getElementInfo(handle: IfcModelHandle, expressID: number): Promise<IfcElementInfo> {
  const props = await handle.api.properties.getItemProperties(handle.modelID, expressID, false)
  const psets = await handle.api.properties.getPropertySets(handle.modelID, expressID, true, false)
  return {
    expressID,
    type: typeof props.type === 'number' ? handle.api.GetNameFromTypeCode(props.type) : String(props.type ?? ''),
    name: unwrapIfcValue(props.Name),
    globalId: unwrapIfcValue(props.GlobalId),
    objectType: unwrapIfcValue(props.ObjectType),
    tag: unwrapIfcValue(props.Tag),
    predefinedType: unwrapIfcValue(props.PredefinedType),
    propertySets: psets.map((p: Record<string, unknown>) => ({
      name: unwrapIfcValue(p.Name),
      properties: Array.isArray(p.HasProperties)
        ? p.HasProperties.map((prop: Record<string, unknown>) => ({
            name: unwrapIfcValue(prop.Name),
            value: unwrapIfcValue(prop.NominalValue),
          }))
        : [],
    })),
  }
}

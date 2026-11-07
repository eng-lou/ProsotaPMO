import * as THREE from 'three'
import {
  IfcAPI, IFCRELAGGREGATES, IFCRELASSOCIATESMATERIAL, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELDEFINESBYPROPERTIES, IFCRELDEFINESBYTYPE,
  IFCPROJECT, IFCSTYLEDITEM, IFCCURTAINWALL,
} from 'web-ifc'
import { disposeMeshGeometries, disposeMeshMaterials } from './elementBaseline'
import { disposeEdgesBatch, type BatchState, type EdgesBatch } from './elementBatching'

import { buildIfcScene } from './ifcGeometryStream'

/** Explicit IFC assembly identity, used only by the opt-in tower recipe. */
export function getCurtainWallAssemblies(handle: IfcModelHandle): Map<number, string> {
  const roots = new Map<number, string>()
  const ids = handle.api.GetLineIDsWithType(handle.ifcModelID, IFCCURTAINWALL)
  for (let i = 0; i < ids.size(); i++) {
    const id = ids.get(i)
    const guid = getGuidFromExpressId(handle, id)
    if (guid) roots.set(id, guid)
  }
  if (!roots.size) return roots
  const children = new Map<number, number[]>()
  const rels = handle.api.GetLineIDsWithType(handle.ifcModelID, IFCRELAGGREGATES)
  for (let i = 0; i < rels.size(); i++) {
    const rel = handle.api.GetLine(handle.ifcModelID, rels.get(i), false)
    const parent = rel.RelatingObject?.value
    if (parent !== undefined && Array.isArray(rel.RelatedObjects)) children.set(parent, [...(children.get(parent) ?? []), ...rel.RelatedObjects.map((r: { value: number }) => r.value)])
  }
  const result = new Map(roots)
  for (const [root, guid] of roots) {
    const queue = [root], seen = new Set<number>()
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      if (seen.has(id)) continue
      seen.add(id); result.set(id, guid)
      for (const child of children.get(id) ?? []) queue.push(child)
    }
  }
  return result
}
import { addRealisticPiece, clearRealisticFromBatch, createRealisticModelInfo, type RealisticModelInfo } from './realisticMaterials'
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
//
// One web-ifc engine PER MODEL, not one shared engine (2026-10-02, per Maro
// live: importing a Snowdon IFC died with "Cannot enlarge memory ...
// limit is 4294901760 bytes" / "Aborted(native code called abort())").
// web-ifc is 32-bit WebAssembly, so a single engine can never address more
// than 4 GB — a hard architectural ceiling, not a setting. Every model
// stays open in its engine after load (properties, GUID lookups, spatial
// tree all query it later), so with one shared engine *every* model loaded
// this session shared that one 4 GB. A fresh engine per model gives each
// its own 4 GB, and disposeIfcModel disposes it so the memory is actually
// released on unload. Loads are still strictly sequential (FourD.tsx's
// import/restore queues), so this never runs two engines' parses at once.
async function createApi(): Promise<IfcAPI> {
  const api = new IfcAPI()
  api.SetWasmPath('/wasm-ifc/', true)
  await api.Init(undefined, true)
  return api
}

// The app-wide model id (`ifc-${modelID}` keys everywhere in FourD) — each
// engine numbers its own models from 0, so the engine's id can't double as
// a session-unique identity any more. Same numbering the shared engine used
// to produce (0, 1, 2, ... per page load).
let nextAppModelId = 0

// BatchState/BatchInstanceInfo/ensureMaterialized all live in
// elementBatching.ts, not here (2026-07-17) — see that file's own header:
// Viewport3D.tsx needs ensureMaterialized but must never statically import
// anything from this file (web-ifc weight), and BatchState/BatchInstanceInfo
// have zero web-ifc dependency of their own, so they moved with it.
export interface IfcModelHandle {
  api: IfcAPI
  // Session-unique app id — use for identity/keys only, never pass to `api`.
  modelID: number
  // This model's id inside its own engine — the one every `api` call takes.
  ifcModelID: number
  object: THREE.Group
  // Null only if the file had zero placeable geometry at all (2026-07-21 —
  // every element's geometry goes into the shared batch now, unique or
  // repeated; see elementBatching.ts's own header for why this changed).
  batch: BatchState | null
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
  const api = await createApi()
  let modelID: number | undefined
  try {
    // Keep the input buffer out of the scene-building scope: a large IFC's
    // bytes can be reclaimed once OpenModel has parsed the records.
    modelID = api.OpenModel(new Uint8Array(await file.arrayBuffer()))
    const { object, batch, recenterOffset } = buildIfcScene(api, modelID, file.name, sharedRecenterOffset)
    sharedRecenterOffset = recenterOffset
    return { api, modelID: nextAppModelId++, ifcModelID: modelID, object, batch }
  } catch (error) {
    // Geometry extraction can fail too; never leave its native engine alive.
    if (modelID !== undefined) { try { api.CloseModel(modelID) } catch { /* engine may have aborted */ } }
    try { api.Dispose() } catch { /* preserve the original import error */ }
    throw error
  }
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
  const result = handle.api.GetExpressIdFromGuid(handle.ifcModelID, guid)
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
  const result = handle.api.GetGuidFromExpressId(handle.ifcModelID, expressID)
  return result === undefined ? undefined : String(result)
}

// A snapshot-quality type name for a given expressID — same reasoning as
// getGuidFromExpressId above (Collections' element_label needs *something*
// readable, not a full getElementInfo property-set fetch). Same
// GetNameFromTypeCode call getTypeCounts below already uses, just for one
// specific element instead of every type in the model.
export function getElementTypeName(handle: IfcModelHandle, expressID: number): string {
  return handle.api.GetNameFromTypeCode(handle.api.GetLineType(handle.ifcModelID, expressID))
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
    // Same exclusion, same reason, for the batched Edges overlay's own
    // InstancedMesh-per-shape children (2026-07-25, elementBatching.ts's
    // own buildEdgesBatch) — disposeMeshMaterials would otherwise dispose
    // EDGES_LINE_MATERIAL, a module-level singleton *shared across every
    // model this session*, breaking edges for every other still-open model
    // the instant any one of them unloads. Disposed correctly below instead
    // (geometries only, never the shared material).
    if (child.userData.isEdgesBatchMesh) return
    // Disposed by clearRealisticFromBatch below.
    if (child.userData.isRealisticGlassBatch) return
    if (child instanceof THREE.Mesh && child !== batchMesh) {
      disposeMeshGeometries(child)
      disposeMeshMaterials(child, false)
    }
  })
  if (handle.batch) {
    clearRealisticFromBatch(handle.batch)
    handle.batch.mesh.material && (Array.isArray(handle.batch.mesh.material) ? handle.batch.mesh.material.forEach(m => m.dispose()) : handle.batch.mesh.material.dispose())
    handle.batch.mesh.dispose()
    for (const entry of handle.batch.geometryByIfcId.values()) entry.geometry.dispose()
  }
  const edgesBatch = handle.object.userData.edgesBatch as EdgesBatch | undefined
  if (edgesBatch) disposeEdgesBatch(edgesBatch)
  handle.api.CloseModel(handle.ifcModelID)
  // Releases this model's whole engine (see createApi's header).
  handle.api.Dispose()
}

export function getTypeCounts(handle: IfcModelHandle): { typeName: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const name of buildIfcTypeByExpressId(handle).values()) counts.set(name, (counts.get(name) ?? 0) + 1)
  return Array.from(counts, ([typeName, count]) => ({ typeName, count })).sort((a, b) => b.count - a.count)
}

// Select from the same placed-element index as the type list and Materials.
export function getExpressIdsForType(handle: IfcModelHandle, typeName: string): number[] {
  const out: number[] = []
  for (const [id, name] of buildIfcTypeByExpressId(handle)) if (name === typeName) out.push(id)
  return out
}

// Per-handle memoization for buildIfcTypeByExpressId/buildElementPropertyData
// below (2026-09-01, per Maro: "optimise and reduce waste, improve speed" —
// a real, already-measured cost, not a guess: buildElementPropertyData's
// own header below documents a *confirmed* 16.5s scan on a real 131k-
// element high-rise, and it was being recomputed from scratch every time
// either the Schedule Wizard (ifcScheduleExtraction.ts) or the Filter
// dialog (ElementFilterDialog.tsx) called it — on a project that already
// ran Generate Schedule (which calls this exact function), opening Filter
// afterward paid that same 16.5s again for data that hadn't changed at
// all. WeakMap-keyed on the handle itself: nothing to invalidate, since a
// loaded IFC model's own psets/types never change after import, and a
// handle that gets unloaded/GC'd takes its cache entry with it for free —
// no manual cleanup needed on Unload/re-import. Caches the *Promise* (not
// just the eventual value) so two near-simultaneous callers — e.g.
// opening Filter right as Generate Schedule finishes — share the one real
// in-flight scan instead of racing two of them.
const ifcTypeByExpressIdCache = new WeakMap<IfcModelHandle, Map<number, string>>()
const elementPropertyDataCache = new WeakMap<IfcModelHandle, Promise<{
  quantityAreaByExpressId: Map<number, number>
  categoryByExpressId: Map<number, string>
  loadBearingByExpressId: Map<number, boolean>
}>>()

// Index elements, not the geometry records that describe them. A faceted
// model can have millions of points/faces per few thousand elements; indexing
// those records exhausted the JS Map limit on Fort Tower. Bulk-read element
// types, then cover rendered non-elements (e.g. spaces and annotations).
export function buildIfcTypeByExpressId(handle: IfcModelHandle): Map<number, string> {
  const cached = ifcTypeByExpressIdCache.get(handle)
  if (cached) return cached
  const result = new Map<number, string>()
  // GetAllTypesOfModel enumerates line IDs for every schema type internally,
  // including millions of points/faces. Filter schema codes before querying WASM.
  for (const typeID of handle.api.GetIfcEntityList(handle.ifcModelID)) {
    if (!handle.api.IsIfcElement(typeID)) continue
    const typeName = handle.api.GetNameFromTypeCode(typeID)
    const ids = handle.api.GetLineIDsWithType(handle.ifcModelID, typeID)
    for (let i = 0; i < ids.size(); i++) result.set(ids.get(i), typeName)
  }
  const addRenderedType = (id: number) => {
    if (!result.has(id)) result.set(id, handle.api.GetNameFromTypeCode(handle.api.GetLineType(handle.ifcModelID, id)))
  }
  if (handle.batch) for (const id of handle.batch.byExpressId.keys()) addRenderedType(id)
  const meshIndex = handle.object.userData.expressIdMeshIndex as Map<number, THREE.Mesh[]> | undefined
  if (meshIndex) for (const id of meshIndex.keys()) addRenderedType(id)
  ifcTypeByExpressIdCache.set(handle, result)
  return result
}

export interface IfcTreeNode {
  expressID: number
  type: string
  children: IfcTreeNode[]
}

export async function getSpatialTree(handle: IfcModelHandle): Promise<IfcTreeNode> {
  return handle.api.properties.getSpatialStructure(handle.ifcModelID, false) as unknown as Promise<IfcTreeNode>
}

// Bulk element -> storey resolution (2026-07-25 fix, per Maro: "Maximum
// call stack size exceeded" scanning a real high-rise — 131,222 schedulable
// candidates — via Generate Schedule). ifcScheduleExtraction.ts's own
// buildStoreyMap used to get this from getSpatialTree above
// (collectStoreyNodes/collectLeafExpressIds walked its result recursively),
// but that tree has one node per *element*, not just per spatial container
// — web-ifc's own getSpatialNode/getChildren (web-ifc-api.js) builds it by
// awaiting one WASM round trip per node, one at a time, and
// collectLeafExpressIds then walks the finished tree with plain
// synchronous recursion and no depth guard. Confirmed live against this
// exact file: building that tree was the dominant cost by far (15+
// minutes, almost entirely spent before the per-candidate scan loop even
// started ticking) — and however deep this particular export's own
// IfcRelAggregates nesting turns out to be is exactly the kind of thing
// synchronous, unbounded recursion over it is one bad export away from
// overflowing the call stack on.
//
// This reads the same fact a different way, without ever building that
// tree: every real, placed element in a normal IFC export relates to its
// containing storey via exactly one IfcRelContainedInSpatialStructure
// relationship — a flat, one-level fact. Reading that relationship type in
// bulk (one GetLineIDsWithType call, then one GetLine per relationship
// *instance* — typically one or a handful per storey, each carrying a
// RelatedElements array of however many elements that storey contains, not
// one WASM call per element) costs a small, fixed number of round trips
// regardless of model size. IfcRelAggregates is read the same way for the
// one real exception: an assembly's own sub-parts (Curtain Wall mullions/
// panels under their IfcCurtainWall, Revit "Assembly" instances) relate to
// their *assembly* via aggregation, not directly to a storey — the assembly
// itself is what's spatially contained. resolveStoreyId below walks that
// aggregation parent chain, preferring a direct spatial-containment hit at
// every step and memoizing as it goes (many real elements share the same
// storey/assembly ancestor) — bounded by real assembly-nesting depth (a
// handful of levels in practice), nothing like "one hop per element in the
// model" the old tree-walk needed, and cycle-guarded regardless.
export async function buildElementStoreyMap(
  handle: IfcModelHandle,
): Promise<Map<number, { name: string; elevationMetres: number | null }>> {
  const storeyExpressIds = getExpressIdsForType(handle, 'IfcBuildingStorey')
  const projectExpressIds = getExpressIdsForType(handle, 'IfcProject')
  const toMetres = projectExpressIds.length > 0 ? getLengthUnitToMetres(handle, projectExpressIds[0]) : 1

  const storeyInfoByExpressId = new Map<number, { name: string; elevationMetres: number | null }>()
  await Promise.all(storeyExpressIds.map(async storeyId => {
    const [name, elevationRaw] = await Promise.all([
      getElementName(handle, storeyId),
      getElementElevation(handle, storeyId),
    ])
    storeyInfoByExpressId.set(storeyId, {
      name,
      elevationMetres: elevationRaw === null ? null : Number(elevationRaw) * toMetres,
    })
  }))

  // child expressID -> its direct spatial container's expressID (usually a
  // storey, occasionally an IfcSpace within one — resolveStoreyId's own
  // parent-chain walk handles that case too, since an IfcSpace is itself
  // aggregated from its storey).
  const containedByExpressId = new Map<number, number>()
  const containsRelIds = handle.api.GetLineIDsWithType(handle.ifcModelID, IFCRELCONTAINEDINSPATIALSTRUCTURE)
  for (let i = 0; i < containsRelIds.size(); i++) {
    const rel = handle.api.GetLine(handle.ifcModelID, containsRelIds.get(i), false) as
      { RelatingStructure?: { value: number }; RelatedElements?: { value: number }[] }
    const containerId = rel.RelatingStructure?.value
    if (containerId === undefined || !Array.isArray(rel.RelatedElements)) continue
    for (const ref of rel.RelatedElements) containedByExpressId.set(ref.value, containerId)
  }

  // child expressID -> its aggregation parent's expressID.
  const parentOfChild = new Map<number, number>()
  const aggregatesRelIds = handle.api.GetLineIDsWithType(handle.ifcModelID, IFCRELAGGREGATES)
  for (let i = 0; i < aggregatesRelIds.size(); i++) {
    const rel = handle.api.GetLine(handle.ifcModelID, aggregatesRelIds.get(i), false) as
      { RelatingObject?: { value: number }; RelatedObjects?: { value: number }[] }
    const parentId = rel.RelatingObject?.value
    if (parentId === undefined || !Array.isArray(rel.RelatedObjects)) continue
    for (const ref of rel.RelatedObjects) parentOfChild.set(ref.value, parentId)
  }

  const resolvedStoreyIdByExpressId = new Map<number, number | null>()
  function resolveStoreyId(expressID: number): number | null {
    const cached = resolvedStoreyIdByExpressId.get(expressID)
    if (cached !== undefined) return cached
    const path: number[] = []
    const seen = new Set<number>()
    let current: number | undefined = expressID
    let result: number | null = null
    while (current !== undefined && !seen.has(current)) {
      const alreadyResolved = resolvedStoreyIdByExpressId.get(current)
      if (alreadyResolved !== undefined) { result = alreadyResolved; break }
      if (storeyInfoByExpressId.has(current)) { result = current; break }
      seen.add(current)
      path.push(current)
      current = containedByExpressId.get(current) ?? parentOfChild.get(current)
    }
    for (const id of path) resolvedStoreyIdByExpressId.set(id, result)
    return result
  }

  const elementToStorey = new Map<number, { name: string; elevationMetres: number | null }>()
  // Every element mentioned by either relationship type is a real candidate
  // for resolution — bounded by relationship count (how many elements a
  // storey/assembly actually references), not full model size, so
  // resolving all of them up front is cheap regardless of how many of them
  // the caller's own candidate list actually ends up using.
  const allReferenced = new Set<number>([...containedByExpressId.keys(), ...parentOfChild.keys()])
  for (const id of allReferenced) {
    const storeyId = resolveStoreyId(id)
    const info = storeyId !== null ? storeyInfoByExpressId.get(storeyId) : undefined
    if (info) elementToStorey.set(id, info)
  }

  return elementToStorey
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
    const project = handle.api.GetLine(handle.ifcModelID, projectExpressID, true) as {
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

// The model's own length unit, read from its IfcProject directly and cached
// per model (2026-09-30). The two callers (TransformPanel's unit factor on
// every change of active model, and each new measurement) used to build the
// whole getSpatialTree first just to learn the project's expressID: one
// WASM round trip per element, ~255ms on the 2018 hospital model, measured
// live as the long task after "select an element" and "Select All". A
// model's unit never changes, so one lookup per model is enough.
const lengthUnitCache = new WeakMap<IfcModelHandle, number>()
export function getModelLengthUnitToMetres(handle: IfcModelHandle): number {
  const cached = lengthUnitCache.get(handle)
  if (cached !== undefined) return cached
  let factor = 1
  try {
    const projectIds = handle.api.GetLineIDsWithType(handle.ifcModelID, IFCPROJECT)
    if (projectIds.size() > 0) factor = getLengthUnitToMetres(handle, projectIds.get(0))
  } catch {
    factor = 1
  }
  lengthUnitCache.set(handle, factor)
  return factor
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
  const props = await handle.api.properties.getItemProperties(handle.ifcModelID, expressID, false)
  return unwrapIfcValue(props.Name)
}

// Bulk Name + PredefinedType read across a whole candidate list (2026-07-25
// perf fix, per Maro: "optimise that too" — the per-candidate scan loop in
// ifcScheduleExtraction.ts stayed slow (~50 elements/sec on a real
// 131,222-candidate high-rise, tens of minutes projected) even after
// buildElementStoreyMap above fixed the storey-resolution stall, because it
// called this function once per element. That used to go through
// properties.getItemProperties, which is just `return this.api.GetLine(...)`
// (web-ifc-api.js) — and GetLine itself is really GetLines(modelID, [id])
// under the hood, a full native WASM round trip for exactly one element.
// GetLines happily accepts the WHOLE candidate array and pays that round
// trip exactly once regardless of array size — the same "one call per
// element" cost class buildElementStoreyMap already fixed for spatial
// containment, collapsed here from one call per element to one call total.
// PredefinedType matters far more than raw IFC type alone for a Revit
// export — verified against a real reference file
// (2018_Hospital_Structural.ifc): 538 of its 612 IfcSlab elements are 'Pile
// Cap-9 Pile:...' foundation elements with PredefinedType=.BASESLAB., not
// floor slabs, and Revit exported them as IfcSlab rather than IfcFooting
// anyway — only 74 are genuine .FLOOR. slabs. Missing on an element whose
// IFC type carries no PredefinedType attribute at all (verified:
// IfcColumn/IfcBeam/IfcWallStandardCase in IFC2X3 have none), rather than a
// guessed default.
// Chunked, not one GetLines(modelID, expressIds) call for the whole array
// (2026-07-25 fix, caught live against this exact high-rise file: a single
// call with all 131,222 candidate ids in one array reproduced the exact
// same "Maximum call stack size exceeded" this whole perf pass was meant to
// fix — web-ifc's own JS-side marshaling of a very large input array hits
// some internal recursion limit of its own well before any WASM memory
// limit, a different mechanism from this app's own now-removed tree-walk
// but the same failure mode). 5,000 ids per call keeps every real file
// tested well clear of that limit while still collapsing candidates.length
// round trips down to a small, fixed handful (27 calls for this exact
// file, not 131,222) — nearly all of the original bulk win, none of the
// crash risk.
const GET_LINES_CHUNK_SIZE = 5000

function getLinesChunked(
  handle: IfcModelHandle, expressIds: number[], flatten: boolean,
): Array<Record<string, unknown> & { expressID: number }> {
  const out: Array<Record<string, unknown> & { expressID: number }> = []
  for (let i = 0; i < expressIds.length; i += GET_LINES_CHUNK_SIZE) {
    const chunk = expressIds.slice(i, i + GET_LINES_CHUNK_SIZE)
    out.push(...(handle.api.GetLines(handle.ifcModelID, chunk, flatten) as Array<Record<string, unknown> & { expressID: number }>))
  }
  return out
}

export function getElementNamesAndPredefinedTypes(
  handle: IfcModelHandle, expressIds: number[],
): Map<number, { name: string; predefinedType: string | null }> {
  const result = new Map<number, { name: string; predefinedType: string | null }>()
  if (expressIds.length === 0) return result
  const lines = getLinesChunked(handle, expressIds, false)
  for (const line of lines) {
    const predefinedType = line.PredefinedType === undefined || line.PredefinedType === null
      ? null
      : unwrapIfcValue(line.PredefinedType)
    result.set(line.expressID, { name: unwrapIfcValue(line.Name), predefinedType })
  }
  return result
}

// Bulk NetArea/GrossArea read across the WHOLE model (2026-07-25 perf fix,
// same "optimise that too" motivation as getElementNamesAndPredefinedTypes
// above) — replaces a former per-element getElementQuantityArea, which used
// properties.getPropertySets to walk IfcRelDefinesByProperties via web-ifc's
// own inverse-property lookup (getRelatedProperties): the element's own
// inverse "IsDefinedBy" relations (1 GetLine), each relation's own
// RelatingPropertyDefinition (1 GetLine), then each referenced pset/
// quantity-set line itself (1 GetLine) — 2-3 sequential native round trips
// PER element, worse than getElementNamesAndPredefinedTypes' one-call cost
// even before its own fix. Reads IfcRelDefinesByProperties in bulk exactly
// like buildElementStoreyMap reads IfcRelContainedInSpatialStructure/
// IfcRelAggregates above (one GetLineIDsWithType + one GetLine per relation
// *instance*, not per element), then bulk-reads every referenced pset/
// quantity-set line in one GetLines call (flatten=true, so nested
// Quantities values resolve inline — matching the old function's own
// getPropertySets(..., true, false) call) instead of one GetLine per pset.
// Whole-model, not scoped to a candidate list (2026-07-25) — unlike
// getElementNamesAndPredefinedTypes, the caller doesn't know which elements
// even have a quantity set until after the relationships are read anyway,
// and the relationship/pset bulk reads themselves cost the same fixed,
// small number of round trips regardless of how many elements end up in
// the result.
//
// NetArea preferred over GrossArea when both exist (2026-07-18, per Maro's
// own QA: "how are you deriving the area quantities, i dont see any area
// reference in the object informations per element" — confirmed
// ifcScheduleExtraction.ts's own bounding-box approximation was silently
// overstating area for anything non-rectangular, since it never checked for
// a real Qto value in the first place) — Net excludes openings/voids, the
// more accurate "actual footprint" figure. An element absent from the
// returned map carries no quantity set at all — verified against the real
// Snowdon sample files: none of the 6 contain a single IfcElementQuantity
// entity (a common gap in Revit's default IFC export, "Export base
// quantities" not enabled at export time) — so this is forward-looking for
// IFC files from other tools that do populate it.
//
// Recommended Revit IFC export settings (2026-07-21, per Maro, going
// forward for every new export) — confirmed against this app's own actual
// import pipeline, not generic advice:
//   - General tab: File type = plain IFC, never IfcXML or a zipped
//     variant — loadIfcModel above calls web-ifc's OpenModel on raw STEP-
//     format bytes; anything else fails to load entirely.
//   - Property Sets tab: "Export base quantities" ON — the exact gap this
//     function's own header documents above; without it every non-
//     rectangular element's area is a bounding-box guess instead of
//     Revit's own real NetArea/GrossArea.
//   - Advanced tab: "Keep Tessellated Geometry as Triangulation" ON — a
//     real Revit export without this produces raw BREP solids that
//     web-ifc has to triangulate itself at import time, and its
//     triangulator throws a real, repeated
//     `[WEB-IFC][error][TriangulateBounds()] No basis found for brep!`
//     for certain degenerate faces (confirmed against a real 6-file
//     Snowdon-scale import, hundreds of these per file). Pre-triangulated
//     geometry from Revit skips that conversion — and its failure mode —
//     for those elements entirely.
//   - Level of Detail tab: Medium, not the highest tessellation setting —
//     more detail is directly more vertices for loadIfcModel's own Pass 2/3
//     to parse and batch, independent of anything the batching rewrite
//     above already optimized.
// No toMetres scaling here — confirmed wrong, not just unneeded (2026-07-22,
// per Maro, after a real Hotel export WITH base quantities enabled still
// produced an absurd multi-year activity duration). First suspected this
// function needed the same toMetres scaling measureElement's bounding-box
// fallback already applies (this file's own now-reverted comment argued
// exactly that) — but a real diagnostic against the actual file (logging
// raw AreaValue alongside toMetres for every Slabs element on the affected
// storey) proved that wrong: raw AreaValue numbers already read as
// plausible real-world m² as-is (a footing ~95, an asphalt road ~9,470, a
// green area ~1,119) — applying toMetres² on top shrank a genuine ~95 m²
// footing down to ~0.0000955 m². IFC's own AREAUNIT is declared
// independently of LENGTHUNIT precisely for this reason (a
// IfcQuantityArea.Unit override, or the project's own default AREAUNIT,
// neither of which has to be "LENGTHUNIT squared") — Revit's real export
// behaviour here is to declare AREAUNIT as SQUARE_METRE outright regardless
// of a millimetre LENGTHUNIT, so AreaValue already needs no conversion.
// (The real cause of that absurd duration was a *classification* bug, not
// a units one — see isSiteElement's own header, ifcScheduleExtraction.ts.)
//
// Also the source of getElementCategories' own Pset_ProductRequirements.
// Category read (2026-07-25, per Maro: "you can see the object information/
// property set data. e.g name, object type, category... so improve your
// schedule generation logic" — real misclassified examples found via the
// Object Information panel, e.g. an IfcPlate named "System Panel:01-BROWN
// PANELS" with Category="Curtain Panels" landing in Structural Members
// instead of Curtain Walls; see ifcScheduleExtraction.ts's own
// CATEGORY_PROPERTY_OVERRIDES for how this gets used). Folded into this same
// function — renamed from buildElementQuantityAreaMap — rather than a
// second, separate bulk relationship/pset scan: Category is a plain
// (non-quantity) property set, needed for every file regardless of whether
// it has any IfcElementQuantity at all, so gating it behind the old
// hasQuantitySets pre-check (still fine for the *quantity* half) would have
// silently skipped classification-relevant Category data on exactly the
// Revit exports ("Export base quantities" off) already documented above as
// the common case. One bulk relationship+pset read now serves both.
//
// Pset_WallCommon.LoadBearing added the same way (2026-07-25, per Maro's own
// real example: exterior walls appearing simultaneously with the structural
// core in a real Animation Timeline check — "those external walls that are
// darker are not really part of the structural core") — a real, plain
// (non-quantity) boolean property, same read pattern as Category, just off
// a different Pset by name. See ifcScheduleExtraction.ts's own
// 'Non-Structural Walls' classification (extractScheduleElements) for how
// this reclassifies a wall out of the structural-climb-gating 'Walls'
// category.
export function buildElementPropertyData(handle: IfcModelHandle): Promise<{
  quantityAreaByExpressId: Map<number, number>
  categoryByExpressId: Map<number, string>
  loadBearingByExpressId: Map<number, boolean>
}> {
  const cached = elementPropertyDataCache.get(handle)
  if (cached) return cached
  // Evicted on rejection (2026-09-01) — this is a pure computation over
  // already-loaded, static WASM data, so a failure would almost certainly
  // repeat on retry anyway, but there's no reason to *guarantee* every
  // future call permanently re-throws the same cached rejection instead
  // of getting a fresh attempt.
  const promise = buildElementPropertyDataUncached(handle).catch(err => {
    elementPropertyDataCache.delete(handle)
    throw err
  })
  elementPropertyDataCache.set(handle, promise)
  return promise
}

async function buildElementPropertyDataUncached(handle: IfcModelHandle): Promise<{
  quantityAreaByExpressId: Map<number, number>
  categoryByExpressId: Map<number, string>
  loadBearingByExpressId: Map<number, boolean>
}> {
  const elementToPsetIds = new Map<number, number[]>()
  const psetIdSet = new Set<number>()
  // One GetLine call per relation instance, deliberately NOT getLinesChunked
  // (2026-07-25 — tried the bulk-chunked read here, matching the pattern
  // used two lines below for the psets themselves; measured directly via
  // console.time on this exact real 131k-element/95k-IfcMember high-rise
  // file and it made this function slower, not faster — 37.0s bulk-chunked
  // vs 16.5s with the per-instance GetLine loop below. Root cause not fully
  // isolated, but IFCRELDEFINESBYPROPERTIES lines carry an array-valued
  // RelatedObjects field, unlike the flat pset lines getLinesChunked already
  // works well for — bulk-marshaling many such lines back across the WASM
  // boundary in one GetLines() response is apparently more expensive here
  // than paying the per-call overhead of GetLine() individually. Measure any
  // future attempt to "optimise" this loop again with console.time against
  // this same file before assuming the usual bulk-read pattern applies.
  //
  // Made async + yielding every 2000 relations (2026-07-25, per Maro: this
  // exact 16.5s stretch on a real 131k-element high-rise runs with zero
  // progress feedback and fully blocks the main thread — indistinguishable
  // from a genuine hang to anyone watching the wizard, and worse on a more
  // loaded machine than the one this was measured on). Doesn't make the
  // underlying per-relation GetLine cost any faster (same total relation
  // count, same per-call cost) — it keeps the tab responsive (paint/input
  // events can still run between chunks) while it works through them,
  // exactly the same "chunked, not one giant synchronous loop" fix already
  // applied to extractScheduleElements' own per-candidate loop.
  const relIds = handle.api.GetLineIDsWithType(handle.ifcModelID, IFCRELDEFINESBYPROPERTIES)
  for (let i = 0; i < relIds.size(); i++) {
    const rel = handle.api.GetLine(handle.ifcModelID, relIds.get(i), false) as
      { RelatingPropertyDefinition?: { value: number }; RelatedObjects?: { value: number }[] }
    const psetId = rel.RelatingPropertyDefinition?.value
    if (psetId !== undefined && Array.isArray(rel.RelatedObjects)) {
      psetIdSet.add(psetId)
      for (const ref of rel.RelatedObjects) {
        const existing = elementToPsetIds.get(ref.value)
        if (existing) existing.push(psetId); else elementToPsetIds.set(ref.value, [psetId])
      }
    }
    if (i % 2000 === 0) await new Promise(resolve => setTimeout(resolve, 0))
  }

  const psetIds = [...psetIdSet]
  const psetById = new Map<number, Record<string, unknown>>()
  for (const line of getLinesChunked(handle, psetIds, true)) psetById.set(line.expressID, line)

  const quantityAreaByExpressId = new Map<number, number>()
  const categoryByExpressId = new Map<number, string>()
  const loadBearingByExpressId = new Map<number, boolean>()
  for (const [expressID, ids] of elementToPsetIds) {
    let netArea: number | null = null
    let grossArea: number | null = null
    for (const psetId of ids) {
      const pset = psetById.get(psetId)
      if (!pset) continue
      const quantities = pset.Quantities
      if (Array.isArray(quantities)) {
        for (const q of quantities as Record<string, unknown>[]) {
          const name = unwrapIfcValue(q.Name)
          if (name !== 'NetArea' && name !== 'GrossArea') continue
          const value = Number(unwrapIfcValue(q.AreaValue))
          if (Number.isNaN(value)) continue
          if (name === 'NetArea') netArea = value
          else grossArea = value
        }
      }
      // Pset_ProductRequirements.Category — Revit's own real classification
      // for this element (verified live: "Curtain Panels", "Site", "Ramps"
      // all seen on this exact high-rise file's real elements) — a plain
      // property (HasProperties), not a quantity (Quantities), so read off
      // the same pset line via getElementInfo's own unwrap idiom.
      if (unwrapIfcValue(pset.Name) === 'Pset_ProductRequirements' && Array.isArray(pset.HasProperties)) {
        for (const prop of pset.HasProperties as Record<string, unknown>[]) {
          if (unwrapIfcValue(prop.Name) !== 'Category') continue
          const category = unwrapIfcValue(prop.NominalValue)
          if (category !== '—') categoryByExpressId.set(expressID, category)
        }
      }
      // Pset_WallCommon.LoadBearing — real Revit-authored data (verified
      // live: false for both a real "01-POOL WALL" and "01-flower pot"
      // element), same unwrap idiom as Category just above.
      if (unwrapIfcValue(pset.Name) === 'Pset_WallCommon' && Array.isArray(pset.HasProperties)) {
        for (const prop of pset.HasProperties as Record<string, unknown>[]) {
          if (unwrapIfcValue(prop.Name) !== 'LoadBearing') continue
          const value = unwrapIfcValue(prop.NominalValue)
          if (value === 'true' || value === 'false') loadBearingByExpressId.set(expressID, value === 'true')
        }
      }
    }
    const area = netArea ?? grossArea
    if (area !== null) quantityAreaByExpressId.set(expressID, area)
  }
  return { quantityAreaByExpressId, categoryByExpressId, loadBearingByExpressId }
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
  const props = await handle.api.properties.getItemProperties(handle.ifcModelID, expressID, false)
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
  const props = await handle.api.properties.getItemProperties(handle.ifcModelID, expressID, false)
  const psets = await handle.api.properties.getPropertySets(handle.ifcModelID, expressID, true, false)
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

// Names for Realistic Materials mode (realisticMaterials.ts), per geometry
// piece: the IfcSurfaceStyle name styling that exact representation item
// (IfcStyledItem.Item is the same entity web-ifc reports as a placed
// geometry's geometryExpressID), the element's associated IfcMaterial
// name(s) (directly, or inherited from its type object), its IFC entity
// type, and whether the piece is transparent. Computed once per model, the
// first time the mode is switched on, and cached on the model's root by the
// caller.
type IfcLine = Record<string, unknown>

function refId(ref: unknown): number | null {
  if (typeof ref === 'number') return ref
  if (ref && typeof ref === 'object' && typeof (ref as { value?: unknown }).value === 'number') return (ref as { value: number }).value
  return null
}

function labelOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'value' in value) return String((value as { value: unknown }).value ?? '').trim()
  return ''
}

function refList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    const single = refId(value)
    return single === null ? [] : [single]
  }
  return value.map(refId).filter((id): id is number => id !== null)
}

export function extractRealisticMaterialInfo(handle: IfcModelHandle): RealisticModelInfo {
  const { api, ifcModelID: modelID } = handle
  const getLine = (id: number): IfcLine | null => {
    try { return api.GetLine(modelID, id, false) as IfcLine } catch { return null }
  }

  // Representation item -> surface style name.
  const styleByItem = new Map<number, string>()
  const styleNameCache = new Map<number, string>()
  const resolveStyleName = (id: number, depth: number): string => {
    const cached = styleNameCache.get(id)
    if (cached !== undefined) return cached
    const line = depth > 4 ? null : getLine(id)
    let name = ''
    if (line) {
      if ('Side' in line) name = labelOf(line.Name) // IfcSurfaceStyle
      else if ('Styles' in line) { // IfcPresentationStyleAssignment (IFC2x3)
        for (const child of refList(line.Styles)) { name = resolveStyleName(child, depth + 1); if (name) break }
      }
    }
    styleNameCache.set(id, name)
    return name
  }
  const styledItems = api.GetLineIDsWithType(modelID, IFCSTYLEDITEM)
  for (let i = 0; i < styledItems.size(); i++) {
    const line = getLine(styledItems.get(i))
    const item = line ? refId(line.Item) : null
    if (!line || item === null || styleByItem.has(item)) continue
    for (const styleId of refList(line.Styles)) {
      const name = resolveStyleName(styleId, 0)
      if (name) { styleByItem.set(item, name); break }
    }
  }

  // Element (or type object) -> material names, in layer order for a
  // layer set.
  const materialCache = new Map<number, { names: string[]; layered: boolean }>()
  const resolveMaterial = (id: number, depth: number): { names: string[]; layered: boolean } => {
    const cached = materialCache.get(id)
    if (cached) return cached
    const result = { names: [] as string[], layered: false }
    const line = depth > 6 ? null : getLine(id)
    const collect = (ids: number[]) => {
      for (const child of ids) {
        const r = resolveMaterial(child, depth + 1)
        for (const n of r.names) if (!result.names.includes(n)) result.names.push(n)
        result.layered ||= r.layered
      }
    }
    if (line) {
      if ('ForLayerSet' in line) { collect(refList(line.ForLayerSet)); result.layered = true }
      else if ('MaterialLayers' in line) { collect(refList(line.MaterialLayers)); result.layered = true }
      else if ('ForProfileSet' in line) collect(refList(line.ForProfileSet))
      else if ('MaterialProfiles' in line) collect(refList(line.MaterialProfiles))
      else if ('MaterialConstituents' in line) collect(refList(line.MaterialConstituents))
      else if ('Materials' in line) collect(refList(line.Materials))
      else if ('Material' in line) collect(refList(line.Material))
      else if ('Name' in line) { const n = labelOf(line.Name); if (n) result.names.push(n) }
    }
    materialCache.set(id, result)
    return result
  }
  const materialByObject = new Map<number, { names: string[]; layered: boolean }>()
  const associations = api.GetLineIDsWithType(modelID, IFCRELASSOCIATESMATERIAL)
  for (let i = 0; i < associations.size(); i++) {
    const rel = getLine(associations.get(i))
    const materialId = rel ? refId(rel.RelatingMaterial) : null
    if (!rel || materialId === null) continue
    const resolved = resolveMaterial(materialId, 0)
    if (resolved.names.length === 0) continue
    for (const objectId of refList(rel.RelatedObjects)) materialByObject.set(objectId, resolved)
  }
  const typeRels = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYTYPE)
  for (let i = 0; i < typeRels.size(); i++) {
    const rel = getLine(typeRels.get(i))
    const typeId = rel ? refId(rel.RelatingType) : null
    const typeMaterial = typeId !== null ? materialByObject.get(typeId) : undefined
    if (!rel || !typeMaterial) continue
    for (const objectId of refList(rel.RelatedObjects)) if (!materialByObject.has(objectId)) materialByObject.set(objectId, typeMaterial)
  }

  const typeByExpressId = buildIfcTypeByExpressId(handle)
  const info = createRealisticModelInfo()
  const addPiece = (expressID: number, geometryId: number | undefined, alpha: number) => {
    const material = materialByObject.get(expressID)
    addRealisticPiece(info, expressID, geometryId, {
      styleName: geometryId !== undefined ? styleByItem.get(geometryId) ?? '' : '',
      materialNames: material?.names ?? [],
      layered: material?.layered ?? false,
      ifcType: typeByExpressId.get(expressID) ?? '',
      transparent: alpha < 0.99,
    })
  }
  if (handle.batch) {
    for (const [expressID, infos] of handle.batch.byExpressId) {
      for (const inst of infos) addPiece(expressID, inst.ifcGeometryId, inst.colorAlpha)
    }
  }
  const meshIndex = handle.object.userData.expressIdMeshIndex as Map<number, THREE.Mesh[]> | undefined
  for (const [expressID, meshes] of meshIndex ?? []) {
    for (const mesh of meshes) addPiece(expressID, mesh.userData.ifcGeometryId as number | undefined, (mesh.userData.ifcColorAlpha as number | undefined) ?? 1)
  }
  return info
}

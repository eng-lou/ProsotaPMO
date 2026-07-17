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

// One shared THREE.BatchedMesh carries every element whose geometry repeats
// elsewhere in the file (2026-07-17, per Maro: "improve the original Prosota
// web version... the recommended strong fix" — the root cause this whole
// module was originally diagnosed for: one THREE.Mesh + one unique
// THREE.MeshStandardMaterial per element means element count directly
// becomes draw-call count). Only *repeated* geometry (e.g. typical
// fasteners/members reused via IfcMappedItem) goes into the batch; anything
// appearing exactly once keeps the fully individual THREE.Mesh path
// (ifcModel.ts's own loadIfcModel), so every existing per-element feature
// needs zero changes for it. A batched element only ever costs a real
// THREE.Mesh the moment something actually needs to touch it individually
// — see ensureMaterialized below, the one primitive every feature that
// needs a specific expressID's real Object3D calls before manipulating it.
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
  // — ensureMaterialized needs to go from "which instance" back to "which
  // shape" to build a standalone mesh for it.
  geometryByIfcId: Map<number, { geometry: THREE.BufferGeometry; geometryId: number }>
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
  let existing: THREE.Mesh | null = null
  rootObject.traverse(child => {
    if (!existing && child instanceof THREE.Mesh && child.userData.expressID === expressID) existing = child
  })
  if (existing) return existing

  const batch = rootObject.userData.batch as BatchState | null | undefined
  const infos = batch?.byExpressId.get(expressID)
  if (!batch || !infos || infos.length === 0) return null

  let firstMesh: THREE.Mesh | null = null
  for (const info of infos) {
    batch.mesh.setVisibleAt(info.instanceId, false)

    let sourceGeometry: THREE.BufferGeometry | null = null
    for (const entry of batch.geometryByIfcId.values()) {
      if (entry.geometryId === info.geometryId) { sourceGeometry = entry.geometry; break }
    }
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

import * as THREE from 'three'
import type { ElementSplit } from './elementSplits'
import { captureOriginalGeometry, captureOriginalMaterial } from './elementBaseline'
import type { IfcModelHandle } from './ifcModel'
import { ensureMaterialized } from './elementBatching'
import { worldSlicePlanes } from './sectionBoxGeometry'
import { buildSplitElementRef, splitTargetMapsByHandle, type SplitTargetMaps } from './splitElementRefs'
export { getSplitExpressId, getSplitElementRef } from './splitElementRefs'

// "Split an element by level" (2026-07-15, per Maro) — clipped virtual
// slices, not real geometry cutting: no cut/cap algorithm exists anywhere
// in this codebase, and building one to solve what's really a scheduling-
// accuracy problem (not a CAD-editing one) isn't worth the risk. Instead,
// for each ElementSplit row, this clones the one real mesh once per
// resulting piece (sharing its BufferGeometry — never duplicated — with
// its own cloned material) and restricts each clone to its own vertical
// range via material.clippingPlanes (worldSlicePlanes, sectionBoxGeometry.ts
// — built directly in world space, see that function's own header for why
// an earlier "local Z, transform via handle.object.matrixWorld" version was
// wrong on a real file: which *local* axis is "up" isn't reliably Z, so
// cut_elevations_m (SplitByLevelPanel.tsx) is itself derived from real
// rendered element positions, not the IFC file's own Elevation attribute).
//
// The key trick making this integrate with the rest of the app for free:
// every clone is added as a real child into the SAME IfcModelHandle.object
// THREE.Group the real IFC meshes already live in, tagged with a
// *synthetic* expressID (from a reserved, never-real range) instead of a
// real one. Every existing per-mesh system in this codebase (click-select,
// box-select, Isolate/Hide, ModelObjects' whole settings/material/render-
// mode pass, TimelinePlayback's animation resolution) already works
// generically off `child.userData.expressID` regardless of where a mesh
// came from — so a slice clone is picked up by all of those with zero
// changes to any of them. The only genuinely new resolution needed is
// mapping a slice's own element_ref string (`${parentGlobalId}::split:N`)
// to/from its synthetic expressID, which real elements get via
// ifcModel.getExpressIdFromGuid/getGuidFromExpressId — slices go through
// the small lookup functions below instead.
// Comfortably above any real file's own expressID range (a multi-million-
// entity IFC file is already an extreme outlier) — see this module's own
// header on why collision with a real id would be a correctness bug, not
// just a display glitch (every existing system trusts userData.expressID
// as *the* identity for a mesh).
const SYNTHETIC_EXPRESS_ID_BASE = 1_000_000_000

// Every real mesh in this handle currently tagged as "split away" — see
// the isSplitAway userData flag set below, read by Viewport3D.tsx's own
// ModelObjects effect (baseVisible computation) to keep an original
// element's own mesh hidden once it's been split into independently-
// animating pieces, the same way a manually-Hidden or animation-hidden
// element already stays out of the normal render/click/box-select set.
function clearStaleState(handle: IfcModelHandle): void {
  const stale: THREE.Object3D[] = []
  handle.object.traverse(child => {
    if (child.userData.isSplitClone) stale.push(child)
    else delete child.userData.isSplitAway
  })
  for (const child of stale) {
    child.parent?.remove(child)
    if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose()
  }
}

// Regenerates every slice clone for this handle from scratch against the
// current `splits` list (2026-07-15) — always a full rebuild rather than
// an incremental diff: split counts are small (a handful of elements, a
// handful of cuts each), so the redundant work on an unrelated re-run is
// cheap, and "remove everything, rebuild fresh" sidesteps any risk of
// drift between what's actually in the scene and what `splits` currently
// says should be there. Selection/isolate/hide state referencing a
// *previous* run's synthetic expressIDs simply goes stale/no-op across a
// rebuild — acceptable: changing which levels an element is split at makes
// whatever was selected of the old pieces meaningless anyway.
export async function regenerateSplitTargets(handle: IfcModelHandle, splits: ElementSplit[], upAxis: 'y' | 'z'): Promise<void> {
  clearStaleState(handle)

  const maps: SplitTargetMaps = { refToExpressId: new Map(), expressIdToRef: new Map() }
  splitTargetMapsByHandle.set(handle, maps)

  const ifcSplits = splits.filter(s => s.source_kind === 'ifc')
  if (ifcSplits.length === 0) return

  const ifcModel = await import('./ifcModel')
  const tree = await ifcModel.getSpatialTree(handle)
  const toMetres = ifcModel.getLengthUnitToMetres(handle, tree.expressID)

  let nextSyntheticId = SYNTHETIC_EXPRESS_ID_BASE

  for (const split of ifcSplits) {
    const expressId = ifcModel.getExpressIdFromGuid(handle, split.element_ref)
    if (expressId === undefined) continue

    // A complex element can be made of several separate geometry pieces
    // sharing one expressID (this session's earlier "31 truss members, one
    // wall/beam" fix to Viewport3D.tsx's own getExpressIdIndex) — every
    // piece needs cloning+clipping identically, not just the first one
    // found, or a multi-piece element would only partially split.
    // ensureMaterialized first (2026-07-17) — see elementBatching.ts's own
    // header: materializes *every* batched piece for this expressID (not
    // just one), so the traverse below actually finds all of them instead
    // of silently missing whichever pieces were still batched.
    ensureMaterialized(handle.object, expressId)
    const parentMeshes: THREE.Mesh[] = []
    handle.object.traverse(child => {
      if (child instanceof THREE.Mesh && child.userData.expressID === expressId && !child.userData.isSplitClone) {
        parentMeshes.push(child)
      }
    })
    if (parentMeshes.length === 0) continue
    parentMeshes.forEach(m => { m.userData.isSplitAway = true })

    // cut_elevations_m is stored as a real *world*-space elevation, already
    // in metres — see SplitByLevelPanel.tsx's own header on why it's
    // derived from actual rendered element positions (matrixWorld) rather
    // than the IFC file's own Elevation attribute, which doesn't reliably
    // correspond to rendered position on a real file. Dividing by toMetres
    // here just undoes the metres unit conversion (scene units stay in the
    // file's own raw declared unit throughout — loadIfcModel's own header)
    // — the result is directly usable as a world-space coordinate, no
    // further transform needed (worldSlicePlanes below).
    const rawCuts = [...split.cut_elevations_m].sort((a, b) => a - b).map(m => m / toMetres)
    const pieceCount = rawCuts.length + 1

    for (let i = 0; i < pieceCount; i++) {
      const worldMin = i === 0 ? null : rawCuts[i - 1]
      const worldMax = i === pieceCount - 1 ? null : rawCuts[i]
      const ref = buildSplitElementRef(split.element_ref, i)
      const syntheticId = nextSyntheticId++
      maps.refToExpressId.set(ref, syntheticId)
      maps.expressIdToRef.set(syntheticId, ref)

      for (const parentMesh of parentMeshes) {
        const clone = new THREE.Mesh(parentMesh.geometry, (parentMesh.material as THREE.MeshStandardMaterial).clone())
        clone.position.copy(parentMesh.position)
        clone.quaternion.copy(parentMesh.quaternion)
        clone.scale.copy(parentMesh.scale)
        clone.castShadow = parentMesh.castShadow
        clone.receiveShadow = parentMesh.receiveShadow
        // Deliberately a fresh userData object, not inherited from the
        // parent (three.js's own Object3D.clone() JSON-round-trips
        // userData, which would throw/corrupt on the parent's real
        // non-serializable entries like originalGeometry/standardMaterial
        // — see elementBaseline.ts — so this builds the clone directly
        // via `new THREE.Mesh(...)` rather than parentMesh.clone()).
        clone.userData = { expressID: syntheticId, splitElementRef: ref, isSplitClone: true }
        clone.material.clippingPlanes = worldSlicePlanes(worldMin, worldMax, upAxis)
        // A real bug, caught 2026-07-15 (per Maro: a Gouraud-mode slice
        // showing runaway "discoloration," and the same slice rendering
        // fully invisible in Rendered/Flat) — Viewport3D.tsx's own
        // ModelObjects effect only resets a mesh's colour/map/metalness/
        // roughness back to baseline via `getOriginalMaterialSlots(child)`
        // (elementBaseline.ts) *before* applying that render pass's
        // selection/variance/clash tint; every other imported mesh gets
        // that baseline from ifcModel.ts's own captureOriginalMaterial call
        // at import time, but a split clone never got one (deliberately
        // fresh userData, per this function's own header) — so each pass's
        // `mat.color.lerp(...)` blended the *already-tinted* colour from
        // the previous pass, compounding indefinitely across every
        // selection/settings change with no way back to the real colour.
        // captureOriginalGeometry alongside it for the same "every real
        // mesh gets one" reason (getOriginalGeometry only affects
        // displacement-subdivision, a smaller gap, but there's no reason to
        // leave a clone without it now that captureOriginalMaterial is
        // being called here anyway).
        captureOriginalMaterial(clone)
        captureOriginalGeometry(clone)
        parentMesh.parent?.add(clone)
      }
    }
  }
}

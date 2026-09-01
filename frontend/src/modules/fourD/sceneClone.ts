import * as THREE from 'three'
import { buildElementMaterial, type BatchState } from './elementBatching'

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
// (or the exploded-batch material below) is re-tagged the same way, into
// its own `userData.standardMaterial` — see that assignment's own comment
// for why: ComparisonViewportPane.tsx now DOES mirror the primary
// viewport's render mode (2026-09-01, per Maro — full parity was a
// deliberate reversal of this file's own original 2026-07-12 "always PBR"
// choice, see that pane's own render-mode effect), and needs a stable
// handle on the real material to swap the display material *from* every
// time the setting changes, not just once.
//
// Public entry point — thin wrapper around buildClone's own recursive
// descent (2026-07-24 restructure, for the BatchedMesh fix below): after
// the whole tree is built, this does one pass over the *finished clone*
// to populate its own `userData.expressIdMeshIndex` — the exact same
// `Map<number, THREE.Mesh[]>` shape elementBatching.ts's own getMeshIndex
// builds for a real model — so TimelinePlayback's element resolution
// (getMaterializedMeshes -> ensureMaterialized -> getMeshIndex) finds
// every clone mesh immediately via that index's own first check, without
// ever needing this cloned root to also carry a working `userData.batch`
// (it doesn't, and building a real second BatchState just to satisfy
// ensureMaterialized's fallback path would be a lot of machinery for
// something the index already makes unnecessary).
export function cloneSceneHierarchy(object: THREE.Object3D): THREE.Object3D {
  const batch = (object.userData.batch as BatchState | null | undefined) ?? null
  const clone = buildClone(object, batch)
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

function buildClone(object: THREE.Object3D, batch: BatchState | null): THREE.Object3D {
  // THREE.BatchedMesh extends THREE.Mesh (2026-07-24 fix, per Maro: the
  // Baseline pane showed a jumbled mess of disconnected, wrongly-angled
  // panels instead of the real building) — this used to fall into the
  // instanceof-Mesh branch below and wrap the *shared batch's own raw
  // internal geometry buffer* as if it were one plain mesh's shape. That
  // buffer is every still-batched element's geometry concatenated
  // together, each still sitting at its own un-transformed instance-local
  // origin (elementBatching.ts's own BatchState header) — none of it ever
  // gets positioned by each instance's own placement matrix except through
  // THREE.BatchedMesh's own per-instance rendering path, which a plain
  // THREE.Mesh knows nothing about. The result was every still-batched
  // element rendered piled on top of each other at the batch's own root
  // transform, instead of its real position in the building — exactly the
  // "disconnected panels" reported.
  //
  // Reconstructed instead as one plain clone Mesh per still-batched
  // instance, built from the exact same BatchInstanceInfo (geometry/
  // matrix/colour) ensureMaterialized itself reads to pull an instance out
  // of the batch for real (elementBatching.ts) — this only *reads* that
  // data, never calling setVisibleAt or deleting anything, so the live
  // model's own batching (and the primary viewport's draw-call count) is
  // completely untouched by opening the Baseline pane. No children to
  // recurse into afterward — a BatchedMesh is always a leaf.
  if ((object as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh) {
    const group = new THREE.Group()
    group.name = object.name
    group.visible = object.visible
    if (batch) {
      for (const [expressID, infos] of batch.byExpressId) {
        for (const info of infos) {
          const geometry = batch.geometryById.get(info.geometryId)
          if (!geometry) continue
          const mesh = new THREE.Mesh(geometry, buildElementMaterial({ x: info.color.r, y: info.color.g, z: info.color.b, w: info.colorAlpha }))
          mesh.applyMatrix4(info.matrix)
          mesh.userData.expressID = expressID
          // Same standardMaterial tag as the plain-Mesh branch below — see
          // that branch's own comment for why this has to be captured here,
          // at construction, rather than read off `.material` later.
          mesh.userData.standardMaterial = mesh.material
          group.add(mesh)
        }
      }
    }
    return group
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

  for (const child of object.children) clone.add(buildClone(child, batch))
  return clone
}

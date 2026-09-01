import * as THREE from 'three'
import type { SectionBoxBounds, SectionBoxRotation } from './sectionBoxes'

// Section Box bounds are stored in the TARGET OBJECT'S OWN LOCAL space, not
// world space (2026-07-09, per section_box.py's own docstring) — this app
// already lets a whole model or an individual element be repositioned/
// rotated/rescaled via TransformControls; world-space bounds would leave a
// box visually detached from its geometry the moment the target moves,
// whereas local-space bounds move/rotate/scale with the target
// automatically, same as its geometry does.

// Seeds a new box's initial bounds from whatever's currently selected
// (2026-07-09) — computes the world-space AABB the same way
// handleFrameSelected already does (THREE.Box3().setFromObject), then
// un-transforms its 8 corners into the target's own local space via the
// inverse of its current world matrix. This can slightly over-approximate
// the tightest possible local-space box when the target is already
// rotated (a world-aligned AABB's corners don't map back to a perfectly
// tight local AABB under rotation) — an acceptable v1 tradeoff, since the
// user can immediately drag any face back in afterward.
function localBoundsFromWorldBox(worldBox: THREE.Box3, target: THREE.Object3D): SectionBoxBounds {
  const inverse = target.matrixWorld.clone().invert()
  const corners = [
    new THREE.Vector3(worldBox.min.x, worldBox.min.y, worldBox.min.z),
    new THREE.Vector3(worldBox.max.x, worldBox.min.y, worldBox.min.z),
    new THREE.Vector3(worldBox.min.x, worldBox.max.y, worldBox.min.z),
    new THREE.Vector3(worldBox.max.x, worldBox.max.y, worldBox.min.z),
    new THREE.Vector3(worldBox.min.x, worldBox.min.y, worldBox.max.z),
    new THREE.Vector3(worldBox.max.x, worldBox.min.y, worldBox.max.z),
    new THREE.Vector3(worldBox.min.x, worldBox.max.y, worldBox.max.z),
    new THREE.Vector3(worldBox.max.x, worldBox.max.y, worldBox.max.z),
  ].map(v => v.applyMatrix4(inverse))
  const localBox = new THREE.Box3().setFromPoints(corners)
  const bounds = {
    min_x: localBox.min.x, min_y: localBox.min.y, min_z: localBox.min.z,
    max_x: localBox.max.x, max_y: localBox.max.y, max_z: localBox.max.z,
  }
  // An empty source Box3 (e.g. worldBox never got union()'d with anything —
  // no visible geometry found under the target) stays at its default
  // min=(+Inf,+Inf,+Inf)/max=(-Inf,-Inf,-Inf) (2026-07-17 fix, per a real
  // 422 — that non-finite value round-trips through JSON.stringify as
  // `null`, which the backend's own required `float` fields then reject
  // with an opaque 422 instead of a message that explains anything).
  // Caught by handleCreateSectionBox's own try/catch, surfaced through the
  // existing sectionBoxError UI same as any other creation failure.
  const allFinite = Number.isFinite(bounds.min_x) && Number.isFinite(bounds.min_y) && Number.isFinite(bounds.min_z)
    && Number.isFinite(bounds.max_x) && Number.isFinite(bounds.max_y) && Number.isFinite(bounds.max_z)
  if (!allFinite) throw new Error('Could not compute a bounding box for the current selection — try selecting again.')
  return bounds
}

export function computeLocalBoundsForObject(object: THREE.Object3D): SectionBoxBounds {
  object.updateMatrixWorld(true)
  return localBoundsFromWorldBox(new THREE.Box3().setFromObject(object), object)
}

// Seeds a new box tightly around a *set* of elements (2026-07-11, per Maro:
// "I made a collection of windows and tried sectioning, didn't work") —
// handleCreateSectionBox used to only ever look at the single "primary"
// selectedExpressId, which handleSelectCollection deliberately clears for a
// bulk selection ("no single 'primary' element in a bulk collection
// select") — so creating a section box while a multi-element Collection was
// selected silently fell back to wrapping the *entire* model instead of
// just the selected elements, producing a box the same size as the whole
// building with nothing visibly cut. Still a whole-object-scoped box once
// created (elementRef stays null) — a spatial cutting volume that clips
// everything inside it, not just the originally-selected elements, matching
// what "section box" means in the Blender reference this feature is built
// from; this only changes what region the box starts sized/positioned to.
export function computeLocalBoundsForObjects(target: THREE.Object3D, elements: THREE.Object3D[]): SectionBoxBounds {
  target.updateMatrixWorld(true)
  const worldBox = new THREE.Box3()
  for (const el of elements) {
    el.updateMatrixWorld(true)
    worldBox.union(new THREE.Box3().setFromObject(el))
  }
  return localBoundsFromWorldBox(worldBox, target)
}

// The 6 faces of a local-space AABB as clipping planes, in that same local
// space — three.js clipping semantics: a fragment renders only if it's on
// the non-negative side of every one of a material's clippingPlanes
// (`normal . point + constant >= 0`), so each plane here is oriented to
// keep the inside of the box and discard the outside, exactly the
// "hollow cutaway" behavior the Blender reference shows before any face is
// dragged past the geometry's own edge.
function localClipPlanes(bounds: SectionBoxBounds): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -bounds.min_x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds.max_x),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds.min_y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds.max_y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -bounds.min_z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), bounds.max_z),
  ]
}

// The box's own additional rotation (2026-07-17, per Maro: "I'd like to
// rotate the bounding box"), as a matrix that rotates *around the box's own
// centre* rather than the target's local origin — T(centre) * R(euler) *
// T(-centre) — so dragging a rotate handle spins the box in place instead
// of also relocating it. Shared by SectionBoxGizmo.tsx's own wireframe/
// handle placement (composed onto the target's matrixWorld the exact same
// way) and computeWorldClipPlanes below, so the visible gizmo and the
// actual clip always agree.
//
// Takes `pivotBounds` as a SEPARATE argument from whatever bounds actually
// define the box's own faces (2026-09-01 fix, per Maro live: "toggle to
// rotate and rotate and go back to resize... drag[ging one handle]...
// affect[s] the whole shape not just that handle face") — recomputing
// centre from the box's own LIVE (currently-dragging) bounds every frame is
// exactly what breaks resize-after-rotate: with rotation R != identity, a
// face's own world position is `centre + R*(facePos - centre)` — differentiate
// that with respect to a centre shift `d` and every OTHER face's world
// position moves by `d*(I - R)`, which is zero only when R is the identity
// (no rotation ever applied). So the instant a box has any rotation, moving
// ONE face (which shifts the min/max midpoint) makes every *other* face
// visibly swing in world space too, purely because this matrix's own centre
// was being recomputed from those same live bounds. Callers now pass the
// box's last-*committed* bounds for `pivotBounds` (unaffected by an
// in-progress resize drag's own live preview) so the rotation pivot stays
// anchored for the whole gesture — the dragged face still slides correctly
// along its own rotated axis (see the math above with the dragged face's
// own facePos changing), but the other 5 stay exactly where they were,
// matching the no-rotation case's already-correct behaviour.
export function sectionBoxPivotMatrix(pivotBounds: SectionBoxBounds, rotation: SectionBoxRotation): THREE.Matrix4 {
  const cx = (pivotBounds.min_x + pivotBounds.max_x) / 2
  const cy = (pivotBounds.min_y + pivotBounds.max_y) / 2
  const cz = (pivotBounds.min_z + pivotBounds.max_z) / 2
  const euler = new THREE.Euler(rotation.rot_x, rotation.rot_y, rotation.rot_z, 'XYZ')
  return new THREE.Matrix4()
    .makeTranslation(cx, cy, cz)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(euler))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz))
}

// Transforms the 6 local-space clip planes into world space against a
// target's *current* matrixWorld, composed with the box's own rotation
// (sectionBoxPivotMatrix above) — Plane.applyMatrix4 uses the normal
// matrix internally, so this stays correct even under the target's own
// rotation/non-uniform scale. Always returns brand-new Plane instances
// (2026-07-09 fix, per design review — Material.clone() deep-clones
// clippingPlanes into disconnected copies, so mutating a shared canonical
// Plane in place would silently go stale on any mesh whose material later
// gets cloned by Viewport3D.tsx's own texture-override scheme; building
// fresh arrays on every call sidesteps that entirely).
//
// `bounds` and `pivotBounds` are deliberately separate (see
// sectionBoxPivotMatrix's own header just above) — `bounds` still defines
// where the 6 planes themselves actually sit (so a live resize drag's own
// face keeps moving as expected), `pivotBounds` only ever feeds the
// rotation's own centre.
export function computeWorldClipPlanes(
  bounds: SectionBoxBounds, pivotBounds: SectionBoxBounds, rotation: SectionBoxRotation, matrixWorld: THREE.Matrix4,
): THREE.Plane[] {
  const composed = matrixWorld.clone().multiply(sectionBoxPivotMatrix(pivotBounds, rotation))
  return localClipPlanes(bounds).map(p => p.applyMatrix4(composed))
}

// One level-slice's clip planes, for "split an element by level"
// (2026-07-15, per Maro — see elementSplitTargets.ts's own header for the
// full "clipped virtual slice, not real geometry" design this belongs to).
//
// Deliberately built DIRECTLY in world space, with no Plane.applyMatrix4
// against any mesh/handle transform at all — unlike computeWorldClipPlanes
// above (whose bounds are legitimately local to one target, so it needs the
// local-to-world step), a "cut at this real elevation" has no single
// element it's relative to. An earlier version of this function assumed a
// raw elevation value lived in the IFC file's own local Z-up frame and
// transformed it through handle.object.matrixWorld — wrong on a real file:
// upAxis.ts's own header notes real IFC imports come back Y-up from
// web-ifc's own geometry extraction just as often as Z-up (verified
// directly against this app's own reference file, not assumed), so which
// *local* axis means "elevation" varies per import and isn't reliably Z.
// three.js's own material.clippingPlanes are natively world-space per its
// own docs, so the fix is to skip local space entirely: the
// caller resolves elevations from each mesh's own already-correct
// matrixWorld (the same transform that already renders everything in the
// right place on screen), and this function just needs to know which
// *world* axis is "up" right now (upAxis, the scene's own live display
// setting — always correct once the axis-correction wrapper has been
// applied, regardless of any one file's own native convention).
//
// worldMin/worldMax are raw scene units (the file's own declared unit,
// e.g. feet, since geometry is never rescaled to metres at import — see
// loadIfcModel's own header) along that axis — already resolved from this
// slice's stored metres-in-cut_elevations_m by the caller (ifcModel.ts's
// getLengthUnitToMetres, inverted). `null` on either side means
// "unbounded" — the bottommost/topmost slice of a split has no lower/upper
// cut at all.
export function worldSlicePlanes(
  worldMin: number | null, worldMax: number | null, upAxis: 'y' | 'z',
): THREE.Plane[] {
  const normal = upAxis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  const planes: THREE.Plane[] = []
  if (worldMin !== null) planes.push(new THREE.Plane(normal.clone(), -worldMin))
  if (worldMax !== null) planes.push(new THREE.Plane(normal.clone().negate(), worldMax))
  return planes
}

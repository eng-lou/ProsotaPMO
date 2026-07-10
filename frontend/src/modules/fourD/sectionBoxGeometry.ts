import * as THREE from 'three'
import type { SectionBoxBounds } from './sectionBoxes'

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
export function computeLocalBoundsForObject(object: THREE.Object3D): SectionBoxBounds {
  object.updateMatrixWorld(true)
  const worldBox = new THREE.Box3().setFromObject(object)
  const inverse = object.matrixWorld.clone().invert()
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
  return {
    min_x: localBox.min.x, min_y: localBox.min.y, min_z: localBox.min.z,
    max_x: localBox.max.x, max_y: localBox.max.y, max_z: localBox.max.z,
  }
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

// Transforms the 6 local-space clip planes into world space against a
// target's *current* matrixWorld — Plane.applyMatrix4 uses the normal
// matrix internally, so this stays correct even under the target's own
// rotation/non-uniform scale. Always returns brand-new Plane instances
// (2026-07-09 fix, per design review — Material.clone() deep-clones
// clippingPlanes into disconnected copies, so mutating a shared canonical
// Plane in place would silently go stale on any mesh whose material later
// gets cloned by Viewport3D.tsx's own texture-override scheme; building
// fresh arrays on every call sidesteps that entirely).
export function computeWorldClipPlanes(bounds: SectionBoxBounds, matrixWorld: THREE.Matrix4): THREE.Plane[] {
  return localClipPlanes(bounds).map(p => p.applyMatrix4(matrixWorld))
}

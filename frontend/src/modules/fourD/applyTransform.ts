import * as THREE from 'three'
import { captureBaseline } from './elementBaseline'

// "Apply Transform" (2026-07-09, per Maro: "allow me to apply transforms to
// the selected object. in essence zeroing out all transform parameters
// while maintaining position") — Blender's Ctrl+A "All Transforms": bakes
// the object's current position, rotation AND scale into its geometry, then
// resets all three fields to their defaults (0/0/0, 0°/0°/0°, 1/1/1) with
// zero *visual* change — "maintaining position" means the object stays put
// on screen, not that the Location field is left non-zero (2026-07-09 fix:
// first version only baked rotation/scale and left position untouched,
// which is Blender's narrower "Rotation & Scale" variant, not what was
// actually asked for — caught when Maro reported "only rotation and scale,
// nothing happened to locations"). Mainly useful after a Source Up Axis
// correction or a gizmo drag has left an object's fields non-zero — this
// folds all of that permanently into the geometry so a later edit starts
// from a clean baseline again.
//
// Two cases, handled differently:
//
// - `object` itself carries geometry (a Mesh — the case for a selected IFC
//   sub-element, which has no children of its own besides an edges overlay)
//   — bake straight into that geometry.
// - `object` is a Group/generic Object3D (a whole imported IFC/GLTF/OBJ/FBX
//   model) — push the bake matrix into each *direct* child's own local
//   transform instead. This is correct for arbitrary nesting depth below
//   that: matrix composition is associative, so pre-multiplying bakeMatrix
//   into a direct child's local matrix produces the exact same matrixWorld
//   for every deeper descendant once `object`'s own transform resets to
//   identity — nothing below the direct children needs to change at all.
// Returns how many elements the bake actually touched (2026-07-09, per
// Maro: "i dont think it recognises the hierarchy why is why parent level
// apply transform isnt working") — a successful Apply Transform on an
// already-identity object produces *zero* visual change by definition (see
// this file's own header — that's the whole point, geometry absorbs
// whatever the fields showed so they can reset to 0/0/1 with nothing moving
// on screen), which reads exactly like "did nothing" with no way to tell
// from the viewport alone whether the whole hierarchy was actually walked
// or the button silently no-op'd. PropertiesPanel.tsx surfaces this count
// as a brief confirmation so that's directly verifiable rather than assumed.
export function applyTransformKeepPosition(object: THREE.Object3D): number {
  const bakeMatrix = new THREE.Matrix4().compose(object.position.clone(), object.quaternion.clone(), object.scale.clone())
  let affected = 0

  if (object instanceof THREE.Mesh && object.geometry) {
    object.geometry = object.geometry.clone()
    object.geometry.applyMatrix4(bakeMatrix)
    affected = 1

    // The edges overlay (ModelObjects' "Edges" visibility toggle in
    // Viewport3D.tsx) is a LineSegments child built from the pre-bake
    // geometry — now stale/misaligned. Drop it so that component's own
    // effect rebuilds a fresh one from the baked geometry on its next
    // pass, rather than rendering unrotated on top of a rotated mesh.
    const edges = object.userData.edgesHelper as THREE.LineSegments | undefined
    if (edges) {
      object.remove(edges)
      edges.geometry.dispose()
      delete object.userData.edgesHelper
    }
  } else {
    for (const child of object.children) {
      child.updateMatrix()
      child.applyMatrix4(bakeMatrix)
      affected++
      // Each child's own local transform just changed to absorb the
      // parent's former one — its *old* baseline snapshot no longer
      // matches its new post-bake pose at all, so a later hover-Backspace
      // reset on that child would otherwise yank it back to where it sat
      // *before* this bake (a real, visible jump), not "undo an edit."
      captureBaseline(child)
    }
  }

  object.position.set(0, 0, 0)
  object.quaternion.identity()
  object.scale.set(1, 1, 1)
  object.updateMatrix()
  // Whatever the fields now show (0/0/1) genuinely *is* this object's own
  // original state going forward (2026-07-09, per Maro: "if i choose to
  // apply that transform then the new z base for that wall should be
  // 300" — i.e. whatever it settles on post-bake becomes the new
  // "original," not the pre-bake value) — the geometry (or, for a Group,
  // every child's own local transform above) now fully encodes what used
  // to be expressed here, so a later reset should snap back to *this*,
  // not the value that existed before Apply Transform ran.
  captureBaseline(object)

  return affected
}

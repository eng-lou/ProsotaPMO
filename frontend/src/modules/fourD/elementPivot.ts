import * as THREE from 'three'
import { captureBaseline } from './elementBaseline'

// "Set Pivot" (2026-07-12, per Maro's crane-rigging request) — Blender's
// own "Origin to 3D Cursor": move an element's own rotation/scale origin
// to a chosen point *without moving its visible geometry*. Needed because
// rotation/scale in this app always pivots around an object's own local
// (0,0,0), wherever its source file happened to place that (see
// TransformPanel.tsx/elementBaseline.ts) — a crane jib's own file almost
// never has its modeling origin sitting exactly at the hinge, so rigging
// it as a child (elementRigging.ts) and rotating the parent would
// otherwise orbit around the wrong point entirely.
//
// Deliberately its own small, isolated snapshot
// (userData.prePivotGeometry / userData.prePivotChildPositions /
// userData.prePivotPosition), NOT reusing elementBaseline.ts's own
// originalGeometry/baselineTransform — those get *repurposed* by other
// features (baking, displacement subdivision) to mean "the state before
// that operation," not "the literal as-imported file state," and pivot
// logic staying fully orthogonal to that avoids any risk of the two
// features fighting over what "original" means. Captured lazily, once,
// the first time setPivot is ever called on a given object in this
// session — at that point nothing else has touched geometry/position yet,
// so it's still the true pre-pivot state.
//
// Always recomputes from that one pre-pivot snapshot rather than applying
// an incremental delta each call — setPivot(object, pointA) then
// setPivot(object, pointB) lands exactly on pointB with no drift, and
// setPivot(object, null) (Reset Pivot) is just "recompute with no offset,"
// not a separate undo path.
function ensureSnapshot(object: THREE.Object3D) {
  if (object.userData.prePivotPosition !== undefined) return
  object.userData.prePivotPosition = object.position.clone()
  if (object instanceof THREE.Mesh) {
    object.userData.prePivotGeometry = object.geometry
  } else {
    const map = new Map<THREE.Object3D, THREE.Vector3>()
    for (const child of object.children) map.set(child, child.position.clone())
    object.userData.prePivotChildPositions = map
  }
}

// The pivot TransformPanel.tsx currently displays/edits for `object` — a
// plain userData read, same "read/write the live object directly, don't
// mirror it into React state" convention that panel already uses for
// position/rotation/scale (its own header explains why). undefined means
// "no override" (backend pivot_x/y/z all null).
export function getPivot(object: THREE.Object3D): THREE.Vector3 | undefined {
  return object.userData.pivotPoint as THREE.Vector3 | undefined
}

// localPoint is in the object's own *pre-pivot* local space — the same
// space TransformPanel's Location fields already read/write, and the same
// space a raycast hit gets converted into via object.worldToLocal() before
// calling this (see the pivot-picking catcher's own header).
export function setPivot(object: THREE.Object3D, localPoint: THREE.Vector3 | null) {
  ensureSnapshot(object)
  const prePivotPosition = object.userData.prePivotPosition as THREE.Vector3

  if (object instanceof THREE.Mesh) {
    const prePivotGeometry = object.userData.prePivotGeometry as THREE.BufferGeometry
    if (localPoint) {
      const next = prePivotGeometry.clone()
      next.translate(-localPoint.x, -localPoint.y, -localPoint.z)
      object.geometry = next
    } else {
      object.geometry = prePivotGeometry
    }
  } else {
    const prePivotChildPositions = object.userData.prePivotChildPositions as Map<THREE.Object3D, THREE.Vector3> | undefined
    for (const child of object.children) {
      const base = prePivotChildPositions?.get(child)
      if (!base) continue
      child.position.copy(base)
      if (localPoint) child.position.sub(localPoint)
    }
  }

  // Compensate so the *visual* position is unchanged: reset to the
  // pre-pivot position, then translateX/Y/Z (three.js's own local-axis
  // translate, already accounting for current rotation) by the new point.
  object.position.copy(prePivotPosition)
  if (localPoint) {
    object.translateX(localPoint.x)
    object.translateY(localPoint.y)
    object.translateZ(localPoint.z)
  }

  // Mode A/B's "base" reference (TimelinePlayback in Viewport3D.tsx) must
  // reflect the new position going forward, same as after a rig reparent
  // (elementRigging.ts) or a Transform bake — otherwise every keyframe/
  // profile offset would still compute against the pre-pivot position.
  captureBaseline(object)

  if (localPoint) object.userData.pivotPoint = localPoint.clone()
  else delete object.userData.pivotPoint
}

export function clearPivot(object: THREE.Object3D) {
  setPivot(object, null)
}

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
// "Pivot Rotation" (2026-07-22, per Maro: dragging an element with the
// Move gizmo travelled at an angle relative to an adjacent element it
// needed to stay flush with) is this same idea for orientation instead of
// position: redefine what the object's own local axes point in, without
// visibly rotating it. The point of it isn't to change how the object
// looks — rotation_x/y/z (TransformPanel's own Rotation section) already
// does that — it's to change what "local" means for TransformControls'
// Local space, so Move tracks a custom-aligned frame (e.g. matching an
// adjacent road's actual angle) instead of either raw world axes or the
// object's true visible orientation.
//
// Deliberately its own small, isolated snapshot
// (userData.prePivotGeometry / userData.prePivotChildPositions /
// userData.prePivotChildQuaternions / userData.prePivotPosition /
// userData.prePivotQuaternion), NOT reusing elementBaseline.ts's own
// originalGeometry/baselineTransform — those get *repurposed* by other
// features (baking, displacement subdivision) to mean "the state before
// that operation," not "the literal as-imported file state," and pivot
// logic staying fully orthogonal to that avoids any risk of the two
// features fighting over what "original" means. Captured lazily, once,
// the first time setPivot/setPivotRotation is ever called on a given
// object in this session — at that point nothing else has touched
// geometry/position/quaternion yet, so it's still the true pre-pivot
// state.
//
// Both pivot point and pivot rotation are always recomputed together from
// that one pre-pivot snapshot (applyPivot below) rather than composing
// incremental deltas — setPivot/setPivotRotation can be called in any
// order, any number of times, and the result is always exactly "the
// pre-pivot state, with today's point and today's rotation applied," with
// no drift and no order-dependence.
function ensureSnapshot(object: THREE.Object3D) {
  if (object.userData.prePivotPosition !== undefined) return
  object.userData.prePivotPosition = object.position.clone()
  object.userData.prePivotQuaternion = object.quaternion.clone()
  if (object instanceof THREE.Mesh) {
    object.userData.prePivotGeometry = object.geometry
  } else {
    const positions = new Map<THREE.Object3D, THREE.Vector3>()
    const quaternions = new Map<THREE.Object3D, THREE.Quaternion>()
    for (const child of object.children) {
      positions.set(child, child.position.clone())
      quaternions.set(child, child.quaternion.clone())
    }
    object.userData.prePivotChildPositions = positions
    object.userData.prePivotChildQuaternions = quaternions
  }
}

// Recomputes geometry/children and the object's own position/quaternion
// from the pre-pivot snapshot plus whichever of pivotPoint/pivotRotation
// are currently set on userData — the one place both features' math
// actually lives, called after either setPivot or setPivotRotation writes
// its own override.
//
// Ordering matters here: the position compensation (translateX/Y/Z) must
// happen *while* object.quaternion is still the pre-pivot-rotation value
// (Q0) — three.js's translateX/Y/Z moves along the object's *current*
// local axes, and the geometry/children were recentered in that same Q0
// frame. Only after that is object.quaternion multiplied by the pivot
// rotation offset. Doing it in the other order would translate along the
// *new* (rotated) axes instead, which no longer matches how the geometry
// was recentered, and the visual position would drift the moment a pivot
// rotation is set alongside a pivot point.
function applyPivot(object: THREE.Object3D) {
  const prePivotPosition = object.userData.prePivotPosition as THREE.Vector3
  const prePivotQuaternion = object.userData.prePivotQuaternion as THREE.Quaternion
  const pivotPoint = object.userData.pivotPoint as THREE.Vector3 | undefined
  const pivotRotation = object.userData.pivotRotation as THREE.Euler | undefined
  const rotationOffset = pivotRotation ? new THREE.Quaternion().setFromEuler(pivotRotation) : null
  const inverseRotationOffset = rotationOffset ? rotationOffset.clone().invert() : null

  if (object instanceof THREE.Mesh) {
    const prePivotGeometry = object.userData.prePivotGeometry as THREE.BufferGeometry
    if (pivotPoint || rotationOffset) {
      const next = prePivotGeometry.clone()
      if (pivotPoint) next.translate(-pivotPoint.x, -pivotPoint.y, -pivotPoint.z)
      if (inverseRotationOffset) next.applyQuaternion(inverseRotationOffset)
      object.geometry = next
    } else {
      object.geometry = prePivotGeometry
    }
  } else {
    const prePivotChildPositions = object.userData.prePivotChildPositions as Map<THREE.Object3D, THREE.Vector3> | undefined
    const prePivotChildQuaternions = object.userData.prePivotChildQuaternions as Map<THREE.Object3D, THREE.Quaternion> | undefined
    for (const child of object.children) {
      const basePosition = prePivotChildPositions?.get(child)
      const baseQuaternion = prePivotChildQuaternions?.get(child)
      if (!basePosition || !baseQuaternion) continue
      const nextPosition = basePosition.clone()
      if (pivotPoint) nextPosition.sub(pivotPoint)
      if (inverseRotationOffset) nextPosition.applyQuaternion(inverseRotationOffset)
      child.position.copy(nextPosition)
      const nextQuaternion = baseQuaternion.clone()
      if (inverseRotationOffset) nextQuaternion.premultiply(inverseRotationOffset)
      child.quaternion.copy(nextQuaternion)
    }
  }

  // Compensate so the *visual* position is unchanged: reset to the
  // pre-pivot position/quaternion, then translateX/Y/Z (three.js's own
  // local-axis translate, using the still-pre-rotation Q0 frame) by the
  // pivot point — see this function's own header for why the rotation
  // offset is applied only afterward.
  object.position.copy(prePivotPosition)
  object.quaternion.copy(prePivotQuaternion)
  if (pivotPoint) {
    object.translateX(pivotPoint.x)
    object.translateY(pivotPoint.y)
    object.translateZ(pivotPoint.z)
  }
  if (rotationOffset) object.quaternion.multiply(rotationOffset)

  // Mode A/B's "base" reference (TimelinePlayback in Viewport3D.tsx) must
  // reflect the new position/rotation going forward, same as after a rig
  // reparent (elementRigging.ts) or a Transform bake — otherwise every
  // keyframe/profile offset would still compute against the pre-pivot
  // state.
  captureBaseline(object)
}

// The pivot point TransformPanel.tsx currently displays/edits for
// `object` — a plain userData read, same "read/write the live object
// directly, don't mirror it into React state" convention that panel
// already uses for position/rotation/scale (its own header explains why).
// undefined means "no override" (backend pivot_x/y/z all null).
export function getPivot(object: THREE.Object3D): THREE.Vector3 | undefined {
  return object.userData.pivotPoint as THREE.Vector3 | undefined
}

// localPoint is in the object's own *pre-pivot* local space — the same
// space TransformPanel's Location fields already read/write, and the same
// space a raycast hit gets converted into via object.worldToLocal() before
// calling this (see the pivot-picking catcher's own header).
export function setPivot(object: THREE.Object3D, localPoint: THREE.Vector3 | null) {
  ensureSnapshot(object)
  if (localPoint) object.userData.pivotPoint = localPoint.clone()
  else delete object.userData.pivotPoint
  applyPivot(object)
}

export function clearPivot(object: THREE.Object3D) {
  setPivot(object, null)
}

// The pivot rotation TransformPanel.tsx displays/edits — same undefined-
// means-no-override convention as getPivot above (backend
// pivot_rotation_x/y/z all null). A THREE.Euler in the object's own
// *pre-pivot* local space, same 'XYZ' order as object.rotation/rotation_x/
// y/z everywhere else in this codebase.
export function getPivotRotation(object: THREE.Object3D): THREE.Euler | undefined {
  return object.userData.pivotRotation as THREE.Euler | undefined
}

export function setPivotRotation(object: THREE.Object3D, euler: THREE.Euler | null) {
  ensureSnapshot(object)
  if (euler) object.userData.pivotRotation = euler.clone()
  else delete object.userData.pivotRotation
  applyPivot(object)
}

export function clearPivotRotation(object: THREE.Object3D) {
  setPivotRotation(object, null)
}

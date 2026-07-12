import * as THREE from 'three'
import { captureBaseline } from './elementBaseline'
import { axisCorrectionRotation, type UpAxis } from './upAxis'

// Crane-style rigging (2026-07-12, per Maro: base -> jib -> trolley ->
// hook, each part driving the next) — Blender's own pivot-based parenting
// (Ctrl+P), not bones/IK, since rig parts here are rigid bodies, not
// deformable/organic meshes. Real three.js scene-graph nesting: once a
// child object becomes a genuine descendant of its parent's Object3D,
// ordinary matrixWorld composition carries it along under Mode A/B's own
// existing local-space position/rotation/scale writes with zero changes
// to that logic (Viewport3D.tsx's TimelinePlayback).
//
// three.js's own Object3D.add() keeps the child's *local* transform as-is,
// which would jump the child visually the instant it's re-parented unless
// its local position/rotation/scale already happened to be zero/identity
// relative to the new parent. attachPreservingWorldTransform computes the
// child's current world matrix first, reparents, then decomposes
// parent.matrixWorld⁻¹ × childWorldMatrix back into the child's own
// position/quaternion/scale — the standard "keep transform" reparent
// (Blender's own Ctrl+P "Keep Transform" option).
export function attachPreservingWorldTransform(child: THREE.Object3D, parent: THREE.Object3D) {
  parent.updateWorldMatrix(true, false)
  child.updateWorldMatrix(true, false)
  const childWorldMatrix = child.matrixWorld.clone()

  parent.add(child)

  const parentWorldInverse = new THREE.Matrix4().copy(parent.matrixWorld).invert()
  const newLocalMatrix = new THREE.Matrix4().multiplyMatrices(parentWorldInverse, childWorldMatrix)
  newLocalMatrix.decompose(child.position, child.quaternion, child.scale)

  // Mode A/B's "base" reference (TimelinePlayback in Viewport3D.tsx) must
  // reflect the new parent-local position/rotation/scale going forward —
  // otherwise every existing keyframe/profile offset on this child would
  // still compute against its old, pre-rig position. Same principle as
  // elementPivot.ts's own setPivot re-capturing after its own compensating
  // transform.
  captureBaseline(child)
}

// The reverse — un-rigging (2026-07-12): a top-level ImportedObject isn't
// mounted directly at the scene root, it's wrapped in its own
// `<group rotation={axisCorrectionRotation(sourceUpAxis, upAxis)}>`
// (ModelObjects' own mount loop below) — a fresh React element each
// render, not a stable Object3D this module could target the way
// attachPreservingWorldTransform targets a real rig parent. Detaching
// therefore can't reuse that function directly; it recomputes the same
// "keep transform" decompose against that wrapper's own *rotation* (the
// only transform it ever applies — no position/scale), computed here from
// the same pure axisCorrectionRotation() the mount loop itself uses, not a
// live reference.
export function detachToSceneRoot(child: THREE.Object3D, sourceUpAxis: UpAxis, upAxis: UpAxis) {
  child.updateWorldMatrix(true, false)
  const worldMatrix = child.matrixWorld.clone()
  child.parent?.remove(child)

  const [rx, ry, rz] = axisCorrectionRotation(sourceUpAxis, upAxis)
  const wrapperMatrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))
  const wrapperInverse = wrapperMatrix.clone().invert()
  const localMatrix = new THREE.Matrix4().multiplyMatrices(wrapperInverse, worldMatrix)
  localMatrix.decompose(child.position, child.quaternion, child.scale)

  captureBaseline(child)
}

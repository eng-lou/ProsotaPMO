import { Euler, Vector3, type Object3D } from 'three'
import { getPivot, getPivotRotation, setPivot, setPivotRotation } from './elementPivot'
export function captureTransform(object: Object3D) {
  const pivot = getPivot(object), rotation = getPivotRotation(object)
  return {
    position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
    pivot: pivot ? pivot.toArray() : null,
    pivotRotation: rotation ? [rotation.x, rotation.y, rotation.z] : null,
  }
}
export type TransformSnapshot = ReturnType<typeof captureTransform>
export function restoreTransform(object: Object3D, state: TransformSnapshot) {
  // Pivot setters rebuild compensated geometry before restoring the exact pose.
  if (JSON.stringify(getPivot(object)?.toArray() ?? null) !== JSON.stringify(state.pivot))
    setPivot(object, state.pivot ? new Vector3().fromArray(state.pivot) : null)
  const current = getPivotRotation(object)
  if (JSON.stringify(current ? [current.x, current.y, current.z] : null) !== JSON.stringify(state.pivotRotation))
    setPivotRotation(object, state.pivotRotation ? new Euler(...state.pivotRotation as [number, number, number]) : null)
  object.position.fromArray(state.position); object.quaternion.fromArray(state.quaternion); object.scale.fromArray(state.scale)
  object.updateMatrixWorld(true)
}

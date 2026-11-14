import { Box3, Matrix3, Vector3, type Object3D } from 'three'

export interface MoveTarget { id: string; object: Object3D }

export function groupCentre(targets: MoveTarget[]) {
  const bounds = new Box3()
  for (const { object } of targets) {
    object.updateWorldMatrix(true, false)
    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) bounds.expandByPoint(object.getWorldPosition(new Vector3()))
    else bounds.union(box)
  }
  return bounds.getCenter(new Vector3())
}

// A collection can span several local coordinate systems. Take one snapshot
// per gesture so repeated pointer events never accumulate movement errors.
export function beginGroupMove(targets: MoveTarget[]) {
  return targets.map(target => {
    const { parent, position } = target.object
    parent?.updateWorldMatrix(true, false)
    const worldToParent = new Matrix3()
    if (parent) worldToParent.setFromMatrix4(parent.matrixWorld).invert()
    return { ...target, start: position.clone(), worldToParent }
  })
}
export type GroupMove = ReturnType<typeof beginGroupMove>

export function translateGroup(move: GroupMove, delta: Vector3) {
  for (const { object, start, worldToParent } of move) {
    object.position.copy(delta).applyMatrix3(worldToParent).add(start)
    object.updateMatrix()
    object.updateWorldMatrix(true, true)
  }
}

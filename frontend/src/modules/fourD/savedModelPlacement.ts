import { Euler, Vector3, type Object3D } from 'three'
import { getElementTransformTarget } from './elementBatching'
import { setPivot, setPivotRotation } from './elementPivot'
import type { ElementTransform } from './elementTransforms'

export function applyElementTransform(object: Object3D, t: ElementTransform | undefined) {
  if (!t) return
  // Pivot first (2026-07-12, extended 2026-07-22 for pivot rotation) —
  // setPivot/setPivotRotation's own compensating position/quaternion
  // writes would otherwise be immediately overwritten by the .set() calls
  // below anyway, but running them first means those correctly land on
  // the saved *final* authored position/rotation rather than fighting a
  // pivot-driven change applied after the fact — geometry recentering is
  // the part that actually matters here, since nothing else re-derives
  // it. See elementPivot.ts's own header.
  if (t.pivot_x !== null && t.pivot_y !== null && t.pivot_z !== null) {
    setPivot(object, new Vector3(t.pivot_x, t.pivot_y, t.pivot_z))
  }
  if (t.pivot_rotation_x !== null && t.pivot_rotation_y !== null && t.pivot_rotation_z !== null) {
    setPivotRotation(object, new Euler(t.pivot_rotation_x, t.pivot_rotation_y, t.pivot_rotation_z))
  }
  object.position.set(t.position_x, t.position_y, t.position_z)
  object.rotation.set(t.rotation_x, t.rotation_y, t.rotation_z)
  object.scale.set(t.scale_x, t.scale_y, t.scale_z)
}

// Use the same edit target on project open and selective IFC reload. Fresh
// imports still have most pieces in the batch, outside the scene graph.
export function restoreIfcPlacements(root: Object3D, saved: readonly ElementTransform[],
  resolveId: (guid: string) => number | undefined) {
  for (const placement of saved) {
    if (!placement.element_ref) continue
    const id = resolveId(placement.element_ref)
    if (id === undefined) continue
    const target = getElementTransformTarget(root, id)
    if (target) applyElementTransform(target, placement)
  }
}

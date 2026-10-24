import * as THREE from 'three'

export interface PathRotationState { base: THREE.Quaternion; last: THREE.Quaternion | null }
export function applyEditablePathRotation(object: THREE.Object3D, state: PathRotationState, curve: THREE.Curve<THREE.Vector3>, progress: number, heading: number, upAxis: 'y'|'z') {
  // A panel/gizmo edit between animation frames becomes an authored correction.
  if (state.last && object.quaternion.angleTo(state.last) > 1e-7) {
    const pathRotation = state.last.clone().multiply(state.base.clone().invert())
    state.base.copy(pathRotation.invert().multiply(object.quaternion))
  }
  const up = new THREE.Vector3(0, upAxis === 'y' ? 1 : 0, upAxis === 'z' ? 1 : 0)
  const first = curve.getTangentAt(0).projectOnPlane(up).normalize()
  const next = curve.getTangentAt(THREE.MathUtils.clamp(progress / 100, 0, 1)).projectOnPlane(up).normalize()
  const angle = Math.atan2(up.dot(first.clone().cross(next)), first.dot(next)) + THREE.MathUtils.degToRad(heading)
  const parent = object.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
  object.quaternion.copy(parent.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(up, angle)).multiply(parent).multiply(state.base))
  state.last = object.quaternion.clone()
}

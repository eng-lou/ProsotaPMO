import * as THREE from 'three'
import type { PathMotion } from './siteScene'

// Travel is measured in metres and presentation seconds, independently of the
// object's authored scale, pivot and rotation. The parent carries path motion.
export function sampleSitePath(curve: THREE.Curve<THREE.Vector3>, motion: PathMotion, seconds: number, upAxis: 'y'|'z') {
  const length = curve.getLength()
  const distance = Math.max(0, seconds) * motion.speed
  const travelled = motion.loop && length > 0 ? distance : Math.min(length, distance)
  const u = length > 0 ? (motion.loop ? travelled % length : travelled) / length : 0
  const up = new THREE.Vector3(0, upAxis === 'y' ? 1 : 0, upAxis === 'z' ? 1 : 0)
  const first = curve.getTangentAt(0).projectOnPlane(up).normalize()
  const tangent = curve.getTangentAt(u).projectOnPlane(up).normalize()
  const angle = first.lengthSq() && tangent.lengthSq() ? Math.atan2(up.dot(first.clone().cross(tangent)), first.dot(tangent)) : 0
  return {
    point: curve.getPointAt(u),
    rotation: new THREE.Quaternion().setFromAxisAngle(up, motion.orient ? angle + THREE.MathUtils.degToRad(motion.heading) : 0),
    animationTime: travelled / motion.animation_reference_speed,
    progress: u * 100,
  }
}

export function applySitePath(parent: THREE.Object3D, curve: THREE.Curve<THREE.Vector3>, motion: PathMotion, seconds: number, upAxis: 'y'|'z', origin: THREE.Vector3) {
  const sample = sampleSitePath(curve, motion, seconds, upAxis)
  parent.quaternion.copy(sample.rotation)
  const anchor = motion.bind_origin ? new THREE.Vector3(motion.bind_origin.x, motion.bind_origin.y, motion.bind_origin.z) : origin
  parent.position.copy(sample.point).sub(anchor.clone().applyQuaternion(sample.rotation))
  parent.updateMatrixWorld(true)
  return sample
}

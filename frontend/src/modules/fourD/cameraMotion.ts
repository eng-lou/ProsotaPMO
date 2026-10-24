import * as THREE from 'three'
import type { CameraPose } from './cameras'
import { fovFromFocalLength } from './cameras'

export type Vec3 = [number, number, number]
export type MotionKind = 'hold' | 'orbit' | 'dolly' | 'slide' | 'crane' | 'pan' | 'tilt' | 'flyover' | 'transition'
export interface MotionSettings {
  offset?: number; kind: MotionKind; duration: number; amount: number; angle: number; reverse: boolean
  easing: 'linear' | 'smooth'; shotSize: 'wide' | 'medium' | 'close'
  alignment: 'center' | 'left' | 'right'; lookAt: boolean; startView: 'current' | 'auto'
}
export interface MotionShot {
  tracking?: { objectId: string; position: Vec3; rotation: [number, number, number, number] } | null
  followMode?: 'fixed' | 'aim' | 'translate' | 'aligned'
  actorClock?: 'presentation' | 'construction'
  id: string; name: string; settings: MotionSettings; target: Vec3; radius: number; upAxis: 'y' | 'z'
  start: CameraPose; end: CameraPose | null; startOffset: Vec3; endOffset: Vec3
  stage: 'fixed' | 'progress'; dateStart: string; dateEnd: string; blend: number
}
export interface CameraMotion { version: 1; shots: MotionShot[] }
export const DEFAULT_MOTION: MotionSettings = { kind: 'orbit', duration: 10, amount: 1, angle: 180, reverse: false, easing: 'smooth', shotSize: 'wide', alignment: 'center', lookAt: true, startView: 'auto' }
export const MOTION_LIBRARY: { kind: MotionKind; name: string; group: string; description: string }[] = [
  { kind: 'hold', name: 'Fixed / Hold', group: 'Static', description: 'Hold a view while construction progresses' },
  { kind: 'orbit', name: 'Orbit / Revolve', group: 'Around target', description: 'Quarter, half or full orbit' },
  { kind: 'dolly', name: 'Push In / Pull Out', group: 'Travel', description: 'Move closer or reveal the wider site' },
  { kind: 'slide', name: 'Slide Left / Right', group: 'Travel', description: 'Travel along a frontage' },
  { kind: 'crane', name: 'Rise / Lower', group: 'Travel', description: 'Rise above or descend towards the target' },
  { kind: 'pan', name: 'Pan', group: 'Turn', description: 'Look across the site from a fixed position' },
  { kind: 'tilt', name: 'Tilt', group: 'Turn', description: 'Look up or down from a fixed position' },
  { kind: 'flyover', name: 'Flyover', group: 'Travel', description: 'Cross the target at a chosen elevation' },
  { kind: 'transition', name: 'View-to-View', group: 'Saved views', description: 'Move between two saved viewpoints' },
]
export function posePosition(p: CameraPose) { return new THREE.Vector3(p.base_position_x, p.base_position_y, p.base_position_z) }
export function poseTarget(p: CameraPose) { return new THREE.Vector3(p.base_target_x, p.base_target_y, p.base_target_z) }
export function withPose(p: CameraPose, position: THREE.Vector3, target: THREE.Vector3): CameraPose {
  return { ...p, base_position_x: position.x, base_position_y: position.y, base_position_z: position.z, base_target_x: target.x, base_target_y: target.y, base_target_z: target.z }
}
export function autoFrame(pose: CameraPose, target: Vec3, radius: number, aspect: number, size: MotionSettings['shotSize']): CameraPose {
  const fov = fovFromFocalLength(pose.base_focal_length) * Math.PI / 180
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * Math.max(.1, aspect)))
  const distance = Math.max(.1, radius) / Math.sin(fit / 2) * ({ wide: 1.4, medium: 1, close: .7 }[size])
  const direction = posePosition(pose).sub(poseTarget(pose)); if (direction.lengthSq() < .00001) direction.set(1, 1, 1)
  const center = new THREE.Vector3(...target)
  return withPose({ ...pose, base_clip_end: Math.max(pose.base_clip_end, distance + radius * 4) }, center.clone().add(direction.normalize().multiplyScalar(distance)), center)
}
export function sampleShot(shot: MotionShot, seconds: number): { pose: CameraPose; date: Date } {
  const s = shot.settings, raw = THREE.MathUtils.clamp(seconds / s.duration, 0, 1)
  const t = s.easing === 'smooth' ? raw * raw * (3 - 2 * raw) : raw
  const u = s.reverse ? 1 - t : t
  const up = shot.upAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
  const center = new THREE.Vector3(...shot.target), startPos = posePosition(shot.start), originalTarget = poseTarget(shot.start)
  const forward = center.clone().sub(startPos).normalize()
  if (forward.lengthSq() < .00001) forward.set(0, 0, -1)
  const right = forward.clone().cross(up).normalize(); if (right.lengthSq() < .00001) right.set(1, 0, 0)
  const pos = startPos.clone(), aim = originalTarget.clone(), travel = shot.radius * s.amount
  let lens = shot.start.base_focal_length
  switch (s.kind) {
    case 'orbit': pos.sub(center).applyAxisAngle(up, THREE.MathUtils.degToRad(s.angle) * u).add(center); break
    case 'dolly': pos.addScaledVector(forward, Math.min(travel, startPos.distanceTo(center) * .85) * u); break
    case 'slide': pos.addScaledVector(right, travel * u); break
    case 'crane': pos.addScaledVector(up, travel * u).addScaledVector(forward, (s.offset || 0) * u); break
    case 'flyover': pos.addScaledVector(right, travel * u).addScaledVector(up, s.offset || 0); break
    case 'pan': aim.copy(originalTarget).sub(startPos).applyAxisAngle(up, THREE.MathUtils.degToRad(s.angle) * u).add(startPos); break
    case 'tilt': aim.copy(originalTarget).sub(startPos).applyAxisAngle(right, THREE.MathUtils.degToRad(THREE.MathUtils.clamp(s.angle, -80, 80)) * u).add(startPos); break
    case 'transition':
      if (shot.end) { pos.lerp(posePosition(shot.end), u); aim.lerp(poseTarget(shot.end), u); lens = THREE.MathUtils.lerp(lens, shot.end.base_focal_length, u) }
      break
  }
  pos.add(new THREE.Vector3(...shot.startOffset).lerp(new THREE.Vector3(...shot.endOffset), s.kind === 'hold' ? 0 : u))
  if (s.lookAt && !['pan', 'tilt', 'transition'].includes(s.kind)) aim.copy(center)
  else if (!['pan', 'tilt', 'transition'].includes(s.kind)) aim.add(pos.clone().sub(startPos))
  if (s.alignment !== 'center') {
    const screenRight = aim.clone().sub(pos).normalize().cross(up).normalize()
    aim.addScaledVector(screenRight, pos.distanceTo(aim) * Math.tan(fovFromFocalLength(lens) * Math.PI / 360) * .45 * (s.alignment === 'left' ? 1 : -1))
  }
  const start = Date.parse(shot.dateStart), end = shot.stage === 'progress' ? Date.parse(shot.dateEnd) : start
  return { pose: withPose({ ...shot.start, base_focal_length: lens }, pos, aim), date: new Date(start + (end - start) * raw) }
}
export function motionDuration(shots: MotionShot[]) { return shots.reduce((sum, s, i) => sum + s.settings.duration + (i ? s.blend : 0), 0) }
export type TargetResolver = (id: string) => { position: THREE.Vector3; rotation: THREE.Quaternion } | null
export function trackPose(shot: MotionShot, pose: CameraPose, resolve?: TargetResolver): CameraPose {
  if (!shot.tracking || !shot.followMode || shot.followMode === 'fixed') return pose
  const live = resolve?.(shot.tracking.objectId)
  if (!live) return pose // Missing/unloaded targets retain the authored shot.
  const origin = new THREE.Vector3(...shot.tracking.position)
  const turn = shot.followMode === 'aligned' ? live.rotation.clone().multiply(new THREE.Quaternion(...shot.tracking.rotation).invert()) : new THREE.Quaternion()
  const move = (point: THREE.Vector3) => point.sub(origin).applyQuaternion(turn).add(live.position)
  if (shot.followMode === 'aim') {
    const target = new THREE.Vector3(...shot.target).sub(origin).applyQuaternion(live.rotation.clone().multiply(new THREE.Quaternion(...shot.tracking.rotation).invert())).add(live.position)
    return withPose(pose, posePosition(pose), poseTarget(pose).add(target.sub(new THREE.Vector3(...shot.target))))
  }
  return withPose(pose, move(posePosition(pose)), move(poseTarget(pose)))
}
export function sampleSequence(shots: MotionShot[], seconds: number, resolve?: TargetResolver) {
  if (!shots.length) return null
  const sample = (shot: MotionShot, time: number) => { const result = sampleShot(shot, time); return { ...result, pose: trackPose(shot, result.pose, resolve) } }
  let remaining = Math.max(0, seconds)
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    if (i && shot.blend > 0) {
      if (remaining < shot.blend) {
        const a = sample(shots[i - 1], shots[i - 1].settings.duration), b = sample(shot, 0)
        const t = remaining / shot.blend, eased = t * t * (3 - 2 * t)
        return { pose: withPose({ ...a.pose, base_focal_length: THREE.MathUtils.lerp(a.pose.base_focal_length, b.pose.base_focal_length, eased) }, posePosition(a.pose).lerp(posePosition(b.pose), eased), poseTarget(a.pose).lerp(poseTarget(b.pose), eased)), date: new Date(a.date.getTime() + (b.date.getTime() - a.date.getTime()) * t) }
      }
      remaining -= shot.blend
    }
    if (remaining < shot.settings.duration || i === shots.length - 1) return sample(shot, remaining)
    remaining -= shot.settings.duration
  }
  return null
}

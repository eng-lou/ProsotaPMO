import * as THREE from 'three'
import type { PathMotion } from './siteScene'

export function sitePathRange(motion: PathMotion, length: number, daysPerSecond: number) {
  const times = (motion.progress_keys || []).map(k => Date.parse(k.date))
  const start = Date.parse(motion.start)
  return { start: new Date(Math.min(start, ...times)), end: new Date(times.length
    ? Math.max(start, ...times) : start + length / motion.speed * 86400000 * daysPerSecond) }
}

// Stored timeline dates are shared by rig keys, path stops and the soil bake.
// Equal positions form a dwell; decreasing positions back up along the route.
export function sitePathProgress(motion: PathMotion, time: number) {
  const keys = [...(motion.progress_keys || [])].sort((a,b) => Date.parse(a.date)-Date.parse(b.date))
  if (!keys.length) return null
  if (time <= Date.parse(keys[0].date)) return keys[0].progress
  for (let i=1; i<keys.length; i++) {
    const a=keys[i-1], b=keys[i], end=Date.parse(b.date)
    if (time >= end) continue
    let t=(time-Date.parse(a.date))/(end-Date.parse(a.date))
    if (a.interpolation==='hold') t=0
    else if (a.interpolation==='smooth') t=t*t*(3-2*t)
    return a.progress+(b.progress-a.progress)*t
  }
  return keys[keys.length-1].progress
}

// Travel is measured in metres and presentation seconds, independently of the
// object's authored scale, pivot and rotation. The parent carries path motion.
export function sampleSitePath(curve: THREE.Curve<THREE.Vector3>, motion: PathMotion, seconds: number, upAxis: 'y'|'z', daysPerSecond = 1) {
  const length = curve.getLength()
  const distance = Math.max(0, seconds) * motion.speed
  const keyed = sitePathProgress(motion, Date.parse(motion.start)+seconds*86400000*daysPerSecond)
  const travelled = keyed !== null ? length*keyed/100 : motion.loop && length > 0 ? distance : Math.min(length, distance)
  const u = length > 0 ? (keyed === null && motion.loop ? travelled % length : travelled) / length : 0
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

export function applySitePath(parent: THREE.Object3D, curve: THREE.Curve<THREE.Vector3>, motion: PathMotion, seconds: number, upAxis: 'y'|'z', origin: THREE.Vector3, daysPerSecond = 1) {
  const sample = sampleSitePath(curve, motion, seconds, upAxis, daysPerSecond)
  parent.quaternion.copy(sample.rotation)
  const anchor = motion.bind_origin ? new THREE.Vector3(motion.bind_origin.x, motion.bind_origin.y, motion.bind_origin.z) : origin
  parent.position.copy(sample.point).sub(anchor.clone().applyQuaternion(sample.rotation))
  parent.updateMatrixWorld(true)
  return sample
}

// Activity-fit mode uses schedule dates, never playback speed, as its clock.
// Keep authored keys untouched; map pauses/reversals proportionally at runtime.
export function fitSitePathToActivity(motion: PathMotion, activity?: {start: string | null; finish: string | null}): PathMotion | null {
  if (!motion.activity_id) return motion
  const start = Date.parse(activity?.start || ''), finish = Date.parse(activity?.finish || '')
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return null
  const keys = [...(motion.progress_keys || [])].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))
  const first = keys.length ? Date.parse(keys[0].date) : 0
  const span = keys.length > 1 ? Date.parse(keys[keys.length-1].date)-first : 0
  return {...motion, start:new Date(start).toISOString(), loop:false, progress_keys:span>0
    ? keys.map(key=>({...key,date:new Date(start+(Date.parse(key.date)-first)/span*(finish-start)).toISOString()}))
    : [{date:new Date(start).toISOString(),progress:0,interpolation:'linear'}, {date:new Date(finish).toISOString(),progress:100,interpolation:'linear'}]}
}
export function sitePathActivityVisible(motion: PathMotion | null, now: Date | null) {
  if (!motion?.activity_id || !now) return true
  const keys = motion.progress_keys || []
  return now.getTime() >= Date.parse(motion.start) && now.getTime() < Date.parse(keys[keys.length-1]?.date || '')
}

import * as THREE from 'three'
import type { PathPoint } from './paths'

// Arc-length-parameterized smooth curve through a Path's control points
// (2026-07-11) — three.js's own CatmullRomCurve3 is exactly what Blender's
// "Follow Path" constraint conceptually walks along (a smooth spline through
// an ordered set of points, `closed` looping back to the first), so this
// reuses it rather than hand-rolling interpolation. `closed` maps straight
// onto CatmullRomCurve3's own constructor flag — same "cyclic U" concept
// Path's own docstring already names it after.
//
// Needs >= 2 points to define a real curve; fewer than that has no direction
// to walk along, so callers get null and should treat the target as
// stationary at the one point that exists (if any).
export function buildPathCurve(points: PathPoint[], closed: boolean): THREE.CatmullRomCurve3 | null {
  if (points.length < 2) return null
  const vectors = points.map(p => new THREE.Vector3(p.x, p.y, p.z))
  return new THREE.CatmullRomCurve3(vectors, closed, 'catmullrom', 0.5)
}

// progress is 0-100 (ElementKeyframe's own path_progress field range, see
// element_keyframe.py's schema docstring) — converted to the curve's own
// 0-1 `u` parameterization here so nothing above this module needs to know
// that split exists.
export function pointAtProgress(curve: THREE.CatmullRomCurve3, progress: number): THREE.Vector3 {
  const t = THREE.MathUtils.clamp(progress, 0, 100) / 100
  return curve.getPointAt(t)
}

export function tangentAtProgress(curve: THREE.CatmullRomCurve3, progress: number): THREE.Vector3 {
  const t = THREE.MathUtils.clamp(progress, 0, 100) / 100
  return curve.getTangentAt(t)
}

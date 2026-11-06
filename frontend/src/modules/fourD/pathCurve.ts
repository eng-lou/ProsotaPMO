import * as THREE from 'three'
import type { PathPoint, PathCoordinate, PathSegmentMode } from './paths'

const vector = (p: PathCoordinate) => new THREE.Vector3(p.x, p.y, p.z)
const coordinate = (p: THREE.Vector3): PathCoordinate => ({ x: p.x, y: p.y, z: p.z })

// Freeze legacy Catmull-Rom spans as equivalent cubics before extending/editing.
// Adding C must not reshape a previously drawn A–B, including in saved routes.
export function materializePathSegments(points: PathPoint[], closed: boolean, mode: PathSegmentMode = 'curved'): PathPoint[] {
  if (points.length < 2) return points.map(p => ({ ...p }))
  const legacy = new THREE.CatmullRomCurve3(points.map(vector), closed, 'centripetal')
  const count = closed ? points.length : points.length - 1
  return points.map((p, i) => {
    if ((!closed && i === 0) || p.segment_mode) return { ...p }
    if (mode === 'straight') return { ...p, segment_mode: mode }
    const span = i === 0 ? count - 1 : i - 1
    const a = vector(points[(i + points.length - 1) % points.length]), b = vector(p)
    const u = legacy.getPoint((span + 1 / 3) / count).multiplyScalar(27).addScaledVector(a, -8).sub(b)
    const v = legacy.getPoint((span + 2 / 3) / count).multiplyScalar(27).sub(a).addScaledVector(b, -8)
    const c1 = u.clone().multiplyScalar(2).sub(v).multiplyScalar(1 / 18).sub(a)
    const c2 = v.multiplyScalar(2).sub(u).multiplyScalar(1 / 18).sub(b)
    return { ...p, segment_mode: mode, segment_controls: [coordinate(c1), coordinate(c2)] }
  })
}

export function pathSegmentCurve(points: PathPoint[], end: number): THREE.Curve<THREE.Vector3> {
  const p = points[end], a = vector(points[(end + points.length - 1) % points.length]), b = vector(p)
  if (p.segment_mode === 'curved' && p.segment_controls) {
    return new THREE.CubicBezierCurve3(a, a.clone().add(vector(p.segment_controls[0])), b.clone().add(vector(p.segment_controls[1])), b)
  }
  return new THREE.LineCurve3(a, b)
}

export function setPathSegmentMode(points: PathPoint[], end: number, mode: PathSegmentMode, locked: (keyof PathCoordinate)[] = []): PathPoint[] {
  if (points.length < 2 || end < 0 || end >= points.length) return points
  const prev = (end + points.length - 1) % points.length
  const a = vector(points[prev]), b = vector(points[end]), chord = b.clone().sub(a)
  let tangent = chord.clone()
  if (prev > 0) tangent = pathSegmentCurve(points, prev).getTangent(1)
  for (const axis of locked) tangent[axis] = 0
  if (tangent.lengthSq() < 1e-12 || tangent.dot(chord) < -1e-8) tangent.copy(chord)
  // A bounded handle turns from the incoming direction into this section.
  tangent.normalize().multiplyScalar(chord.length() / 3)
  const controls: [PathCoordinate, PathCoordinate] = [coordinate(tangent), coordinate(chord.multiplyScalar(-1 / 3))]
  return points.map((p, i) => i === end ? { ...p, segment_mode: mode, segment_controls: mode === 'curved' ? controls : null } : p)
}

export function appendPathPoint(points: PathPoint[], closed: boolean, legacyMode: PathSegmentMode, point: PathCoordinate, mode: PathSegmentMode, locked: (keyof PathCoordinate)[] = []): PathPoint[] {
  const frozen = materializePathSegments(points, closed, legacyMode)
  let next = setPathSegmentMode([...frozen, { ...point }], points.length, mode, locked)
  if (closed && next.length > 1) next = setPathSegmentMode(next, 0, frozen[0]?.segment_mode || mode)
  return next
}

// Include exact vertices at mixed-mode joins, avoiding a rendered shortcut
// across a corner that the follower would actually travel through.
export function samplePathCurve(points: PathPoint[], closed: boolean, mode: PathSegmentMode = 'curved'): THREE.Vector3[] {
  if (points.length < 2) return points.map(vector)
  const frozen = materializePathSegments(points, closed, mode)
  const samples = [vector(points[0])]
  for (let i = 1; i <= (closed ? points.length : points.length - 1); i++) {
    const end = i % points.length
    samples.push(...pathSegmentCurve(frozen, end).getPoints(frozen[end].segment_mode === 'straight' ? 1 : 24).slice(1))
  }
  return samples
}

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
export function buildPathCurve(points: PathPoint[], closed: boolean, mode: 'curved' | 'straight' = 'curved'): THREE.Curve<THREE.Vector3> | null {
  if (points.length < 2) return null
  if (points.some(p => p.segment_mode)) {
    const frozen = materializePathSegments(points, closed, mode)
    const curve = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 1; i < points.length; i++) curve.add(pathSegmentCurve(frozen, i))
    if (closed) curve.add(pathSegmentCurve(frozen, 0))
    return curve
  }
  const vectors = points.map(p => new THREE.Vector3(p.x, p.y, p.z))
  if (mode === 'straight') {
    const curve = new THREE.CurvePath<THREE.Vector3>()
    for (let i=1;i<vectors.length;i++) curve.add(new THREE.LineCurve3(vectors[i-1],vectors[i]))
    if(closed) curve.add(new THREE.LineCurve3(vectors[vectors.length-1],vectors[0]))
    return curve
  }
  return new THREE.CatmullRomCurve3(vectors, closed, 'centripetal')
}

// progress is 0-100 (ElementKeyframe's own path_progress field range, see
// element_keyframe.py's schema docstring) — converted to the curve's own
// 0-1 `u` parameterization here so nothing above this module needs to know
// that split exists.
export function pointAtProgress(curve: THREE.Curve<THREE.Vector3>, progress: number): THREE.Vector3 {
  const t = THREE.MathUtils.clamp(progress, 0, 100) / 100
  return curve.getPointAt(t)
}

export function tangentAtProgress(curve: THREE.Curve<THREE.Vector3>, progress: number): THREE.Vector3 {
  const t = THREE.MathUtils.clamp(progress, 0, 100) / 100
  return curve.getTangentAt(t)
}

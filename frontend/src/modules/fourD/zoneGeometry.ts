import * as THREE from 'three'
import type { UpAxis } from './upAxis'
import type { ZonePoint, ZoneShape } from './zones'

// Segment count for a circle zone's own geometry/border loop (2026-07-30,
// per Maro: "the radial zone for things like crane clearance etc") — fixed
// rather than scaled by radius like REVEAL_SAMPLES_PER_UNIT below, since a
// circle's own smoothness need doesn't grow with size the way a reveal
// animation's sampling density does; 64 is smooth at any on-screen size
// this app's own camera distances actually show.
const CIRCLE_SEGMENTS = 64

// Pure geometry math for Zone's flat-footprint fill/border (2026-07-29) —
// kept separate from ZoneGizmo.tsx's own React glue, same split
// measurementGeometry.ts already uses for the Measure tool.
//
// A Zone's stored points carry no meaningful up-axis coordinate (see
// zone.py's own model docstring — that's `elevation`'s job, a single
// scalar the caller applies as one group-level position offset, not
// per-vertex). Everything here is built in a *local* frame where the up
// axis is always 0 — ZoneGizmo.tsx positions the whole group at
// `elevation` once, so the fill mesh/border/label/drag-plane all share one
// offset instead of recomputing it each.
//
// THREE.ShapeGeometry builds flat in its own local XY plane. Mapping that
// onto the world's actual horizontal plane depends on upAxis:
// - 'z' (Z-up): world horizontal IS (x, y) already — no rotation, shape
//   2D coords are literally (point.x, point.y).
// - 'y' (Y-up, three.js's own default up): world horizontal is (x, z) —
//   shape 2D coords are (point.x, point.z), then the geometry is rotated
//   +90° about X (`rotateX(Math.PI / 2)`), which maps local (x, y, 0) to
//   world (x, 0, y) — i.e. local Y lands exactly on world Z with no sign
//   flip (verified via the standard X-rotation matrix, not assumed).
export interface ZoneShapeResult {
  geometry: THREE.BufferGeometry
  // Closed loop (first point repeated at the end) in the same local frame
  // as `geometry` — for a LineLoop/Line border overlay.
  borderPoints: THREE.Vector3[]
  // Local-frame centroid (plain average of the footprint, not the true
  // polygon centroid — close enough for label placement and cheap for a
  // shape that's usually near-convex).
  centroid: THREE.Vector3
}

function toLocal2D(point: ZonePoint, upAxis: UpAxis): [number, number] {
  return upAxis === 'z' ? [point.x, point.y] : [point.x, point.z]
}

// shape/radius (2026-07-30, per Maro: "the radial zone for things like
// crane clearance etc") — a circle zone stores exactly one point (the
// center, see zone.py's own docstring) instead of 3+ corners; radius only
// matters for this branch. THREE.Shape.absarc + ShapeGeometry's own
// curveSegments param handle the actual circle tessellation, so the fill
// mesh is a real smooth disc, not a coarse N-gon approximation.
// sweepAngle (2026-08-03, per Maro's own crane-clearance reference
// screenshot — "PB-1"/"PB-2" circles filling in as a pac-man-style pie
// wedge from 0° to a full circle) — defaults to a full circle (2π) so
// every pre-existing call site is unaffected. Below a full circle, the
// fill becomes a real pie wedge (center → arc → back to center via
// moveTo/closePath — absarc alone, with no leading moveTo, only ever
// traces the bare arc/circumference) and the border outline gets the
// matching two radial edges instead of just the circumference, so
// ZoneGizmo.tsx's border Line traces the wedge shape too, not a static
// full-circle ring sitting around a growing fill.
export function buildZoneShapeGeometry(
  points: ZonePoint[], upAxis: UpAxis, shape: ZoneShape = 'polygon', radius = 5, sweepAngle = Math.PI * 2,
): ZoneShapeResult | null {
  if (shape === 'circle') {
    if (points.length < 1) return null
    const [cx, cy] = toLocal2D(points[0], upAxis)
    // Snap a near-complete sweep to an exact full circle (2026-08-03, per
    // Maro: "the full sweep is not ideal") — a live reveal's `progress`
    // rarely lands on EXACTLY 1 (frame timing, easing, loop wraparound),
    // so `sweepAngle` rarely lands on EXACTLY 2π either. Without this, a
    // "finished" sweep sat forever just short of a full circle: the two
    // straight center→arc "spoke" border edges never disappeared (a
    // persistent seam/notch instead of a clean ring), and ShapeGeometry's
    // own earcut triangulation of an almost-but-not-quite-closed wedge is
    // a known source of stray sliver triangles for near-degenerate
    // polygons — exactly the jagged artifacts seen right at the end of a
    // real sweep. Below this threshold, behaviour is unchanged.
    const FULL_CIRCLE_EPSILON = 0.01
    const effectiveSweep = sweepAngle >= Math.PI * 2 - FULL_CIRCLE_EPSILON ? Math.PI * 2 : sweepAngle
    const isWedge = effectiveSweep < Math.PI * 2
    const circleShape = new THREE.Shape()
    // A real pie *sector* (arc + two straight radii to center), not a
    // *segment* (arc + a single chord) — per Maro: "per slice the fill
    // exist with the center of the circle as the focal point." absarc()
    // only auto-inserts a connecting line from the *previous curve's own
    // endpoint* — a bare moveTo() with no curve pushed yet doesn't count
    // (Path.absellipse's own "if (this.curves.length > 0)" guard), so
    // moveTo(center) alone was silently discarded and the shape's fill
    // ended up built purely from the arc's own sampled points, closed by
    // a straight chord between its two ends — exactly a lens/segment, not
    // a slice. The explicit lineTo to the arc's own start point (angle 0)
    // is what actually links the center into the path as a real vertex.
    if (isWedge) {
      circleShape.moveTo(cx, cy)
      circleShape.lineTo(cx + radius, cy)
    }
    circleShape.absarc(cx, cy, radius, 0, effectiveSweep, false)
    if (isWedge) circleShape.closePath()
    const geometry = new THREE.ShapeGeometry(circleShape, CIRCLE_SEGMENTS)
    if (upAxis === 'y') geometry.rotateX(Math.PI / 2)

    const toVec3 = (x: number, y: number) => (upAxis === 'z' ? new THREE.Vector3(x, y, 0) : new THREE.Vector3(x, 0, y))
    const arcSegments = isWedge ? Math.max(2, Math.round(CIRCLE_SEGMENTS * (effectiveSweep / (Math.PI * 2)))) : CIRCLE_SEGMENTS
    const borderPoints: THREE.Vector3[] = []
    if (isWedge) borderPoints.push(toVec3(cx, cy))
    for (let i = 0; i <= arcSegments; i++) {
      const angle = (i / arcSegments) * effectiveSweep
      borderPoints.push(toVec3(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)))
    }
    if (isWedge) borderPoints.push(toVec3(cx, cy))
    const centroid = upAxis === 'z' ? new THREE.Vector3(cx, cy, 0) : new THREE.Vector3(cx, 0, cy)
    return { geometry, borderPoints, centroid }
  }

  if (points.length < 3) return null

  const shapePath = new THREE.Shape()
  const [x0, y0] = toLocal2D(points[0], upAxis)
  shapePath.moveTo(x0, y0)
  for (let i = 1; i < points.length; i++) {
    const [x, y] = toLocal2D(points[i], upAxis)
    shapePath.lineTo(x, y)
  }
  shapePath.closePath()

  const geometry = new THREE.ShapeGeometry(shapePath)
  if (upAxis === 'y') geometry.rotateX(Math.PI / 2)

  const borderPoints = points.map(p => {
    const [x, y] = toLocal2D(p, upAxis)
    return upAxis === 'z' ? new THREE.Vector3(x, y, 0) : new THREE.Vector3(x, 0, y)
  })
  borderPoints.push(borderPoints[0].clone())

  const centroid = new THREE.Vector3()
  for (const p of borderPoints.slice(0, -1)) centroid.add(p)
  centroid.divideScalar(points.length)

  return { geometry, borderPoints, centroid }
}

// Samples the closed border loop at even arc-length intervals, for the
// 'draw' reveal animation only (2026-08-06, per Maro: "the border line
// animation for the zones needs to kind of work like the path. currently
// it just appears, so on the 0 frame its already there"). `borderPoints`
// is just the raw corners (plus the closing repeat) — perfectly fine for
// rendering the *complete* border, which is exactly straight lines between
// them either way, but revealing it corner-by-corner (ZoneGizmo.tsx's own
// revealCount slicing) only has as many visible steps as there are edges —
// for a simple 4-corner zone, the very first edge alone can already be most
// of the total perimeter (confirmed against a real zone: one edge measured
// 20.9 of a 68.5 total perimeter, ~65% revealed after a single, supposedly
// "just started" step), so the animation reads as "instantly there" rather
// than tracing in. PathGizmo.tsx's own curve reveal never has this problem
// because CatmullRomCurve3.getPoints() already densely samples the spline
// (CURVE_SAMPLES_MIN/CURVE_SAMPLES_PER_POINT) before ZoneGizmo.tsx's
// matching revealCount logic ever slices it — this is the equivalent
// densification for a Zone's own straight-edged loop, so the two features
// trace in at comparable, actually-gradual granularity. REVEAL_SAMPLES_PER_UNIT
// scales sample count with the shape's own real perimeter (not a fixed
// count) so a tiny zone doesn't get needlessly oversampled and a huge one
// still traces smoothly instead of visibly stepping between long edges.
const REVEAL_SAMPLES_PER_UNIT = 2
const REVEAL_SAMPLES_MIN = 32

export function densifyBorderForReveal(borderPoints: THREE.Vector3[]): THREE.Vector3[] {
  if (borderPoints.length < 2) return borderPoints
  const segmentLengths: number[] = []
  let totalLength = 0
  for (let i = 0; i < borderPoints.length - 1; i++) {
    const length = borderPoints[i].distanceTo(borderPoints[i + 1])
    segmentLengths.push(length)
    totalLength += length
  }
  if (totalLength === 0) return borderPoints

  const sampleCount = Math.max(REVEAL_SAMPLES_MIN, Math.round(totalLength * REVEAL_SAMPLES_PER_UNIT))
  const result: THREE.Vector3[] = []
  let segmentIndex = 0
  let distanceBeforeSegment = 0
  for (let s = 0; s <= sampleCount; s++) {
    const targetDistance = (s / sampleCount) * totalLength
    while (
      segmentIndex < segmentLengths.length - 1
      && distanceBeforeSegment + segmentLengths[segmentIndex] < targetDistance
    ) {
      distanceBeforeSegment += segmentLengths[segmentIndex]
      segmentIndex++
    }
    const segmentLength = segmentLengths[segmentIndex]
    const t = segmentLength > 0 ? Math.min(1, Math.max(0, (targetDistance - distanceBeforeSegment) / segmentLength)) : 0
    result.push(new THREE.Vector3().lerpVectors(borderPoints[segmentIndex], borderPoints[segmentIndex + 1], t))
  }
  return result
}

// Continuous, sub-segment reveal (2026-08-06, per Maro: "at 0 its still
// peeking out") — see PathGizmo.tsx's own matching sliceRevealTuples
// header for the full "why": the previous version snapped straight to the
// nearest *whole* point index the instant progress ticked above 0, so
// even the very first reveal frame already showed one complete minimum
// segment rather than a growing sliver. Appends one linearly-interpolated
// point at the fractional remainder so the leading tip slides forward
// continuously — at progress=0 exactly there's only the single starting
// point (too few to draw anything).
export function sliceRevealVectors(points: THREE.Vector3[], progress: number): THREE.Vector3[] | null {
  if (points.length < 2 || progress <= 0) return null
  const revealIndex = Math.min(points.length - 1, progress * (points.length - 1))
  const whole = Math.floor(revealIndex)
  const frac = revealIndex - whole
  const sliced = points.slice(0, whole + 1)
  if (frac > 0 && whole + 1 < points.length) {
    sliced.push(points[whole].clone().lerp(points[whole + 1], frac))
  }
  return sliced.length >= 2 ? sliced : null
}

// The zone's own fixed drag/add-point plane (2026-07-29) — same upAxis
// convention PathAddPointCatcher already uses for its ground-plane
// fallback (Vector3(0,0,1) for 'z', Vector3(0,1,0) for 'y'), just placed at
// `elevation` instead of always 0 — so a vertex drag/add can never lift one
// corner off the zone's own flat plane the way a camera-facing drag plane
// (PathGizmo's own convention) could.
export function zonePlane(upAxis: UpAxis, elevation: number): THREE.Plane {
  const normal = upAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
  return new THREE.Plane(normal, -elevation)
}

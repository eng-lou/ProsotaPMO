import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { Line2 } from 'three-stdlib'
import type { Path, PathPoint } from './paths'
import type { UpAxis } from './upAxis'
import { computeRevealProgress } from './timelinePlayback'
import type { ExportLabelRegistry } from './exportLabels'

// Handles keep this fixed neutral color regardless of the route's own
// `path.color` (2026-07-29) — only the line/arrow/label pick up the
// route's own color (see PathGizmo's render below), so the drag affordance
// doesn't disappear against a busy-colored route (e.g. a bright red haul
// route would otherwise hide bright-red handles right on top of it).
const HANDLE_COLOR = 0x38bdf8
// Minimum curve resolution, and additional samples per control point
// (2026-07-29, per Maro: "at bends, its not looking good" — a screenshot-
// confirmed real symptom: a sharp turn rendered as a jumbled cross-hatch of
// dashes instead of a smooth curve). A *fixed* total sample count spread
// across the whole curve, regardless of how many control points/turns it
// actually has, starves any one sharp bend of resolution the longer/more
// complex the overall route gets — a two-point path and a forty-point one
// used to get the same 64 samples between them, so the forty-point one's
// own turns got roughly 1/20th the resolution. Scaling with point count
// instead keeps each individual bend adequately sampled no matter how long
// the rest of the route is.
const CURVE_SAMPLES_MIN = 64
const CURVE_SAMPLES_PER_POINT = 24
// Flat-arrow size (2026-07-29) — see the arrow's own render/orientation
// logic below for why this is a flat ground shape, not a 3D cone.
const ARROW_LENGTH = 0.5
const ARROW_RADIUS = 0.2
// The camera distance at which the arrow renders at its authored
// ARROW_LENGTH/ARROW_RADIUS size, verbatim (2026-07-29, per Maro: "at
// closer angles the path and its arrow are proportional but at far angles
// the arrow disappears" — confirmed live via screenshot: a real building/
// site model at typical zoomed-out site-overview distance shrank the
// world-space-sized arrow to sub-pixel). Below this distance the arrow
// never renders SMALLER than its authored size (matches the close-up
// screenshot's own "looks proportional, don't touch it" appearance);
// beyond it, the arrow scales up linearly with distance so its apparent
// on-screen size stays roughly constant instead of shrinking away — the
// same "world size ∝ distance" trick a camera-facing sprite uses, applied
// directly to this mesh's own per-frame scale instead of a real billboard,
// since the arrow still needs to lie flat and yaw with the route rather
// than always face the camera.
const ARROW_REFERENCE_DISTANCE = 20

// Flat ground-arrow shape (2026-07-29) — a plain triangle in the local XY
// plane, tip at local +X, built once and shared by every PathGizmo instance
// (only ever read from, never mutated, so one shared THREE.BufferGeometry
// is safe across every route's own arrow mesh — same idiom as this app's
// other shared/cached geometries). Replaces an earlier 3D ConeGeometry
// (2026-07-29, per Maro's own screenshots — "at closer angles proportional
// but at far angles the arrow disappears" plus a second, separate report:
// "at bends, its not looking good", a cone lying oriented along the route's
// true 3D tangent, seen from close to directly above like every reference
// screenshot in this whole feature, projects edge-on into a thin diagonal
// sliver rather than a recognizable arrowhead — easy to mistake for a
// stray, misaligned dash, which is exactly what got reported). A flat
// shape lying on the ground and yawed toward the route's own *horizontal*
// direction of travel (ignoring any slope) reads as a real arrow from any
// angle, the same way the reference video's own arrows do.
const FLAT_ARROW_GEOMETRY = new THREE.ShapeGeometry((() => {
  const shape = new THREE.Shape()
  shape.moveTo(ARROW_LENGTH, 0)
  shape.lineTo(0, ARROW_RADIUS)
  shape.lineTo(0, -ARROW_RADIUS)
  shape.closePath()
  return shape
})())

// Forces three.js's WebGLBindingStates to recompute a fat-line's own
// max-instance-count cache (2026-08-06, per Maro: "when i play the
// animation or scrub i notice the line doesnt follow. but the arrow
// does") — traced into three.js's own source
// (renderers/webgl/WebGLBindingStates.js): geometry._maxInstanceCount is
// computed once, the very first time this Line2's own
// InstancedBufferGeometry (what drei's <Line> is actually built on) gets
// bound to the GPU, then cached forever — `if (geometry._maxInstanceCount
// === undefined) { geometry._maxInstanceCount = ... }` — regardless of
// how many more times setPositions() below swaps in a differently-sized
// instanceStart/instanceEnd buffer afterward (confirmed reading
// WebGLRenderer.js's own render path: `Math.min(geometry.instanceCount,
// geometry._maxInstanceCount)` decides how many segments actually get
// drawn, and instanceCount itself defaults to Infinity, untouched by
// setPositions()). Since the reveal animation's very first setPositions()
// call happens at the *smallest* possible slice (progress just above 0 —
// 2 points, 1 segment), that tiny count gets locked in as the permanent
// draw ceiling: every later, larger setPositions() call updates the
// buffer's actual contents correctly, but the renderer never draws more
// than that first frame's instance count, so the visible line never grows
// past its very first sliver. The arrow (a plain mesh with its own
// directly-set position/quaternion, no InstancedBufferGeometry involved)
// was never affected — matches exactly "the line doesn't follow, but the
// arrow does". Deleting the cached field after every setPositions() call
// forces WebGLBindingStates to recompute it fresh against the geometry's
// *current* buffer on its next bind — mirrors what three.js's own
// WebGLGeometries.js does on geometry disposal (`delete
// geometry._maxInstanceCount`).
export function resetLine2InstanceCap(geometry: THREE.BufferGeometry): void {
  delete (geometry as THREE.BufferGeometry & { _maxInstanceCount?: number })._maxInstanceCount
}

// Live-editable helper for one Path (2026-07-11, per Maro's Blender curve
// reference — see path.py's own model docstring). Every child mesh here is
// tagged userData.isPathGizmo so PathAddPointCatcher's raw raycast (below)
// can skip these when placing a *new* point — otherwise clicking near an
// existing handle while adding points would hit the handle itself instead
// of whatever real geometry or ground plane is underneath it.
//
// Points are world-space (unlike SectionBoxGizmo, which tracks a target's
// matrixWorld every frame) — path.py's own docstring is explicit that a
// Path lives directly in world space, so handles are placed straight from
// each point's own x/y/z with no per-frame parent-matrix copy needed.
//
// Drag math (2026-07-29, rewritten — see below): while dragging, each
// pointer move first raycasts against the real scene (same
// isPathGizmo/isZoneGizmo/isMeasurementGizmo-excluding hit-test
// PathAddPointCatcher's own click-to-place uses) so an existing point
// re-lands on whatever surface is under the cursor, exactly like placing a
// brand-new point does. Falls back to a plane facing the camera through the
// point's start position (the original, only, technique here) for the case
// nothing is under the cursor — e.g. repositioning a genuinely-3D waypoint
// (a crane path's mid-air point) in open space.
//
// The plane-only version of this (still used as the fallback) has a real
// bug when used as the *only* drag mechanism: the plane is fixed at
// drag-start facing that moment's camera direction, so the released point
// necessarily looks right from that exact viewpoint (that's what "facing
// the camera" guarantees) but is generally NOT on the surface the user was
// actually looking at — from any other angle the true offset shows up, in
// all 3 axes (2026-07-29, per Maro, after dragging a point on the same
// misplaced-path incident this file's own isZoneGizmo/isMeasurementGizmo
// exclusion above already fixed for the *add* path: "it only looks right
// from the angle it was placed... in other views, its completely off in
// all axes"). Surface-raycasting the drag itself, not just point-add,
// removes the camera-facing plane from the common case entirely.
//
// Live-drag only touches local component state via onDragMove (FourD.tsx
// keeps a working copy for the live curve preview); nothing persists until
// pointer-up (onDragEnd), matching this app's existing TransformControls
// convention.
function isAppGizmoObject(object: THREE.Object3D): boolean {
  let obj: THREE.Object3D | null = object
  while (obj) {
    if (obj.userData?.isPathGizmo || obj.userData?.isZoneGizmo || obj.userData?.isMeasurementGizmo) return true
    obj = obj.parent
  }
  return false
}

// Arrowhead orientation math (2026-07-29), factored out of PathGizmo's own
// arrowTransform useMemo below so the reveal animation's own useFrame (same
// file, further down) can recompute it against whatever the *currently
// revealed* sub-array of curvePositions is, not just the full static
// curve — an animated route's arrow needs to sit at the growing tip and
// re-yaw as that tip's own direction of travel changes, the same way it
// already sits at the final segment for a non-animated route. Lies flat
// against the ground and yaws to face the final segment's own *horizontal*
// direction of travel — see this function's own former inline comment
// (still accurate) on why a flat shape + this basis construction, not a 3D
// cone + setFromUnitVectors.
function computeArrowTransform(points: [number, number, number][], upAxis: UpAxis): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
  if (points.length < 2) return null
  const end = new THREE.Vector3(...points[points.length - 1])
  const prev = new THREE.Vector3(...points[points.length - 2])
  const tangent = end.clone().sub(prev)
  const up = upAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
  const forward = tangent.clone().addScaledVector(up, -tangent.dot(up))
  // Degenerate only for a dead-vertical final segment (straight up/down) —
  // no real horizontal direction to point along at all; an arbitrary
  // horizontal fallback still lands the arrow at the right *position*, just
  // with an arbitrary yaw, rather than skipping it entirely.
  if (forward.lengthSq() < 1e-8) forward.set(1, 0, 0).addScaledVector(up, -up.x)
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1).addScaledVector(up, -up.z)
  forward.normalize()
  const right = new THREE.Vector3().crossVectors(up, forward).normalize()
  const basis = new THREE.Matrix4().makeBasis(forward, right, up)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis)
  return { position: end, quaternion }
}

// Continuous, sub-segment reveal (2026-08-06, per Maro: "at 0 its still
// peeking out" — screenshot-confirmed a short-but-visible stub right at
// the very start of the reveal window, instead of nothing). The previous
// version snapped straight to the nearest *whole* point index
// (Math.max(2, Math.round(progress*(total-1))+1)) the instant progress
// ticked above 0 — a fat line needs at least 2 points to draw any segment
// at all, so that snap meant the very first frame of the reveal already
// showed one complete minimum-length segment, not a growing sliver.
// Appends one linearly-interpolated point between the last fully-revealed
// point and the next one, at the fractional remainder of `progress *
// (total-1)`, so the leading tip slides forward continuously every frame
// instead of jumping in whole-point steps — at progress=0 exactly there's
// only the single starting point (too few to draw anything), matching
// "nothing visible yet".
function sliceRevealTuples(points: [number, number, number][], progress: number): [number, number, number][] | null {
  if (points.length < 2 || progress <= 0) return null
  const revealIndex = Math.min(points.length - 1, progress * (points.length - 1))
  const whole = Math.floor(revealIndex)
  const frac = revealIndex - whole
  const sliced = points.slice(0, whole + 1)
  if (frac > 0 && whole + 1 < points.length) {
    const a = points[whole]
    const b = points[whole + 1]
    sliced.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac])
  }
  return sliced.length >= 2 ? sliced : null
}
function PathGizmo({
  path, upAxis, hideHandles, timelineDateRef, animationStart, animationEnd, exportLabelsRef, onDragStart, onDragMove, onDragEnd,
}: {
  path: Path
  // Needed only for the arrow's own flat-lie-and-yaw orientation below
  // (2026-07-29) — the line/handles/label have never needed to know which
  // axis is "up".
  upAxis: UpAxis
  // 2026-07-29 — the line/arrow/label are real site-logistics content now
  // (a styled, colored, dashed, labeled route — see path.py's own new
  // style-fields header), not just a live-editing aid, so they keep
  // rendering during a capture/still-export same as an Annotation always
  // does. Only the drag handles (pure editing chrome nobody wants floating
  // in an exported video) respect hidePathHelpers — Viewport3D.tsx's own
  // render call passes that through as this prop instead of the old
  // `{!hidePathHelpers && <PathGizmos .../>}` wrapper that used to hide the
  // whole gizmo, line included.
  hideHandles: boolean
  // Line-draw reveal animation (2026-07-29, per Maro: "animate the line
  // itself so it looks like its coming from the first point to the
  // last... visible in the animation timeline") — the same ref every other
  // animated actor already reads (Viewport3D.tsx's TimelinePlayback), a
  // ref and not React state so scrubbing/Play doesn't re-render this
  // component 60 times a second (see that ref's own header in
  // Viewport3D.tsx); read directly inside this component's own useFrame
  // below instead.
  timelineDateRef: React.MutableRefObject<Date | null>
  // Resolved out of ElementKeyframe rows (source_kind 'path', field
  // 'anim_start'/'anim_end') by FourD.tsx/PathGizmos below (2026-07-30,
  // superseding the old plain path.animation_start/animation_end columns —
  // see paths.ts's own header for why: this reveal window now needs to
  // work, and appear in the Animation Timeline's dope-sheet, with no
  // scheduled Activity involved at all).
  animationStart: Date | null
  animationEnd: Date | null
  // Capture/Export Video text visibility (2026-07-30, per Maro: "the text
  // boxes and texts dont show up in the captured renders") — see
  // exportLabels.ts's own header.
  exportLabelsRef: React.MutableRefObject<ExportLabelRegistry>
  onDragStart: () => void
  onDragMove: (pathId: string, points: PathPoint[]) => void
  onDragEnd: (pathId: string, points: PathPoint[]) => void
}) {
  const { camera, scene } = useThree()
  const dragRef = useRef<{
    index: number
    plane: THREE.Plane
    offset: THREE.Vector3
    lastPoints: PathPoint[]
  } | null>(null)
  const arrowRef = useRef<THREE.Mesh>(null)
  const lineRef = useRef<Line2>(null)
  const dragRaycaster = useRef(new THREE.Raycaster())
  // Removes this path's own export-label entry on unmount (2026-07-30) —
  // same "don't leave a ghost label behind after deletion" reasoning
  // AnnotationMarker.tsx's own matching cleanup effect explains.
  useEffect(() => {
    return () => { exportLabelsRef.current.delete(`${path.id}-label`) }
  }, [path.id, exportLabelsRef])

  const curvePositions = useMemo(() => {
    if (path.points.length < 2) return null
    const vectors = path.points.map(p => new THREE.Vector3(p.x, p.y, p.z))
    // 'centripetal', not the earlier explicit 'catmullrom' (2026-07-29, per
    // Maro: "at bends, its not looking good" — confirmed live via
    // screenshot: a sharp turn rendered as a jumbled cross-hatch instead of
    // a smooth curve). Verified directly in three.js's own
    // CatmullRomCurve3.js — its own file header literally describes
    // 'centripetal' as "useful for avoiding cusps and self-intersections in
    // non-uniform Catmull-Rom curves" (a cited paper, not a guess) and it's
    // the library's own default when no type is given at all; the uniform
    // 'catmullrom' type this used to pass explicitly is exactly the
    // variant prone to the loop/overshoot artifacts at a sharp, unevenly-
    // spaced turn that a real haul-route bend produces.
    const curve = new THREE.CatmullRomCurve3(vectors, path.closed, 'centripetal')
    const samples = Math.max(CURVE_SAMPLES_MIN, path.points.length * CURVE_SAMPLES_PER_POINT)
    return curve.getPoints(samples).map(v => [v.x, v.y, v.z] as [number, number, number])
  }, [path.points, path.closed])

  // Arrowhead orientation (2026-07-29, `path.show_arrow`) — lies flat
  // against the ground (FLAT_ARROW_GEOMETRY's own local XY plane, normal
  // +Z) and yaws to face the curve's final segment's own *horizontal*
  // direction of travel — see computeArrowTransform's own header above for
  // the full "why". The reveal-animation branch of the useFrame just below
  // recomputes this same function against the currently-revealed sub-array
  // instead, when path.animate is on.
  const arrowTransform = useMemo(() => {
    if (!curvePositions || !path.show_arrow) return null
    return computeArrowTransform(curvePositions, upAxis)
  }, [curvePositions, path.show_arrow, upAxis])

  // Only ever true->false (2026-07-29) — lets the reveal-animation branch
  // below know it just needs to reset the Line's geometry/visibility back
  // to the full static curve once, the moment `animate` turns off, rather
  // than doing that reset on every single frame forever (this file's own
  // per-frame budget is meant for paths that are *actually* animating —
  // see timelineDateRef's own header on why a ref, not React state, drives
  // this in the first place).
  const wasAnimatingRef = useRef(false)

  // Distance-based arrow scale (2026-07-29, per Maro: "at closer angles the
  // path and its arrow are proportional but at far angles the arrow
  // disappears") plus the line-draw reveal animation (2026-07-29, per
  // Maro: "animate the line itself so it looks like its coming from the
  // first point to the last with the arrow as well if enabled... can
  // place animation on loop") — both live in the same per-frame callback
  // since the reveal branch also needs to re-scale the arrow at its own,
  // continuously-moving tip position. Imperatively mutates the drei
  // <Line>'s own Line2/LineGeometry via lineRef instead of recomputing
  // `curvePositions` through React state every frame — this app's own
  // hard-learned perf lesson (AnimationActorsList.tsx's own header: a
  // React-state-driven per-frame update froze the whole 3D pipeline at
  // real project scale) applies just as much to a single animated route as
  // it did to thousands of keyframed actors, so this never triggers a
  // React re-render at all while playing.
  useFrame(() => {
    // Capture/Export Video text visibility (2026-07-30, per Maro: "the
    // text boxes and texts dont show up in the captured renders") — see
    // exportLabels.ts's own header. Points are already world-space (this
    // group has no position offset of its own — path.py's own docstring
    // is explicit a Path lives directly in world space), so no
    // localToWorld conversion is needed here, unlike Zone/Annotation.
    if (path.show_label && path.name && path.points.length > 0) {
      const p = path.points[0]
      exportLabelsRef.current.set(`${path.id}-label`, {
        kind: 'path-label',
        visible: true,
        worldPos: new THREE.Vector3(p.x, p.y, p.z),
        text: path.name,
        backgroundColor: 'rgba(255,255,255,0.85)',
        borderColor: path.color,
        textColor: path.color,
        fontSize: 13,
        borderRadius: 4,
        bold: true,
        anchor: 'bottom-center',
      })
    } else {
      exportLabelsRef.current.delete(`${path.id}-label`)
    }

    if (!path.animate) {
      if (wasAnimatingRef.current) {
        wasAnimatingRef.current = false
        if (lineRef.current && curvePositions) {
          lineRef.current.geometry.setPositions(curvePositions.flat())
          resetLine2InstanceCap(lineRef.current.geometry)
          lineRef.current.computeLineDistances()
          lineRef.current.visible = true
        }
        if (arrowRef.current) arrowRef.current.visible = true
      }
      if (arrowRef.current && arrowTransform) {
        const distance = camera.position.distanceTo(arrowTransform.position)
        arrowRef.current.scale.setScalar(Math.max(1, distance / ARROW_REFERENCE_DISTANCE))
      }
      return
    }
    wasAnimatingRef.current = true
    if (!curvePositions || curvePositions.length < 2) return

    const now = timelineDateRef.current ?? new Date()
    const progress = computeRevealProgress(now, animationStart, animationEnd, path.animation_loop)
    const sliced = sliceRevealTuples(curvePositions, progress)
    const visible = sliced !== null

    if (lineRef.current) {
      lineRef.current.visible = visible
      if (sliced) {
        lineRef.current.geometry.setPositions(sliced.flat())
        resetLine2InstanceCap(lineRef.current.geometry)
        lineRef.current.computeLineDistances()
      }
    }

    if (arrowRef.current) {
      const tip = path.show_arrow && sliced ? computeArrowTransform(sliced, upAxis) : null
      arrowRef.current.visible = !!tip
      if (tip) {
        arrowRef.current.position.copy(tip.position)
        arrowRef.current.quaternion.copy(tip.quaternion)
        const distance = camera.position.distanceTo(tip.position)
        arrowRef.current.scale.setScalar(Math.max(1, distance / ARROW_REFERENCE_DISTANCE))
      }
    }
  })

  const handlePointerDown = (index: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    onDragStart()

    const point = path.points[index]
    const worldPos = new THREE.Vector3(point.x, point.y, point.z)
    const cameraDir = new THREE.Vector3()
    camera.getWorldDirection(cameraDir)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDir, worldPos)
    const hit = new THREE.Vector3()
    e.ray.intersectPlane(plane, hit)

    dragRef.current = { index, plane, offset: worldPos.clone().sub(hit), lastPoints: path.points }
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    if (!drag) return
    e.stopPropagation()

    const raycaster = dragRaycaster.current
    raycaster.ray.copy(e.ray)
    // raycaster.camera (2026-07-29) — required, not optional: drei's
    // <Line> (Line2/LineSegments2) reads it during raycast() to convert
    // its screen-space width into world units, and throws a bare
    // TypeError ("Cannot read properties of null (reading 'near')") if
    // it's unset, rather than just missing the hit — caught live once a
    // Path's own curve line existed anywhere in the scene. THREE.Raycaster
    // defaults `camera` to null; only `setFromCamera` sets it, which this
    // standalone raycaster (built from a copied ray, not a camera) never
    // calls.
    raycaster.camera = camera
    const surfaceHits = raycaster.intersectObjects(scene.children, true).filter(hit => !isAppGizmoObject(hit.object))
    let next: THREE.Vector3
    if (surfaceHits.length > 0) {
      next = surfaceHits[0].point
    } else {
      const planeHit = new THREE.Vector3()
      if (!e.ray.intersectPlane(drag.plane, planeHit)) return
      next = planeHit.add(drag.offset)
    }

    const nextPoints = drag.lastPoints.map((p, i) => (i === drag.index ? { x: next.x, y: next.y, z: next.z } : p))
    drag.lastPoints = nextPoints
    onDragMove(path.id, nextPoints)
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    onDragEnd(path.id, drag.lastPoints)
  }

  return (
    <group userData={{ isPathGizmo: true }}>
      {curvePositions && (
        <Line
          ref={lineRef}
          points={curvePositions}
          color={path.color}
          lineWidth={path.line_width}
          dashed={path.line_style === 'dashed'}
          dashSize={path.dash_size}
          gapSize={path.gap_size}
          userData={{ isPathGizmo: true }}
        />
      )}
      {arrowTransform && (
        <mesh
          ref={arrowRef}
          geometry={FLAT_ARROW_GEOMETRY}
          position={arrowTransform.position}
          quaternion={arrowTransform.quaternion}
          userData={{ isPathGizmo: true }}
        >
          <meshBasicMaterial
            color={path.color} side={THREE.DoubleSide}
            polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
          />
        </mesh>
      )}
      {path.show_label && path.name && path.points.length > 0 && (
        <Html center distanceFactor={12} position={[path.points[0].x, path.points[0].y, path.points[0].z]} style={{ pointerEvents: 'none' }}>
          <div style={{
            fontWeight: 700, fontSize: 13, color: path.color, whiteSpace: 'nowrap',
            background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4,
            border: `1.5px solid ${path.color}`, transform: 'translateY(-140%)',
          }}>
            {path.name}
          </div>
        </Html>
      )}
      {!hideHandles && path.points.map((point, index) => (
        <mesh
          key={index}
          position={[point.x, point.y, point.z]}
          userData={{ isPathGizmo: true }}
          onPointerDown={handlePointerDown(index)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial color={HANDLE_COLOR} depthTest />
        </mesh>
      ))}
    </group>
  )
}

// Every currently-visible Path's own gizmo (2026-07-11) — mirrors
// SectionBoxGizmos' own "skip if not visible" convention. Rendered as a
// sibling of ModelObjects, not nested under any imported model, since a
// Path is project-scoped rather than attached to one target.
export function PathGizmos({
  paths, upAxis, hideHandles, timelineDateRef, animWindows, exportLabelsRef, onDragStart, onDragMove, onDragEnd,
}: {
  paths: Path[]
  upAxis: UpAxis
  hideHandles: boolean
  timelineDateRef: React.MutableRefObject<Date | null>
  // Keyed by path.id (2026-07-30) — see PathGizmo's own animationStart/
  // animationEnd header for what these resolve from.
  animWindows: Map<string, { start: Date | null; end: Date | null }>
  exportLabelsRef: React.MutableRefObject<ExportLabelRegistry>
  onDragStart: () => void
  onDragMove: (pathId: string, points: PathPoint[]) => void
  onDragEnd: (pathId: string, points: PathPoint[]) => void
}) {
  return (
    <>
      {paths.filter(p => p.visible).map(path => {
        const window = animWindows.get(path.id)
        return (
          <PathGizmo
            key={path.id}
            path={path}
            upAxis={upAxis}
            hideHandles={hideHandles}
            timelineDateRef={timelineDateRef}
            animationStart={window?.start ?? null}
            animationEnd={window?.end ?? null}
            exportLabelsRef={exportLabelsRef}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
          />
        )
      })}
    </>
  )
}

// Click-to-place a new point on the active path (2026-07-11, per Maro's
// chosen add-point UX: click directly in the 3D viewport rather than typing
// numeric coordinates). Deliberately bypasses React Three Fiber's own
// synthetic pointer-event system entirely — attaching a *native*
// 'pointerdown' listener on the canvas element in the capture phase, so it
// runs and can stopPropagation before R3F's own listener (registered in the
// bubble phase) gets a chance to run ModelObjects' existing selection/
// box-select handlers. This means add-point mode needs zero changes to
// ModelObjects' already-complex click handling to "win" over it.
//
// Raycasts against the whole scene first (so clicking an actual wall/slab
// places the point right on its surface, the common case for tracing a path
// along real geometry) — objects tagged userData.isPathGizmo (this file's
// own curve line + handles) are filtered out of the hit-test so clicking
// near an existing point doesn't grab the handle instead of the surface
// beneath it. Falls back to a ground plane (at the up-axis's zero level) so
// clicking empty space above/around the model still places a point instead
// of silently doing nothing.
export function PathAddPointCatcher({
  active, upAxis, onAddPoint,
}: {
  active: boolean
  upAxis: 'y' | 'z'
  onAddPoint: (point: PathPoint) => void
}) {
  const { camera, scene, gl } = useThree()

  useEffect(() => {
    if (!active) return

    const raycaster = new THREE.Raycaster()
    const groundPlane = upAxis === 'z'
      ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
      : new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    const handlePointerDown = (event: PointerEvent) => {
      event.stopPropagation()
      event.preventDefault()
      const rect = gl.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)

      // isAppGizmoObject (2026-07-29 fix, per Maro, after a real incident: a
      // path traced across a sidewalk that had a Zone's own flat fill
      // polygon sitting over part of it landed on the *Zone's* fill mesh
      // instead of the sidewalk beneath it). Shared with PathGizmo's own
      // vertex-drag raycast above so add-a-point and drag-an-existing-point
      // land on the same surface — this filter is reused verbatim for
      // Paths, Annotation placement, and pivot-picking, and never got told
      // about ZoneGizmo.tsx/MeasurementMarker.tsx's own overlay tags when
      // those were added later — any app-level gizmo/overlay mesh needs to
      // be listed in isAppGizmoObject, not just this file's own.
      const hits = raycaster.intersectObjects(scene.children, true).filter(hit => !isAppGizmoObject(hit.object))

      if (hits.length > 0) {
        const p = hits[0].point
        onAddPoint({ x: p.x, y: p.y, z: p.z })
        return
      }
      const groundHit = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
        onAddPoint({ x: groundHit.x, y: groundHit.y, z: groundHit.z })
      }
    }

    const el = gl.domElement
    el.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => el.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [active, upAxis, camera, scene, gl, onAddPoint])

  return null
}

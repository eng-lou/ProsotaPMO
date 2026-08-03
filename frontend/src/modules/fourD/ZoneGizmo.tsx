import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { LineGeometry, type Line2 } from 'three-stdlib'
import type { Zone, ZonePoint } from './zones'
import { buildZoneShapeGeometry, densifyBorderForReveal, sliceRevealVectors, zonePlane } from './zoneGeometry'
import type { UpAxis } from './upAxis'
import { computeRevealProgress } from './timelinePlayback'
// See PathGizmo.tsx's own header on this function for the full "why" —
// the same Line2/InstancedBufferGeometry max-instance-count caching gotcha
// applies here for the border reveal below.
import { resetLine2InstanceCap } from './PathGizmo'
import type { ExportLabelRegistry } from './exportLabels'

const HANDLE_COLOR = 0xffffff

// Live-editable helper for one Zone (2026-07-29, per Maro's site-logistics
// reference — a filled, labeled "PROJECT SITE" style area). Mirrors
// PathGizmo.tsx's own structure closely, with one deliberate difference:
// vertex drag is constrained to the zone's own fixed horizontal plane at
// `elevation` (zoneGeometry.ts's own zonePlane), not a camera-facing plane
// like PathGizmo's handles — a Zone is meant to stay flat, so an edit must
// never lift one corner off-plane the way an unconstrained camera-facing
// drag could. The whole group is offset once by `elevation` on the up
// axis; the fill mesh/border/label/handles all live in the same
// zoneGeometry.ts-built local frame (up-coordinate always 0) underneath it.
function ZoneGizmo({
  zone, upAxis, hideHandles, timelineDateRef, animationStart, animationEnd, exportLabelsRef, onDragStart, onDragMove, onDragEnd,
}: {
  zone: Zone
  upAxis: UpAxis
  // 2026-07-29 — the fill/border/label are real site-logistics content
  // (the whole point of this feature — a "PROJECT SITE" style area meant to
  // show up in an exported video), not just a live-editing aid, so they
  // keep rendering during a capture/still-export same as an Annotation
  // always does. Only the drag handles (pure editing chrome) respect
  // Viewport3D.tsx's existing hidePathHelpers flag — same PathGizmo.tsx
  // treatment, see that component's own matching `hideHandles` header.
  hideHandles: boolean
  // Reveal animation (2026-07-29, per Maro: "the animation will go like
  // path to set the border then the fill, can also set a flashing zone
  // animation") — same ref PathGizmo.tsx's own matching prop reads, see
  // that component's own header for why a ref (not React state) is what
  // drives this.
  timelineDateRef: React.MutableRefObject<Date | null>
  // Resolved out of ElementKeyframe rows (source_kind 'zone', field
  // 'anim_start'/'anim_end') by FourD.tsx/ZoneGizmos below (2026-07-30) —
  // see PathGizmo.tsx's own matching prop header for the full rationale.
  animationStart: Date | null
  animationEnd: Date | null
  // Capture/Export Video text visibility (2026-07-30, per Maro: "the text
  // boxes and texts dont show up in the captured renders") — see
  // exportLabels.ts's own header.
  exportLabelsRef: React.MutableRefObject<ExportLabelRegistry>
  onDragStart: () => void
  onDragMove: (zoneId: string, points: ZonePoint[]) => void
  onDragEnd: (zoneId: string, points: ZonePoint[]) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const dragRef = useRef<{ index: number; plane: THREE.Plane; lastPoints: ZonePoint[] } | null>(null)
  const lineRef = useRef<Line2>(null)
  const fillMeshRef = useRef<THREE.Mesh>(null)
  const fillMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const wasAnimatingRef = useRef(false)
  // 'sweep' mode's own per-frame-rebuilt geometry (2026-08-03) — unlike
  // 'draw'/'flash', which only touch opacity/border-line-length, a sweep
  // reveal animates the fill mesh's actual geometry (a growing pie wedge),
  // so each frame's THREE.ShapeGeometry needs its own explicit disposal —
  // same "rebuilt geometry needs manual disposal" discipline the live-drag
  // cleanup effect below already established, just per-frame instead of
  // per-unmount.
  const sweepGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  // The border's own per-frame geometry during 'sweep' (2026-08-03, per
  // Maro: reported mismatch between the fill wedge and its border — one
  // spoke edge staying stuck at a stale, much larger sweep angle instead
  // of tracking the current one). Line2's own setPositions()+
  // resetLine2InstanceCap() mutate-in-place approach (used by 'draw'/
  // 'flash' above, and originally by this mode too) relies on three.js's
  // WebGLBindingStates re-caching geometry._maxInstanceCount on the very
  // next render after the reset — correct for 'draw''s always-growing
  // reveal, but a sweep's border swings both up AND down as the timeline
  // gets scrubbed back and forth, a pattern that never got proven against
  // that caching path. Sidestepping it entirely: a genuinely fresh
  // LineGeometry every frame (same "replace the whole object, dispose the
  // previous one" approach the fill mesh's own sweepGeometryRef already
  // uses above) can never carry a stale cached instance count, since it's
  // never been rendered before this frame.
  const sweepBorderGeometryRef = useRef<InstanceType<typeof LineGeometry> | null>(null)
  useEffect(() => {
    return () => {
      sweepGeometryRef.current?.dispose()
      sweepBorderGeometryRef.current?.dispose()
    }
  }, [])

  const shapeResult = useMemo(
    () => buildZoneShapeGeometry(zone.points, upAxis, zone.shape, zone.radius),
    [zone.points, upAxis, zone.shape, zone.radius],
  )
  // Densified border, 'draw' reveal only (2026-08-06) — see
  // zoneGeometry.ts's own densifyBorderForReveal header for the full "why".
  // The complete-border render (fill mesh, non-animating border, 'flash'
  // mode) all keep using shapeResult.borderPoints directly — the corner-
  // only loop is exactly right for those, since it's just straight lines
  // between real corners either way.
  const revealBorderPoints = useMemo(
    () => (shapeResult ? densifyBorderForReveal(shapeResult.borderPoints) : null),
    [shapeResult],
  )
  // buildZoneShapeGeometry allocates a real THREE.ShapeGeometry every call
  // (2026-07-29) — passed directly as the fill mesh's `geometry` prop below
  // rather than composed via JSX `<bufferGeometry>`, so R3F doesn't take
  // ownership/auto-dispose it the way it would a JSX-created one. A live
  // vertex drag recomputes this on every pointer-move frame (same cost
  // PathGizmo's own curvePositions already pays for a Path drag — just a
  // plain array there, so nothing to leak), so without this explicit
  // dispose every intermediate geometry from a drag would leak GPU memory
  // for as long as the zone stays mounted.
  useEffect(() => {
    return () => { shapeResult?.geometry.dispose() }
  }, [shapeResult])
  // Removes this zone's own export-label entry on unmount (2026-07-30) —
  // same "don't leave a ghost label behind after deletion" reasoning
  // AnnotationMarker.tsx's own matching cleanup effect explains.
  useEffect(() => {
    return () => { exportLabelsRef.current.delete(`${zone.id}-label`) }
  }, [zone.id, exportLabelsRef])
  const groupPosition: [number, number, number] = upAxis === 'z' ? [0, 0, zone.elevation] : [0, zone.elevation, 0]

  // Reveal animation (2026-07-29, per Maro: "the animation will go like
  // path to set the border then the fill, can also set a flashing zone
  // animation"). Imperative, not React-state-driven — same perf reasoning
  // as PathGizmo.tsx's own matching useFrame (that component's own header
  // has the full "why"). 'draw': the first half of the animation window
  // traces the border in (same partial-Line-geometry technique
  // PathGizmo.tsx uses for its own line reveal, just over borderPoints'
  // straight polygon edges instead of a spline), the second half fades the
  // fill in from 0 to zone.fill_opacity. 'flash': the border stays fully
  // drawn the whole time; only the fill's own opacity pulses, via a
  // triangle wave over the *looped* 0..1 progress (a smooth fade in then
  // back out every cycle) — a flash that isn't set to loop just plays that
  // one fade in/out and then rests, same as 'draw' would.
  useFrame(() => {
    // Capture/Export Video text visibility (2026-07-30, per Maro: "the
    // text boxes and texts dont show up in the captured renders") — see
    // exportLabels.ts's own header. Written unconditionally, ahead of the
    // animate/flash branching below, so the label stays in sync regardless
    // of which reveal mode (or none) is active — the Html label itself is
    // never gated by any of that either (only the border/fill are).
    if (groupRef.current && shapeResult) {
      exportLabelsRef.current.set(`${zone.id}-label`, {
        kind: 'zone-label',
        visible: zone.visible,
        worldPos: groupRef.current.localToWorld(shapeResult.centroid.clone()),
        text: zone.name,
        backgroundColor: null,
        borderColor: null,
        textColor: zone.border_color,
        fontSize: zone.label_font_size,
        borderRadius: 0,
        bold: true,
        anchor: 'center',
      })
    }

    if (!zone.animate) {
      if (wasAnimatingRef.current) {
        wasAnimatingRef.current = false
        if (lineRef.current && shapeResult) {
          const fullBorderPositions = shapeResult.borderPoints.flatMap(p => [p.x, p.y, p.z])
          if (sweepBorderGeometryRef.current) {
            // Recovering from 'sweep' — lineRef.current.geometry currently
            // points at our own per-frame object (see the sweep branch
            // below), not drei's originally-managed one, so this builds one
            // more fresh instance rather than mutating-then-disposing
            // whatever's still actively assigned (which would leave
            // lineRef.current.geometry pointing at a disposed object).
            const restored = new LineGeometry()
            restored.setPositions(fullBorderPositions)
            const previous = sweepBorderGeometryRef.current
            lineRef.current.geometry = restored
            sweepBorderGeometryRef.current = null
            previous.dispose()
          } else {
            lineRef.current.geometry.setPositions(fullBorderPositions)
            resetLine2InstanceCap(lineRef.current.geometry)
          }
          lineRef.current.computeLineDistances()
          lineRef.current.visible = true
        }
        if (fillMaterialRef.current) fillMaterialRef.current.opacity = zone.fill_opacity
        // Restores the mesh back to the memoized full-circle geometry and
        // disposes whatever 'sweep' geometry was last active — a stopped
        // animation shouldn't leave the fill mid-wedge.
        if (fillMeshRef.current && shapeResult) fillMeshRef.current.geometry = shapeResult.geometry
        if (sweepGeometryRef.current) {
          sweepGeometryRef.current.dispose()
          sweepGeometryRef.current = null
        }
      }
      return
    }
    wasAnimatingRef.current = true
    if (!shapeResult) return

    const now = timelineDateRef.current ?? new Date()
    const progress = computeRevealProgress(now, animationStart, animationEnd, zone.animation_loop)

    if (zone.animation_mode === 'flash') {
      if (lineRef.current) {
        lineRef.current.geometry.setPositions(shapeResult.borderPoints.flatMap(p => [p.x, p.y, p.z]))
        resetLine2InstanceCap(lineRef.current.geometry)
        lineRef.current.computeLineDistances()
        lineRef.current.visible = true
      }
      if (fillMaterialRef.current) {
        const pulse = 1 - Math.abs(2 * progress - 1)
        fillMaterialRef.current.opacity = zone.fill_opacity * pulse
      }
      return
    }

    // 'sweep' (2026-08-03, per Maro's own crane-clearance reference
    // screenshot) — only meaningful for shape="circle" (ZonesPanel.tsx only
    // ever offers it then; any other shape falls through to 'draw' below as
    // a safe default). Unlike 'draw'/'flash', the wedge angle itself *is*
    // the reveal — fill opacity stays constant at zone.fill_opacity
    // throughout, and both the fill mesh's geometry and the border's wedge
    // outline are rebuilt from scratch every frame via
    // buildZoneShapeGeometry's own sweepAngle param.
    if (zone.animation_mode === 'sweep' && zone.shape === 'circle') {
      const sweepAngle = progress * Math.PI * 2
      const sweepResult = buildZoneShapeGeometry(zone.points, upAxis, zone.shape, zone.radius, sweepAngle)
      if (sweepResult) {
        if (fillMeshRef.current) fillMeshRef.current.geometry = sweepResult.geometry
        sweepGeometryRef.current?.dispose()
        sweepGeometryRef.current = sweepResult.geometry
        if (lineRef.current) {
          // A genuinely fresh LineGeometry every frame, not an in-place
          // setPositions() mutation of whatever's already there — see
          // sweepBorderGeometryRef's own header above for why: this
          // deliberately avoids relying on resetLine2InstanceCap's
          // "correct again on the very next render" caching behaviour,
          // which 'draw'/'flash' lean on safely (a reveal that only ever
          // grows) but a sweep's border — which can grow *or* shrink as
          // the timeline gets scrubbed in either direction — never had
          // proven against.
          const borderGeom = new LineGeometry()
          borderGeom.setPositions(sweepResult.borderPoints.flatMap(p => [p.x, p.y, p.z]))
          sweepBorderGeometryRef.current?.dispose()
          sweepBorderGeometryRef.current = borderGeom
          lineRef.current.geometry = borderGeom
          lineRef.current.visible = true
          lineRef.current.computeLineDistances()
        }
      }
      if (fillMaterialRef.current) fillMaterialRef.current.opacity = zone.fill_opacity
      return
    }

    // 'draw' — first half reveals the border, second half fades the fill.
    // Slices the densified revealBorderPoints, not the raw 4-ish-corner
    // shapeResult.borderPoints (see zoneGeometry.ts's own
    // densifyBorderForReveal header) — a coarse corner-only slice made a
    // single long edge look "already fully drawn" after just one reveal
    // step. sliceRevealVectors then interpolates *within* that densified
    // list at the fractional remainder, so the leading tip slides forward
    // continuously frame to frame instead of jumping sample to sample.
    const borderPhase = Math.min(1, progress * 2)
    const fillPhase = Math.max(0, progress * 2 - 1)
    const sliced = revealBorderPoints ? sliceRevealVectors(revealBorderPoints, borderPhase) : null
    if (lineRef.current) {
      lineRef.current.visible = sliced !== null
      if (sliced) {
        lineRef.current.geometry.setPositions(sliced.flatMap(p => [p.x, p.y, p.z]))
        resetLine2InstanceCap(lineRef.current.geometry)
        lineRef.current.computeLineDistances()
      }
    }
    if (fillMaterialRef.current) fillMaterialRef.current.opacity = zone.fill_opacity * fillPhase
  })

  const handlePointerDown = (index: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    onDragStart()
    dragRef.current = { index, plane: zonePlane(upAxis, zone.elevation), lastPoints: zone.points }
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    const group = groupRef.current
    if (!drag || !group) return
    e.stopPropagation()
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(drag.plane, hit)) return
    const local = group.worldToLocal(hit.clone())
    // Zero the up-coordinate explicitly (2026-07-29) — the plane
    // intersection already lands within float precision of it, but
    // zone.py's own docstring documents every stored point's up-coordinate
    // as always exactly 0, and zoneGeometry.ts's toLocal2D never reads it
    // anyway, so this just keeps the stored data honest rather than
    // leaving a stray near-zero value in the JSONB blob.
    const nextPoint: ZonePoint = upAxis === 'z'
      ? { x: local.x, y: local.y, z: 0 }
      : { x: local.x, y: 0, z: local.z }
    const nextPoints = drag.lastPoints.map((p, i) => (i === drag.index ? nextPoint : p))
    drag.lastPoints = nextPoints
    onDragMove(zone.id, nextPoints)
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    onDragEnd(zone.id, drag.lastPoints)
  }

  return (
    <group ref={groupRef} position={groupPosition} userData={{ isZoneGizmo: true }}>
      {shapeResult && (
        <>
          <mesh ref={fillMeshRef} geometry={shapeResult.geometry} userData={{ isZoneGizmo: true }}>
            <meshBasicMaterial
              ref={fillMaterialRef}
              color={zone.fill_color} transparent opacity={zone.fill_opacity}
              side={THREE.DoubleSide} depthWrite={false}
              polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
            />
          </mesh>
          <Line
            ref={lineRef}
            points={shapeResult.borderPoints}
            color={zone.border_color}
            lineWidth={zone.border_width}
            dashed={zone.border_style === 'dashed'}
            dashSize={zone.border_dash_size}
            gapSize={zone.border_gap_size}
            userData={{ isZoneGizmo: true }}
          />
          <Html center distanceFactor={12} position={[shapeResult.centroid.x, shapeResult.centroid.y, shapeResult.centroid.z]} style={{ pointerEvents: 'none' }}>
            <div style={{
              fontWeight: 700, fontSize: zone.label_font_size, color: zone.border_color, whiteSpace: 'nowrap',
              textShadow: '0 1px 3px rgba(0,0,0,0.6), 0 0 6px rgba(0,0,0,0.4)', letterSpacing: '0.03em',
            }}>
              {zone.name}
            </div>
          </Html>
        </>
      )}
      {!hideHandles && zone.points.map((point, index) => {
        const [lx, ly] = upAxis === 'z' ? [point.x, point.y] : [point.x, point.z]
        const localPos: [number, number, number] = upAxis === 'z' ? [lx, ly, 0] : [lx, 0, ly]
        return (
          <mesh
            key={index}
            position={localPos}
            userData={{ isZoneGizmo: true }}
            onPointerDown={handlePointerDown(index)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <sphereGeometry args={[0.12, 12, 12]} />
            <meshBasicMaterial color={HANDLE_COLOR} depthTest={false} />
          </mesh>
        )
      })}
    </group>
  )
}

// Every currently-visible Zone's own gizmo (2026-07-29) — same "always
// render every visible one" convention as PathGizmo.tsx's own PathGizmos.
export function ZoneGizmos({
  zones, upAxis, hideHandles, timelineDateRef, animWindows, exportLabelsRef, onDragStart, onDragMove, onDragEnd,
}: {
  zones: Zone[]
  upAxis: UpAxis
  hideHandles: boolean
  timelineDateRef: React.MutableRefObject<Date | null>
  // Keyed by zone.id (2026-07-30) — see ZoneGizmo's own animationStart/
  // animationEnd header for what these resolve from.
  animWindows: Map<string, { start: Date | null; end: Date | null }>
  exportLabelsRef: React.MutableRefObject<ExportLabelRegistry>
  onDragStart: () => void
  onDragMove: (zoneId: string, points: ZonePoint[]) => void
  onDragEnd: (zoneId: string, points: ZonePoint[]) => void
}) {
  return (
    <>
      {zones.filter(z => z.visible).map(zone => {
        const window = animWindows.get(zone.id)
        return (
          <ZoneGizmo
            key={zone.id}
            zone={zone}
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

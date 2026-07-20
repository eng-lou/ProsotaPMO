import { useMemo } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import type { IfcUnitDisplay } from './ifcUnitDisplay'
import { distanceMetres, formatMeasurementValue } from './measurementGeometry'
import type { Measurement, MeasurementPoint } from './measurements'

const LENGTH_COLOR = '#f59e0b' // amber — distinct from Path's sky-blue and SectionBox's own handle colour
const AREA_COLOR = '#a855f7' // purple — distinct from both Length and the selection-tint palette
const SELECTED_COLOR = '#0ea5e9'

// One saved Measurement in the 4D viewport (2026-07-19, per Maro: "add a
// measurement feature, length and areas"). Unlike AnnotationMarker, a
// Measurement's points are fixed at creation (see measurement.py's own
// MeasurementUpdate docstring) — no drag handles, no per-frame Mode A/B
// animation resolution needed, so this stays a plain static render rather
// than AnnotationMarker's own useFrame-driven one.
export function MeasurementMarker({
  measurement, unitPreference, selected, onSelect,
}: {
  measurement: Measurement
  unitPreference: IfcUnitDisplay
  selected: boolean
  onSelect: (id: string) => void
}) {
  const color = selected ? SELECTED_COLOR : measurement.kind === 'length' ? LENGTH_COLOR : AREA_COLOR
  const linePositions = useMemo((): [number, number, number][] => {
    const pts = measurement.points.map(p => [p.x, p.y, p.z] as [number, number, number])
    // Close the loop for an area's own outline — a length is just the one
    // open segment between its 2 points.
    return measurement.kind === 'area' ? [...pts, pts[0]] : pts
  }, [measurement.points, measurement.kind])

  const labelPosition = useMemo((): [number, number, number] => {
    const pts = measurement.points
    const sum = pts.reduce((acc, p) => new THREE.Vector3(acc.x + p.x, acc.y + p.y, acc.z + p.z), new THREE.Vector3())
    return [sum.x / pts.length, sum.y / pts.length, sum.z / pts.length]
  }, [measurement.points])

  if (!measurement.visible) return null

  return (
    // isMeasurementGizmo (2026-07-19) — same "tag every helper mesh so the
    // click-to-place raycast skips it" convention PathGizmo.tsx's own
    // isPathGizmo already established; without it, placing a later point
    // near an earlier one (or near a saved measurement) could hit this
    // marker's own sphere/line instead of the real model surface beneath it.
    <group userData={{ isMeasurementGizmo: true }}>
      <Line points={linePositions} color={color} lineWidth={2} />
      {/* Real openings traced inside a face-clicked patch (2026-07-19, per
          Maro: "can it detect and exclude the voids?") — value is already
          net of these (see measurement.py's own docstring), this is purely
          drawing each hole's own outline, dashed to read as "an opening"
          rather than another length to add on. */}
      {measurement.hole_loops.map((loop, i) => (
        <Line
          key={i}
          points={[...loop.map(p => [p.x, p.y, p.z] as [number, number, number]), [loop[0].x, loop[0].y, loop[0].z]]}
          color={color} lineWidth={1.5} dashed dashSize={0.1} gapSize={0.08}
        />
      ))}
      {measurement.points.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.06, 10, 10]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
      <Html center distanceFactor={8} position={labelPosition} style={{ pointerEvents: 'none' }}>
        <div
          onClick={() => onSelect(measurement.id)}
          style={{
            pointerEvents: 'auto', cursor: 'pointer', whiteSpace: 'nowrap',
            background: 'rgba(17, 24, 39, 0.85)', color: '#fff',
            border: `1px solid ${selected ? SELECTED_COLOR : color}`,
            borderRadius: 4, padding: '3px 6px', fontSize: 12,
          }}
        >
          {measurement.name}: {formatMeasurementValue(measurement.kind, measurement.value, unitPreference)}
        </div>
      </Html>
    </group>
  )
}

// Live preview while a Length measurement is still being collected
// (2026-07-19) — not yet a real Measurement (nothing's been created
// server-side), so this reads straight off FourD.tsx's own local
// measuringPoints state rather than the saved list, and shows a running
// value using the same per-measurement toMetres FourD.tsx already resolved
// from the first click (see MeasurementGizmo.tsx's own header). Area
// (points) was removed 2026-07-19 (per Maro, once Area (face) made it
// redundant), so this only ever renders 0 or 1 collected point now — kept
// as its own component rather than inlined since it may as well stay ready
// for whatever the next multi-point tool turns out to be.
export function MeasurementPreview({
  points, toMetres, unitPreference,
}: {
  points: MeasurementPoint[]
  toMetres: number
  unitPreference: IfcUnitDisplay
}) {
  const linePositions = useMemo(
    (): [number, number, number][] => points.map(p => [p.x, p.y, p.z] as [number, number, number]),
    [points],
  )
  const labelPosition = useMemo((): [number, number, number] | null => {
    if (points.length === 0) return null
    const last = points[points.length - 1]
    return [last.x, last.y, last.z]
  }, [points])

  if (points.length === 0) return null

  const value = points.length === 2 ? distanceMetres(points[0], points[1], toMetres) : null

  return (
    <group userData={{ isMeasurementGizmo: true }}>
      {linePositions.length >= 2 && <Line points={linePositions} color={LENGTH_COLOR} lineWidth={2} dashed dashSize={0.15} gapSize={0.1} />}
      {points.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.06, 10, 10]} />
          <meshBasicMaterial color={LENGTH_COLOR} depthTest={false} />
        </mesh>
      ))}
      {labelPosition && (
        <Html center distanceFactor={8} position={labelPosition} style={{ pointerEvents: 'none' }}>
          <div style={{
            whiteSpace: 'nowrap', background: 'rgba(17, 24, 39, 0.85)', color: '#fff',
            border: `1px solid ${LENGTH_COLOR}`, borderRadius: 4, padding: '3px 6px', fontSize: 12,
          }}>
            {value !== null ? formatMeasurementValue('length', value, unitPreference) : `${points.length} pt${points.length === 1 ? '' : 's'}…`}
          </div>
        </Html>
      )}
    </group>
  )
}

// Live snap-cursor indicator (2026-07-19, per Maro: "learn from blender" —
// Blender's own Measure tool shows a small ring at wherever the cursor
// currently is/will snap to, updated on every mouse move, before you ever
// click). A single small ring rather than Blender's own two distinct
// vertex/edge icons — this app's version doesn't distinguish which kind of
// snap is active, just shows where the next click will land.
export function MeasurementHoverIndicator({ point }: { point: MeasurementPoint | null }) {
  if (!point) return null
  return (
    <mesh position={[point.x, point.y, point.z]} userData={{ isMeasurementGizmo: true }}>
      <ringGeometry args={[0.08, 0.11, 16]} />
      <meshBasicMaterial color="#ffffff" depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function MeasurementMarkers({
  measurements, unitPreference, selectedId, onSelect,
}: {
  measurements: Measurement[]
  unitPreference: IfcUnitDisplay
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <>
      {measurements.map(m => (
        <MeasurementMarker key={m.id} measurement={m} unitPreference={unitPreference} selected={m.id === selectedId} onSelect={onSelect} />
      ))}
    </>
  )
}

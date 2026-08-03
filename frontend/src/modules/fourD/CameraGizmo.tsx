import { useMemo } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import type { Camera } from './cameras'
import { fovFromFocalLength } from './cameras'

interface Props {
  camera: Camera
}

const FRUSTUM_DEPTH = 1 // metres — a fixed small visual size, same "scene marker, not to scale" convention AxisGizmo/SectionBoxGizmo already use for their own handles.
const GIZMO_COLOR = '#f59e0b' // amber — matches this app's existing selection-highlight palette (SectionBoxGizmo's own HANDLE_COLOR)

// Hand-rolled camera frustum wireframe (2026-08-03, per Maro's own
// Blender-camera reference) — shown at every Camera's own live base pose
// for every camera that ISN'T currently being looked through (the active
// one has no gizmo of its own since the viewport IS its view). Plain
// THREE.Line via drei's <Line> helper, same hand-rolled-gizmo convention
// as AxisGizmo.tsx/SectionBoxGizmo.tsx — no drei CameraHelper, which
// isn't used anywhere else in this codebase.
//
// Purely a visual marker for v1 (not yet clickable to select/activate —
// look-through is driven from the Cameras panel's own 👁 toggle).
export function CameraGizmo({ camera }: Props) {
  const { apex, base } = useMemo(() => {
    const apex = new THREE.Vector3(camera.base_position_x, camera.base_position_y, camera.base_position_z)
    const target = new THREE.Vector3(camera.base_target_x, camera.base_target_y, camera.base_target_z)
    const forward = target.clone().sub(apex)
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1)
    forward.normalize()
    // Any vector not parallel to forward, to derive a stable right/up basis.
    const worldUp = Math.abs(forward.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize()
    const up = new THREE.Vector3().crossVectors(right, forward).normalize()

    const fovRad = (fovFromFocalLength(camera.base_focal_length) * Math.PI) / 180
    const halfHeight = FRUSTUM_DEPTH * Math.tan(fovRad / 2)
    const halfWidth = halfHeight * 1.5 // a plausible fixed visual aspect — this gizmo isn't the passepartout, just a marker
    const center = apex.clone().add(forward.clone().multiplyScalar(FRUSTUM_DEPTH))
    const corners = [
      center.clone().add(right.clone().multiplyScalar(-halfWidth)).add(up.clone().multiplyScalar(halfHeight)),
      center.clone().add(right.clone().multiplyScalar(halfWidth)).add(up.clone().multiplyScalar(halfHeight)),
      center.clone().add(right.clone().multiplyScalar(halfWidth)).add(up.clone().multiplyScalar(-halfHeight)),
      center.clone().add(right.clone().multiplyScalar(-halfWidth)).add(up.clone().multiplyScalar(-halfHeight)),
    ] as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
    return { apex, base: corners }
  }, [camera.base_position_x, camera.base_position_y, camera.base_position_z, camera.base_target_x, camera.base_target_y, camera.base_target_z, camera.base_focal_length])

  return (
    <group>
      <Line points={[apex, base[0], apex, base[1], apex, base[2], apex, base[3]]} color={GIZMO_COLOR} lineWidth={1.5} segments />
      <Line points={[base[0], base[1], base[2], base[3], base[0]]} color={GIZMO_COLOR} lineWidth={1.5} />
      <Html position={apex} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
        <div className="text-[10px] font-medium text-amber-500 whitespace-nowrap -translate-y-4">📹 {camera.name}</div>
      </Html>
    </group>
  )
}

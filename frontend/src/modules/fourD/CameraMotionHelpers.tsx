import { useRef } from 'react'
import * as THREE from 'three'
import { Line, Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { posePosition, sampleShot, type MotionShot, type Vec3 } from './cameraMotion'
import type { CameraMotionController } from './useCameraMotion'

export function CameraMotionDriver({ controller, timeline }: {
  controller: CameraMotionController
  timeline?: { dateRef: React.MutableRefObject<Date | null>; start: Date; daysPerSecond: number; cameraId: string; shots: MotionShot[] }
}) {
  const previous = useRef<{ cameraId: string; date: number } | null>(null)
  useFrame(() => {
    const date = timeline?.dateRef.current?.getTime()
    if (timeline && date !== undefined) {
      // Only timeline clock changes take ownership; editor preview and export
      // remain free to sample their own time while the timeline is stationary.
      if ((previous.current?.cameraId === timeline.cameraId && previous.current.date !== date) && controller.state.current.active) {
        if (controller.state.current.shots !== timeline.shots) controller.activate(timeline.shots)
        controller.pause()
        controller.seek((date - timeline.start.getTime()) / (86400000 * timeline.daysPerSecond))
      }
      previous.current = { cameraId: timeline.cameraId, date }
    } else previous.current = null
    if (controller.state.current.active) controller.applyAt(controller.state.current.seconds)
  }, -80)
  // Actors update at -1. Reapply tracking after their transforms, before rendering.
  useFrame(() => { if (controller.state.current.active) controller.applyAt(controller.state.current.seconds) }, -0.5)
  return null
}
function Handle({ point, label, color, onMove }: { point: Vec3; label: string; color: string; onMove: (delta: THREE.Vector3) => void }) {
  const { camera, controls } = useThree()
  const drag = useRef<{ plane: THREE.Plane; start: THREE.Vector3; move: typeof onMove } | null>(null)
  function down(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...point))
    const start = e.ray.intersectPlane(plane, new THREE.Vector3()); if (start) drag.current = { plane, start, move: onMove }
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false
  }
  return <group position={point}><mesh onPointerDown={down} onPointerMove={e => { if (!drag.current) return; e.stopPropagation(); const hit = e.ray.intersectPlane(drag.current.plane, new THREE.Vector3()); if (hit) drag.current.move(hit.sub(drag.current.start)) }} onPointerUp={e => { e.stopPropagation(); drag.current = null; (e.target as Element).releasePointerCapture(e.pointerId); if (controls) (controls as unknown as { enabled: boolean }).enabled = true }}>
    <sphereGeometry args={[Math.max(.08, camera.position.distanceTo(new THREE.Vector3(...point)) * .012), 12, 12]} /><meshBasicMaterial color={color} depthTest={false} />
  </mesh><Html center style={{ pointerEvents: 'none', color, fontSize: 11, whiteSpace: 'nowrap', marginTop: 16 }}>{label}</Html></group>
}
export function CameraMotionHelpers({ shot, onChange }: { shot: MotionShot; onChange: (shot: MotionShot) => void }) {
  const points = Array.from({ length: 65 }, (_, i) => posePosition(sampleShot(shot, i / 64 * shot.settings.duration).pose))
  const updateOffset = (key: 'startOffset' | 'endOffset', delta: THREE.Vector3) => onChange({ ...shot, [key]: new THREE.Vector3(...shot[key]).add(delta).toArray() })
  return <group>
    <Line points={points} color="#38bdf8" lineWidth={2} />
    <Handle point={points[0].toArray()} label="Start" color="#22c55e" onMove={delta => updateOffset(shot.settings.reverse ? 'endOffset' : 'startOffset', delta)} />
    <Handle point={points[points.length - 1].toArray()} label="End" color="#fb923c" onMove={delta => updateOffset(shot.settings.reverse ? 'startOffset' : 'endOffset', delta)} />
    <Handle point={shot.target} label="Target" color="#e879f9" onMove={delta => onChange({ ...shot, target: new THREE.Vector3(...shot.target).add(delta).toArray() })} />
  </group>
}

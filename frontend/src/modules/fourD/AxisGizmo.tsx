import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// Drop-in replacement for drei's <GizmoViewport> (2026-08-06, per Maro: "when
// i click to go the top or z axis. i expect it free from rotation" —
// screenshot-confirmed: clicking the Z (or whichever axis is currently
// "up") head left the grid visibly tilted instead of perfectly
// horizontal/vertical, and this happened for every axis, not just Top).
//
// Root cause, traced into drei's own source (node_modules/@react-three/drei/
// core/GizmoHelper.js): its tweenCamera() builds the target orientation via
// `dummy.lookAt(targetPosition)`, using `dummy.up` as the reference vector
// that disambiguates roll. `dummy.up` is a snapshot of the main camera's own
// `.up` taken once, and this app's own CameraSettings component sets
// camera.up to whichever axis is currently "up" (Z for the default "Z up
// (Blender)" mode, Y otherwise — see upAxis.ts's own header). Clicking the
// axis head that matches that exact up axis (i.e. "Top"/"Bottom") therefore
// asks lookAt to orient a camera whose forward direction is *parallel* to
// its own up reference — a classic degenerate case, resolved by three.js's
// own Matrix4.lookAt fallback with an arbitrary small nudge rather than a
// clean zero-roll result. Every other axis (Front/Back/Left/Right) is never
// parallel to the up axis, so those were never affected.
//
// Snaps instantly rather than animating (2026-08-06, second pass — per
// Maro: "it takes multiple clicking to square it up," confirmed live: an
// earlier animated version of this fix computed a mathematically correct
// target quaternion (verified via direct console logging of the settled
// camera state) but still rendered tilted after one click, converging only
// after several repeats). Root cause of *that*: drei's own <OrbitControls>
// wrapper subscribes its own useFrame(…, -1) unconditionally (node_modules/
// @react-three/drei/core/OrbitControls.js) and calls controls.update()
// every single frame regardless of anything this component does — and
// OrbitControls.update() ends with object.lookAt(target) using
// object.up, i.e. it performs its own separate degenerate-lookAt exactly
// like the one this file works around, but on every frame of the
// animation, using whatever `up` happened to be mid-interpolation. An
// animated tween update()s the camera 30-60 times over its ~0.3s span,
// each call racing this component's own per-frame correction against
// OrbitControls' own per-frame recomputation — correct most frames, but
// the actual rendered pixels on any given frame depend on the two
// useFrame subscribers' relative ordering, which is not guaranteed to
// consistently favour this component's own correction. A one-shot,
// synchronous snap sidesteps the whole race: position/quaternion/up are
// set once in the click handler itself (not spread across frames), then
// controls.update() is called exactly once, synchronously, right there —
// by the time OrbitControls' own per-frame update() next runs, the camera
// is already fully settled and consistent with its own up axis, so it has
// nothing to "correct" and just reproduces the same state.
function isOrbitControlsLike(controls: OrbitControlsImpl | null): controls is OrbitControlsImpl {
  return !!controls
}

const AXIS_DIRECTIONS: [number, number, number][] = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1],
]

function drawAxisHeadTexture(color: string, label: string | null, labelColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.beginPath()
  context.arc(32, 32, 16, 0, 2 * Math.PI)
  context.closePath()
  context.fillStyle = color
  context.fill()
  if (label) {
    context.font = '18px Inter var, Arial, sans-serif'
    context.textAlign = 'center'
    context.fillStyle = labelColor
    context.fillText(label, 32, 41)
  }
  return new THREE.CanvasTexture(canvas)
}

function AxisHead({
  position, color, label, labelColor, onPick,
}: {
  position: [number, number, number]
  color: string
  label: string | null
  labelColor: string
  onPick: (direction: THREE.Vector3) => void
}) {
  const texture = useMemo(() => drawAxisHeadTexture(color, label, labelColor), [color, label, labelColor])
  return (
    <sprite
      position={position}
      scale={label ? 1 : 0.75}
      onPointerDown={e => {
        e.stopPropagation()
        onPick(new THREE.Vector3(...position).normalize())
      }}
    >
      <spriteMaterial map={texture} alphaTest={0.3} opacity={label ? 1 : 0.75} toneMapped={false} />
    </sprite>
  )
}

function AxisLine({ color, rotation }: { color: string; rotation: [number, number, number] }) {
  return (
    <group rotation={rotation}>
      <mesh position={[0.4, 0, 0]}>
        <boxGeometry args={[0.8, 0.05, 0.05]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function AxisGizmo({
  axisColors, labelColor, labels = ['X', 'Y', 'Z'], cameraRef, controlsRef,
}: {
  axisColors: [string, string, string]
  labelColor: string
  labels?: [string, string, string]
  cameraRef: React.MutableRefObject<THREE.Camera | null>
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>
}) {
  const invalidate = useThree(state => state.invalidate)
  const dummy = useRef(new THREE.Object3D())

  const snapTo = useCallback((direction: THREE.Vector3) => {
    const mainCamera = cameraRef.current
    if (!mainCamera) return
    const controls = controlsRef.current
    const target = isOrbitControlsLike(controls) ? controls.target : new THREE.Vector3()
    const radius = mainCamera.position.distanceTo(target)
    const trueUp = mainCamera.up.clone()

    // The one real fix (see this file's own header): pick a disambiguation
    // "up" that's never parallel to `direction`. World +X is never the up
    // axis in this app (upAxis.ts only ever swaps Y/Z), so it's always safe
    // here even though it's specifically wrong/unused for the common,
    // non-degenerate case below. Only used to solve for the final
    // quaternion — the camera's own `.up` is set back to the *true* axis
    // immediately below, not left on this disambiguation value.
    const disambiguationUp = Math.abs(direction.dot(trueUp)) > 0.999 ? new THREE.Vector3(1, 0, 0) : trueUp

    dummy.current.up.copy(disambiguationUp)
    dummy.current.position.set(0, 0, 0)
    dummy.current.lookAt(direction.clone().multiplyScalar(radius).add(target))

    mainCamera.position.copy(direction).multiplyScalar(radius).add(target)
    mainCamera.quaternion.copy(dummy.current.quaternion)
    mainCamera.up.copy(trueUp)
    if (isOrbitControlsLike(controls)) controls.update()
    invalidate()
  }, [cameraRef, controlsRef, invalidate])

  const [colorX, colorY, colorZ] = axisColors
  const [labelX, labelY, labelZ] = labels

  return (
    <group scale={40}>
      <AxisLine color={colorX} rotation={[0, 0, 0]} />
      <AxisLine color={colorY} rotation={[0, 0, Math.PI / 2]} />
      <AxisLine color={colorZ} rotation={[0, -Math.PI / 2, 0]} />
      {AXIS_DIRECTIONS.map(position => {
        const axisIndex = position.findIndex(v => v !== 0)
        const color = [colorX, colorY, colorZ][axisIndex]
        const label = position[axisIndex] > 0 ? [labelX, labelY, labelZ][axisIndex] : null
        return (
          <AxisHead key={position.join(',')} position={position} color={color} label={label} labelColor={labelColor} onPick={snapTo} />
        )
      })}
    </group>
  )
}

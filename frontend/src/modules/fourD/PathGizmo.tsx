import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { Path, PathPoint } from './paths'

const LINE_COLOR = '#38bdf8' // sky-blue — distinct from SectionBoxGizmo's amber handles and the selection-tint palette
const HANDLE_COLOR = 0x38bdf8
const CURVE_SAMPLES = 64

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
// Drag math: single-point free-drag in a plane facing the camera through
// the point being dragged (the standard technique for an unconstrained
// point-editor, as opposed to SectionBoxGizmo's single-axis-constrained
// drag, since a curve control point has no natural axis to be constrained
// to). Live-drag only touches local component state via onDragMove
// (FourD.tsx keeps a working copy for the live curve preview); nothing
// persists until pointer-up (onDragEnd), matching this app's existing
// TransformControls convention.
function PathGizmo({
  path, onDragStart, onDragMove, onDragEnd,
}: {
  path: Path
  onDragStart: () => void
  onDragMove: (pathId: string, points: PathPoint[]) => void
  onDragEnd: (pathId: string, points: PathPoint[]) => void
}) {
  const { camera } = useThree()
  const dragRef = useRef<{
    index: number
    plane: THREE.Plane
    offset: THREE.Vector3
    lastPoints: PathPoint[]
  } | null>(null)

  const curvePositions = useMemo(() => {
    if (path.points.length < 2) return null
    const vectors = path.points.map(p => new THREE.Vector3(p.x, p.y, p.z))
    const curve = new THREE.CatmullRomCurve3(vectors, path.closed, 'catmullrom', 0.5)
    return curve.getPoints(CURVE_SAMPLES).map(v => [v.x, v.y, v.z] as [number, number, number])
  }, [path.points, path.closed])

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
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(drag.plane, hit)) return
    const next = hit.add(drag.offset)
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
        <Line points={curvePositions} color={LINE_COLOR} lineWidth={2} userData={{ isPathGizmo: true }} />
      )}
      {path.points.map((point, index) => (
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
  paths, onDragStart, onDragMove, onDragEnd,
}: {
  paths: Path[]
  onDragStart: () => void
  onDragMove: (pathId: string, points: PathPoint[]) => void
  onDragEnd: (pathId: string, points: PathPoint[]) => void
}) {
  return (
    <>
      {paths.filter(p => p.visible).map(path => (
        <PathGizmo key={path.id} path={path} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} />
      ))}
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

      const hits = raycaster.intersectObjects(scene.children, true)
        .filter(hit => {
          let obj: THREE.Object3D | null = hit.object
          while (obj) {
            if (obj.userData?.isPathGizmo) return false
            obj = obj.parent
          }
          return true
        })

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

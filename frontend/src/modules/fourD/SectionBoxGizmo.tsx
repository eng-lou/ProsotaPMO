import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { ImportedObject, ResolvedSectionBox } from './Viewport3D'
import type { SectionBoxBounds } from './sectionBoxes'
import { ensureMaterialized } from './elementBatching'

type FaceId = 'min_x' | 'max_x' | 'min_y' | 'max_y' | 'min_z' | 'max_z'

interface Face {
  id: FaceId
  position: [number, number, number]
  // Which local axis (as a column index into the target's matrixWorld —
  // 0=X, 1=Y, 2=Z) this face's handle moves along.
  axisColumn: 0 | 1 | 2
  rotation: [number, number, number]
}

// A cone's default orientation in three.js points along +Y — these rotate
// it to point outward along whichever axis each face actually sits on.
const FACE_ROTATIONS: Record<FaceId, [number, number, number]> = {
  max_x: [0, 0, -Math.PI / 2],
  min_x: [0, 0, Math.PI / 2],
  max_y: [0, 0, 0],
  min_y: [Math.PI, 0, 0],
  max_z: [Math.PI / 2, 0, 0],
  min_z: [-Math.PI / 2, 0, 0],
}

const HANDLE_COLOR = 0xf59e0b // amber — matches this app's existing selection-highlight palette

function facesFor(bounds: SectionBoxBounds): Face[] {
  const cx = (bounds.min_x + bounds.max_x) / 2
  const cy = (bounds.min_y + bounds.max_y) / 2
  const cz = (bounds.min_z + bounds.max_z) / 2
  return [
    { id: 'min_x', position: [bounds.min_x, cy, cz], axisColumn: 0, rotation: FACE_ROTATIONS.min_x },
    { id: 'max_x', position: [bounds.max_x, cy, cz], axisColumn: 0, rotation: FACE_ROTATIONS.max_x },
    { id: 'min_y', position: [cx, bounds.min_y, cz], axisColumn: 1, rotation: FACE_ROTATIONS.min_y },
    { id: 'max_y', position: [cx, bounds.max_y, cz], axisColumn: 1, rotation: FACE_ROTATIONS.max_y },
    { id: 'min_z', position: [cx, cy, bounds.min_z], axisColumn: 2, rotation: FACE_ROTATIONS.min_z },
    { id: 'max_z', position: [cx, cy, bounds.max_z], axisColumn: 2, rotation: FACE_ROTATIONS.max_z },
  ]
}

const MIN_GAP = 0.02 // metres — keeps a dragged face from crossing/inverting its opposite one

function applyFaceDelta(start: SectionBoxBounds, face: FaceId, localDelta: number): SectionBoxBounds {
  const next = { ...start }
  switch (face) {
    case 'min_x': next.min_x = Math.min(start.min_x + localDelta, start.max_x - MIN_GAP); break
    case 'max_x': next.max_x = Math.max(start.max_x + localDelta, start.min_x + MIN_GAP); break
    case 'min_y': next.min_y = Math.min(start.min_y + localDelta, start.max_y - MIN_GAP); break
    case 'max_y': next.max_y = Math.max(start.max_y + localDelta, start.min_y + MIN_GAP); break
    case 'min_z': next.min_z = Math.min(start.min_z + localDelta, start.max_z - MIN_GAP); break
    case 'max_z': next.max_z = Math.max(start.max_z + localDelta, start.min_z + MIN_GAP); break
  }
  return next
}

// One section box's own wireframe + 6 draggable face handles (2026-07-09,
// per Maro's Blender "Section Box" reference — replicated after Maro
// pointed out there was previously no way to resize a box without
// accidentally moving the real object via the ordinary Transform gizmo
// instead). Rendered as a sibling of ModelObjects inside the Canvas, not
// nested inside the target's own axis-correction wrapper — this group's
// own matrix is copied from the target's *matrixWorld* every frame
// (below), which already resolves through however many wrapper groups
// sit above the target, so copying it onto a scene-root-level group here
// reproduces the exact same world transform with no double-transform risk.
// Children of this group are therefore positioned in the target's own
// local space — exactly the frame Section Box bounds are stored in.
//
// Drag math: on pointer-down on a face handle, captures that face's own
// world-space basis vector (the target's matrixWorld column for whichever
// local axis this face moves along — deliberately NOT normalized, so its
// own length encodes the target's current scale along that axis). Each
// pointer-move raycasts into a plane containing that axis and facing the
// camera (the standard single-axis-drag technique — same idea
// TransformControls itself uses internally), projects the resulting
// world-space delta back onto the axis, and divides by the basis vector's
// length to convert that world distance into the right local-space bound
// delta. Live-drag only ever touches local component state (via
// onDragMove, which FourD.tsx uses to override just this one box's bounds
// for the live clip-plane preview) — nothing is persisted until pointer-up
// (onDragEnd), matching this whole app's existing "TransformControls edits
// are live-local, nothing auto-saves mid-drag" convention.
function SectionBoxGizmo({
  box, target, onDragStart, onDragMove, onDragEnd,
}: {
  box: ResolvedSectionBox
  target: THREE.Object3D
  onDragStart: () => void
  onDragMove: (boxId: string, bounds: SectionBoxBounds) => void
  onDragEnd: (boxId: string, bounds: SectionBoxBounds) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const dragRef = useRef<{
    face: FaceId
    startBounds: SectionBoxBounds
    axisWorld: THREE.Vector3
    plane: THREE.Plane
    anchorWorld: THREE.Vector3
    lastBounds: SectionBoxBounds
  } | null>(null)

  useFrame(() => {
    if (!groupRef.current) return
    target.updateMatrixWorld(true)
    groupRef.current.matrix.copy(target.matrixWorld)
    groupRef.current.matrixAutoUpdate = false
    groupRef.current.matrixWorldNeedsUpdate = true
  })

  const bounds = box.bounds
  const faces = useMemo(() => facesFor(bounds), [bounds.min_x, bounds.min_y, bounds.min_z, bounds.max_x, bounds.max_y, bounds.max_z])
  // Created once and mutated in place on every bounds change, rather than
  // rebuilt via useMemo (2026-07-09 fix) — this fires on every pointer-move
  // while dragging, and a fresh Box3Helper each time would leak a small
  // GPU line-geometry buffer per frame (three.js doesn't auto-dispose old
  // geometries just because they're no longer referenced from JS).
  const box3Helper = useMemo(() => new THREE.Box3Helper(new THREE.Box3(), HANDLE_COLOR), [])
  useEffect(() => {
    box3Helper.box.min.set(bounds.min_x, bounds.min_y, bounds.min_z)
    box3Helper.box.max.set(bounds.max_x, bounds.max_y, bounds.max_z)
  }, [box3Helper, bounds.min_x, bounds.min_y, bounds.min_z, bounds.max_x, bounds.max_y, bounds.max_z])
  useEffect(() => () => {
    box3Helper.geometry.dispose()
    ;(box3Helper.material as THREE.Material).dispose()
  }, [box3Helper])

  const handlePointerDown = (face: Face) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    if (!groupRef.current) return
    onDragStart()

    const m = groupRef.current.matrixWorld
    const axisWorld = new THREE.Vector3().setFromMatrixColumn(m, face.axisColumn)
    const handleWorldPos = new THREE.Vector3(...face.position).applyMatrix4(m)
    const cameraDir = new THREE.Vector3()
    camera.getWorldDirection(cameraDir)
    const axisWorldUnit = axisWorld.clone().normalize()
    const planeNormal = new THREE.Vector3()
      .crossVectors(axisWorldUnit, new THREE.Vector3().crossVectors(cameraDir, axisWorldUnit))
      .normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, handleWorldPos)

    dragRef.current = { face: face.id, startBounds: bounds, axisWorld, plane, anchorWorld: handleWorldPos, lastBounds: bounds }
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    if (!drag) return
    e.stopPropagation()
    const point = new THREE.Vector3()
    if (!e.ray.intersectPlane(drag.plane, point)) return
    const axisLength = drag.axisWorld.length()
    if (axisLength < 1e-8) return
    const worldDistance = point.clone().sub(drag.anchorWorld).dot(drag.axisWorld) / axisLength
    const localDelta = worldDistance / axisLength
    const next = applyFaceDelta(drag.startBounds, drag.face, localDelta)
    drag.lastBounds = next
    onDragMove(box.id, next)
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    onDragEnd(box.id, drag.lastBounds)
  }

  return (
    <group ref={groupRef}>
      <primitive object={box3Helper} />
      {faces.map(face => (
        <mesh
          key={face.id}
          position={face.position}
          rotation={face.rotation}
          onPointerDown={handlePointerDown(face)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <coneGeometry args={[0.08, 0.24, 8]} />
          {/* depthTest normal, not disabled (2026-07-09 fix, per Maro's
              screenshot — the handles were rendering *through* solid
              geometry, looking like stray shapes floating inside the
              object). Raycasting/dragging is unaffected either way (it's
              independent of depth-tested rendering) — a handle that's
              behind geometry from the current angle is still fully
              grabbable, just not visible until you rotate to see it,
              same as any other occluded object in the scene. */}
          <meshBasicMaterial color={HANDLE_COLOR} />
        </mesh>
      ))}
    </group>
  )
}

// Every currently-visible Section Box's own gizmo, resolved against its
// target's real THREE.Object3D (2026-07-09) — a box whose target isn't
// currently loaded, or whose own `visible` flag is off, simply renders
// nothing, same skip-if-not-resolvable convention as clip-plane
// application itself (Viewport3D.tsx's ModelObjects). For an element-
// scoped box (elementExpressId set, 2026-07-09 per-element scoping), the
// gizmo's own target is that specific mesh, not the whole object — found
// via the same `userData.expressID` traversal used everywhere else in
// this file — so the wireframe/handles wrap just that element and track
// its own local transform within the model, not the model's as a whole.
export function SectionBoxGizmos({
  boxes, objects, onDragStart, onDragMove, onDragEnd,
}: {
  boxes: ResolvedSectionBox[]
  objects: ImportedObject[]
  onDragStart: () => void
  onDragMove: (boxId: string, bounds: SectionBoxBounds) => void
  onDragEnd: (boxId: string, bounds: SectionBoxBounds) => void
}) {
  return (
    <>
      {boxes.filter(b => b.visible).map(box => {
        const object = objects.find(o => o.id === box.sceneObjectId)?.object
        if (!object) return null
        let target = object
        if (box.elementExpressId !== undefined) {
          // ensureMaterialized, not a plain traverse (2026-07-17) — see
          // elementBatching.ts's own header.
          const found = ensureMaterialized(object, box.elementExpressId)
          if (!found) return null
          target = found
        }
        return (
          <SectionBoxGizmo key={box.id} box={box} target={target} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} />
        )
      })}
    </>
  )
}

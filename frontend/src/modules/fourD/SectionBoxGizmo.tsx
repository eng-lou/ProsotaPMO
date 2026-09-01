import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import type { ImportedObject, ResolvedSectionBox } from './Viewport3D'
import type { SectionBoxBounds, SectionBoxRotation } from './sectionBoxes'
import type { SectionBoxTool } from './SectionBoxPanel'
import { ensureMaterialized } from './elementBatching'
import { sectionBoxPivotMatrix } from './sectionBoxGeometry'

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
  box, target, tool, onDragStart, onDragMove, onDragEnd, onRotateStart, onRotateMove, onRotateEnd,
}: {
  box: ResolvedSectionBox
  target: THREE.Object3D
  tool: SectionBoxTool
  onDragStart: () => void
  onDragMove: (boxId: string, bounds: SectionBoxBounds) => void
  onDragEnd: (boxId: string, bounds: SectionBoxBounds) => void
  onRotateStart: () => void
  onRotateMove: (boxId: string, rotation: SectionBoxRotation) => void
  onRotateEnd: (boxId: string, rotation: SectionBoxRotation) => void
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
    // Composed with the box's own rotation (2026-07-17, per Maro: "I'd
    // like to rotate the bounding box") — see sectionBoxPivotMatrix's own
    // header (sectionBoxGeometry.ts). Children below still position
    // themselves using bounds' plain absolute min_x/max_x etc, unchanged —
    // pivotMatrix rotates *around the box's own centre*, so nothing here
    // needs to be redefined relative to that centre.
    //
    // box.pivotBounds, not box.bounds (2026-09-01 fix — see
    // sectionBoxPivotMatrix's own header for the full "resize after rotate
    // swings the whole box" story): pivotBounds stays pinned to the box's
    // last-committed extent for the whole of an in-progress resize drag, so
    // the wireframe's own rotation centre doesn't wander every frame right
    // along with the very face being dragged.
    groupRef.current.matrix.copy(target.matrixWorld).multiply(sectionBoxPivotMatrix(box.pivotBounds, box.rotation))
    groupRef.current.matrixAutoUpdate = false
    groupRef.current.matrixWorldNeedsUpdate = true
  })

  const bounds = box.bounds
  const faces = useMemo(() => facesFor(bounds), [bounds.min_x, bounds.min_y, bounds.min_z, bounds.max_x, bounds.max_y, bounds.max_z])
  // Proportional to the box's own size, not a fixed absolute unit size
  // (2026-07-17 fix, per Maro: "no handles" — a fixed radius/height was
  // comfortably visible against a single small element's local scale but
  // became microscopically invisible against a box spanning an entire
  // building. No upper clamp deliberately — this app never rescales an
  // IFC file's own native length unit onto the scene graph
  // (getLengthUnitToMetres in ifcModel.ts only ever reports it for
  // display, see that function's own header), and a common one is
  // millimetres, where even a whole building's own bounds diagonal is
  // "large" only in the small-multiplier sense, not in absolute scene
  // units — an upper clamp tuned for a metres-scale model would silently
  // reintroduce this exact invisible-handle bug on an mm-scale one. Only a
  // lower clamp, so a tiny element-scoped box still gets a comfortably
  // grabbable handle instead of shrinking below usable size.
  const handleRadius = useMemo(() => {
    const dx = bounds.max_x - bounds.min_x
    const dy = bounds.max_y - bounds.min_y
    const dz = bounds.max_z - bounds.min_z
    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz)
    return Math.max(diagonal * 0.015, 0.08)
  }, [bounds.min_x, bounds.min_y, bounds.min_z, bounds.max_x, bounds.max_y, bounds.max_z])
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

  // Rotate handle (2026-07-17, per Maro: "I'd like to rotate the bounding
  // box") — reuses drei's own TransformControls in 'rotate' mode rather
  // than a bespoke ring gizmo, same control every object/element transform
  // elsewhere in this app already uses, attached to an invisible proxy
  // group instead of a real scene object (there's no single real Object3D
  // that "is" the box's rotation — it's stored as its own rot_x/y/z,
  // independent of the target's own transform).
  //
  // pivotGroupRef carries target.matrixWorld * translate-to-centre only —
  // deliberately NOT composed with the box's own current rotation (unlike
  // groupRef above) — so the proxy's own LOCAL rotation, read directly off
  // it, always equals the box's current absolute rot_x/y/z with no delta
  // math needed: onChange just reads proxy.rotation straight off.
  // space="local" on TransformControls means the rings themselves are
  // drawn along the proxy's own (unrotated-parent) axes too, i.e. the
  // box's own default axes, not the camera/world's.
  const pivotGroupRef = useRef<THREE.Group>(null)
  const [proxy, setProxy] = useState<THREE.Group | null>(null)
  const isRotatingRef = useRef(false)

  useFrame(() => {
    if (!pivotGroupRef.current) return
    target.updateMatrixWorld(true)
    // box.pivotBounds, not box.bounds — see groupRef's own useFrame above
    // for why (2026-09-01 fix); harmless here since the two are identical
    // whenever no resize drag is in progress, which is always true while
    // this rotate-only proxy is even mounted, but keeping both pivot
    // computations sourced from the same field avoids a future edge case
    // (e.g. a resize commit landing mid-tool-switch) reintroducing the
    // exact same class of bug in just this one spot.
    const cx = (box.pivotBounds.min_x + box.pivotBounds.max_x) / 2
    const cy = (box.pivotBounds.min_y + box.pivotBounds.max_y) / 2
    const cz = (box.pivotBounds.min_z + box.pivotBounds.max_z) / 2
    pivotGroupRef.current.matrix.copy(target.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(cx, cy, cz))
    pivotGroupRef.current.matrixAutoUpdate = false
    pivotGroupRef.current.matrixWorldNeedsUpdate = true
  })

  // Syncs the proxy's own rotation FROM box.rotation — only while NOT
  // actively being dragged (isRotatingRef), so this doesn't fight
  // TransformControls' own direct mutation of the same object mid-drag;
  // only relevant for an external change (initial mount, or another
  // client's edit landing) while this box isn't the one being rotated.
  useEffect(() => {
    if (!proxy || isRotatingRef.current) return
    proxy.rotation.set(box.rotation.rot_x, box.rotation.rot_y, box.rotation.rot_z, 'XYZ')
  }, [proxy, box.rotation.rot_x, box.rotation.rot_y, box.rotation.rot_z])

  const handleRotateChange = () => {
    if (!proxy || !isRotatingRef.current) return
    onRotateMove(box.id, { rot_x: proxy.rotation.x, rot_y: proxy.rotation.y, rot_z: proxy.rotation.z })
  }

  return (
    <>
      <group ref={groupRef}>
        {/* Wireframe stays visible in both tools — only the draggable
            cones themselves are Resize-only (2026-07-17 fix, per Maro:
            "the rotation handles make it hard to manipulate the original
            handles" — showing both sets of handles at once meant they
            fought over the same clicks and screen space). */}
        <primitive object={box3Helper} />
        {tool === 'resize' && faces.map(face => (
          <mesh
            key={face.id}
            position={face.position}
            rotation={face.rotation}
            onPointerDown={handlePointerDown(face)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <coneGeometry args={[handleRadius, handleRadius * 3, 8]} />
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
      {tool === 'rotate' && (
        <>
          <group ref={pivotGroupRef}>
            <group ref={setProxy} />
          </group>
          {proxy && (
            <TransformControls
              object={proxy}
              mode="rotate"
              space="local"
              onMouseDown={() => { isRotatingRef.current = true; onRotateStart() }}
              onChange={handleRotateChange}
              onMouseUp={() => {
                isRotatingRef.current = false
                onRotateEnd(box.id, { rot_x: proxy.rotation.x, rot_y: proxy.rotation.y, rot_z: proxy.rotation.z })
              }}
            />
          )}
        </>
      )}
    </>
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
  boxes, objects, tool, onDragStart, onDragMove, onDragEnd, onRotateStart, onRotateMove, onRotateEnd,
}: {
  boxes: ResolvedSectionBox[]
  objects: ImportedObject[]
  tool: SectionBoxTool
  onDragStart: () => void
  onDragMove: (boxId: string, bounds: SectionBoxBounds) => void
  onDragEnd: (boxId: string, bounds: SectionBoxBounds) => void
  onRotateStart: () => void
  onRotateMove: (boxId: string, rotation: SectionBoxRotation) => void
  onRotateEnd: (boxId: string, rotation: SectionBoxRotation) => void
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
          <SectionBoxGizmo
            key={box.id} box={box} target={target} tool={tool}
            onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}
            onRotateStart={onRotateStart} onRotateMove={onRotateMove} onRotateEnd={onRotateEnd}
          />
        )
      })}
    </>
  )
}

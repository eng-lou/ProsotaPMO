import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { ensureMaterialized, type BatchState } from './elementBatching'
import { findSnapPoint } from './measurementGeometry'
import type { MeasurementPoint } from './measurements'

export interface MeasurementHit {
  point: MeasurementPoint
  // The resolved (never-batched) hit object, for handleMeasurementHit's own
  // toMetres/model resolution in FourD.tsx — null for the ground-plane
  // fallback, same "empty space still places a point" convention
  // PathAddPointCatcher already has.
  object: THREE.Object3D | null
  // Valid only when object is a real indexed-geometry Mesh — Area (face)
  // mode's own seed triangle for measurementGeometry.ts's measureFacePatch.
  faceIndex: number | null
}

function isVisibleThroughAncestors(object: THREE.Object3D): boolean {
  // three.js's own Raycaster never checks `.visible` (verified directly in
  // three/src/core/Raycaster.js — only `layers` gates traversal), but
  // Isolate/Hide in this app work by setting `.visible = false` directly on
  // each excluded mesh (Viewport3D.tsx's own ModelObjects, ~line 698/1086)
  // while leaving it fully present in the scene graph. Without this check,
  // clicking/hovering while something's isolated could silently hit a
  // now-invisible element elsewhere in the model instead of the real
  // visible surface under the cursor — same reasoning ModelObjects' own
  // handleClick already walks this exact chain for.
  let obj: THREE.Object3D | null = object
  while (obj) {
    if (obj.userData?.isPathGizmo || obj.userData?.isMeasurementGizmo) return false
    if (!obj.visible) return false
    obj = obj.parent
  }
  return true
}

function raycastFromEvent(
  event: PointerEvent, raycaster: THREE.Raycaster, camera: THREE.Camera, scene: THREE.Scene, domElement: HTMLElement,
) {
  const rect = domElement.getBoundingClientRect()
  const cursorPx = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  const ndc = new THREE.Vector2((cursorPx.x / rect.width) * 2 - 1, -(cursorPx.y / rect.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(scene.children, true).filter(hit => isVisibleThroughAncestors(hit.object))
  return { hits, cursorPx, rect }
}

// Click-to-place for the Measure tool (2026-07-19) — same raw-native-
// pointerdown-in-capture-phase trick as PathGizmo.tsx's own
// PathAddPointCatcher (bypasses R3F's synthetic event system so it wins
// over ModelObjects' own selection without needing any changes there), same
// raycast-real-geometry-first-then-ground-plane-fallback behaviour. Doesn't
// just reuse PathAddPointCatcher directly, though: Area (face) mode needs
// more than a world-space point back — a stable faceIndex on real,
// non-batched geometry — so this also resolves a THREE.BatchedMesh hit down
// to its per-element mesh the same way Viewport3D.tsx's own handleClick
// does (elementBatching.ts), then re-raycasts restricted to just that
// element's own mesh to get a faceIndex valid on the now-standalone
// geometry (the batch's own shared geometry's face indices don't carry
// over — materializing swaps the geometry entirely).
//
// Vertex/edge snapping (2026-07-19, per Maro: "I need points to snap to
// element points edges corners. learn from blender") — on commit (click),
// findSnapPoint checks the clicked triangle's own 3 vertices/edges for one
// within screen-space range of the cursor and uses that instead of the raw
// surface hit; onHoverPoint mirrors the same check on every pointermove
// (read-only — no materializing) so a live indicator can show what the
// *next* click would snap to, matching Blender's own hover cursor. Hover
// preview only resolves for an already-individual mesh, not a still-batched
// one — materializing on mere hover would permanently pop every hovered
// element out of the shared batch (elementBatching.ts's own "deliberately
// permanent" contract), defeating the point of batching for a read-only
// preview; clicking still snaps correctly either way, since ensureMaterialized
// only ever runs on an actual commit below.
export function MeasurementCatcher({
  active, upAxis, onHit, onHoverPoint,
}: {
  active: boolean
  upAxis: 'y' | 'z'
  onHit: (hit: MeasurementHit) => void
  onHoverPoint: (point: MeasurementPoint | null) => void
}) {
  const { camera, scene, gl } = useThree()

  useEffect(() => {
    if (!active) {
      onHoverPoint(null)
      return
    }

    const raycaster = new THREE.Raycaster()
    const groundPlane = upAxis === 'z'
      ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
      : new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    const handlePointerDown = (event: PointerEvent) => {
      event.stopPropagation()
      event.preventDefault()
      const { hits, cursorPx, rect } = raycastFromEvent(event, raycaster, camera, scene, gl.domElement)

      if (hits.length > 0) {
        const hit = hits[0]
        let target: THREE.Object3D = hit.object
        let faceIndex = hit.faceIndex ?? null

        if ((target as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh && hit.batchId !== undefined) {
          let batchRoot: THREE.Object3D | null = target
          while (batchRoot && batchRoot.userData.batch === undefined) batchRoot = batchRoot.parent
          const batchState = batchRoot?.userData.batch as BatchState | undefined
          const resolvedId = batchState?.expressIdByInstanceId.get(hit.batchId)
          if (resolvedId !== undefined && batchRoot) {
            const materialized = ensureMaterialized(batchRoot, resolvedId)
            if (materialized) {
              target = materialized
              const reHits = raycaster.intersectObject(materialized, false)
              faceIndex = reHits.length > 0 ? (reHits[0].faceIndex ?? null) : null
            }
          }
        }

        let point: MeasurementPoint = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
        if (target instanceof THREE.Mesh) {
          const snapped = findSnapPoint(target, camera, cursorPx, rect.width, rect.height)
          if (snapped) point = snapped
        }

        onHit({ point, object: target, faceIndex })
        return
      }
      const groundHit = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
        onHit({ point: { x: groundHit.x, y: groundHit.y, z: groundHit.z }, object: null, faceIndex: null })
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const { hits, cursorPx, rect } = raycastFromEvent(event, raycaster, camera, scene, gl.domElement)
      if (hits.length === 0) { onHoverPoint(null); return }
      const hit = hits[0]
      // Batched hits are skipped here (read-only, no materialize) — see
      // this component's own header.
      if ((hit.object as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh) { onHoverPoint(null); return }
      if (!(hit.object instanceof THREE.Mesh)) {
        onHoverPoint({ x: hit.point.x, y: hit.point.y, z: hit.point.z })
        return
      }
      const snapped = findSnapPoint(hit.object, camera, cursorPx, rect.width, rect.height)
      onHoverPoint(snapped ?? { x: hit.point.x, y: hit.point.y, z: hit.point.z })
    }

    const el = gl.domElement
    // Bubble phase, no stopPropagation/preventDefault (2026-07-19) — unlike
    // the commit handler above, hover preview must stay non-destructive:
    // OrbitControls' own drag-to-orbit still needs to see these same
    // pointermove events to keep working while the Measure tool is armed.
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => {
      el.removeEventListener('pointermove', handlePointerMove)
      el.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      onHoverPoint(null)
    }
  }, [active, upAxis, camera, scene, gl, onHit, onHoverPoint])

  return null
}

import * as THREE from 'three'
import type { BatchState } from './elementBatching'

// "Simplify while orbiting" (2026-10-02, per Maro: "exactly, that's
// brilliant", after measuring the five-file NBU Medical Clinic at ~6.0M
// triangles per frame, 4.6M of them from the MEP file's fittings). While an
// orbit drag is in progress, every batched element that would cover only a
// few pixels on screen is hidden, Navisworks-style, and shown again the
// moment the drag ends — small things are culled, near/large things stay,
// so a close-up interior view keeps what's around the camera.
//
// Screen size is judged once, at drag start, from each instance's bounding
// sphere against the camera as it is then (an orbit keeps the distance to
// the pivot, so the verdict holds for the drag). Only instances that were
// VISIBLE are hidden, and only those are restored — Hide/Isolate/timeline
// visibility the user had going in is untouched. The hidden set is kept on
// the batch mesh (userData.movingHidden) so the timeline's own per-frame
// visibility writes skip those instances instead of fighting the cull.
const MIN_RADIUS_PX = 5

const _sphere = new THREE.Sphere()
const _matrix = new THREE.Matrix4()

function pixelsPerUnitAt(camera: THREE.Camera, point: THREE.Vector3, viewportHeightPx: number): number {
  if (camera instanceof THREE.OrthographicCamera) {
    return viewportHeightPx / ((camera.top - camera.bottom) / camera.zoom)
  }
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50
  const distance = Math.max(camera.position.distanceTo(point), 1e-3)
  return viewportHeightPx / (2 * distance * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
}

export function hideSmallWhileMoving(root: THREE.Object3D, camera: THREE.Camera, viewportHeightPx: number): number {
  const batch = root.userData.batch as BatchState | undefined
  if (!batch || batch.mesh.userData.movingHidden) return 0
  const mesh = batch.mesh
  mesh.updateMatrixWorld(true)
  const hidden = new Set<number>()
  for (const infos of batch.byExpressId.values()) {
    for (const { instanceId } of infos) {
      if (!mesh.getVisibleAt(instanceId)) continue
      mesh.getBoundingSphereAt(mesh.getGeometryIdAt(instanceId), _sphere)
      mesh.getMatrixAt(instanceId, _matrix)
      _sphere.applyMatrix4(_matrix.premultiply(mesh.matrixWorld))
      if (_sphere.radius * pixelsPerUnitAt(camera, _sphere.center, viewportHeightPx) < MIN_RADIUS_PX) {
        mesh.setVisibleAt(instanceId, false)
        hidden.add(instanceId)
      }
    }
  }
  mesh.userData.movingHidden = hidden
  return hidden.size
}

export function restoreAfterMoving(root: THREE.Object3D) {
  const batch = root.userData.batch as BatchState | undefined
  const hidden = batch?.mesh.userData.movingHidden as Set<number> | undefined
  if (!batch || !hidden) return
  for (const instanceId of hidden) batch.mesh.setVisibleAt(instanceId, true)
  delete batch.mesh.userData.movingHidden
}

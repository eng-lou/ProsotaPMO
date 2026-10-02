import * as THREE from 'three'

// Orthographic view support (2026-10-02, per Maro: "I want an orthographic
// view ... similar to how Blender does it").
//
// An orthographic camera's position doesn't move when you zoom (OrbitControls
// changes camera.zoom instead), so anything that sized or culled itself by
// "distance from the camera" (annotation markers, path gizmo arrows, the
// shadow frustum) would stop reacting to zoom. This returns the distance a
// perspective camera with the app's default 35° FOV would need to show the
// same visible height — i.e. how far away the view *looks* — and the plain
// distance for a perspective camera.
const REFERENCE_TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(35) / 2)

export function orthoVisibleHeight(camera: THREE.OrthographicCamera): number {
  return (camera.top - camera.bottom) / camera.zoom
}

export function effectiveViewDistance(camera: THREE.Camera, point: THREE.Vector3): number {
  if (camera instanceof THREE.OrthographicCamera) return orthoVisibleHeight(camera) / (2 * REFERENCE_TAN_HALF_FOV)
  return camera.position.distanceTo(point)
}

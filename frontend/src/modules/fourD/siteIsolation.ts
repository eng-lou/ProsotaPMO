import * as THREE from 'three'
/** Freeze the visible camera volume, not downloaded tiles. Keep crop aligned with passepartout. */
export function captureIsolation(camera: THREE.Camera, viewportAspect: number, frameAspect?: number): [number,number,number,number][] {
  camera.updateMatrixWorld(true)
  const crop = new THREE.Matrix4()
  if (frameAspect) {
    crop.makeScale(Math.max(1, viewportAspect / frameAspect), Math.max(1, frameAspect / viewportAspect), 1)
  }
  const clip = crop.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
  return new THREE.Frustum().setFromProjectionMatrix(clip).planes.map(p => [p.normal.x,p.normal.y,p.normal.z,p.constant])
}

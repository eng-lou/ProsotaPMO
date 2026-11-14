import { DirectionalLight, Vector3 } from 'three'

const focusInLight = new Vector3()

/** Follow the viewed area in light-space without changing the sun direction.
 * Zoom controls XY texel density, never the scene's caster/receiver depth range.
 */
export function fitSunShadow(light: DirectionalLight, focus: Vector3, visibleHeight: number, modelRadius: number, sunRadius: number) {
  const radius = Math.max(0.1, modelRadius)
  const extent = Math.max(Math.min(10, radius), Math.min(visibleHeight, radius)) * 2
  // Refresh the light's view transform before projecting the orbit target.
  light.updateWorldMatrix(true, false)
  light.target.updateWorldMatrix(true, false)
  light.shadow.updateMatrices(light)
  const camera = light.shadow.camera
  focusInLight.copy(focus).applyMatrix4(camera.matrixWorldInverse)
  camera.left = focusInLight.x - extent
  camera.right = focusInLight.x + extent
  camera.bottom = focusInLight.y - extent
  camera.top = focusInLight.y + extent
  camera.near = 0.5
  camera.far = Math.max(1, sunRadius + radius * 2)
  camera.updateProjectionMatrix()
  light.shadow.normalBias = extent * 0.001
  light.shadow.updateMatrices(light)
  return `${extent.toPrecision(5)}|${focusInLight.x.toPrecision(6)}|${focusInLight.y.toPrecision(6)}|${camera.far.toPrecision(6)}`
}

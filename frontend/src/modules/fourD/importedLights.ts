import * as THREE from 'three'

// Disable illumination through layers so children of a light (including a fixture
// mesh) stay visible and animation can still update the light's own properties.
const originalMasks = new WeakMap<THREE.Light, number>()

export function setImportedLightsEnabled(root: THREE.Object3D, enabled: boolean) {
  root.traverse(node => {
    if (!(node instanceof THREE.Light)) return
    const original = originalMasks.get(node)
    if (!enabled && original === undefined) {
      originalMasks.set(node, node.layers.mask)
      node.layers.disableAll()
    } else if (enabled && original !== undefined) {
      node.layers.mask = original
      originalMasks.delete(node)
    }
  })
}

export function cloneImportedLight(light: THREE.Light) {
  const copy = light.clone(false)
  copy.layers.mask = originalMasks.get(light) ?? light.layers.mask
  return copy
}

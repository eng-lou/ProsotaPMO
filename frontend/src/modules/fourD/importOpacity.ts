import * as THREE from 'three'

/** Separate-opacity imports often describe cutouts, not a blended whole mesh.
 * Keep genuinely translucent maps and authored scalar transparency blended.
 */
export function prepareImportedOpacity(material: THREE.MeshStandardMaterial, rgba: Uint8ClampedArray) {
  if (material.opacity < 1 || (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0) || !rgba.length) return
  let opaque = 0, intermediate = 0
  const count = rgba.length / 4
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] >= 250) opaque++
    else if (rgba[i] > 5) intermediate++
  }
  // Allow antialiased mask edges and small translucent eye overlays, but not
  // broad glass/fabric gradients. MASK survives the GLB export/reload boundary.
  if (opaque / count < .5 || intermediate / count > .05) return
  material.transparent = false
  material.depthWrite = true
  material.alphaTest = .5
  material.userData.prosotaOpacityMode = 'cutout'
}

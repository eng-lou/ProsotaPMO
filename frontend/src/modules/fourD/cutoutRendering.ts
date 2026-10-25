import * as THREE from 'three'

// A hard alpha cutoff erases foliage when averaged mip alpha falls below it.
// Stochastic coverage retains the average opacity without sorting leaf cards.
export function prepareCutoutRendering(root: THREE.Object3D) {
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    let cutout = false
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || (!material.map && !material.alphaMap)) continue
      // Character atlases have opaque skin/clothes with small masked details.
      // Keep their authored cutoff: stochastic coverage makes compressed white
      // mask pixels sparkle across otherwise solid surfaces.
      if (material.userData.prosotaOpacityMode === 'cutout') continue
      if (material.alphaTest > 0 && !material.transparent) {
        material.alphaTest = 0
        material.alphaHash = true
        material.needsUpdate = true
      }
      cutout ||= material.alphaHash
    }
    if (!cutout) return
    // Three r169 does not copy alphaHash from the visible material to its
    // built-in shadow materials. Supply both directional and point-light paths.
    if (!node.customDepthMaterial) node.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaHash: true })
    if (!node.customDistanceMaterial) node.customDistanceMaterial = new THREE.MeshDistanceMaterial({ alphaHash: true })
  })
}

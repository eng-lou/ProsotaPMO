import * as THREE from 'three'

// Draw ordering reads boundingSphere even when frustum culling is disabled.
// Keep a sphere available for sorting; use exact animated triangle tests for picking without a full vertex scan.
export function animatedAssetBounds(object: THREE.Object3D) {
  let revision = 0
  const skins: THREE.SkinnedMesh[] = []
  object.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return
    skins.push(node)
    node.frustumCulled = false
    if (!node.boundingSphere) {
      if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere()
      node.boundingSphere = node.geometry.boundingSphere!.clone()
    }
    const raycast = node.raycast
    let pickedRevision = -1
    node.raycast = function(raycaster, hits) {
      if (pickedRevision !== revision) {
        object.updateWorldMatrix(true, false)
        object.updateMatrixWorld(true)
        pickedRevision = revision
      }
      // A tight skin sphere costs a full morph + bone transform of every
      // vertex, before raycast transforms them again for triangle tests.
      // Bypass stale pose bounds only for this ray; exact triangles still
      // decide the hit. Keep the ordinary sphere for renderer draw ordering.
      const sphere = this.boundingSphere, radius = sphere.radius
      const box = this.boundingBox
      sphere.radius = Infinity
      ;(this as unknown as {boundingBox: THREE.Box3|null}).boundingBox = null
      try { raycast.call(this, raycaster, hits) }
      finally { sphere.radius = radius; this.boundingBox = box }
    }
  })
  return () => {
    revision++
    for (const mesh of skins) {
      // Framing can still request a fresh box. Never null the sorting sphere:
      // WebGLRenderer would scan every deformed vertex on the next frame.
      const bounds = mesh as unknown as {boundingBox: THREE.Box3|null}
      bounds.boundingBox = null
    }
  }
}

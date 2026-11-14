import type { BatchedMesh, Mesh, Object3D } from 'three'

// Inspect displayed materials and live instances, not merely a stored Water
// assignment. Hidden water must not keep all the scene's render passes running.
export function hasVisibleWater(scene: Object3D) {
  let found = false
  scene.traverseVisible(object => {
    if (found) return
    const mesh = object as Mesh
    if (!mesh.material) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material.visible || material.opacity <= 0) continue
      const uniforms = material.userData.realisticUniforms
      if (uniforms?.realClass?.value === 14) { found = true; break }
      const data = uniforms?.realClassTex?.value?.image?.data
      const batch = mesh as BatchedMesh
      if (!data || !batch.isBatchedMesh) continue
      for (let i = 0; i < data.length; i += 4) {
        // Alpha marks surfaces drawn by a separate translucent batch. The
        // opaque batch's shader discards them, even if getVisibleAt is true.
        if (data[i] === 14 && data[i + 3] < 128 && batch.getVisibleAt(i / 4)) { found = true; break }
      }
    }
  })
  return found
}

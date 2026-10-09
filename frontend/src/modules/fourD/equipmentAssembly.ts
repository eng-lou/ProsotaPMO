import * as THREE from 'three'

/** Copy rigid parts without application metadata, animation or scene reparenting. */
export function assembleEquipment(parts: { name: string; object: THREE.Object3D; fileId?: string | null }[], name: string) {
  if (parts.length < 2) throw new Error('Select at least two imports')
  const root = new THREE.Group(); root.name = name
  const copy = (node: THREE.Object3D): THREE.Object3D => {
    const mesh = node as THREE.Mesh
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || node.animations.length) throw new Error('Assembly requires rigid parts without embedded animation')
    const result = mesh.isMesh ? new THREE.Mesh(mesh.geometry, mesh.material) : new THREE.Group()
    result.name = node.name
    result.position.copy(node.position); result.quaternion.copy(node.quaternion); result.scale.copy(node.scale)
    for (const child of node.children) result.add(copy(child))
    return result
  }
  for (const part of parts) {
    part.object.updateWorldMatrix(true, true)
    const node = copy(part.object); node.name = part.name
    // Bake viewport axis correction and any existing parent into each copied root.
    const matrix = part.object.matrixWorld
    if (Math.abs(matrix.determinant()) < 1e-12) throw new Error(`${part.name} has zero scale; restore its visible pose before assembling`)
    matrix.decompose(node.position, node.quaternion, node.scale)
    const reconstructed = new THREE.Matrix4().compose(node.position, node.quaternion, node.scale)
    if (matrix.elements.some((v, i) => Math.abs(v - reconstructed.elements[i]) > 1e-5)) throw new Error(`${part.name} has a sheared transform; use uniform parent scale before assembling`)
    root.add(node)
  }
  root.userData.prosotaEquipmentSources = parts.map(p => p.fileId).filter(Boolean)
  return root
}

import * as THREE from 'three'
import type { BatchState } from './elementBatching'
import type { ClashGeometry } from './clashGeometry'

/** Read every IFC piece without decomposing placements or changing the scene. */
export function readIfcClashMeshes(root: THREE.Object3D, expressID: number): THREE.Mesh[] {
  const index = root.userData.expressIdMeshIndex as Map<number, THREE.Mesh[]> | undefined
  const meshes = [...(index?.get(expressID) ?? [])]
  const batch = root.userData.batch as BatchState | undefined
  for (const info of batch?.byExpressId.get(expressID) ?? []) {
    const geometry = batch!.geometryById.get(info.geometryId)
    if (!geometry) throw new Error(`Missing IFC geometry piece for element #${expressID}. Reload the model.`)
    const proxy = new THREE.Mesh(geometry, batch!.mesh.material)
    // Keep the exact render matrix: decomposing a zero-scale placement creates
    // NaN rotations even though its original matrix and vertices are finite.
    proxy.matrixAutoUpdate = false
    batch!.mesh.getMatrixAt(info.instanceId, proxy.matrix)
    proxy.parent = batch!.mesh
    proxy.visible = batch!.mesh.getVisibleAt(info.instanceId) && info.colorAlpha !== 0
    meshes.push(proxy)
  }
  return meshes
}

/** Compact only rendered triangles; unused buffer capacity is not geometry. */
export function captureMeshTriangles(mesh: THREE.Mesh, label: string): ClashGeometry | null {
  if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.BatchedMesh) {
    throw new Error(`Unsupported animated/instanced geometry for ${label}. Use static element geometry.`)
  }
  mesh.updateWorldMatrix(true, false)
  if (!mesh.matrixWorld.elements.every(Number.isFinite)) throw new Error(`Invalid world placement for ${label}. Reload the model or reset its transform.`)
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  if (!position || position.itemSize < 3) throw new Error(`Missing 3D positions for ${label}.`)
  const index = geometry.getIndex()
  const count = index?.count ?? position.count
  const start = Math.max(0, Math.floor(geometry.drawRange.start))
  const end = Math.min(count, start + geometry.drawRange.count)
  // WebGL ignores a trailing one/two vertices in TRIANGLES mode.
  const stop = start + Math.floor((end - start) / 3) * 3
  const remap = new Map<number, number>()
  const positions: number[] = [], indices: number[] = []
  const vertex = new THREE.Vector3()
  for (let i = start; i < stop; i++) {
    const original = index ? index.getX(i) : i
    if (!Number.isInteger(original) || original < 0 || original >= position.count) throw new Error(`Invalid triangle index ${original} for ${label}. Reload the model.`)
    let target = remap.get(original)
    if (target === undefined) {
      vertex.fromBufferAttribute(position, original).applyMatrix4(mesh.matrixWorld)
      if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) throw new Error(`Invalid referenced vertex ${original} for ${label}. Reload the model.`)
      target = remap.size
      remap.set(original, target)
      positions.push(vertex.x, vertex.y, vertex.z)
    }
    indices.push(target)
  }
  return indices.length ? { positions, indices } : null
}

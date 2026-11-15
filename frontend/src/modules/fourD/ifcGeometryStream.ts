import * as THREE from 'three'
import type { IfcAPI } from 'web-ifc'
import { captureBaseline, disposeMeshGeometries, disposeMeshMaterials } from './elementBaseline'
import { buildElementMaterial, finalizeIndividualMesh, type BatchState } from './elementBatching'

import { extractIfcGeometry, type IfcGeometryData, type IfcPlacement } from './ifcGeometryData'

function buildGeometry(vertexData: Float32Array, indexData: Uint32Array): THREE.BufferGeometry {
  const vertexCount = vertexData.length / 6
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  for (let v = 0, p = 0, u = 0; v < vertexData.length; v += 6, p += 3, u += 2) {
    positions[p] = vertexData[v]; positions[p + 1] = vertexData[v + 1]; positions[p + 2] = vertexData[v + 2]
    normals[p] = vertexData[v + 3]; normals[p + 1] = vertexData[v + 4]; normals[p + 2] = vertexData[v + 5]
    // IFC has no UVs: local box projection preserves editable material tiling.
    const nx = Math.abs(normals[p]), ny = Math.abs(normals[p + 1]), nz = Math.abs(normals[p + 2])
    if (nx >= ny && nx >= nz) { uvs[u] = positions[p + 1]; uvs[u + 1] = positions[p + 2] }
    else if (ny >= nx && ny >= nz) { uvs[u] = positions[p]; uvs[u + 1] = positions[p + 2] }
    else { uvs[u] = positions[p]; uvs[u + 1] = positions[p + 1] }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indexData, 1))
  return geometry
}

/** Extract each shape while web-ifc's temporary per-element geometry is alive.
 * LoadAllGeometry retains the entire native geometry cache and can exceed the
 * 32-bit WASM ceiling even when the IFC records themselves fit (Fort Tower).
 * StreamAllMeshes clears that cache between elements. Only owned Three buffers
 * and plain placement records survive the callback; properties stay in the API.
 */
export async function buildIfcScene(api: IfcAPI, modelID: number, name: string, sharedOffset: THREE.Vector3 | null, prepared?: IfcGeometryData) {
  const group = new THREE.Group()
  group.name = name
  const geometries = new Map<number, THREE.BufferGeometry>()
  const placements: IfcPlacement[] = []
  const offsetSum = new THREE.Vector3()
  let totalVertices = 0, totalIndices = 0
  let batch: BatchState | null = null
  let batchedMesh: THREE.BatchedMesh | undefined
  let batchedMaterial: THREE.MeshStandardMaterial | undefined
  let sliceStart = performance.now()
  const yieldToInput = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); sliceStart = performance.now() }
  try {
    await yieldToInput()
    const data = prepared ?? extractIfcGeometry(api, modelID)
    for (const shape of data.geometries) {
      if (performance.now() - sliceStart > 8) await yieldToInput()
      geometries.set(shape.id, buildGeometry(shape.vertices, shape.indices))
      totalVertices += shape.vertices.length / 6; totalIndices += shape.indices.length
    }
    for (const placed of data.placements) {
      placements.push(placed)
      if (!sharedOffset) { offsetSum.x += placed.matrix[12]; offsetSum.y += placed.matrix[13]; offsetSum.z += placed.matrix[14] }
    }

    await yieldToInput()

    // All federated files must share one offset. The caller commits this only
    // after success, so a failed first import cannot shift subsequent models.
    const recenterOffset = sharedOffset ?? (placements.length ? offsetSum.divideScalar(placements.length) : null)
    if (geometries.size) {
      batchedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })
      batchedMesh = new THREE.BatchedMesh(placements.length, totalVertices, totalIndices, batchedMaterial)
      batchedMesh.name = 'batched-elements'
      batchedMesh.perObjectFrustumCulled = false
      batchedMesh.sortObjects = false
      batch = { mesh: batchedMesh, byExpressId: new Map(), expressIdByInstanceId: new Map(), geometryByIfcId: new Map(), geometryById: new Map() }
      group.add(batchedMesh)
      for (const [id, geometry] of geometries) {
        if (performance.now() - sliceStart > 8) await yieldToInput()
        const geometryId = batchedMesh.addGeometry(geometry)
        batch.geometryByIfcId.set(id, { geometry, geometryId })
        batch.geometryById.set(geometryId, geometry)
      }
    }
    let mirroredCount = 0
    for (const placed of placements) {
      if (performance.now() - sliceStart > 8) await yieldToInput()
      const matrix = new THREE.Matrix4().fromArray(placed.matrix)
      if (recenterOffset) {
        matrix.elements[12] -= recenterOffset.x
        matrix.elements[13] -= recenterOffset.y
        matrix.elements[14] -= recenterOffset.z
      }
      const entry = batch!.geometryByIfcId.get(placed.geometryExpressID)!
      if (matrix.determinant() >= 0) {
        const instanceId = batch!.mesh.addInstance(entry.geometryId)
        batch!.mesh.setMatrixAt(instanceId, matrix)
        const color = new THREE.Color(placed.color.x, placed.color.y, placed.color.z)
        batch!.mesh.setColorAt(instanceId, color)
        const infos = batch!.byExpressId.get(placed.expressID) ?? []
        infos.push({ geometryId: entry.geometryId, instanceId, color, colorAlpha: placed.color.w, matrix, ifcGeometryId: placed.geometryExpressID })
        batch!.byExpressId.set(placed.expressID, infos)
        batch!.expressIdByInstanceId.set(instanceId, placed.expressID)
      } else {
        // BatchedMesh cannot render reflections. Clone our owned cache here;
        // the native geometry is no longer available after streaming finishes.
        const mesh = new THREE.Mesh(entry.geometry.clone(), buildElementMaterial(placed.color))
        mesh.userData.ifcGeometryId = placed.geometryExpressID
        mesh.userData.ifcColorAlpha = placed.color.w
        finalizeIndividualMesh(mesh, placed.expressID, matrix, group)
        mirroredCount++
      }
    }
    // Three 0.169 needs a fresh compile after per-instance colours are assigned.
    if (batchedMaterial) batchedMaterial.needsUpdate = true
    captureBaseline(group)
    group.userData.batch = batch
    console.info(`[4D] ${name}: streamed ${placements.length} placements — ${placements.length - mirroredCount} batched, ${mirroredCount} mirrored, ${geometries.size} unique shapes`)
    return { object: group, batch, recenterOffset }
  } catch (error) {
    group.traverse(object => {
      if (object instanceof THREE.Mesh && object !== batchedMesh) {
        disposeMeshGeometries(object)
        disposeMeshMaterials(object, false)
      }
    })
    batchedMesh?.dispose()
    batchedMaterial?.dispose()
    for (const geometry of geometries.values()) geometry.dispose()
    throw error
  }
}

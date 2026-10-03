// Run: node --test tests/elementBatching.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import * as THREE from 'three'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/modules/fourD/elementBatching.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const { buildEdgesBatch, syncEdgesBatch, setBatchedInstanceMatrix, ensureMaterialized, removeElementsFromModel } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text + '\n//# sourceURL=elementBatching-test-bundle.mjs').toString('base64')}`)

function fixture() {
  const root = new THREE.Group()
  const geometry = new THREE.BoxGeometry()
  const mesh = new THREE.BatchedMesh(3, 100, 150, new THREE.MeshBasicMaterial())
  const geometryId = mesh.addGeometry(geometry)
  const byExpressId = new Map()
  for (let id = 1; id <= 3; id++) {
    const instanceId = mesh.addInstance(geometryId)
    const matrix = new THREE.Matrix4().makeTranslation(id * 10, 0, 0)
    mesh.setMatrixAt(instanceId, matrix)
    byExpressId.set(id, [{ geometryId, instanceId, matrix, color: new THREE.Color('white'), colorAlpha: 1, ifcGeometryId: 1 }])
  }
  root.add(mesh)
  root.userData.batch = { mesh, byExpressId, expressIdByInstanceId: new Map([[0, 1], [1, 2], [2, 3]]),
    geometryById: new Map([[geometryId, geometry]]), geometryByIfcId: new Map() }
  mesh.setVisibleAt(0, false)
  root.userData.edgesBatch = buildEdgesBatch(root)
  const entry = root.userData.edgesBatch.entries.get(geometryId)
  const matrixAt = instanceId => {
    const matrix = new THREE.Matrix4()
    entry.mesh.getMatrixAt(entry.localIndexByInstanceId.get(instanceId), matrix)
    return matrix
  }
  return { root, mesh, geometryId, entry, matrixAt }
}

test('outlines disappear when scrubbing backwards and reappear at the current animated position', () => {
  const { root, mesh, geometryId, matrixAt } = fixture()
  assert.equal(matrixAt(0).determinant(), 0, 'not-yet-built element starts hidden')
  mesh.setVisibleAt(1, false)
  syncEdgesBatch(root)
  assert.equal(matrixAt(1).determinant(), 0, 'existing outline disappears on rewind')
  const moved = new THREE.Matrix4().makeTranslation(50, 20, 10)
  setBatchedInstanceMatrix(root, mesh, 0, geometryId, moved)
  assert.equal(matrixAt(0).determinant(), 0, 'moving a hidden element must not reveal its outline')
  mesh.setVisibleAt(0, true)
  syncEdgesBatch(root)
  assert.deepEqual(matrixAt(0).elements, moved.elements, 'show uses live transform, not import transform')
})

test('materializing and removing elements preserve remaining outline visibility', () => {
  const { root, mesh, entry, matrixAt } = fixture()
  ensureMaterialized(root, 1)
  assert.equal(entry.mesh.count, 2)
  mesh.setVisibleAt(2, false)
  syncEdgesBatch(root)
  assert.equal(matrixAt(2).determinant(), 0, 'swap-moved final instance follows its own visibility')
  removeElementsFromModel(root, [2])
  assert.equal(entry.mesh.count, 1)
  mesh.setVisibleAt(2, true)
  syncEdgesBatch(root)
  assert.equal(matrixAt(2).elements[12], 30)
})

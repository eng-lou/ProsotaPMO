import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ stdin: { contents: "export * from './src/modules/fourD/clashGeometry'; export * from './src/modules/fourD/clashMeshCapture'; export * as THREE from 'three'", resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const { computeClashes, captureMeshTriangles, readIfcClashMeshes, THREE } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
function element(key, size, x = 0) {
  const g = new THREE.BoxGeometry(size, size, size); g.translate(x, 0, 0)
  return { key, meshes: [{ positions: Array.from(g.attributes.position.array), indices: Array.from(g.index.array) }] }
}
const run = (a, b, kind = 'hard', mm = 0, units = 1) => computeClashes([a, b], [a.key], [b.key], kind, mm, units)
test('hard clash includes a fully enclosed solid', () => assert.equal(run(element('outer', 4), element('inner', 1)).hits.length, 1))
test('crossing and touching boxes clash, separated boxes do not', () => {
  assert.equal(run(element('a', 2), element('b', 2, 1)).hits.length, 1)
  assert.equal(run(element('a', 2), element('b', 2, 2)).hits.length, 1)
  assert.equal(run(element('a', 2), element('b', 2, 3)).hits.length, 0)
})
test('shared collection members never clash with themselves and reversed pairs deduplicate', () => {
  const a = element('a', 2), b = element('b', 2, 1)
  assert.equal(computeClashes([a], ['a'], ['a'], 'hard', 0).hits.length, 0)
  assert.equal(computeClashes([a, b], ['a', 'b', 'a'], ['b', 'a'], 'hard', 0).hits.length, 1)
})
test('clearance respects measured gap and scene units', () => {
  assert.equal(run(element('a', 1), element('b', 1, 1.01), 'clearance', 5).hits.length, 0)
  const found = run(element('a', 1), element('b', 1, 1.01), 'clearance', 15)
  assert.equal(found.hits.length, 1); assert.ok(Math.abs(found.hits[0].distanceMm - 10) < .001)
  assert.equal(run(element('a', 1000), element('b', 1000, 1010), 'clearance', 5, .001).hits.length, 0)
  assert.equal(run(element('a', 1000), element('b', 1000, 1010), 'clearance', 15, .001).hits.length, 1)
})
test('open surfaces are flagged and not treated as enclosing solids', () => {
  const plane = { key: 'plane', meshes: [{ positions: [-2,-2,0, 2,-2,0, 2,2,0, -2,2,0], indices: [0,1,2,0,2,3] }] }
  const other = element('box', 1, 6)
  const result = run(plane, other)
  assert.equal(result.hits.length, 0); assert.equal(result.warnings.length, 1)
})
test('invalid tolerance is rejected', () => assert.throws(() => run(element('a', 1), element('b', 1), 'clearance', -1)))

test('overlapping bounding boxes do not create a false clearance clash', () => {
  const sphere = (key, x, y) => { const g = new THREE.SphereGeometry(1, 12, 8); g.translate(x, y, 0); return { key, meshes: [{ positions: Array.from(g.attributes.position.array), indices: Array.from(g.index.array) }] } }
  assert.equal(run(sphere('a', 0, 0), sphere('b', 1.6, 1.6), 'clearance', 50).hits.length, 0)
})


test('capture ignores unused invalid vertices and trailing non-triangle capacity', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, NaN,NaN,NaN], 3))
  const result = captureMeshTriangles(new THREE.Mesh(geometry), 'wall')
  assert.deepEqual(result.indices, [0,1,2])
  assert.equal(result.positions.length, 9)
  geometry.setIndex([0,1,2,3,3,3]); geometry.setDrawRange(0, 3)
  assert.deepEqual(captureMeshTriangles(new THREE.Mesh(geometry), 'wall'), result)
  geometry.setDrawRange(0, 6)
  assert.throws(() => captureMeshTriangles(new THREE.Mesh(geometry), 'wall'), /Invalid referenced vertex/)
})

test('batched IFC capture preserves zero-scale matrices and all geometry pieces without materialization', () => {
  const root = new THREE.Group(); root.position.set(10, 0, 0)
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const batchMesh = new THREE.BatchedMesh(2, 48, 72, new THREE.MeshBasicMaterial())
  root.add(batchMesh)
  const geometryId = batchMesh.addGeometry(geometry)
  const first = batchMesh.addInstance(geometryId), second = batchMesh.addInstance(geometryId)
  const collapsed = new THREE.Matrix4().makeScale(0, 1, 1)
  collapsed.setPosition(2, 0, 0)
  batchMesh.setMatrixAt(first, collapsed)
  batchMesh.setMatrixAt(second, new THREE.Matrix4().makeTranslation(5, 0, 0))
  batchMesh.setVisibleAt(second, false)
  root.userData.batch = { mesh: batchMesh, geometryById: new Map([[geometryId, geometry]]), byExpressId: new Map([[42, [first, second].map(instanceId => ({ geometryId, instanceId, colorAlpha: 1 }))]]) }
  const meshes = readIfcClashMeshes(root, 42)
  assert.equal(meshes.length, 2)
  assert.equal(root.children.length, 1)
  assert.equal(meshes[1].visible, false)
  const captured = meshes.map(mesh => captureMeshTriangles(mesh, 'wall'))
  assert.ok(captured.every(g => g.positions.every(Number.isFinite)))
  assert.equal(captured[0].positions[0], 12)
  assert.ok(captured[1].positions[0] >= 14.5)
  // The former materialization path cannot represent this matrix as TRS.
  const oldMesh = new THREE.Mesh(geometry); oldMesh.applyMatrix4(collapsed); oldMesh.updateMatrixWorld()
  assert.ok(oldMesh.matrixWorld.elements.some(v => !Number.isFinite(v)))
})

test('capture rejects out-of-range indices rather than reporting incomplete geometry as clean', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setIndex([0,1,9999])
  assert.throws(() => captureMeshTriangles(new THREE.Mesh(geometry), 'wall'), /Invalid triangle index/)
})

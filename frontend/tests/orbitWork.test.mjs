import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const { outputFiles } = await build({ stdin: { contents: `
export * as THREE from 'three';
export * from './src/modules/fourD/elementBatching';
export * from './src/modules/fourD/movingDetail';
export * from './src/modules/fourD/viewportVisibility';
export * from './src/modules/fourD/realisticMaterials';
export * from './src/modules/fourD/batchRevision';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' })
const m = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
const { THREE } = m

function fixture(count = 3) {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry()
  const mesh = new THREE.BatchedMesh(count, 100, 200, new THREE.MeshStandardMaterial())
  const geometryId = mesh.addGeometry(geometry), byExpressId = new Map(), expressIdByInstanceId = new Map()
  for (let i = 0; i < count; i++) {
    const instanceId = mesh.addInstance(geometryId)
    const matrix = new THREE.Matrix4().makeTranslation(i % 200, 0, Math.floor(i / 200))
    mesh.setMatrixAt(instanceId, matrix); mesh.setColorAt(instanceId, new THREE.Color('white'))
    byExpressId.set(i + 1, [{ instanceId, geometryId, ifcGeometryId: 1, matrix, color: new THREE.Color('white'), colorAlpha: 1 }])
    expressIdByInstanceId.set(instanceId, i + 1)
  }
  root.add(mesh)
  const batch = { mesh, byExpressId, expressIdByInstanceId, geometryById: new Map([[geometryId, geometry]]), geometryByIfcId: new Map() }
  root.userData.batch = batch
  return { root, mesh, batch }
}

test('individual animated IFC pieces obey orbit simplification without losing schedule or manual visibility', () => {
  const { root, mesh } = fixture()
  const first = m.ensureMaterialized(root, 1), second = m.ensureMaterialized(root, 2)
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 10000)
  camera.position.set(0, 0, 500)
  root.updateMatrixWorld(true)
  assert.equal(m.hideSmallWhileMoving(root, camera, 1000), 3)
  assert.equal(first.visible, false)
  m.updateMeshVisibility(first, true)
  assert.equal(first.visible, false, 'playback must not undo temporary orbit hiding')
  m.updateMeshVisibility(first, false)
  second.userData.baseVisible = false
  m.updateInstanceVisibility(mesh, 2, false)
  m.restoreAfterMoving(root)
  assert.equal(first.visible, false, 'removed on the timeline during the drag stays removed')
  assert.equal(second.visible, false, 'manually hidden during the drag stays hidden')
  assert.equal(mesh.getVisibleAt(2), false)
  m.updateMeshVisibility(first, true)
  assert.equal(first.visible, true, 'reverse scrubbing restores the element')
  second.userData.baseVisible = true; m.updateMeshVisibility(second)
  m.updateInstanceVisibility(mesh, 2, true)
  assert.equal(second.visible, true)
  assert.equal(mesh.getVisibleAt(2), true)
  assert.equal(m.hideSmallWhileMoving(root, camera, 1000), 3)
  m.restoreAfterMoving(root)
  assert.equal(first.visible, true)
  assert.equal(second.visible, true)
})

test('nearby individual geometry remains visible while orbiting, including orthographic views', () => {
  for (const camera of [new THREE.PerspectiveCamera(50, 1, .1, 10000), new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 1000)]) {
    const { root } = fixture()
    const first = m.ensureMaterialized(root, 1)
    camera.position.set(0, 0, 5)
    assert.equal(m.hideSmallWhileMoving(root, camera, 1000), 0)
    assert.equal(first.visible, true)
    m.restoreAfterMoving(root)
  }
})

test('unchanged outlines skip instance scans; visibility changes after rendering still invalidate', () => {
  const { root, mesh } = fixture(1000)
  const edges = root.userData.edgesBatch = m.buildEdgesBatch(root)
  m.syncEdgesBatch(root)
  let iterations = 0
  const values = edges.entries.values.bind(edges.entries)
  edges.entries.values = () => { iterations++; return values() }
  for (let i = 0; i < 120; i++) m.syncEdgesBatch(root)
  assert.equal(iterations, 0)
  mesh.setVisibleAt(0, false)
  mesh._visibilityChanged = false // Three's renderer has already consumed it.
  m.syncEdgesBatch(root)
  assert.equal(iterations, 1)
  assert.equal([...edges.entries.values()][0].shown[0], false)
  mesh.setVisibleAt(0, true); m.syncEdgesBatch(root)
  assert.equal([...edges.entries.values()][0].shown[0], true)
})

test('surface batch reuse preserves visibility, transforms, alpha and clipping without idle uploads', () => {
  const { batch, mesh } = fixture()
  const info = { entries: new Map(), keyByPiece: new Map([['1:1', 'pane'], ['2:1', 'pane'], ['3:1', 'wall']]), keyByExpressId: new Map() }
  const mapping = { pane: 'glass', wall: 'concrete' }
  m.applyRealisticToBatch(batch, mesh.material, info, mapping, false, false, false)
  m.syncRealisticGlassBatch(batch)
  const surface = mesh.userData.realistic.glass
  const version = surface.mesh._colorsTexture.version
  let reads = 0
  const data = mesh._drawInfo
  mesh._drawInfo = new Proxy(data, { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return target[key] } })
  for (let i = 0; i < 120; i++) m.syncRealisticGlassBatch(batch)
  assert.equal(reads, 0, 'paused orbit must not inspect every glass instance')
  assert.equal(surface.mesh._colorsTexture.version, version)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 2)
  mesh.material.clippingPlanes = [plane]; mesh.visible = false
  m.syncRealisticGlassBatch(batch)
  assert.equal(surface.mesh.visible, false)
  assert.equal(surface.mesh.material.clippingPlanes[0], plane)
  mesh.visible = true; mesh.setVisibleAt(0, false)
  m.syncRealisticGlassBatch(batch)
  assert.equal(surface.mesh.getVisibleAt(surface.localIds[0]), false)
  mesh.setVisibleAt(0, true)
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(13, 2, 8))
  mesh.setColorAt(0, new THREE.Color('red'))
  m.syncRealisticGlassBatch(batch)
  const matrix = new THREE.Matrix4(); surface.mesh.getMatrixAt(surface.localIds[0], matrix)
  assert.equal(matrix.elements[12], 13)
  assert.equal(surface.mesh.getVisibleAt(surface.localIds[0]), true)
  m.applyRealisticToBatch(batch, mesh.material, info, { ...mapping, 'opacity:pane': '0' }, false, false, false)
  m.syncRealisticGlassBatch(batch)
  assert.equal(mesh.userData.realistic.glass.mesh.getVisibleAt(0), false)
  m.clearRealisticFromBatch(batch)
})

test('visibility revisions are independent per batch and detect deletion and slot reuse', () => {
  const a = fixture(), b = fixture()
  const before = m.batchContentKey(a.mesh), other = m.batchContentKey(b.mesh)
  a.mesh.setVisibleAt(0, true)
  assert.equal(m.batchContentKey(a.mesh), before)
  a.mesh.deleteInstance(0)
  assert.notEqual(m.batchContentKey(a.mesh), before)
  const deleted = m.batchContentKey(a.mesh)
  a.mesh.addInstance(0)
  assert.notEqual(m.batchContentKey(a.mesh), deleted)
  assert.equal(m.batchContentKey(b.mesh), other)
})

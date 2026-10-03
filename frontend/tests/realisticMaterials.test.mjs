import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import * as THREE from 'three'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/modules/fourD/realisticMaterials.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const m = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text + '\n//# sourceURL=realistic-materials-tests.mjs').toString('base64')}`)

test('legacy mappings retain class IDs and default texture transform', () => {
  assert.equal(m.classIndexForKey('wall', undefined, { wall: 'concrete' }), 1)
  assert.equal(m.classIndexForKey('frame', undefined, { frame: 'metal' }), 3)
  assert.equal(m.classIndexForKey('pane', undefined, { pane: 'glass' }), m.GLASS_CLASS)
  assert.deepEqual(m.textureSettingsForKey('wall', { wall: 'concrete' }), { scale: 1, rotation: 0 })
  assert.equal(m.classIndexForKey('wall', undefined, { wall: 'unknown' }), 0)
})

test('texture transforms survive serialization and malformed values fall back safely', () => {
  const map = m.withTextureSettings({ wall: 'brick' }, 'wall', { scale: 2, rotation: 90 })
  assert.deepEqual(m.textureSettingsForKey('wall', JSON.parse(JSON.stringify(map))), { scale: 2, rotation: 90 })
  for (const bad of ['oops', 'null', '{"scale":0,"rotation":17}']) {
    assert.deepEqual(m.textureSettingsForKey('wall', { 'texture:wall': bad }), { scale: 1, rotation: 0 })
  }
  assert.deepEqual(m.withTextureSettings(map, 'wall', { scale: 1, rotation: 0 }), { wall: 'brick' })
})

test('reset removes only the selected material overrides', () => {
  let map = m.withTextureSettings({ wall: 'render', frame: 'painted-metal' }, 'wall', { scale: 0.5, rotation: 270 })
  map = m.withColourOverride(map, 'wall', '#abcdef')
  assert.deepEqual(m.resetRealisticEntry(map, 'wall'), { frame: 'painted-metal' })
  assert.equal(map.wall, 'render')
})

test('new finish classes keep imported colour and report scaled repeats', () => {
  for (const finish of ['render', 'painted-metal']) {
    const index = m.classIndexForKey('surface', undefined, { surface: finish })
    assert.ok(index > 11)
    assert.equal(m.classReplacesColour(index), false)
  }
  assert.deepEqual(m.realisticTileSize('brick', 2), [0.9, 0.6])
})

test('batched transforms preserve glass geometry and use the same settings as individual meshes', () => {
  const source = new THREE.MeshStandardMaterial()
  const geometry = new THREE.BoxGeometry()
  const mesh = new THREE.BatchedMesh(2, 100, 200, source)
  mesh.userData.standardMaterial = source
  const root = new THREE.Group()
  root.add(mesh)
  const geometryId = mesh.addGeometry(geometry)
  const instances = [mesh.addInstance(geometryId), mesh.addInstance(geometryId)]
  const batch = { mesh, byExpressId: new Map(instances.map((instanceId, i) => [i + 1, [{ instanceId, geometryId,
    ifcGeometryId: 1, matrix: new THREE.Matrix4(), color: new THREE.Color('white'), colorAlpha: 1 }]])),
    geometryById: new Map([[geometryId, geometry]]) }
  const info = { entries: new Map(), keyByPiece: new Map([['1:1', 'wall'], ['2:1', 'pane']]), keyByExpressId: new Map() }
  const initial = { wall: 'brick', pane: 'glass' }
  m.applyRealisticToBatch(batch, source, info, initial, false, false, false)
  const glass = mesh.userData.realistic.glass
  assert.ok(glass)
  const next = m.withTextureSettings(initial, 'wall', { scale: 2, rotation: 90 })
  m.applyRealisticToBatch(batch, source, info, next, false, false, false)
  assert.equal(mesh.userData.realistic.glass, glass)
  assert.deepEqual(Array.from(mesh.userData.realistic.classTexture.image.data.slice(0, 4)), [5, 3, 1, 0])
  const individual = m.getRealisticVariant(source, 5, undefined, false, 1, null, m.textureSettingsForKey('wall', next))
  assert.deepEqual(individual.userData.realisticUniforms.realTransform.value.toArray(), [2, 1])
  m.applyRealisticToBatch(batch, source, info, next, true, false, false)
  assert.deepEqual(Array.from(mesh.userData.realistic.classes), [0, 0])
  assert.equal(mesh.userData.realistic.glass, null)
  m.clearRealisticFromBatch(batch)
  m.disposeRealisticVariant(source)
  mesh.dispose()
  geometry.dispose()
  source.dispose()
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import * as THREE from 'three'

const { outputFiles } = await build({
  stdin: { contents: "export * from './realisticMaterials'; export * from './materialScope'; export { adjustSelectedTextures } from './customTextures'",
    resolveDir: fileURLToPath(new URL('../src/modules/fourD/', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const m = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text + '\n//# sourceURL=realistic-materials-tests.mjs').toString('base64')}`)

test('moquette uses its own matte atlas layer and retains saved mapping transforms', () => {
  const mapping = JSON.parse(JSON.stringify(m.withTextureSettings({ lawn: 'moquette' }, 'lawn', { scale: 2, rotation: 90 })))
  const index = m.classIndexForKey('lawn', undefined, mapping)
  assert.equal(index, 15)
  assert.equal(m.classIndexForKey('water', undefined, { water: 'water' }), 14)
  assert.deepEqual(m.textureSettingsForKey('lawn', mapping), { scale: 2, rotation: 90 })
  const source = new THREE.MeshStandardMaterial()
  const material = m.getRealisticVariant(source, index)
  const uniforms = material.userData.realisticUniforms
  const params = uniforms.realParams.value.image
  assert.equal(params.data[index * 4 + 2], 11)
  assert.ok(params.data[(params.width + index) * 4] >= 0.9)
  const atlas = uniforms.realTex.value.image
  assert.equal(atlas.depth, 15 + m.GROUND_FINISHES.length)
  assert.equal(atlas.data.length, 256 * 256 * 4 * atlas.depth)
  const checked = m.getRealisticVariant(source, m.classIndexForKey('lawn', undefined, { lawn: 'moquette-checkered' }))
  assert.equal(checked.userData.realisticUniforms.realParams.value.image.data[19 * 4 + 2], 11)
  m.disposeRealisticVariant(source); source.dispose()
})

test('legacy mappings retain class IDs and default texture transform', () => {
  assert.equal(m.classIndexForKey('wall', undefined, { wall: 'concrete' }), 1)
  assert.equal(m.classIndexForKey('frame', undefined, { frame: 'metal' }), 3)
  assert.equal(m.classIndexForKey('pane', undefined, { pane: 'glass' }), m.GLASS_CLASS)
  assert.deepEqual(m.textureSettingsForKey('wall', { wall: 'concrete' }), { scale: 1, rotation: 0 })
  assert.equal(m.classIndexForKey('wall', undefined, { wall: 'unknown' }), 0)
})

test('one camera guide can be filled, hidden and reset independently of another camera and its housing', () => {
  const info = m.createRealisticModelInfo()
  for (const id of [11, 12]) {
    for (const [geometry, style, alpha] of [[1, 'Field of View', 0.2], [2, 'Housing', 1]]) {
      m.addRealisticPiece(info, id, geometry, {styleName: style, materialNames: ['Field of View', 'Housing'],
        layered: false, ifcType: 'IFCBUILDINGELEMENTPROXY', transparent: alpha < 1, sourceOpacity: alpha})
    }
  }
  const cone = info.keyByPiece.get('11:1'), housing = info.keyByPiece.get('11:2')
  const target = ['file', 'element:11']
  const change = {['guide:' + cone]: 'surface', ['opacity:' + cone]: '0'}
  const saved = JSON.parse(JSON.stringify(m.editMaterialFields({}, [target], change)))
  const local = m.mappingAtTarget(saved, target), peer = m.mappingAtTarget(saved, ['file', 'element:12'])
  assert.equal(m.outlineForKey(cone, info, local), false)
  assert.equal(m.opacityForKey(cone, local), 0)
  assert.equal(m.outlineForKey(housing, info, local), false)
  assert.equal(m.opacityForKey(housing, local), undefined)
  assert.equal(m.outlineForKey(cone, info, peer), true)
  const reset = m.editMaterialFields(saved, [target], change, true)
  assert.equal(m.outlineForKey(cone, info, m.mappingAtTarget(reset, target)), true)
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


test('two IFC walls sharing a finish keep independent batch and mesh appearances after reload', () => {
  const owner = 'fort-tower-file'
  const target = [owner, 'element:1']
  const defaults = { wall: 'metal' }
  const saved = m.editMaterialFields(defaults, [target], {
    wall: 'brick', 'colour:wall': '#bb7010', 'texture:wall': JSON.stringify({ scale: 2, rotation: 90 }),
  })
  const restored = JSON.parse(JSON.stringify(saved))
  const local = m.materialScope(restored, owner)
  const otherFile = m.materialScope(restored, 'another-file')
  const info = { entries: new Map(), keyByPiece: new Map([['1:1','wall'], ['2:1','wall']]), keyByExpressId: new Map() }
  const mat = new THREE.MeshStandardMaterial()
  const geo = new THREE.BoxGeometry()
  const mesh = new THREE.BatchedMesh(2, 100, 200, mat)
  const geometryId = mesh.addGeometry(geo)
  const batch = { mesh, byExpressId: new Map(), geometryById: new Map([[geometryId, geo]]) }
  for (const id of [1, 2]) {
    batch.byExpressId.set(id, [{ instanceId: mesh.addInstance(geometryId), geometryId, ifcGeometryId: 1 }])
    const piece = new THREE.Mesh(geo, mat)
    piece.userData = {expressID: id, ifcGeometryId: 1}
    assert.equal(m.classIndexForMesh(piece, mat, info, local), id === 1 ? 5 : 3)
    assert.equal(m.classIndexForMesh(piece, mat, info, otherFile), 3)
    assert.equal(m.colourOverrideForMesh(piece, mat, info, local)?.getHexString() ?? null, id === 1 ? 'bb7010' : null)
  }
  m.applyRealisticToBatch(batch, mat, info, local, false, false, false)
  assert.deepEqual([...mesh.userData.realistic.classTexture.image.data.slice(0,8)], [5,3,1,0,3,2,0,0])
  assert.equal(mesh.userData.realisticInstanceColours[0].getHexString(), 'bb7010')
  assert.equal(mesh.userData.realisticInstanceColours[1], undefined)
  const reset = m.editMaterialFields(restored, [target], {wall:null, 'colour:wall':null, 'texture:wall':null}, true)
  assert.deepEqual(reset, defaults)
  mesh.dispose(); mat.dispose(); geo.dispose()
})

test('two placed copies retain their own settings when a shared texture is edited', () => {
  const original = {map:{name:'tool.png', dataUri:'data:image', texture:new THREE.Texture()}}
  const next = m.adjustSelectedTextures({a:original, b:original}, ['b'], {rotation:Math.PI / 2})
  assert.equal(next.a.map.texture.rotation, 0)
  assert.equal(next.b.map.texture.rotation, Math.PI / 2)
  assert.equal(next.b.map.texture.source, next.a.map.texture.source)
  const key = 'site|asset-id|0'
  const map = m.editMaterialFields({[key]:'metal'}, [['site:b']], {[key]:'brick'})
  assert.equal(m.materialScope(map,'site:a')[key], 'metal')
  assert.equal(m.materialScope(map,'site:b')[key], 'brick')
})

test('temporary ground finishes have distinct repeatable texture layers and support scoped scale and tint', () => {
  const source = new THREE.MeshStandardMaterial()
  const layers = new Set()
  for (const finish of m.GROUND_FINISHES) {
    const index = m.classIndexForKey('pad', undefined, {pad:finish})
    assert.ok(index > 19 && m.classReplacesColour(index))
    const uniforms = m.getRealisticVariant(source, index).userData.realisticUniforms
    const layer = uniforms.realParams.value.image.data[index * 4 + 2]
    const atlas = uniforms.realTex.value.image
    assert.ok(layer >= 15 && layer < atlas.depth)
    const offset = layer * atlas.width * atlas.height * 4
    const sample = atlas.data.subarray(offset, offset + atlas.width * atlas.height * 4)
    assert.ok(new Set(sample.filter((_,i) => i % 4 === 0)).size > 10)
    layers.add(layer)
    assert.deepEqual(m.realisticTileSize(finish, 4), m.realisticTileSize(finish, 1).map(v=>v*4))
  }
  assert.equal(layers.size, 6)
  m.disposeRealisticVariant(source)
  source.dispose()
})

test('haul-road detail does not bake continuous parallel bands across an IFC road', () => {
  const source = new THREE.MeshStandardMaterial()
  const cls = m.classIndexForKey('road', undefined, { road: 'haul-road' })
  const { realTex, realParams } = m.getRealisticVariant(source, cls).userData.realisticUniforms
  const { data, width, height } = realTex.value.image
  const layer = realParams.value.image.data[cls * 4 + 2]
  const columns = new Float64Array(width)
  const rows = new Float64Array(height)
  let sum = 0, sumSquares = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tone = data[((layer * height + y) * width + x) * 4]
      columns[x] += tone / height
      rows[y] += tone / width
      sum += tone
      sumSquares += tone * tone
    }
  }
  const mean = sum / (width * height)
  const variance = sumSquares / (width * height) - mean * mean
  assert.ok(variance > 0)
  for (const means of [rows, columns]) {
    const bandVariance = means.reduce((n, value) => n + (value - mean) ** 2, 0) / means.length
    assert.ok(bandVariance < variance * .12, 'full-width bands dominate the ground detail')
  }
  m.disposeRealisticVariant(source)
  source.dispose()
})

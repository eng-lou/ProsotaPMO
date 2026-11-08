import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { IFCWALL, IFCSPACE, IFCANNOTATION, IFCCARTESIANPOINT, IFCSTYLEDITEM,
  IFCFACEBASEDSURFACEMODEL, IFCRELASSOCIATESMATERIAL, IFCRELDEFINESBYTYPE } = require('web-ifc')
const filename = fileURLToPath(new URL('./ifcMaterialExtraction.bundle.cjs', import.meta.url))
const { outputFiles } = await build({
  stdin: {
    contents: "export { getTypeCounts, getExpressIdsForType, buildIfcTypeByExpressId, extractRealisticMaterialInfo } from './ifcModel';",
    resolveDir: fileURLToPath(new URL('../src/modules/fourD/', import.meta.url)),
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['web-ifc'],
})
const compiled = new Module(filename)
compiled.filename = filename
compiled.paths = Module._nodeModulePaths(path.dirname(filename))
compiled._compile(outputFiles[0].text, filename)
const { getTypeCounts, getExpressIdsForType, buildIfcTypeByExpressId, extractRealisticMaterialInfo } = compiled.exports

const vector = values => ({ size: () => values.length, get: index => values[index] })
const ref = value => ({ value })

function fixture() {
  const scans = []
  const lines = new Map([
    [1001, { Item: ref(101), Styles: [ref(2001)] }],
    [2001, { Styles: [ref(2002)] }],
    [2002, { Side: 'BOTH', Name: ref('Glazing') }],
    [3001, { RelatedObjects: [ref(10)], RelatingMaterial: ref(4001) }],
    [3002, { RelatedObjects: [ref(5001)], RelatingMaterial: ref(4002) }],
    [4001, { Name: ref('Concrete') }],
    [4002, { ForLayerSet: ref(4003) }],
    [4003, { MaterialLayers: [ref(4004), ref(4005)] }],
    [4004, { Material: ref(4006) }],
    [4005, { Material: ref(4007) }],
    [4006, { Name: ref('Brick') }],
    [4007, { Name: ref('Insulation') }],
    [6001, { RelatedObjects: [ref(10), ref(20)], RelatingType: ref(5001) }],
  ])
  const ids = new Map([
    [IFCWALL, [10, 20]], [IFCSTYLEDITEM, [1001]],
    [IFCRELASSOCIATESMATERIAL, [3001, 3002]], [IFCRELDEFINESBYTYPE, [6001]],
  ])
  const api = {
    GetIfcEntityList(modelID) {
      assert.equal(modelID, 0)
      return [IFCWALL, IFCCARTESIANPOINT, IFCSPACE, IFCANNOTATION]
    },
    IsIfcElement: type => type === IFCWALL,
    GetLineIDsWithType(modelID, type) {
      assert.equal(modelID, 0, 'use the native IFC handle, not the application model ID')
      assert.notEqual(type, IFCCARTESIANPOINT, 'geometry records must never be indexed')
      scans.push(type)
      return vector(ids.get(type) ?? [])
    },
    GetLine(modelID, id) { assert.equal(modelID, 0); return lines.get(id) },
    GetLineType(modelID, id) { assert.equal(modelID, 0); return id === 30 ? IFCSPACE : IFCANNOTATION },
    GetNameFromTypeCode: type => type === IFCWALL ? 'IFCWALL' : type === IFCSPACE ? 'IFCSPACE' : 'IFCANNOTATION',
  }
  const handle = {
    modelID: 42, ifcModelID: 0, api,
    batch: { byExpressId: new Map([
      [10, [{ ifcGeometryId: 101, colorAlpha: 0.4 }]],
      [30, [{ ifcGeometryId: 103, colorAlpha: 1 }]],
    ]) },
    // Selection materialises pieces out of the batch. They still need mapping.
    object: { userData: { expressIdMeshIndex: new Map([
      [20, [{ userData: { ifcGeometryId: 102, ifcColorAlpha: 1 } }]],
      [40, [{ userData: { ifcGeometryId: 104 } }]],
    ]) } },
  }
  return { handle, scans, ids, lines }
}

test('a camera field of view inherits its wrapper style; a directly styled housing keeps its own finish', () => {
  const {handle, ids, lines} = fixture()
  ids.set(IFCFACEBASEDSURFACEMODEL, [120])
  ids.set(IFCSTYLEDITEM, [1001, 1002])
  lines.set(120, {FbsmFaces: [ref(101), ref(103)]})
  lines.set(1002, {Item: ref(120), Styles: [ref(2010)]})
  lines.set(2010, {Side: 'BOTH', Name: ref('Air - Vivotek - Field of View')})
  handle.batch.byExpressId.get(30)[0].colorAlpha = 0.2
  const info = extractRealisticMaterialInfo(handle)
  const cone = info.entries.get(info.keyByPiece.get('30:103'))
  const housing = info.entries.get(info.keyByPiece.get('10:101'))
  assert.equal(cone.volumeGuide, true)
  assert.equal(cone.sourceOpacity, 0.2)
  assert.equal(housing.label, 'Glazing')
  assert.equal(housing.volumeGuide, false)
})

test('type lookup indexes elements and rendered non-elements without enumerating geometry', () => {
  const { handle, scans } = fixture()
  assert.deepEqual(getTypeCounts(handle)[0], { typeName: 'IFCWALL', count: 2 })
  assert.deepEqual(getExpressIdsForType(handle, 'IFCWALL'), [10, 20])
  assert.deepEqual([...buildIfcTypeByExpressId(handle)], [
    [10, 'IFCWALL'], [20, 'IFCWALL'], [30, 'IFCSPACE'], [40, 'IFCANNOTATION'],
  ])
  assert.deepEqual(scans, [IFCWALL])
  buildIfcTypeByExpressId(handle)
  assert.deepEqual(scans, [IFCWALL], 'repeat lookup uses the per-handle cache')
})

test('material mapping includes styles, direct overrides, inherited layers and selected meshes', () => {
  const { handle } = fixture()
  const info = extractRealisticMaterialInfo(handle)
  assert.equal(info.keyByExpressId.size, 4)
  assert.equal(info.keyByPiece.size, 4)
  const entry = id => info.entries.get(info.keyByExpressId.get(id))
  assert.equal(entry(10).label, 'Glazing')
  assert.match(entry(10).detail, /Concrete/)
  assert.match(entry(10).detail, /transparent in IFC/)
  assert.doesNotMatch(entry(10).detail, /Brick/, 'direct material overrides the type material')
  assert.equal(entry(20).label, 'Brick')
  assert.match(entry(20).detail, /Layers: Brick \/ Insulation/)
  assert.match(entry(30).label, /Space.*no material/)
  assert.match(entry(40).label, /Annotation.*no material/)
  // A saved model reopened with the same native ID must get a fresh lookup.
  const reload = fixture()
  reload.ids.set(IFCWALL, [50])
  reload.handle.batch.byExpressId.clear()
  reload.handle.object.userData.expressIdMeshIndex.clear()
  const reloadedTypes = buildIfcTypeByExpressId(reload.handle)
  assert.equal(reloadedTypes.get(50), 'IFCWALL')
  assert.equal(reloadedTypes.has(20), false)
})

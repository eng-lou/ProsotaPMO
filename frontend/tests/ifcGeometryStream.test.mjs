import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const { outputFiles } = await build({
  stdin: {
    contents: "export * from './ifcGeometryStream'; export { ensureMaterialized } from './elementBatching'; export { BufferGeometry, Matrix4, Vector3 } from 'three';",
    resolveDir: fileURLToPath(new URL('../src/modules/fourD/', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const { buildIfcScene, ensureMaterialized, BufferGeometry, Matrix4, Vector3 } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

function fixture({ fail = false } = {}) {
  let active = false, deleted = 0, reads = 0
  const vertices = new Float32Array([0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1])
  const indices = new Uint32Array([0, 1, 2])
  const placement = (id, x, mirror = false) => ({
    geometryExpressID: id,
    flatTransformation: new Matrix4().makeScale(mirror ? -1 : 1, 1, 1).setPosition(x, 20, 30).elements,
    color: { x: 0.2, y: 0.4, z: 0.6, w: 0.5 },
  })
  const emit = (callback, id, parts) => {
    active = true
    callback({ expressID: id, geometries: { size: () => parts.length, get: i => parts[i] } })
    active = false
    // Native placements and geometry cease to be usable after each callback.
    for (const part of parts) { part.flatTransformation.fill(NaN); part.color.x = NaN }
  }
  const api = {
    StreamAllMeshes(_id, callback) {
      emit(callback, 10, [placement(100, 1000), placement(101, 1002)])
      if (fail) throw Error('stream interrupted')
      emit(callback, 20, [placement(100, 1010)])
      emit(callback, 30, [placement(100, 1020, true)])
      emit(callback, 40, [placement(102, 99999)])
    },
    GetLineType: (_id, expressID) => expressID,
    GetNameFromTypeCode: type => type === 40 ? 'IFCSTYLEDITEM' : 'IFCWALL',
    GetGeometry() {
      assert.ok(active, 'must extract native geometry inside the callback')
      reads++
      return { GetVertexData: () => 0, GetVertexDataSize: () => vertices.length,
        GetIndexData: () => 0, GetIndexDataSize: () => indices.length, delete: () => deleted++ }
    },
    GetVertexArray: () => vertices.slice(), GetIndexArray: () => indices.slice(),
  }
  return { api, stats: () => ({ reads, deleted }) }
}

test('streamed multipart, repeated and mirrored elements retain geometry, identity and editable materials', () => {
  const f = fixture()
  const { object, batch, recenterOffset } = buildIfcScene(f.api, 0, 'test.ifc', null)
  assert.deepEqual(f.stats(), { reads: 2, deleted: 2 })
  assert.equal(batch.geometryByIfcId.size, 2)
  assert.equal(batch.byExpressId.get(10).length, 2)
  assert.equal(batch.byExpressId.get(20).length, 1)
  assert.equal(batch.byExpressId.has(40), false)
  assert.deepEqual(recenterOffset.toArray(), [1008, 20, 30])
  const piece = batch.byExpressId.get(10)[0]
  assert.deepEqual(piece.matrix.elements.slice(12, 15), [-8, 0, 0])
  assert.deepEqual(piece.color.toArray(), [0.2, 0.4, 0.6])
  assert.equal(piece.colorAlpha, 0.5)
  assert.equal(batch.expressIdByInstanceId.get(piece.instanceId), 10)
  const cached = batch.geometryByIfcId.get(100).geometry
  assert.deepEqual([...cached.attributes.position.array], [0, 0, 0, 2, 0, 0, 0, 2, 0])
  assert.deepEqual([...cached.attributes.uv.array], [0, 0, 2, 0, 0, 2])
  const mirror = object.children.find(child => child.userData.expressID === 30)
  assert.ok(mirror)
  assert.ok(mirror.matrix.determinant() < 0)
  assert.notEqual(mirror.geometry, cached)
  assert.equal(mirror.userData.ifcColorAlpha, 0.5)
  ensureMaterialized(object, 10)
  assert.equal(object.children.filter(child => child.userData.expressID === 10).length, 2)
  assert.equal(batch.byExpressId.has(10), false)
})

test('federated models reuse the shared coordinate origin', () => {
  const shared = new Vector3(500, 10, 20)
  const { batch, recenterOffset } = buildIfcScene(fixture().api, 0, 'second.ifc', shared)
  assert.equal(recenterOffset, shared)
  assert.deepEqual(batch.byExpressId.get(10)[0].matrix.elements.slice(12, 15), [500, 10, 10])
})

test('a failed stream disposes already extracted geometry and native handles', () => {
  const f = fixture({ fail: true })
  const original = BufferGeometry.prototype.dispose
  let disposed = 0
  BufferGeometry.prototype.dispose = function () { disposed++; original.call(this) }
  try { assert.throws(() => buildIfcScene(f.api, 0, 'bad.ifc', null), /stream interrupted/) }
  finally { BufferGeometry.prototype.dispose = original }
  assert.equal(disposed, 2)
  assert.deepEqual(f.stats(), { reads: 2, deleted: 2 })
})

test('real IFC streaming matches native geometry and leaves IFC properties readable', async () => {
  const require = createRequire(import.meta.url)
  const { IfcAPI } = require(fileURLToPath(new URL('../node_modules/web-ifc/web-ifc-api-node.js', import.meta.url)))
  const api = new IfcAPI()
  await api.Init()
  const id = api.OpenModel(new Uint8Array(readFileSync(new URL('../../desktop/tests/fixtures/wall.ifc', import.meta.url))))
  try {
    const all = api.LoadAllGeometry(id)
    const expected = []
    for (let i = 0; i < all.size(); i++) {
      const flat = all.get(i)
      for (let j = 0; j < flat.geometries.size(); j++) {
        const placed = flat.geometries.get(j), geometry = api.GetGeometry(id, placed.geometryExpressID)
        try {
          expected.push({ expressID: flat.expressID, id: placed.geometryExpressID,
            matrix: Array.from(placed.flatTransformation),
            vertices: api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize()),
            indices: api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize()) })
        } finally { geometry.delete() }
      }
    }
    const { batch } = buildIfcScene(api, id, 'wall.ifc', new Vector3())
    assert.ok(expected.length > 0)
    assert.equal(batch.expressIdByInstanceId.size, expected.length)
    for (const item of expected) {
      const geometry = batch.geometryByIfcId.get(item.id).geometry
      assert.deepEqual([...geometry.index.array], [...item.indices])
      assert.deepEqual([...geometry.attributes.position.array], [...item.vertices].filter((_v, i) => i % 6 < 3))
      assert.deepEqual(batch.byExpressId.get(item.expressID)[0].matrix.elements, item.matrix)
      assert.ok(api.GetLine(id, item.expressID).GlobalId.value)
    }
  } finally { api.CloseModel(id); api.Dispose() }
})

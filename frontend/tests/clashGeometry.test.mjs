import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ stdin: { contents: "export * from './src/modules/fourD/clashGeometry'; export * as THREE from 'three'", resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const { computeClashes, THREE } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
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

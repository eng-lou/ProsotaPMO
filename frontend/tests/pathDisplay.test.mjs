import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ entryPoints: ['src/modules/fourD/pathDisplay.ts'], bundle: true, write: false, format: 'esm' })
const { showPath } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('viewport and render visibility are independent and do not mutate the bound route', () => {
  const path = Object.freeze({ visible: true, opacity: .5, show_in_viewport: false, show_in_render: true, points: [1, 2] })
  assert.equal(showPath(path, false), false)
  assert.equal(showPath(path, true), true)
  assert.deepEqual(path.points, [1, 2])
  assert.equal(showPath({ ...path, show_in_viewport: true, show_in_render: false }, false), true)
  assert.equal(showPath({ ...path, show_in_render: false }, true), false)
})
test('legacy paths remain visible; master hide and zero opacity hide all route decorations', () => {
  assert.equal(showPath({ visible: true }, false), true)
  assert.equal(showPath({ visible: true }, true), true)
  for (const rendering of [false, true]) {
    assert.equal(showPath({ visible: false }, rendering), false)
    assert.equal(showPath({ visible: true, opacity: 0 }, rendering), false)
  }
})

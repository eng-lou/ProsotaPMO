import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ entryPoints: ['src/modules/fourD/siteSceneTime.ts'], bundle: true, write: false, format: 'esm' })
const { presentAt } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('site presence follows shared dates consistently on forward and backward seek', () => {
  const activity = { start: '2026-10-21T08:00:00Z', finish: '2026-10-21T17:00:00Z' }
  for (const [hour, expected] of [[7,false],[8,true],[12,true],[17,true],[18,false],[12,true],[7,false]]) {
    assert.equal(presentAt(activity, new Date(`2026-10-21T${String(hour).padStart(2,'0')}:00:00Z`)), expected)
  }
  assert.equal(presentAt(undefined, new Date()), false)
  assert.equal(presentAt({ start: null, finish: null }, new Date()), false)
  assert.equal(presentAt(activity, null), false)
})

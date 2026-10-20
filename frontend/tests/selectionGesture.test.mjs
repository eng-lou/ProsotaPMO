import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ entryPoints: ['src/modules/fourD/selectionGesture.ts'], bundle: true, write: false, format: 'esm' })
const { SelectionGesture, sameSelectionHit } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('release after dragging or gizmo use cannot select behind equipment; next click works', () => {
  const gesture = new SelectionGesture()
  gesture.begin(100, 100, 1)
  gesture.move(130, 100, 1)
  gesture.move(100, 100, 1)
  assert.equal(gesture.blocked, true)
  gesture.begin(100, 100, 1)
  assert.equal(gesture.blocked, false)
  gesture.consume()
  assert.equal(gesture.blocked, true)
  gesture.begin(100, 100, 1)
  gesture.move(102, 100, 1)
  assert.equal(gesture.blocked, false)
})
test('holding equipment cannot resolve a different release target or a different batched IFC element', () => {
  assert.equal(sameSelectionHit({ object: 'equipment' }, 'ground'), false)
  assert.equal(sameSelectionHit({ object: 'equipment' }, 'equipment'), true)
  assert.equal(sameSelectionHit({ object: 'ifc', batchId: 1 }, 'ifc', 2), false)
  assert.equal(sameSelectionHit({ object: 'ifc', batchId: 1 }, 'ifc', 1), true)
  assert.equal(sameSelectionHit(null, 'ground'), false)
})

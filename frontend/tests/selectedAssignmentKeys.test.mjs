import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/modules/fourD/selectedAssignmentKeys.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' })
const { selectedAssignmentKeys } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

test('129,065 selected elements with no links perform zero IFC calls', async () => {
  const selected = new Set(Array.from({ length: 129065 }, (_, i) => i + 1))
  const handle = { api: new Proxy({}, { get() { throw new Error('Unexpected IFC access') } }) }
  assert.equal((await selectedAssignmentKeys([], new Set(['model']), selected, [], handle)).size, 0)
})

test('looks up each linked GUID once, preserves mesh links, ignores unselected and missing elements', async () => {
  let calls = 0
  const handle = { ifcModelID: 7, api: { GetExpressIdFromGuid(model, guid) { assert.equal(model, 7); calls++; return { chosen: 2, other: 3 }[guid] } } }
  const links = ['chosen', 'chosen', 'other', 'missing'].map(element_ref => ({ source_kind: 'ifc', element_ref }))
  links.push({ source_kind: 'mesh', element_ref: 'mesh.obj' })
  const keys = await selectedAssignmentKeys(links, new Set(['mesh']), new Set([2]), [{ id: 'mesh', kind: 'mesh', name: 'mesh.obj' }], handle)
  assert.deepEqual([...keys], ['ifc::chosen', 'mesh::mesh.obj'])
  assert.equal(calls, 3)
})

test('large link scans yield and stop when selection changes', async () => {
  const controller = new AbortController()
  let calls = 0
  const handle = { api: { GetExpressIdFromGuid() { calls++; return 1 } } }
  const links = Array.from({ length: 1000 }, (_, i) => ({ source_kind: 'ifc', element_ref: String(i) }))
  const promise = selectedAssignmentKeys(links, new Set(), new Set([1]), [], handle, controller.signal)
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' })
  assert.equal(calls, 128)
})

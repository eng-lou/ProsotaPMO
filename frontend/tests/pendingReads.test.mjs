import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/pendingReads.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
})
const { sharePendingRead } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

test('concurrent widgets share one request, subsequent refresh gets fresh data', async () => {
  let calls = 0
  const read = async () => ++calls
  const first = sharePendingRead('project-A', read)
  assert.equal(sharePendingRead('project-A', read), first)
  assert.equal(await first, 1)
  assert.equal(await sharePendingRead('project-A', read), 2)
  assert.equal(await sharePendingRead('project-B', read), 3)
})

test('failed reads clear pending state and allow retry', async () => {
  const first = sharePendingRead('failure', () => { throw new Error('offline') })
  assert.equal(sharePendingRead('failure', async () => 'unexpected'), first)
  await assert.rejects(first, /offline/)
  assert.equal(await sharePendingRead('failure', async () => 'recovered'), 'recovered')
})

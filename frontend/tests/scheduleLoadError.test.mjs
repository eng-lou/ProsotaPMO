import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/modules/scheduling/scheduleLoadError.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser',
})
const { scheduleLoadError } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

test('identifies the failed collection and HTTP status without exposing query identifiers', () => {
  assert.equal(scheduleLoadError({ isAxiosError: true, config: { url: '/api/v1/activities/?project_id=private' }, response: { status: 500, data: 'Internal Server Error' } }),
    'Could not load activities (HTTP 500). Please retry.')
  assert.equal(scheduleLoadError({ isAxiosError: true, config: { url: '/api/v1/resource-assignments/' }, response: { status: 500 } }),
    'Could not load resource assignments (HTTP 500). Please retry.')
})

test('distinguishes a missing response from an HTTP server error', () => {
  assert.equal(scheduleLoadError({ isAxiosError: true, config: { url: '/api/v1/activities/' } }),
    'Could not load activities: no response from the server. Please retry.')
})

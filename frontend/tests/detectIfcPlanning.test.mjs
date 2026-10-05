import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const {outputFiles} = await build({entryPoints:[fileURLToPath(new URL('../src/modules/fourD/detectIfcPlanning.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'})
const {hasProsotaPlanning} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('ordinary geometry does not offer snapshot restoration', async () => {
  assert.equal(await hasProsotaPlanning(new Blob(["ISO-10303-21; #1=IFCPROJECT('abc');"])), false)
})
test('detects exported planning metadata', async () => {
  assert.equal(await hasProsotaPlanning(new Blob(["#1=IFCPROPERTYSET('id',$,'Prosota_Export',$,(#2));"])), true)
})
test('detects metadata across stream chunks and cancels remaining scan', async () => {
  let cancelled = false
  const chunks = ["#1=IFCPROPERTYSET('id',$,'Pro", "sota_Ex", "port',$,(#2));"]
  const file = {stream: () => new ReadableStream({pull(controller) {
    const chunk = chunks.shift()
    if (chunk) controller.enqueue(new TextEncoder().encode(chunk))
  },cancel() {cancelled = true}})}
  assert.equal(await hasProsotaPlanning(file), true)
  assert.equal(cancelled, true)
})

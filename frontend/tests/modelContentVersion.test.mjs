import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
const { outputFiles } = await build({
  entryPoints: ['src/modules/fourD/modelContentVersion.ts'], bundle: true,
  write: false, platform: 'browser', format: 'esm',
  plugins: [{name: 'mock-api', setup(b) {
    b.onResolve({filter: /^@\/lib\/api$/}, () => ({path:'api',namespace:'mock'}))
    b.onLoad({filter: /.*/, namespace:'mock'}, () => ({contents:'export const api = {get: (...args) => globalThis.versionGet(...args)}'}))
  }}],
})
const {getModelContentVersion} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('version checks share in-flight requests but revalidate subsequent loads', async () => {
  let calls=0, finish
  globalThis.versionGet = (url, config) => {
    calls++; assert.equal(config.timeout,60000)
    return new Promise(resolve => {finish=resolve})
  }
  const first=getModelContentVersion('a'), second=getModelContentVersion('a')
  assert.equal(first,second); assert.equal(calls,1)
  finish({data:{version:'v1'}}); assert.equal(await first,'v1')
  const next=getModelContentVersion('a'); assert.equal(calls,2)
  finish({data:{version:'v2'}}); assert.equal(await next,'v2')
})
test('transient failures retry with bounded backoff; access errors do not retry', async () => {
  const original=globalThis.setTimeout, delays=[]
  globalThis.setTimeout=(fn, ms) => {delays.push(ms); queueMicrotask(fn); return 0}
  try {
    let calls=0
    globalThis.versionGet=async () => {
      if (++calls<3) throw Object.assign(new Error('timeout'),{isAxiosError:true,code:'ECONNABORTED'})
      return {data:{version:'v3'}}
    }
    assert.equal(await getModelContentVersion('retry'),'v3')
    assert.equal(calls,3); assert.deepEqual(delays,[2000,5000])
    calls=0
    globalThis.versionGet=async () => {calls++;throw Object.assign(new Error('forbidden'),{isAxiosError:true,response:{status:403}})}
    await assert.rejects(getModelContentVersion('denied'),/forbidden/); assert.equal(calls,1)
    calls=0
    globalThis.versionGet=async () => {calls++;throw Object.assign(new Error('unavailable'),{isAxiosError:true,response:{status:503}})}
    await assert.rejects(getModelContentVersion('exhausted'),/unavailable/); assert.equal(calls,3)
    globalThis.versionGet=async () => ({data:{version:'recovered'}})
    assert.equal(await getModelContentVersion('exhausted'),'recovered')
  } finally {globalThis.setTimeout=original}
})


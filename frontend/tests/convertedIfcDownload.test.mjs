import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const clients = []
globalThis.__downloadClients = clients
const {outputFiles} = await build({entryPoints:[fileURLToPath(new URL('../src/lib/api.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env.VITE_API_URL':'""'},plugins:[{name:'mock-transport',setup(build) {
  build.onResolve({filter:/^axios$/}, () => ({path:'axios',namespace:'mock'}))
  build.onLoad({filter:/.*/,namespace:'mock'}, () => ({contents:`export default {create() { const client = {get:async()=>{throw new Error('unexpected request')}}; globalThis.__downloadClients.push(client); return client }, isAxiosError(e) {return !!e.isAxiosError}}`}))
}}]})
const {downloadLargeBlob} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('signed download uses isolated transport and retries a dropped connection', async () => {
  let attempts = 0
  const blob = new Blob(['converted IFC'])
  clients[0].get = () => { throw new Error('must not use authenticated client') }
  clients[1].get = async (_url, options) => {
    assert.equal(options.timeout, 0)
    assert.ok(options.signal)
    assert.equal(options.headers, undefined)
    if (++attempts === 1) throw {isAxiosError:true,message:'Network Error'}
    options.onDownloadProgress()
    return {data:blob}
  }
  assert.equal(await downloadLargeBlob('https://storage.example/signed', true), blob)
  assert.equal(attempts, 2)
})
test('ordinary downloads use application client; HTTP 403 is not retried', async () => {
  let attempts = 0
  clients[0].get = async () => { attempts++; throw {isAxiosError:true,response:{status:403}} }
  await assert.rejects(downloadLargeBlob('/api/v1/model3d-files/id/download'))
  assert.equal(attempts, 1)
})

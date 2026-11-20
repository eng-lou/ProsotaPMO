import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
const {outputFiles}=await build({entryPoints:['src/modules/fourD/siteAssetRecovery.ts'],bundle:true,write:false,platform:'browser',format:'esm',plugins:[{name:'loader',setup(b){
 b.onResolve({filter:/^\.\/siteAssets$/},()=>({path:'loader',namespace:'mock'}))
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const loadSiteAsset=(...args)=>globalThis.assetLoad(...args)'}))
}}]})
const {loadSiteAssetWithRecovery}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('retry temporary load failures without selection; preserve separate instance clones',async()=>{
 const original=globalThis.setTimeout,delays=[]
 globalThis.setTimeout=(fn,ms)=>{delays.push(ms);queueMicrotask(fn);return 0}
 try{
  let calls=0
  globalThis.assetLoad=async()=>{if(++calls===1)throw Object.assign(new Error('timeout'),{isAxiosError:true});return {instance:calls}}
  assert.equal((await loadSiteAssetWithRecovery('asset')).instance,2)
  assert.deepEqual(delays,[2000])
  assert.notEqual(await loadSiteAssetWithRecovery('asset'),await loadSiteAssetWithRecovery('asset'))
  calls=0
  globalThis.assetLoad=async()=>{calls++;throw Object.assign(new Error('missing'),{isAxiosError:true,response:{status:404}})}
  await assert.rejects(loadSiteAssetWithRecovery('asset'),/missing/);assert.equal(calls,1)
  calls=0
  globalThis.assetLoad=async()=>{calls++;throw new Error('download stalled - no data received for 60s')}
  await assert.rejects(loadSiteAssetWithRecovery('asset'),/stalled/);assert.equal(calls,3)
  calls=0
  globalThis.assetLoad=async()=>{calls++;throw new Error('Invalid GLB metadata')}
  await assert.rejects(loadSiteAssetWithRecovery('asset'),/Invalid/);assert.equal(calls,1)
 }finally{globalThis.setTimeout=original}
})

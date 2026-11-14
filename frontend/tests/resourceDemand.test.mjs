import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const effects=[]; const calls=[]
globalThis.__resourceTest={effects,calls}
const { outputFiles }=await build({stdin:{contents:"export {useResourcesTabData} from './src/modules/scheduling/useResourcesTabData'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',plugins:[{name:'hook-harness',setup(build){
 build.onResolve({filter:/^react$/},()=>({path:'react',namespace:'harness'}))
 build.onResolve({filter:/(^|\/)api$/},()=>({path:'api',namespace:'harness'}))
 build.onLoad({filter:/.*/,namespace:'harness'},({path})=>({contents:path==='react'?`export const useMemo=f=>f(); export const useCallback=f=>f; export const useState=v=>[typeof v==='function'?v():v,()=>{}]; export const useEffect=f=>globalThis.__resourceTest.effects.push(f);`:`export const api={post:async(...args)=>{globalThis.__resourceTest.calls.push(args);return {data:{spreads:{}}}},get:async()=>({data:{}})};`}))
}}]})
const {useResourcesTabData}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('hidden resource panels do no spread work; opening loads and closing cancels',async()=>{
 const resources=[{id:'r',resource_type:'labour'}]
 const assignments=[{id:'x',resource_id:'r',activity_id:'a'}]
 const activities=[{id:'a',start:'2026-11-12',finish:'2026-11-13'}]
 const args=[resources,assignments,activities,new Set(),'month',null,null]
 const hidden=useResourcesTabData(...args,false)
 for(const effect of effects.splice(0)) effect()
 assert.equal(calls.length,0)
 assert.equal(hidden.trackedResources.length,0)
 assert.equal(hidden.assignmentsByResource.size,0)
 const visible=useResourcesTabData(...args,true)
 const cleanups=effects.splice(0).map(f=>f())
 await new Promise(resolve=>setTimeout(resolve,0))
 assert.equal(visible.trackedResources.length,1)
 assert.equal(calls.length,1)
 assert.deepEqual(calls[0][1].resource_ids,['r'])
 cleanups.forEach(f=>f?.())
 assert.equal(calls[0][2].signal.aborted,true)
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/lib/performanceDiagnostics'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {installPerformanceDiagnostics}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('diagnostics are bounded and omit request contents, IDs and query parameters',()=>{
 const original=globalThis.performance
 let clock=0, request, response
 globalThis.window={}
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}})
 try {
  installPerformanceDiagnostics({interceptors:{request:{use:f=>request=f},response:{use:f=>response=f}}})
  for(let i=0;i<120;i++){
   const config={method:'patch',url:'/api/v1/activities/12345678-1234-1234-1234-123456789abc?secret=value',data:{task_name:'Private project name'}}
   request(config);clock+=300
   response({config,headers:{'server-timing':'app;dur=123.4'}})
  }
  const rows=window.prosotaPerformance.snapshot()
  assert.equal(rows.length,100)
  assert.equal(rows[0].name,'PATCH /api/v1/activities/:id')
  assert.equal(rows[0].serverMs,123.4)
  assert.equal(rows[0].durationMs,300)
  assert.equal(JSON.stringify(rows).includes('Private'),false)
  window.prosotaPerformance.clear()
  assert.equal(window.prosotaPerformance.snapshot().length,0)
 } finally {delete globalThis.window;Object.defineProperty(globalThis,'performance',{configurable:true,value:original})}
})

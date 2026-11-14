import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({entryPoints:['src/modules/fourD/frameNotifier.ts'],bundle:true,write:false,format:'esm'})
const {createFrameNotifier}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const wait=ms=>new Promise(r=>setTimeout(r,ms))
test('animation inspector updates coalesce, show final pose, and cancel on unmount',async()=>{
 let pose=0;const shown=[];const notifier=createFrameNotifier(()=>shown.push(pose),30)
 notifier.trigger()
 for(let i=1;i<=100;i++){pose=i;notifier.trigger()}
 assert.deepEqual(shown,[0])
 await wait(65)
 assert.deepEqual(shown,[0,100])
 notifier.trigger();notifier.trigger();const count=shown.length;notifier.dispose()
 await wait(65);assert.equal(shown.length,count)
})

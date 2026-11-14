import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/clipPlaneOwnership'; export * as T from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {mergeClipPlanes,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const plane=(distance)=>new T.Plane(new T.Vector3(1,0,0),distance)
test('clipping systems compose, remove independently, and reuse unchanged values',()=>{
 let planes=mergeClipPlanes(null,'sectionBox',[plane(3)])
 const section=planes[0]
 assert.equal(mergeClipPlanes(planes,'grow',[]),planes)
 planes=mergeClipPlanes(planes,'grow',[plane(1)])
 assert.equal(planes[0],section)
 assert.equal(mergeClipPlanes(planes,'grow',[plane(1)]),planes)
 const moved=mergeClipPlanes(planes,'grow',[plane(2)])
 assert.notEqual(moved,planes);assert.equal(moved[1].constant,2)
 assert.deepEqual(mergeClipPlanes(moved,'grow',[]),[section])
 assert.equal(mergeClipPlanes([section],'sectionBox',[]),null)
 assert.equal(mergeClipPlanes(null,'grow',[]),null)
})

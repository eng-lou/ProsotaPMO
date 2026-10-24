import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/pathCurve'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {buildPathCurve,pointAtProgress}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const points=[{x:0,y:0,z:2},{x:10,y:0,z:2},{x:10,y:10,z:2}]
test('straight path animation preserves corners and arc distance',()=>{
 const curve=buildPathCurve(points,false,'straight')
 assert.deepEqual(pointAtProgress(curve,25).toArray(),[5,0,2])
 assert.deepEqual(pointAtProgress(curve,75).toArray(),[10,5,2])
})
test('closed straight path reaches start',()=>{
 assert.deepEqual(pointAtProgress(buildPathCurve(points,true,'straight'),100).toArray(),[0,0,2])
})
test('curved interpolation remains distinct and reaches endpoints',()=>{
 const curve=buildPathCurve(points,false,'curved')
 assert.deepEqual(pointAtProgress(curve,100).toArray(),[10,10,2])
 assert.notEqual(pointAtProgress(curve,25).y,0)
 assert.equal(buildPathCurve([],false),null)
})

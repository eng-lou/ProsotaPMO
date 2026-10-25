import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/importOpacity'; export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {prepareImportedOpacity,THREE}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const pixels=alphas=>new Uint8ClampedArray(alphas.flatMap(a=>[255,255,255,a]))
test('mostly opaque character atlas with cutouts writes depth',()=>{
 const m=new THREE.MeshStandardMaterial({transparent:true,depthWrite:false})
 prepareImportedOpacity(m,pixels([...Array(90).fill(255),...Array(8).fill(0),128,204]))
 assert.equal(m.transparent,false);assert.equal(m.depthWrite,true);assert.equal(m.alphaTest,.5)
})
test('translucent surfaces and scalar opacity retain blending',()=>{
 for(const [m,data] of [
  [new THREE.MeshStandardMaterial({transparent:true,depthWrite:false}),pixels(Array(100).fill(128))],
  [new THREE.MeshStandardMaterial({transparent:true,depthWrite:false,opacity:.4}),pixels(Array(100).fill(255))],
  [new THREE.MeshPhysicalMaterial({transparent:true,depthWrite:false,transmission:1}),pixels(Array(100).fill(255))]
 ]){prepareImportedOpacity(m,data);assert.equal(m.transparent,true);assert.equal(m.depthWrite,false);assert.equal(m.alphaTest,0)}
})

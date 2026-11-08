import assert from 'node:assert/strict'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import * as THREE from 'three'

const {outputFiles}=await build({entryPoints:[fileURLToPath(new URL('../src/modules/fourD/footprintEdges.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'})
const {footprintField,footprintMask}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const unit=new THREE.Vector3(1,1,1)
const cornerStyle={fade:0,radius:1}, fadeStyle={fade:1,radius:0}
function sample(field,mask,u,v){
  return mask[(Math.floor(v/field.pitch)+3)*field.w+Math.floor(u/field.pitch)+3]
}
test('a metre-wide footprint fade is solid in the middle and smooth at the perimeter',()=>{
  const field=footprintField(new THREE.PlaneGeometry(10000,4000),unit.clone().multiplyScalar(.001))
  const mask=footprintMask(field,fadeStyle)
  assert.equal(sample(field,mask,5,2),255)
  assert.ok(sample(field,mask,.05,2)<12)
  assert.ok(Math.abs(sample(field,mask,.5,2)-128)<12)
  assert.equal(sample(field,mask,5,1.2),255)
})
test('radius clips convex corners independently and preserves a straight edge',()=>{
  const field=footprintField(new THREE.PlaneGeometry(10,4),unit)
  const mask=footprintMask(field,cornerStyle)
  assert.equal(sample(field,mask,.08,.08),0)
  assert.equal(sample(field,mask,.6,.6),255)
  assert.equal(sample(field,mask,5,.03),255)
  assert.equal(sample(field,mask,5,2),255)
  assert.equal(sample(field,footprintMask(field,{fade:0,radius:0}),.08,.08),255)
})
test('ends-only fades from the two short ends and keeps the long sides solid',()=>{
  const field=footprintField(new THREE.PlaneGeometry(10,4),unit)
  const mask=footprintMask(field,{fade:1,radius:0,endsOnly:true})
  assert.equal(sample(field,mask,5,.025),255)
  assert.ok(sample(field,mask,.05,2)<12)
  assert.ok(sample(field,mask,9.95,2)<12)
  assert.ok(Math.abs(sample(field,mask,9.5,2)-128)<12)
})
test('holes feather and shared triangle edges stay opaque',()=>{
  const shape=new THREE.Shape().moveTo(0,0).lineTo(10,0).lineTo(10,8).lineTo(0,8).closePath()
  shape.holes.push(new THREE.Path().moveTo(3,3).lineTo(3,5).lineTo(7,5).lineTo(7,3).closePath())
  const field=footprintField(new THREE.ExtrudeGeometry(shape,{depth:.1,bevelEnabled:false}),unit)
  const mask=footprintMask(field,fadeStyle)
  assert.equal(sample(field,mask,5,4),0)
  assert.ok(sample(field,mask,5,2.5)>110 && sample(field,mask,5,2.5)<145)
  for(let i=2;i<=8;i+=.25)assert.equal(sample(field,mask,i,1.4),255)
})

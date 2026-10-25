Error.stackTraceLimit=0

import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/shapeBoolean';export * from './src/modules/fourD/terrainShape';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {computeShapeBoolean,disposeBooleanResults,volume,prepareTerrain,subdivideTerrain,raiseTerrain,simplifyTerrain,checkSolid,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const box=(w,h,d,x=0,y=0,z=0)=>{const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color:0x887744}));mesh.position.set(x,y,z);return mesh}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,a+' != '+b)
test('excavation conserves volume and preserves originals',()=>{
 const a=box(10,4,10,20,2,30),b=box(4,6,4,20,4,30),before=Array.from(a.geometry.attributes.position.array),position=a.position.clone()
 const r=computeShapeBoolean(a,b,'y','excavate')
 near(volume(r[0].mesh.geometry),352);near(volume(r[1].mesh.geometry),48)
 assert.deepEqual(Array.from(a.geometry.attributes.position.array),before);assert.deepEqual(a.position,position)
 near(r[0].position.x,20);near(r[0].position.y,0);near(r[0].position.z,30)
 assert.equal(r[1].mesh.material.color.getHex(),0xdc2626);disposeBooleanResults(r)
})
test('union and intersection in either up axis, transformed cutter',()=>{
 const a=box(2,2,2),b=box(2,2,2,1)
 for(const axis of ['y','z']){
  const u=computeShapeBoolean(a,b,axis,'union'),i=computeShapeBoolean(a,b,axis,'intersect')
  near(volume(u[0].mesh.geometry),12);near(volume(i[0].mesh.geometry),4);disposeBooleanResults(u);disposeBooleanResults(i)
 }
 b.rotation.y=.4;b.scale.set(1,.5,1);assert.ok(computeShapeBoolean(a,b,'y','subtract')[0].mesh.geometry.attributes.position.count>0)
})
test('reject open inputs and empty cuts',()=>{
 assert.throws(()=>computeShapeBoolean(box(2,2,2),new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshStandardMaterial()),'y','subtract'),/closed solids/)
 assert.throws(()=>computeShapeBoolean(box(2,2,2),box(2,2,2,50),'y','excavate'),/partial overlap/)
 assert.throws(()=>computeShapeBoolean(box(2,2,2),box(20,20,20),'y','subtract'),/no solid/)
})
test('subdivision and local brush preserve base; simplify retains closed solid',()=>{
 const r=prepareTerrain(box(10,2,10,0,1,0),'y')
 let g=r.mesh.geometry
 for(let i=0;i<3;i++)g=subdivideTerrain(g)
 near(volume(g),200);checkSolid(g)
 const raised=raiseTerrain(g,new T.Vector3(0,2,0),3,1,1)
 raised.computeBoundingBox();near(raised.boundingBox.min.y,0);assert.ok(raised.boundingBox.max.y>2.9)
 g.computeBoundingBox();near(g.boundingBox.max.y,2);checkSolid(raised)
 const simplified=simplifyTerrain(g,20);assert.ok(simplified.attributes.position.count<g.attributes.position.count);checkSolid(simplified)
 disposeBooleanResults([r])
})

test('boolean output can be used in a second cut',()=>{
 const first=computeShapeBoolean(box(10,4,10),box(4,6,4,0,2),'y','subtract')
 const mesh=first[0].mesh;mesh.position.copy(first[0].position)
 const next=computeShapeBoolean(mesh,box(2,8,2,3,0,0),'y','subtract');assert.ok(volume(next[0].mesh.geometry)>0)
 disposeBooleanResults(first);disposeBooleanResults(next)
})

test('material-split closed shells remain usable, but missing faces are rejected',()=>{
 const geometry=new T.BoxGeometry(4,4,4).toNonIndexed(), shell=new T.Group()
 for(const group of geometry.groups){
   const g=new T.BufferGeometry()
   for(const name of ['position','normal','uv']){const a=geometry.getAttribute(name);g.setAttribute(name,new T.BufferAttribute(a.array.slice(group.start*a.itemSize,(group.start+group.count)*a.itemSize),a.itemSize))}
   shell.add(new T.Mesh(g,new T.MeshStandardMaterial()))
 }
 const r=computeShapeBoolean(shell,box(2,6,2),'y','subtract');near(volume(r[0].mesh.geometry),48);disposeBooleanResults(r)
 shell.remove(shell.children[0])
 assert.throws(()=>computeShapeBoolean(shell,box(2,6,2),'y','subtract'),/closed solids/)
})

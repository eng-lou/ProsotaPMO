import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/sitePathMotion';export * from './src/modules/fourD/pathCurve';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {sampleSitePath,applySitePath,buildPathCurve,sitePathRange,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const motion={path_id:'route',start:'2026-10-23T00:00:00Z',speed:1.4,animation_reference_speed:1.4,orient:true,heading:0,loop:false}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`)
test('travel has physical speed, stops at end and scrubs deterministically',()=>{
 const curve=buildPathCurve([{x:0,y:0,z:0},{x:14,y:0,z:0}],false,'straight')
 near(sampleSitePath(curve,motion,5,'z').point.x,7)
 near(sampleSitePath(curve,motion,20,'z').point.x,14)
 near(sampleSitePath(curve,motion,20,'z').animationTime,10)
 near(sampleSitePath(curve,motion,-2,'z').animationTime,0)
 near(sampleSitePath(curve,{...motion,speed:2.8},5,'z').animationTime,10)
 near(sampleSitePath(curve,motion,5,'z').point.x,7)
})
test('binding and turns never overwrite editable scale/rotation in either up axis',()=>{
 for(const axis of ['y','z']){
 const curve=buildPathCurve([{x:0,y:0,z:0},{x:7,y:0,z:0},axis==='z'?{x:7,y:7,z:0}:{x:7,y:0,z:7}],false,'straight')
 const parent=new T.Group(),object=new T.Group();parent.add(object);object.scale.setScalar(.01);object.rotation.set(.2,.4,.6);object.position.set(3,4,5)
 const before=object.quaternion.clone();applySitePath(parent,curve,motion,0,axis,object.position)
 assert.ok(object.quaternion.equals(before));near(parent.quaternion.angleTo(new T.Quaternion()),0)
 object.rotation.z+=.5;const corrected=object.quaternion.clone()
 applySitePath(parent,curve,motion,8,axis,object.position)
 assert.ok(object.quaternion.equals(corrected));near(object.scale.x,.01)
 const at=object.getWorldPosition(new T.Vector3()),expected=sampleSitePath(curve,motion,8,axis).point
 near(at.distanceTo(expected),0)
 }
})
test('loop keeps animation phase advancing while the journey wraps',()=>{
 const curve=buildPathCurve([{x:0,y:0,z:0},{x:14,y:0,z:0}],false,'straight')
 const result=sampleSitePath(curve,{...motion,loop:true},12,'z');near(result.point.x,2.8);near(result.animationTime,12)
})

test('timed route pauses, reverses, stops and reloads on the same absolute timeline',()=>{
 const curve=buildPathCurve([{x:0,y:0,z:0},{x:20,y:0,z:0}],false,'straight')
 for(const speed of [1/86400,7]){
  const date=s=>new Date(Date.parse(motion.start)+s*86400000*speed).toISOString()
  const keyed=JSON.parse(JSON.stringify({...motion,loop:true,progress_keys:[[0,0],[4,25],[6,25],[10,100],[13,100],[17,0]].map(([s,progress])=>({date:date(s),progress,interpolation:'linear'}))}))
  const sample=s=>sampleSitePath(curve,keyed,s,'z',speed)
  near(sample(4).point.x,5);near(sample(5).point.x,5);near(sample(6).animationTime,sample(4).animationTime)
  near(sample(8).point.x,12.5);near(sample(12).point.x,20);near(sample(15).point.x,10)
  near(sample(20).point.x,0);near(sample(20).animationTime,0);near(sample(-3).point.x,0)
  const range=sitePathRange(keyed,20,speed);near((range.end-range.start)/(86400000*speed),17)
  const parent=new T.Group();applySitePath(parent,curve,keyed,8,'z',new T.Vector3(),speed);near(parent.position.x,sample(8).point.x)
 }
})

test('hold keys jump only at the next key; smooth keys ease travel',()=>{
 const curve=buildPathCurve([{x:0,y:0,z:0},{x:20,y:0,z:0}],false,'straight'),date=s=>new Date(Date.parse(motion.start)+s*86400000).toISOString()
 const keyed={...motion,progress_keys:[{date:date(0),progress:0,interpolation:'hold'},{date:date(10),progress:100,interpolation:'linear'}]}
 near(sampleSitePath(curve,keyed,9.99,'z').progress,0);near(sampleSitePath(curve,keyed,10,'z').progress,100)
 keyed.progress_keys[0].interpolation='smooth';near(sampleSitePath(curve,keyed,2.5,'z').progress,15.625)
})

test('saved raised-surface correction survives frames, turns and reload',()=>{
 for(const axis of ['y','z']) {
 const curve=buildPathCurve([{x:0,y:0,z:0},{x:7,y:0,z:0},axis==='z'?{x:7,y:7,z:0}:{x:7,y:0,z:7}],false,'straight')
 const parent=new T.Group(),object=new T.Group();parent.add(object);object.position.set(23,-15,-31)
 const bound={...motion,bind_origin:{x:23,y:-15,z:-31}}
 applySitePath(parent,curve,bound,0,axis,object.position)
 // Equivalent to snapping the object's base onto a slab 3m above the route.
 object.position[axis]+=3
 for(const time of [0,3,8,0]) {
  const saved=JSON.parse(JSON.stringify(bound))
  applySitePath(parent,curve,saved,time,axis,object.position)
  near(object.getWorldPosition(new T.Vector3())[axis],3)
 }
 }
})

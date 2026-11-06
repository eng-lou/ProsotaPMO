import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/equipmentCycle';export * from './src/modules/fourD/equipmentRig';export * from './src/modules/fourD/soilSimulation';export * from './src/modules/fourD/sitePathMotion';export * as T from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {buildEquipmentCycle,controlValue,bakeSoil,sampleSitePath,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const start=Date.parse('2026-01-01T00:00:00Z'),date=s=>new Date(start+s*1000).toISOString()
const soil={enabled:true,show_guide:false,bucket_node:'bucket',center:[0,0,0],size:[1.4,1,1],rotation:[0,0,0],capacity:.4,dump_angle:105,pour_seconds:1.5,source:[1,0,0],radius:2,height:1,up_axis:'z',start:date(0),end:date(10),duration_seconds:10,steps:240,color:'#806046'}
const rig={id:'test',definition:{schema_version:1,controls:['lift','tip'].map(id=>({id,value:0,rest:0,keys:[{date:date(-1),value:0,interpolation:'linear'},{date:date(30),value:1,interpolation:'linear'}]})),joints:[],followers:[],soil}}
const recipe={pickup:{lift:0,tip:0},carry:{lift:1,tip:0},tip:{lift:1,tip:1},approach_seconds:4,lift_seconds:2,travel_seconds:5,tip_seconds:.3,start_progress:0,pickup_progress:10,drop_progress:90}
const motion={path_id:'p',start:date(0),speed:1,animation_reference_speed:1,loop:false,orient:true,heading:0}
test('guided cycle parks during lift and pour, empties, and retains other keys',()=>{
 const r=buildEquipmentCycle(rig,recipe,start,1/86400,motion),curve=new T.LineCurve3(new T.Vector3(),new T.Vector3(10,0,0)),s=r.rig.definition.soil
 assert.equal(s.duration_seconds,13.3);assert.equal(r.rig.definition.controls[0].keys[0].date,date(-1));assert.equal(r.rig.definition.controls[0].keys.at(-1).date,date(30))
 const position=t=>sampleSitePath(curve,r.motion,t,'z',1/86400)
 assert.equal(position(5).progress,10);assert.equal(position(12).progress,90);assert.equal(position(13.3).animationTime,position(11).animationTime)
 const bake=bakeSoil(s,time=>{
  const lift=controlValue(r.rig.definition.controls[0],time),tip=controlValue(r.rig.definition.controls[1],time),p=position((time-start)/1000).point
  return new T.Matrix4().compose(new T.Vector3(p.x,0,.8+1.4*lift),new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2+tip*Math.PI),new T.Vector3(1,1,1))
 })
 assert.ok(bake.frames.some(f=>f.fill>.1));assert.ok(bake.frames.at(-1).deposited>.1);assert.ok(bake.frames.at(-1).fill<1e-8);assert.ok(bake.falls.every(f=>f.to[0]>8))
 assert.deepEqual(buildEquipmentCycle(JSON.parse(JSON.stringify(r.rig)),recipe,start,1/86400,JSON.parse(JSON.stringify(r.motion))),r)
})
test('retiming removes old generated tail; missing poses and invalid durations fail before saving',()=>{
 const first=buildEquipmentCycle(rig,recipe,start,1/86400,motion)
 const r=buildEquipmentCycle(first.rig,{...recipe,travel_seconds:1},start,1/86400,first.motion)
 assert.ok(r.rig.definition.controls.every(c=>!c.keys.some(k=>Date.parse(k.date)>Date.parse(r.rig.definition.soil.end)&&Date.parse(k.date)<Date.parse(date(30)))))
 assert.throws(()=>buildEquipmentCycle(rig,{...recipe,tip:{}},start,1/86400,motion),/Capture/)
 assert.throws(()=>buildEquipmentCycle(rig,{...recipe,travel_seconds:NaN},start,1/86400,motion),/durations/)
 assert.throws(()=>buildEquipmentCycle(rig,{...recipe,drop_progress:101},start,1/86400,motion),/positions/)
})

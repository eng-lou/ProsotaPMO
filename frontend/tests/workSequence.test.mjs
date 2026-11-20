import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/workSequence'; export * from './src/modules/fourD/workSequenceVisual'; export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {sampleWork,workWindows,workVisual,applyWorkPose,createWorkClip,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const base=Date.parse('2026-11-01T00:00:00Z'),h=3600000,iso=n=>new Date(base+n*h).toISOString(),origin={x:2,y:3,z:4}
const activities=[{id:'a',start:iso(2),finish:iso(12)},{id:'b',start:iso(16),finish:iso(26)}]
const row=(id,extra={})=>({id,activity_id:id,start:null,finish:null,start_chainage:0,end_chainage:10,position:{x:10,y:0,z:0},depth:10,travel_hours:2,excavation_id:'soil'+id,pile_id:null,...extra})
const config={kind:'tbm',axis:'z',offset:{x:0,y:0,z:0},path_id:'path',steps:[row('a'),row('b',{start_chainage:10,end_chainage:20})],tool_control:null,tool_travel:20,tool_rest:0,tool_full:1}
const curve=new T.LineCurve3(new T.Vector3(),new T.Vector3(40,0,0)),at=(c,t)=>sampleWork(c,activities,base+t*h,origin,curve)
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`)
test('TBM chainage, holds, reverse seek and excavation face share progress',()=>{
 for(const [time,x] of [[1,0],[7,5],[14,10],[21,15],[30,20],[7,5]]){const s=at(config,time);near(s.point.x,x);if(time===7){const v=workVisual(config,activities,'soila',base+time*h,curve);near(v.plane.distanceToPoint(s.point),0);assert.ok(v.plane.distanceToPoint(new T.Vector3(6,0,0))>0)}}
 assert.equal(workVisual(config,activities,'soila',base+14*h,curve).visible,false)
 assert.equal(workVisual(config,activities,'soila',base+h,curve).plane,null)
})
test('3D orientation follows gradients and anchor offset preserves model transform',()=>{
 const c=new T.CatmullRomCurve3([new T.Vector3(),new T.Vector3(10,0,0),new T.Vector3(20,4,8),new T.Vector3(30,10,15)])
 const sample=sampleWork(config,activities,base+21*h,origin,c),tangent=c.getTangentAt(0).applyQuaternion(sample.rotation);near(tangent.distanceTo(c.getTangentAt(sample.chainage/c.getLength())),0)
 const parent=new T.Group(),child=new T.Group();child.position.set(2,3,4);child.rotation.z=.7;child.scale.set(2,3,4);parent.add(child);applyWorkPose(parent,sample,origin);near(child.getWorldPosition(new T.Vector3()).distanceTo(sample.point),0);assert.deepEqual(child.scale.toArray(),[2,3,4]);near(child.rotation.z,.7)
})
test('piling travels, drills to depth, withdraws, holds and returns on reverse seek',()=>{
 const p={...config,kind:'piling',tool_control:'auger',steps:[row('a',{pile_id:'pileA'}),row('b',{position:{x:30,y:0,z:0}})]}
 near(at(p,1).point.x,6);near(at(p,5.25).depth,5);near(at(p,8.5).depth,10);near(at(p,9.5).depth,5);near(at(p,13).depth,0);near(at(p,15).point.x,20);near(at(p,30).point.x,30);near(at(p,5.25).tool,.25)
 assert.equal(workVisual(p,activities,'pileA',base+9*h).visible,false);assert.equal(workVisual(p,activities,'pileA',base+11*h).visible,true)
 near(workVisual(p,activities,'soila',base+5.25*h).plane.distanceToPoint(new T.Vector3(10,0,-5)),0)
 assert.equal(workVisual(p,activities,'soila',base+9*h).visible,false)
})
test('date edits retime and overrides persist after serialization',()=>{
 const moved=activities.map(a=>a.id==='a'?{...a,start:iso(4),finish:iso(14)}:a);near(sampleWork(config,moved,base+7*h,origin,curve).chainage,3)
 const manual={...config,steps:config.steps.map(s=>s.id==='a'?{...s,start:iso(2),finish:iso(12)}:s)};near(sampleWork(JSON.parse(JSON.stringify(manual)),moved,base+7*h,origin,curve).chainage,5)
})
test('invalid schedules, chainages and insufficient tool travel fail closed',()=>{
 assert.throws(()=>workWindows(config,[]),/activity/);assert.throws(()=>at({...config,steps:[row('a',{end_chainage:100})]},7),/length/)
 assert.throws(()=>workWindows({...config,steps:[row('a'),row('b',{start_chainage:11,end_chainage:20})]},activities),/continuous/)
 assert.throws(()=>workWindows({...config,kind:'piling',steps:[row('a'),row('b',{travel_hours:5})]},activities),/overlap/)
 assert.throws(()=>workWindows({...config,kind:'piling',tool_control:'x',tool_travel:5},activities),/depth/i)
})
test('clipping is reversible and retains unrelated section planes',()=>{
 const root=new T.Group(),mat=new T.MeshStandardMaterial(),mesh=new T.Mesh(new T.BoxGeometry(),mat),existing=new T.Plane(new T.Vector3(0,1,0),10);root.add(mesh);mat.clippingPlanes=[existing];const clip=createWorkClip();clip.apply(root,new T.Plane(new T.Vector3(1,0,0),-5));assert.equal(mat.clippingPlanes.length,2);assert.equal(mat.clipShadows,true);clip.apply(root,new T.Plane(new T.Vector3(1,0,0),-2));assert.equal(mat.clippingPlanes.length,2);clip.dispose();assert.deepEqual(mat.clippingPlanes,[existing]);assert.equal(mat.clipShadows,false);mat.dispose();mesh.geometry.dispose()
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/simulator/workerMethod';export * from './src/modules/simulator/workerMethodRuntime';export * as THREE from 'three'",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'}})
const {methodAt,methodRoutePoint,snapshotMethod,newWorkerMethod,reusableMethod,WorkerMethodRuntime,THREE:T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const epoch=Date.parse('2026-10-28T08:00:00'),date=s=>new Date(epoch+s*1000).toISOString()
const event=(stage,a,b,from,to,p=0,q=1)=>({step_id:'method',start:date(a),end:date(b),progress_from:p,progress_to:q,worker_action:{stage,seconds:stage==='work'?10:5,from_progress:from,to_progress:to}})
const events=[event('approach',0,5,0,.5),event('work',5,8,.5,.5,0,.3),event('work',18,25,.5,.5,.3,1),event('continue',25,30,.5,1)]
test('calendar interruption holds work and resumes at the same motion frame',()=>{
 const pause=methodAt(events,'method',epoch+12000)
 assert.equal(pause.active,false);assert.equal(pause.stage,'work');assert.equal(pause.clipSeconds,3);assert.equal(pause.routeProgress,.5)
 assert.equal(methodAt(events,'method',epoch+18000).clipSeconds,3)
 assert.equal(methodAt(events,'method',epoch+26000).routeProgress,.6)
 assert.equal(methodAt(events,'method',epoch+30000).finished,true)
 assert.equal(methodAt(events,'method',epoch-1).started,false)
})
const item={id:'worker',asset_id:'w',kind:'asset',yaw:0,up_axis:'y'},toolItem={id:'tool',asset_id:'t',kind:'asset'}
const m={...newWorkerMethod(),worker_id:'worker',worker_asset_id:'w',tool_id:'tool',tool_asset_id:'t',route_id:'r',idle_clip:'Idle',walk_clip:'Walk',work_clip:'Work',hand:'CC_Base_R_Hand'}
test('route snapshot preserves curve geometry and reusable template clears bindings',()=>{
 const path={id:'r',points:[{x:0,y:0,z:0},{x:6,y:0,z:0},{x:6,y:0,z:6}],closed:false,curve_mode:'straight'}
 const captured=snapshotMethod(m,[item,toolItem],[path]);assert.equal(captured.route.length_m,12)
 assert.deepEqual(methodRoutePoint(captured,.5).toArray(),[6,0,0])
 path.points[1].x=100;assert.equal(captured.route.geometry.points[1].x,6)
 const reusable=reusableMethod(captured);assert.equal(reusable.route,null);assert.equal(reusable.worker_id,'');assert.equal(reusable.tool_id,'');assert.equal(reusable.walk_clip,'Walk')
})
function scene(){const world=new T.Group(),parent=new T.Group(),worker=new T.Group(),rig=new T.Group(),hand=new T.Bone(),hip=new T.Bone(),toolParent=new T.Group(),tool=new T.Group();world.add(parent,toolParent);parent.add(worker);worker.add(rig);rig.add(hip);hip.add(hand);hand.name='CC_Base_R_Hand';hip.name='CC_Base_Hip';hand.position.y=1;worker.position.set(20,1,2);toolParent.add(tool);tool.position.set(-10,2,4);tool.scale.setScalar(2);rig.userData.siteAssetRigRoot=true;rig.animations=['Idle','Walk','Work'].map(name=>new T.AnimationClip(name,2,[new T.VectorKeyframeTrack('CC_Base_R_Hand.position',[0,1,2],[0,1,0,0,1.2,0,0,1,0])]));world.updateMatrixWorld(true);return {world,worker,tool}}
test('runtime is deterministic on reverse seek, holds grip through pause, restores scene',()=>{
 const {worker,tool}=scene(),original=[worker.position.toArray(),worker.quaternion.toArray(),tool.position.toArray(),tool.scale.toArray(),tool.visible]
 const method={...m,route:{samples:[[0,0,0],[12,0,0]],length_m:12},grip:{position:[.2,0,0],rotation:[0,90,0]}}
 const r=new WorkerMethodRuntime(method,worker,tool,item);r.own()
 r.evaluate(events,'method',epoch-1);assert.equal(worker.visible,false)
 r.evaluate(events,'method',epoch+7000);const work=[worker.position.toArray(),tool.position.toArray(),tool.quaternion.toArray()];assert.equal(tool.visible,true)
 assert.equal(worker.visible,true)
 r.evaluate(events,'method',epoch+12000);const hold=tool.position.toArray();r.evaluate(events,'method',epoch+18000);assert.deepEqual(tool.position.toArray(),hold)
 r.evaluate(events,'method',epoch+28000);assert.equal(tool.visible,false)
 assert.equal(worker.visible,true)
 r.evaluate(events,'method',epoch+30000);assert.equal(worker.visible,false);assert.equal(tool.visible,false)
 r.evaluate(events,'method',epoch+7000);assert.deepEqual([worker.position.toArray(),tool.position.toArray(),tool.quaternion.toArray()],work)
 assert.equal(worker.visible,true)
 r.dispose();assert.deepEqual([worker.position.toArray(),worker.quaternion.toArray(),tool.position.toArray(),tool.scale.toArray(),tool.visible],original);assert.equal(worker.userData.simulatorOwnsPose,undefined)
})

test('temporary playback restores an originally hidden worker',()=>{
 const {worker,tool}=scene();worker.visible=false
 const r=new WorkerMethodRuntime({...m,route:{samples:[[0,0,0],[12,0,0]],length_m:12}},worker,tool,item);r.own()
 r.evaluate(events,'method',epoch+7000);assert.equal(worker.visible,true)
 r.dispose();assert.equal(worker.visible,false)
})

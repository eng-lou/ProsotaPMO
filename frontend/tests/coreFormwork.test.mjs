import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {build} from 'esbuild'

const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/coreRig';export * from './src/modules/fourD/coreCycle'; export * from './src/modules/fourD/climbingFormwork'; export * from 'three'; export {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const lib=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const hour=3600000, base=Date.UTC(2026,10,22),at=h=>new Date(base+h*hour).toISOString()
const activity=(id,start,finish,phase)=>({id,start:at(start),finish:at(finish),schedule_phase_key:phase,task_name:'L2 - Core walls - '+id,parent_id:'L2'})
const tasks=[activity('A',0,2),activity('B',12,14,'formwork_rebar'),activity('pour',14,18,'pour'),activity('stripA',5,7),activity('climb',8,12,'core_climb'),activity('strip',20,21,'strip')]
const config={axis:'z',mode:'articulated',reference_elevation:0,lifts:[
 {id:'0',activity_id:'A',height:0,duration_hours:1,strip_activity_id:'stripA'},
 {id:'1',activity_id:'B',height:3.4,duration_hours:1,...lib.corePhases(tasks[1],tasks)}]}
const rows=lib.climbWindows(config,tasks),sample=lib.prepareCoreCycle(config,rows)
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} ≠ ${b}`)
test('one generated lift uses its own climb, pour and strip activities',()=>{
 assert.deepEqual(lib.corePhases(tasks[1],[...tasks,{...tasks[2],id:'other',task_name:'L2 - Walls - Pour'}]),{climb_activity_id:'climb',pour_activity_id:'pour',strip_activity_id:'strip'})
 assert.equal(rows[1].startMs,base+8*hour);assert.equal(rows[1].finishMs,base+12*hour)
 assert.deepEqual(lib.cycleWarnings(rows),[])
 assert.match(lib.cycleWarnings(lib.climbWindows(config,tasks.map(t=>t.id==='stripA'?{...t,finish:at(10)}:t)))[0],/previous strip/)
})
test('cores strip, climb in two stages, close and pour; reverse scrubbing restores every pose',()=>{
 const pose=h=>sample(base+h*hour)
 near(pose(6).panels,.5);near(pose(10).lower,0);assert.ok(pose(10).upper>2)
 near(pose(11).upper,3.4);assert.ok(pose(11).lower>0 && pose(11).lower<3.4)
 near(pose(13).panels,.5); near(pose(14).panels,0);near(pose(16).deployment,1)
 near(pose(18).deployment,0);near(pose(20.5).panels,.5);near(pose(21).upper,3.4)
 const earlier=pose(11);pose(18);assert.deepEqual(pose(11),earlier)
 const keyed=lib.prepareCoreCycle({...config,boom_keys:[{date:at(14),deployment:0,slew:0},{date:at(18),deployment:.6,slew:90}]},rows)
 near(keyed(base+16*hour).deployment,.3);near(keyed(base+16*hour).slew,45);near(keyed(base+10*hour).deployment,0)
})
test('delivered GLB has independently moving decks, all four form faces and an articulated boom in both scene axes',async()=>{
 const bytes=await fs.readFile(new URL('../public/models/Prosota_Core_Formwork_with_Boom.glb',import.meta.url))
 const gltf=await new lib.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 assert.deepEqual(gltf.animations.map(a=>a.name),['Core climb - 3 m','Placing boom - deploy'])
 const frame=lib.coreFrame(gltf.scene), moving=[]
 frame.traverse(n=>{if(n.userData.coreRigPart)moving.push(n)})
 const foot=moving.find(n=>n.userData.coreRigPart==='lower'), nozzle=moving.find(n=>n.userData.coreRigPart==='hose')
 const point=n=>n.getWorldPosition(new lib.Vector3()), footAtRest=point(foot), hoseAtRest=point(nozzle)
 const mixer=new lib.AnimationMixer(gltf.scene)
 mixer.clipAction(gltf.animations[0]).play();mixer.setTime(.57)
 near(frame.position.y,3);near(point(foot).y,footAtRest.y)
 mixer.setTime(1);near(point(foot).y-footAtRest.y,3)
 mixer.stopAllAction();mixer.clipAction(gltf.animations[1]).play();mixer.setTime(.95)
 assert.ok(point(nozzle).distanceTo(hoseAtRest)>2)
 mixer.setTime(0);near(point(nozzle).distanceTo(hoseAtRest),0);mixer.stopAllAction()
 for(const axis of ['y','z']){
   const anchor=new lib.Group(), model=gltf.scene.clone(true), frame=lib.coreFrame(model), apply=lib.bindCoreRig(frame)
   anchor.add(model);if(axis==='z')model.rotation.x=Math.PI/2
   model.scale.set(1.2,1.4,1.1)
   const parts=role=>{const out=[];model.traverse(n=>{if(n.userData.coreRigPart===role)out.push(n)});return out}
   const lower=parts('lower')[0], head=parts('slew')[0],hose=parts('hose')[0]
   assert.ok(lower && head && hose);assert.ok(parts('panel').length>=4)
   const world=n=>n.getWorldPosition(new lib.Vector3())
   const set=p=>{anchor.position[axis]=p.upper;apply(p,axis);anchor.updateMatrixWorld(true)}
   const initial=sample(base);set(initial);const low0=world(lower),high0=world(head),hose0=world(hose)
   const mid=sample(base+10*hour);set(mid)
   near(world(lower)[axis],low0[axis]);near(world(head)[axis]-high0[axis],mid.upper)
   const closed=world(hose);set({...mid,deployment:1,slew:35});assert.ok(world(hose).distanceTo(closed)>2)
   set(initial);near(world(hose).distanceTo(hose0),0);near(world(lower).distanceTo(low0),0)
 }
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {build} from 'esbuild'

const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/coreRig';export * from './src/modules/fourD/coreRigConnections';export * from './src/modules/fourD/coreCycle'; export * from './src/modules/fourD/climbingFormwork'; export * from 'three'; export {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
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

function checkLiftConnections(scene) {
 const rods=[], feet=new Map()
 scene.traverse(n=>{
   if(n.userData.coreLiftStation)rods.push(n)
   if(n.userData.coreSupportFace)feet.set(n.userData.coreSupportFace,n)
 })
 assert.equal(rods.length,12)
 assert.equal(feet.size,4)
 const at=(node,x,y,z)=>node.localToWorld(new lib.Vector3(x,y,z))
 const meshes=node=>node.children.filter(child=>child.isMesh)
 function hitsAcross(node,x,y,z,targets) {
   const origin=at(node,x+.7,y,z)
   const direction=at(node,x,y,z).sub(origin).normalize()
   return new lib.Raycaster(origin,direction,0,1.8).intersectObjects(targets,false).length>0
 }
 scene.updateWorldMatrix(true,true)
 for (const rod of rods) {
   const upper=rod.parent, lower=feet.get(rod.userData.coreLiftStation)
   const {x,y,z}=rod.position
   const housing=upper.children.find(n=>n.userData.coreRigPart==='ramHousing' && n.position.equals(rod.position))
   assert.ok(housing)
   const upperPin=at(upper,x,y,z), lowerPin=at(lower,x,y-1.8,z)
   near(at(rod,0,0,0).distanceTo(upperPin),0)
   near(at(rod,0,-1,0).distanceTo(lowerPin),0)
   assert.ok(hitsAcross(upper,x,y,z,meshes(upper)),'upper clevis pin is missing')
   assert.ok(hitsAcross(lower,x,y-1.8,z,meshes(lower)),'lower clevis pin is missing')
   // Check actual cylinder triangles at intervals along the entire span.
   const cylinders=[...meshes(rod),...meshes(housing)]
   for(let step=1;step<24;step++) assert.ok(hitsAcross(rod,0,-step/24,0,cylinders),'gap in '+rod.name)
   for(const k of ['x','y','z'])near(housing.scale[k],1)
 }
}

test('hydraulic assemblies reach both pinned decks on every face throughout the native and exported climb',async()=>{
 const bytes=await fs.readFile(new URL('../public/models/Prosota_Core_Formwork_with_Boom.glb',import.meta.url))
 const gltf=await new lib.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const mixer=new lib.AnimationMixer(gltf.scene)
 mixer.clipAction(gltf.animations[0]).play()
 for(const t of [0,.28,.57,.78,1,.72,.57,.34,0]) {
   mixer.setTime(t)
   checkLiftConnections(gltf.scene)
 }
 mixer.stopAllAction()
 const anchor=new lib.Group(), model=gltf.scene
 anchor.add(model);model.rotation.set(Math.PI/2,.13,0);model.scale.set(1.15,1.3,.92)
 const apply=lib.bindCoreRig(lib.coreFrame(model))
 for(const [upper,lower] of [[0,0],[2,0],[4.5,0],[4.5,2.8],[4.5,4.5],[1.75,0],[0,0]]){
   anchor.position.z=upper
   apply({upper,lower,panels:1,deployment:0,slew:0},'z')
   checkLiftConnections(model)
 }
})


test('existing version-one boom rigs keep their baked clips and receive the same four-sided connections once',async()=>{
 const bytes=await fs.readFile(new URL('../public/models/Prosota_Core_Formwork_with_Boom.glb',import.meta.url))
 const gltf=await new lib.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const frame=lib.coreFrame(gltf.scene)
 const upgrades=[]
 frame.traverse(n=>{if(!n.isMesh && (n.name.startsWith('Core_Upper_Brackets_')||n.name==='Core_Lower_Bracket_Frame'))upgrades.push(n)})
 assert.equal(upgrades.length,5)
 const removed=new Set()
 for(const group of upgrades){group.traverse(n=>removed.add(n.name));group.removeFromParent()}
 for(const clip of gltf.animations)clip.tracks=clip.tracks.filter(t=>!removed.has(t.name.split('.')[0]))
 frame.userData.coreRigVersion=1
 lib.installCoreConnections(frame,gltf.animations)
 lib.installCoreConnections(frame,gltf.animations)
 assert.equal(frame.userData.coreRigVersion,2)
 const mixer=new lib.AnimationMixer(gltf.scene)
 mixer.clipAction(gltf.animations[0]).play()
 for(const t of [0,.57,.88,.39,0]){mixer.setTime(t);checkLiftConnections(gltf.scene)}
})

test('pour sweeps and independently keyed channels follow a delayed and extended activity',()=>{
 const sweep={start_angle:-60,finish_angle:100}
 const first={...config.lifts[0],pour_activity_id:'firstPour'}
 const cfg={...config,boom_slew:10,pour_sweep:sweep,lifts:[first,config.lifts[1]]}
 const activities=[...tasks,activity('firstPour',2,5)]
 const rescheduled=activities.map(a=>a.id==='pour'?{...a,start:at(182),finish:at(190)}:a)
 const sampleAt=(settings,schedule)=>{
   const pose=lib.prepareCoreCycle(settings,lib.climbWindows(settings,schedule))
   return h=>pose(base+h*hour)
 }
 const automatic=sampleAt(cfg,activities)
 near(automatic(3.5).slew,20);near(automatic(16).slew,20)
 near(automatic(14.6).slew,-60);near(automatic(17.4).slew,100)
 near(automatic(17.7).deployment,.5);near(automatic(18).slew,10)
 const withKeys=keys=>({...cfg,lifts:[first,{...cfg.lifts[1],pour_keys:keys}]})
 const keyed=withKeys([{progress:.8,slew:90},{progress:.2,slew:-30}])
 const original=sampleAt(keyed,activities), changed=sampleAt(keyed,rescheduled)
 for(const progress of [1,.8,.5,.2,.075,0,.5]){
   const before=original(14+4*progress),after=changed(182+8*progress)
   near(after.slew,before.slew);near(after.deployment,before.deployment)
   near(after.deployment,automatic(14+4*progress).deployment)
 }
 near(changed(188.4).slew,90);near(changed(186).slew,30);near(changed(16).deployment,0)
 near(changed(3.5).slew,20);near(changed(10).deployment,0)
 const reachOnly=sampleAt(withKeys([{progress:.5,deployment:.4}]),rescheduled)
 near(reachOnly(186).slew,20);near(reachOnly(186).deployment,.4)
 near(reachOnly(182).deployment,0);near(reachOnly(190).deployment,0)
 const dated=sampleAt({...keyed,boom_keys:[{date:at(16),deployment:.64,slew:42}]},activities)
 near(dated(16).slew,30);near(dated(16).deployment,.64);near(dated(19).slew,42)
 const missing=sampleAt(keyed,activities.filter(a=>a.id!=='pour'))
 near(missing(16).slew,10);near(missing(16).deployment,0)
})

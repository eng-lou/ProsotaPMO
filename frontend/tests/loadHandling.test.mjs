import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/loadHandling';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {T,slingAnchorWorld,liftingPointWorld,loadRoots,loadDates,captureLoadEvent,loadEventAt,loadEventWorld,validateLoadEvents}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const date=n=>new Date(1800000000000+n*1000),near=(a,b)=>a.elements.forEach((v,i)=>assert.ok(Math.abs(v-b.elements[i])<1e-6))
test('truck to hook transfer preserves world pose; release stays fixed after hook moves and reverse seek restores attachment',()=>{
 const scene=new T.Group(),truck=new T.Group(),hook=new T.Group(),deck=new T.Group();scene.add(truck,hook,deck)
 truck.position.set(5,1,3);truck.rotation.y=.5;truck.scale.setScalar(.01);hook.position.set(7,8,2);deck.position.set(6,2,3);deck.rotation.z=.1;deck.scale.set(2,2,2)
 loadRoots.set('deck',deck);loadRoots.set('truck',truck);loadRoots.set('hook',hook)
 const item={id:'deck'},capture=(n,p)=>{loadDates.set('deck',date(n).getTime());return captureLoadEvent(item,p,'',date(n),true)}
 const first=capture(0,'truck');near(loadEventWorld(first,truck),deck.matrixWorld)
 truck.position.x+=8;loadEventWorld(first,truck).decompose(deck.position,deck.quaternion,deck.scale);deck.updateWorldMatrix(true,true)
 const transfer=capture(10,'hook');near(loadEventWorld(transfer,hook),deck.matrixWorld)
 hook.position.y+=4;loadEventWorld(transfer,hook).decompose(deck.position,deck.quaternion,deck.scale);deck.updateWorldMatrix(true,true)
 const release=capture(20,null),installed=deck.matrixWorld.clone();hook.position.y+=50
 loadEventWorld(release).decompose(deck.position,deck.quaternion,deck.scale);deck.updateWorldMatrix(true,true)
 const relift=capture(30,'hook');near(loadEventWorld(relift,hook),installed)
 hook.position.x+=5;loadEventWorld(relift,hook).decompose(deck.position,deck.quaternion,deck.scale);deck.updateWorldMatrix(true,true)
 const building=new T.Group();scene.add(building);building.position.set(50,10,2);loadRoots.set('building',building)
 const fix=capture(35,'building'),fixed=deck.matrixWorld.clone();near(loadEventWorld(fix,building),fixed)
 const full=[first,transfer,release,relift,fix];assert.equal(loadEventAt(full,date(32).getTime()).id,relift.id);assert.equal(loadEventAt(full,date(25).getTime()).id,release.id)
 const events=JSON.parse(JSON.stringify([first,transfer,release]));validateLoadEvents(events)
 near(loadEventWorld(loadEventAt(events,date(40).getTime())),installed)
 assert.equal(loadEventAt(events,date(5).getTime()).parent_id,'truck');assert.equal(loadEventAt(events,date(-1).getTime()),undefined)
 near(loadEventWorld(loadEventAt(events,date(20).getTime())),installed)
})
test('capture rejects stale viewport, self-parent and missing anchors; duplicate times reject',()=>{
 const deck=new T.Group();loadRoots.set('deck',deck);loadDates.set('deck',date(1).getTime())
 assert.throws(()=>captureLoadEvent({id:'deck'},null,'',date(2),false),/Pause/)
 assert.throws(()=>captureLoadEvent({id:'deck'},'deck','',date(1),false),/itself/)
 assert.throws(()=>captureLoadEvent({id:'deck'},'missing','hook',date(1),false),/not available/)
 const e=captureLoadEvent({id:'deck'},null,'',date(1),false)
 assert.throws(()=>validateLoadEvents([e,e]),/different valid/)
 assert.throws(()=>validateLoadEvents([{...e,matrix:Array(16).fill(0)}]),/transform/)
})

 test('named sling endpoints follow articulated parts and reject missing or ambiguous nodes',()=>{
 const root=new T.Group(),tray=new T.Group(),eye=new T.Group();eye.name='LiftEye_1';root.add(tray);tray.add(eye);eye.position.set(1,0,2);root.position.set(3,4,5);
 const p=()=>liftingPointWorld(root,[0,0,0],'LiftEye_1');assert.deepEqual(p().toArray(),[4,4,7]);tray.position.z=3;assert.deepEqual(p().toArray(),[4,4,10]);tray.position.z=0;assert.deepEqual(p().toArray(),[4,4,7]);
 assert.equal(liftingPointWorld(root,[0,0,0],'missing'),null);const duplicate=new T.Group();duplicate.name=eye.name;root.add(duplicate);assert.equal(p(),null);
 assert.deepEqual(liftingPointWorld(root,[1,2,3]).toArray(),[4,6,8]);
 })


test('sling uses offset hook geometry without moving the saved attachment frame',()=>{
 const crane=new T.Group(),hook=new T.Mesh(new T.BoxGeometry(1,1,1).translate(0,20,0));crane.add(hook);crane.position.set(3,4,5);crane.scale.setScalar(2);
 assert.deepEqual(slingAnchorWorld(hook).toArray(),[3,44,5]);
 const event={parent_id:'crane',matrix:new T.Matrix4().toArray()};const before=loadEventWorld(event,hook);
 slingAnchorWorld(hook);near(loadEventWorld(event,hook),before);
 hook.position.y=5;assert.deepEqual(slingAnchorWorld(hook).toArray(),[3,54,5]);hook.position.y=0;assert.deepEqual(slingAnchorWorld(hook).toArray(),[3,44,5]);
 const marker=new T.Group();marker.position.y=2;crane.add(marker);assert.deepEqual(slingAnchorWorld(marker).toArray(),[3,8,5]);
})

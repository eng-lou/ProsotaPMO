import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/soilSimulation';export * from './src/modules/fourD/soilPlayback';export * as THREE from 'three'`,loader:'ts',resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm'})
const {THREE,bakeSoil,soilFrameAt,soilBasis,createSoilPlayback,validateSoil,bucketOpeningAngle,calibrateBucketOpening,bucketFrame,bucketOpeningLip,bucketOpeningInFrame}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const config=()=>({enabled:true,show_guide:false,bucket_node:'/0:bucket',center:[0,0,0],size:[1.4,1,1],rotation:[0,0,0],capacity:.4,dump_angle:105,pour_seconds:1,source:[0,0,0],radius:2,height:1,up_axis:'z',start:'2026-01-01T00:00:00Z',end:'2026-01-01T00:00:10Z',duration_seconds:10,steps:240,color:'#806046'})
function pose(s,t){const u=(t-Date.parse(s.start))/10000;const upright=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);const dump=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2+(u>.55?Math.PI:0));return soilBasis(s).multiply(new THREE.Matrix4().compose(new THREE.Vector3(u<.25?0:4,0,u<.25?.8:2),u<.55?upright:dump,new THREE.Vector3(1,1,1)))}
const total=(a,cell)=>a.reduce((x,y)=>x+y,0)*cell*cell
test('scoop/carry/pour conserves volume, lands away from source and empties',()=>{
 const s=config(),b=bakeSoil(s,t=>pose(s,t)),last=b.frames.at(-1)
 assert.ok(b.frames.some(f=>f.fill>.1));assert.ok(b.frames.some(f=>f.inAir>.01));assert.ok(last.deposited>.1);assert.ok(last.fill<1e-8);assert.ok(last.inAir<1e-8)
 for(const f of b.frames){assert.ok(f.fill<=s.capacity+1e-7);assert.ok(Math.abs(total(f.source,b.sourceGrid.cell)+f.fill+f.inAir+f.deposited-b.initialVolume)<2e-6);assert.ok(Math.abs(total(f.deposit,b.depositGrid.cell)-f.deposited)<1e-6)}
 assert.ok(b.falls.every(f=>f.to[0]>3));assert.ok(last.source.every(h=>h>=0))
})
test('replay and backwards seeking are identical, including reload and post-end settling',()=>{
 const s=config(),b=bakeSoil(s,t=>pose(s,t)),first=structuredClone(soilFrameAt(b,Date.parse(s.start)+4000))
 soilFrameAt(b,Date.parse(s.end)+100000);soilFrameAt(b,Date.parse(s.start));assert.deepEqual(soilFrameAt(b,Date.parse(s.start)+4000),first)
 const reloaded=JSON.parse(JSON.stringify(s));assert.deepEqual(bakeSoil(reloaded,t=>pose(reloaded,t)).frames,b.frames)
 assert.equal(soilFrameAt(b,Date.parse(s.start)-1000).fill,0)
})
test('upright bucket retains contents; no contact never creates soil; Y-up matches Z-up',()=>{
 const s=config();const upright=bakeSoil(s,t=>pose(s,Math.min(t,Date.parse(s.start)+4000)));assert.ok(upright.frames.at(-1).fill>.1);assert.equal(upright.falls.length,0)
 const empty=bakeSoil(s,t=>new THREE.Matrix4().makeTranslation(30,30,30).multiply(pose(s,t)));assert.equal(empty.frames.at(-1).fill,0);assert.equal(empty.falls.length,0)
 const other={...s,up_axis:'y'};const a=bakeSoil(s,t=>pose(s,t)),b=bakeSoil(other,t=>pose(other,t));assert.ok(Math.abs(a.frames.at(-1).deposited-b.frames.at(-1).deposited)<1e-6)
})
test('capacity and bounds reject invalid recipes; viewport mesh updates and guides hide for capture',()=>{
 const s=config();for(const patch of [{capacity:0},{size:[1,-1,1]},{steps:100000},{end:s.start},{source:[NaN,0,0]}])assert.throws(()=>validateSoil({...s,...patch}))
 const view=createSoilPlayback(s,t=>pose(s,t));const time=Date.parse(s.start)+6000
 view.update(time,pose(s,time),true);const guide=view.group.getObjectByName('Bucket volume guide');assert.equal(guide.visible,true)
 assert.ok(view.group.getObjectByName('Bucket contents').visible||view.group.getObjectByName('Falling soil').count>0)
 view.update(time,pose(s,time),false);assert.equal(guide.visible,false);view.dispose()
})
test('returning soil lands on the source pile; visible contents stay inside the selected part',()=>{
 const s=config(),sameSpot=t=>{const p=pose(s,t);p.elements[12]=0;return p},b=bakeSoil(s,sameSpot)
 assert.ok(b.falls.length>0);assert.ok(b.falls.some(f=>f.to[2]>.1))
 const bucket=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()),v=createSoilPlayback(s,t=>pose(s,t),bucket),t=Date.parse(s.start)+4000
 v.update(t,pose(s,t));const fill=v.group.getObjectByName('Bucket contents'),position=fill.geometry.getAttribute('position')
 assert.equal(fill.visible,true)
 for(let i=0;i<position.count;i++)for(const axis of ['getX','getY','getZ'])assert.ok(Math.abs(position[axis](i))<=.50001)
 v.dispose();bucket.geometry.dispose();bucket.material.dispose()
})

test('mouth-up calibration fixes a reversed reference without moving volume, pile or timing; saved playback holds then pours',()=>{
 for(const up_axis of ['y','z']){
  const s={...config(),up_axis,rotation:[THREE.MathUtils.degToRad(145),0,0]},carry=pose(s,Date.parse(s.start)+4000)
  assert.ok(Math.abs(bucketOpeningAngle(s,carry)-145)<1e-6)
  const before=structuredClone(s),frame=bucketFrame(s).toArray()
  const fixed={...s,opening_direction:calibrateBucketOpening(s,carry)}
  assert.ok(bucketOpeningAngle(fixed,carry)<1e-6)
  assert.ok(bucketOpeningAngle(fixed,pose(s,Date.parse(s.start)+6000))>179)
  assert.deepEqual(bucketFrame(fixed).toArray(),frame)
  assert.deepEqual(s,before)
  const baked=bakeSoil(fixed,t=>pose(fixed,t))
  assert.ok(soilFrameAt(baked,Date.parse(s.start)+4000).fill>.1)
  assert.equal(soilFrameAt(baked,Date.parse(s.start)+4000).inAir,0)
  assert.ok(baked.frames.at(-1).deposited>.1)
  assert.ok(baked.frames.at(-1).fill<1e-8)
  const restored=JSON.parse(JSON.stringify(fixed))
  assert.deepEqual(bakeSoil(restored,t=>pose(restored,t)).frames,baked.frames)
  const lip=bucketOpeningLip(fixed),direction=bucketOpeningInFrame(fixed)
  assert.ok(lip.clone().normalize().distanceTo(direction)<1e-8)
  assert.ok(fixed.size.every((v,i)=>Math.abs(lip.getComponent(i))<=v/2+1e-8))
  const view=createSoilPlayback(fixed,t=>pose(fixed,t));view.update(Date.parse(s.start)+4000,carry,true)
  const arrow=view.group.getObjectByName('Bucket volume guide').children.find(n=>n instanceof THREE.ArrowHelper)
  const arrowUp=new THREE.Vector3(0,1,0).transformDirection(arrow.matrixWorld)
  assert.ok(arrowUp[up_axis]>.999999);view.dispose()
 }
})

test('mouth reference respects placed/scaled equipment and rejects invalid directions',()=>{
 const s=config(),world=new THREE.Matrix4().compose(new THREE.Vector3(180,2,4),new THREE.Quaternion().setFromEuler(new THREE.Euler(.6,.2,.9)),new THREE.Vector3(1.5,.8,2))
 const fixed={...s,opening_direction:calibrateBucketOpening(s,world)}
 assert.ok(bucketOpeningAngle(fixed,world)<1e-6)
 assert.deepEqual(world.toArray(),world.clone().toArray())
 for(const value of [[0,0,0],[NaN,1,0],[Infinity,0,0],[1,2]])assert.throws(()=>validateSoil({...s,opening_direction:value}))
 assert.throws(()=>calibrateBucketOpening(s,new THREE.Matrix4().makeScale(0,1,1)))
})

test('preloaded truck body carries a finite load, discharges at its rear edge and survives reload',()=>{
 const s={...config(),mode:'preloaded',initial_fill:.75,material:'gravel',dump_angle:28,outlet:[0,-.45,-.5]}
 const world=t=>new THREE.Matrix4().compose(new THREE.Vector3(3,0,2),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2+(t>Date.parse(s.start)+4000?Math.PI/3:0)),new THREE.Vector3(1,1,1))
 const b=bakeSoil(s,world)
 assert.equal(b.frames[0].fill,s.capacity*.75);assert.equal(total(b.frames[0].source,b.sourceGrid.cell),0)
 assert.equal(soilFrameAt(b,Date.parse(s.start)+3000).fill,s.capacity*.75)
 assert.ok(b.frames.at(-1).fill<1e-7);assert.ok(b.frames.at(-1).deposited>.29)
 for(const f of b.frames)assert.ok(Math.abs(f.fill+f.inAir+f.deposited-b.initialVolume)<1e-6)
 assert.deepEqual(bucketOpeningLip(s).toArray(),[0,-.45,-.5])
 assert.deepEqual(bakeSoil(JSON.parse(JSON.stringify(s)),world).frames,b.frames)
 for(const patch of [{initial_fill:1.1},{outlet:[0,0,.6]},{material:'unsupported'},{mode:'unknown'}])assert.throws(()=>validateSoil({...s,...patch}))
})

test('coarse aggregate uses bounded reusable instances; fine material remains a continuous surface',()=>{
 for(const material of ['soil','sand','gravel','rocks']){
  const s={...config(),material},v=createSoilPlayback(s,t=>pose(s,t)),t=Date.parse(s.start)+4000
  v.update(t,pose(s,t));const stones=v.group.getObjectByName('Carried aggregate'),source=v.group.getObjectByName('Source aggregate')
  assert.equal(stones.visible,material==='gravel'||material==='rocks')
  if(stones.visible){assert.ok(stones.count>0&&stones.count<=192);assert.ok(source.count>0&&source.count<=512)}
  const snapshot=stones.instanceMatrix.array.slice();v.update(Date.parse(s.end),pose(s,Date.parse(s.end)));v.update(t,pose(s,t));assert.deepEqual(stones.instanceMatrix.array,snapshot)
  v.dispose()
 }
})

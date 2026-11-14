import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const {outputFiles}=await build({stdin:{contents:`
export * from './src/modules/fourD/viewportPicking';
export * from './src/modules/fourD/navigationSession';
export * from './src/modules/fourD/visibleWater';
export * from './src/modules/fourD/visibleAnimation';
export {createPointerEvents} from '@react-three/fiber';
export * as T from 'three';
`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'})
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//# sourceURL=viewport-input-fixture.js').toString('base64'))

function sceneEvents(factory, count=1) {
 const camera=new m.T.PerspectiveCamera(50,1,.1,100);camera.position.z=4;camera.updateMatrixWorld()
 const root=new m.T.Group(),geometry=new m.T.SphereGeometry(1,24,16),material=new m.T.MeshBasicMaterial()
 let rays=0,clicks=0,wheels=0,misses=0
 for(let i=0;i<count;i++) {
  const mesh=new m.T.Mesh(geometry,material),original=mesh.raycast
  mesh.raycast=function(...args){rays++;return original.apply(this,args)}
  root.add(mesh)
 }
 root.updateMatrixWorld(true)
 const state={camera,pointer:new m.T.Vector2(),raycaster:new m.T.Raycaster(),size:{width:100,height:100},
  internal:{interaction:[root],lastEvent:{current:null},capturedMap:new Map(),hovered:new Map(),initialClick:[50,50],initialHits:[]},
  onPointerMissed:()=>misses++}
 const store={getState:()=>state,setState:patch=>Object.assign(state,patch)}
 root.__r3f={root:store,eventCount:1,handlers:{onClick:()=>clicks++}}
 state.events=factory(store)
 const event={offsetX:50,offsetY:50,pointerId:1,target:{},deltaY:30}
 return {root,state,event,emit:name=>state.events.handlers[name](event),
  wheelTool:()=>{root.__r3f.handlers.onWheel=()=>wheels++},counts:()=>({rays,clicks,wheels,misses})}
}

test('real Fiber wheel routing skips triangle picking, retains click/miss and real wheel tools',()=>{
 const s=sceneEvents(m.visibleViewportEvents)
 s.emit('onWheel');assert.equal(s.counts().rays,0)
 s.emit('onPointerDown');s.emit('onClick');assert.equal(s.counts().clicks,1)
 s.wheelTool();s.emit('onWheel');assert.equal(s.counts().wheels,1)
 s.root.visible=false;s.emit('onPointerDown');s.emit('onClick')
 assert.equal(s.counts().clicks,1);assert.equal(s.counts().misses,1)
 s.root.visible=true;s.emit('onPointerDown');s.emit('onClick');assert.equal(s.counts().clicks,2)
})

test('wheel burst avoids real visible-mesh intersections (benchmark)',()=>{
 const run=factory=>{
  const s=sceneEvents(factory,800),start=performance.now()
  for(let i=0;i<12;i++)s.emit('onWheel')
  return {ms:+(performance.now()-start).toFixed(2),rays:s.counts().rays}
 }
 const before=run(m.createPointerEvents),after=run(m.visibleViewportEvents)
 console.log(JSON.stringify({wheelEvents:12,visibleMeshes:800,before,after}))
 assert.equal(before.rays,9600);assert.equal(after.rays,0)
})

test('wheel bursts and damping share one navigation session; cleanup/capture restores once',()=>{
 const old={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout}
 let now=0,id=0,starts=0,ends=0;const timers=new Map()
 globalThis.setTimeout=(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id}
 globalThis.clearTimeout=id=>timers.delete(id)
 const advance=ms=>{now+=ms;for(const [id,timer]of timers)if(timer.at<=now){timers.delete(id);timer.fn()}}
 try {
  const session=m.createNavigationSession(()=>starts++,()=>ends++)
  for(let i=0;i<12;i++){session.start();session.end();advance(25)}
  assert.equal(starts,1);assert.equal(ends,0,'the cheap path must survive until a zoom frame is drawn')
  session.change();advance(100);session.change();advance(100);assert.equal(ends,0,'damping extends the session')
  advance(50);assert.equal(ends,1)
  session.start();advance(1000);assert.equal(ends,1,'a held drag does not time out')
  session.end();session.finish();assert.equal(ends,2,'capture restores immediately')
  advance(1000);session.finish();assert.equal(ends,2);assert.equal(timers.size,0)
 }finally{Object.assign(globalThis,old)}
})

test('only displayed water and visible assets keep ambient animation awake',()=>{
 const scene=new m.T.Scene(),parent=new m.T.Group(),mat=new m.T.MeshStandardMaterial()
 mat.userData.realisticUniforms={realClass:{value:14}}
 const water=new m.T.Mesh(new m.T.BoxGeometry(),mat);parent.add(water);scene.add(parent)
 assert.equal(m.hasVisibleWater(scene),true);assert.equal(m.isObjectRendered(water),true)
 parent.visible=false;assert.equal(m.hasVisibleWater(scene),false);assert.equal(m.isObjectRendered(water),false)
 parent.visible=true;water.visible=false;assert.equal(m.hasVisibleWater(scene),false)
 water.visible=true;mat.visible=false;assert.equal(m.hasVisibleWater(scene),false)
 mat.visible=true;mat.opacity=0;assert.equal(m.hasVisibleWater(scene),false)
 mat.opacity=1;assert.equal(m.hasVisibleWater(scene),true)
})

test('hidden, deleted and separately rendered batch water do not keep frames running',()=>{
 const mat=new m.T.MeshStandardMaterial(),data=new Uint8Array([14,0,0,0,14,0,0,0,14,0,0,0,14,0,0,0])
 mat.userData.realisticUniforms={realClass:{value:0},realClassTex:{value:{image:{data}}}}
 const batch=new m.T.BatchedMesh(4,100,200,mat),g=batch.addGeometry(new m.T.BoxGeometry()),id=batch.addInstance(g)
 assert.equal(m.hasVisibleWater(batch),true)
 batch.setVisibleAt(id,false);assert.equal(m.hasVisibleWater(batch),false,'unallocated texture slots are not water surfaces')
 batch.setVisibleAt(id,true);assert.equal(m.hasVisibleWater(batch),true,'reverse scrub restores live water')
 data[3]=255;assert.equal(m.hasVisibleWater(batch),false,'opaque shader discards separately rendered surfaces')
 data[3]=0;batch.deleteInstance(id);assert.equal(m.hasVisibleWater(batch),false)
})

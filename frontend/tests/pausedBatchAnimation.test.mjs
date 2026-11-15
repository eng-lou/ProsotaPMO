import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const source = readFileSync('src/modules/fourD/Viewport3D.tsx', 'utf8')
const start = source.indexOf('  useFrame(() => {', source.indexOf('  const lastAppliedDateMs = useRef'))
const end = source.indexOf('  })', start)
const body = source.slice(start + '  useFrame(() => {'.length, end)
const { outputFiles } = await build({ stdin: { contents: `
import * as THREE from 'three';
export { THREE };
export { DEFAULT_ANIMATION_CONFIG } from './src/modules/fourD/animationDefaults';
import { pickActiveLink, computeAppliedAnimationStateAt } from './src/modules/fourD/timelinePlayback';
import { updateInstanceVisibility } from './src/modules/fourD/viewportVisibility';
export { updateInstanceVisibility };
export { ensureBatchAnimation } from './src/modules/fourD/batchAnimationShader';
import { batchPieceWorldBounds, setBatchAnimation } from './src/modules/fourD/batchAnimationShader';
import { createBatchAnimationGate } from './src/modules/fourD/batchAnimationGate';
import { setBatchedInstanceMatrix, syncEdgesBatch } from './src/modules/fourD/elementBatching';
export function make(dateRef, batchVisibilityTargetsRef, baseline=false) {
 const gate=createBatchAnimationGate();
 const batchFrameGate=baseline?{needsUpdate:()=>true,targetsToUpdate:()=>batchVisibilityTargetsRef.current,applied:()=>{}}:gate;
 const individualFrameGate={needsUpdate:()=>true,targetsToUpdate:()=>batchVisibilityTargetsRef.current,applied:()=>{}};
 const targetsRef={current:[]},pathTargetsRef={current:[]},sceneObjects=[],activeObjectId=null,upAxis='y';
 const lastAppliedDateMs={current:null};
 const varianceByElementKey=new Map(),clashByElementKey=new Map();
 const showClashColors=false,showVarianceColors=false,renderMode='gouraud';
 const _scratchColor=new THREE.Color(),_scratchMatrix=new THREE.Matrix4(),_scratchTranslation=new THREE.Matrix4();
 const ANIMATION_VISIBILITY_EPSILON=.001;
 const growAxisWorldVector=(axis)=>new THREE.Vector3(...(axis==='x'?[1,0,0]:axis==='y'?[0,1,0]:[0,0,1]));
 const resolveVarianceTint=()=>({magnitude:0,isLate:false});
 const timingRenderer={},beginViewportWork=()=>null,endViewportWork=()=>{};
 return {frame:()=>{${body}},invalidate:()=>gate.invalidate()};
}`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const m = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text+'\n//# sourceURL=batch-frame-test.js').toString('base64'))
const { THREE } = m

function fixture(count = 3) {
 const mesh = new THREE.BatchedMesh(count, 24, 36, new THREE.MeshStandardMaterial())
 const geometryId = mesh.addGeometry(new THREE.BoxGeometry())
 const root = new THREE.Group(); root.add(mesh)
 const ids = new Map(), targets = []
 const activity={start:'2026-10-01',finish:'2026-10-11'}
 const links=[{activity, startMs:Date.parse(activity.start),finishMs:Date.parse(activity.finish),profile:{...m.DEFAULT_ANIMATION_CONFIG,color_from:null},axis:'y'}]
 let reads=0
 for(let i=0;i<count;i++) {
  const instanceId=mesh.addInstance(geometryId),expressID=i+1;ids.set(instanceId,expressID)
  targets.push({mesh,root,expressID,expressIdByInstanceId:ids,elementKey:String(i),links,
   instances:[{instanceId,geometryId,restMatrix:new THREE.Matrix4(),originalColor:new THREE.Color('white')}],
   get cachedState(){reads++;return this.state},set cachedState(value){this.state=value}})
 }
 const ref={current:targets},date={current:new Date('2026-09-30')}
 return {mesh,ref,date,reads:()=>reads}
}

test('production batch frame skips paused scans but responds to scrub, external visibility and binding changes',()=>{
 const f=fixture(), runtime=m.make(f.date,f.ref)
 runtime.frame();assert.equal(f.mesh.getVisibleAt(0),false)
 const reads=f.reads()
 for(let i=0;i<120;i++)runtime.frame()
 assert.equal(f.reads(),reads,'camera-only frames do not visit linked elements')
 // An imperative writer accidentally reveals a not-yet-built piece.
 f.mesh.setVisibleAt(0,true);runtime.frame()
 assert.equal(f.mesh.getVisibleAt(0),false)
 f.date.current=new Date('2026-10-12');runtime.frame()
 assert.equal(f.mesh.getVisibleAt(0),true)
 f.mesh.userData.batchBaseVisibleByInstanceId=new Map([[0,false]])
 m.updateInstanceVisibility(f.mesh,0);runtime.frame()
 assert.equal(f.mesh.getVisibleAt(0),false,'isolation remains authoritative')
 f.mesh.userData.batchBaseVisibleByInstanceId.set(0,true)
 m.updateInstanceVisibility(f.mesh,0);runtime.frame()
 assert.equal(f.mesh.getVisibleAt(0),true)
 f.date.current=new Date('2026-09-30');runtime.frame()
 assert.equal(f.mesh.getVisibleAt(0),false)
 const before=f.reads();runtime.invalidate();runtime.frame()
 assert.ok(f.reads()>before,'a paused selection/material commit reconciles')
 const replaced=f.reads();f.ref.current=[...f.ref.current];runtime.frame()
 assert.ok(f.reads()>replaced,'fresh bindings reconcile at an unchanged date')
})

test('55,000 linked elements: unchanged orbit work does not scale with element count',t=>{
 const f=fixture(55000)
 f.date.current=new Date('2026-10-12')
 const old=m.make(f.date,f.ref,true),next=m.make(f.date,f.ref)
 old.frame();next.frame()
 const before=f.reads(),at=performance.now()
 for(let i=0;i<60;i++)old.frame()
 const oldMs=performance.now()-at,oldReads=f.reads()-before
 const after=f.reads(),bt=performance.now()
 for(let i=0;i<60;i++)next.frame()
 const newMs=performance.now()-bt
 assert.equal(oldReads,55000*60)
 assert.equal(f.reads(),after)
 assert.equal(f.mesh.getVisibleAt(0),true)
 t.diagnostic(JSON.stringify({elements:55000,frames:60,beforeMs:+oldMs.toFixed(2),afterMs:+newMs.toFixed(2)}))
})


test('165 Grow products with 37,000 representation pieces stay batched through removal and reverse scrub',t=>{
 const f=fixture(37000),all=f.ref.current,grouped=[]
 const profile={...m.DEFAULT_ANIMATION_CONFIG,trigger:'over_duration',transform_kind:'grow',grow_mode:'remove',axis:'y',direction:-1,opacity_from:1,opacity_to:0,color_from:null,color_to:null}
 for(let at=0;at<all.length;at+=225){
  const target=all[at],instances=all.slice(at,at+225).flatMap(t=>t.instances)
  for(const piece of instances)target.expressIdByInstanceId.set(piece.instanceId,target.expressID)
  target.instances=instances;target.links=target.links.map(link=>({...link,profile}));grouped.push(target)
 }
 f.ref.current=grouped
 const runtime=m.make(f.date,f.ref);runtime.frame()
 const state=m.ensureBatchAnimation(f.mesh)
 f.date.current=new Date('2026-10-06');runtime.frame()
 assert.equal(state.texture.image.data[4],.5)
 assert.equal(state.texture.image.data[37000*8-4],.5)
 const started=performance.now()
 for(let i=0;i<10;i++){f.date.current=new Date(Date.parse('2026-10-06')+i*3600000);runtime.frame()}
 const activeMs=(performance.now()-started)/10
 f.date.current=new Date('2026-10-12');runtime.frame();assert.equal(f.mesh.getVisibleAt(36999),false)
 f.date.current=new Date('2026-09-30');runtime.frame();assert.equal(f.mesh.getVisibleAt(36999),true)
 assert.equal(state.texture.image.data[37000*8-4],1)
 assert.equal(f.mesh.parent.children.length,1,'no individual geometry nodes were created')
 const revision=state.revision
 const idleStart=performance.now();for(let i=0;i<120;i++)runtime.frame()
 assert.equal(state.revision,revision,'paused frames do not rewrite GPU animation data')
 t.diagnostic(JSON.stringify({pieces:37000,products:grouped.length,activeFrameMs:activeMs,paused120FramesMs:performance.now()-idleStart}))
 f.mesh.dispose()
})

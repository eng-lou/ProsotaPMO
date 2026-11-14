import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const source = readFileSync('src/modules/fourD/Viewport3D.tsx', 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('  useFrame(() => {', source.indexOf('  const lastAppliedDateMs = useRef'))
const end = source.indexOf('  })', start)
const body = source.slice(start + '  useFrame(() => {'.length, end)
const axisStart = source.indexOf('function growAxisWorldVector(')
const axisFunction = source.slice(axisStart, source.indexOf('\n}\n', axisStart) + 2)
const { outputFiles } = await build({ stdin: { contents: `
import * as THREE from 'three'; export {THREE};
export {DEFAULT_ANIMATION_CONFIG} from './src/modules/fourD/animationDefaults';
import {pickActiveLink,computeAppliedAnimationStateAt} from './src/modules/fourD/timelinePlayback';
import {updateMeshVisibility} from './src/modules/fourD/viewportVisibility';
import {applyAnimationOpacity} from './src/modules/fourD/animationRendering';
import {mergeClipPlanes} from './src/modules/fourD/clipPlaneOwnership';
import {syncRealisticVariant} from './src/modules/fourD/realisticMaterials';
import {createIndividualAnimationGate} from './src/modules/fourD/individualAnimationGate';
export {createIndividualAnimationGate};
${axisFunction}
export function make(dateRef,targetsRef,baseline=false) {
 const batchVisibilityTargetsRef={current:[]},pathTargetsRef={current:[]},sceneObjects=[];
 const activeObjectId=null,upAxis='y',lastAppliedDateMs={current:null};
 const batchFrameGate={needsUpdate:()=>false};
 const individualFrameGate=baseline?{needsUpdate:()=>true,applied:()=>{}}:createIndividualAnimationGate();
 const varianceByElementKey=new Map(),clashByElementKey=new Map();
 const showClashColors=false,showVarianceColors=false,renderMode='realistic';
 const _scratchColor=new THREE.Color(),_scratchPosition=new THREE.Vector3(),_scratchScale=new THREE.Vector3(),_scratchEuler=new THREE.Euler();
 const DEG_TO_RAD=Math.PI/180,ANIMATION_VISIBILITY_EPSILON=.001;
 const resolveVarianceTint=()=>({magnitude:0,isLate:false});
 const timingRenderer={},beginViewportWork=()=>null,endViewportWork=()=>{};
 const frame=()=>{${body}};
 frame.invalidate=()=>individualFrameGate.invalidate?.();
 return frame;
}`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const m = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text + '\n//# sourceURL=paused-individual-fixture.js').toString('base64'))
const { THREE: T } = m
function fixture(count=1,remove=false) {
  const geometry=new T.BoxGeometry(),targets=[]
  const profile={...m.DEFAULT_ANIMATION_CONFIG,transform_kind:'grow',grow_mode:remove?'remove':'reveal',color_from:null,
    opacity_from:remove?1:0,opacity_to:remove?0:1}
  const link={profile,axis:'z',startMs:Date.parse('2026-10-01'),finishMs:Date.parse('2026-10-11')}
  let writes=0
  for(let i=0;i<count;i++) {
    const material=new T.MeshStandardMaterial({color:'#c0a080'})
    let planes=null
    Object.defineProperty(material,'clippingPlanes',{get:()=>planes,set:value=>{planes=value;writes++}})
    const mesh=new T.Mesh(geometry,material)
    const variant=new T.MeshStandardMaterial()
    variant.userData.realisticClass=0;variant.userData.realisticUniforms={realClass:{value:0}}
    material.userData.realisticVariant=variant;mesh.material=variant
    targets.push({object:mesh,links:[link],basePosition:mesh.position.clone(),baseRotation:mesh.rotation.clone(),baseScale:mesh.scale.clone(),
      keyframeTracks:{},materials:[{mesh,material,originalColor:material.color.clone()}],worldBBox:new T.Box3(new T.Vector3(-.5,-.5,-.5),new T.Vector3(.5,.5,.5))})
  }
  return {ref:{current:targets},date:{current:new Date(remove?'2026-10-12':'2026-09-30')},writes:()=>writes}
}

test('hidden paused pieces avoid material writes but stay hidden after selection; reverse restores replacement variants',()=>{
  for(const remove of [false,true]) {
    const f=fixture(1,remove),frame=m.make(f.date,f.ref),target=f.ref.current[0],{mesh,material}=target.materials[0]
    frame();frame();assert.equal(mesh.visible,false)
    const writes=f.writes()
    for(let i=0;i<120;i++)frame()
    assert.equal(f.writes(),writes)
    mesh.visible=true
    const variant=new T.MeshStandardMaterial()
    variant.userData.realisticClass=0;variant.userData.realisticUniforms={realClass:{value:0}}
    material.userData.realisticVariant=variant;mesh.material=variant
    frame.invalidate();frame();assert.equal(mesh.visible,false,'selection cannot reveal a hidden scheduled piece')
    f.date.current=new Date('2026-10-06');frame()
    assert.equal(mesh.visible,true);assert.equal(variant.visible,true)
    assert.equal(variant.opacity,.5);assert.equal(variant.depthWrite,false)
    assert.equal(variant.clippingPlanes.length,1)
    mesh.userData.baseVisible=false;frame.invalidate();frame();assert.equal(mesh.visible,false,'manual hide remains composed')
    mesh.userData.baseVisible=true;frame.invalidate();frame();assert.equal(mesh.visible,true)
    f.date.current=new Date(remove?'2026-09-30':'2026-10-12');frame()
    assert.equal(variant.opacity,1);assert.equal(variant.depthWrite,true)
    assert.equal(mesh.visible,true);assert.equal(variant.clippingPlanes,null)
  }
})

test('10,000 hidden individual grow targets: paused orbit avoids clipping/material work',t=>{
  const f=fixture(10000),before=m.make(f.date,f.ref,true),after=m.make(f.date,f.ref)
  before();after();after()
  let at=performance.now()
  for(let i=0;i<60;i++)before()
  const oldMs=performance.now()-at,writes=f.writes()
  at=performance.now()
  for(let i=0;i<60;i++)after()
  const newMs=performance.now()-at
  assert.equal(f.writes(),writes)
  assert.ok(f.ref.current.every(t=>!t.object.visible))
  t.diagnostic(JSON.stringify({elements:10000,frames:60,beforeMs:+oldMs.toFixed(2),afterMs:+newMs.toFixed(2)}))
})

test('visible grow pieces skip unchanged work before, during and after orbit; reconcile edits',()=>{
  const f=fixture(),frame=m.make(f.date,f.ref),target=f.ref.current[0],{mesh,material}=target.materials[0]
  f.date.current=new Date('2026-10-06');frame();frame()
  const writes=f.writes()
  for(let i=0;i<120;i++)frame()
  assert.equal(f.writes(),writes,'visible pieces do not keep rewriting clipping/materials')
  // No camera state is needed: cached updates also apply after mouse release.
  const variant=material.userData.realisticVariant
  variant.visible=false;variant.opacity=1;frame()
  assert.equal(variant.visible,true);assert.equal(variant.opacity,.5)
  material.color.set('red');frame.invalidate();frame();assert.equal(material.color.getHexString(),'c0a080')
  const plane=material.clippingPlanes[0],constant=plane.constant
  plane.constant+=20;frame.invalidate();frame();assert.equal(material.clippingPlanes[0].constant,constant)
  mesh.position.x+=20;frame();assert.equal(mesh.position.x,0)
  mesh.visible=false;frame();assert.equal(mesh.visible,true)
  mesh.userData.baseVisible=false;frame.invalidate();frame();assert.equal(mesh.visible,false)
  mesh.userData.baseVisible=true;frame.invalidate();frame();assert.equal(mesh.visible,true)
  mesh.userData.simulatorOwnsPose=true;mesh.position.x=40;frame()
  assert.equal(mesh.position.x,40);assert.equal(variant.opacity,1)
  delete mesh.userData.simulatorOwnsPose;frame()
  assert.equal(mesh.position.x,0);assert.equal(variant.opacity,.5)
  const before=f.writes();frame.invalidate();frame();assert.ok(f.writes()>before,'React commit reconciles')
  f.date.current=new Date('2026-10-12');frame();assert.equal(variant.opacity,1)
  f.date.current=new Date('2026-10-06');frame();assert.equal(variant.opacity,.5)
})

test('10,000 visible individual grow targets: orbit and settled frames reuse applied state',t=>{
  const f=fixture(10000);f.date.current=new Date('2026-10-06')
  const before=m.make(f.date,f.ref,true),after=m.make(f.date,f.ref)
  before();after();after();after()
  let at=performance.now()
  for(let i=0;i<60;i++)before()
  const oldMs=performance.now()-at,writes=f.writes()
  at=performance.now()
  for(let i=0;i<60;i++)after()
  const newMs=performance.now()-at
  assert.equal(f.writes(),writes)
  assert.ok(f.ref.current.every(t=>t.object.visible))
  t.diagnostic(JSON.stringify({visibleElements:10000,frames:60,beforeMs:+oldMs.toFixed(2),afterMs:+newMs.toFixed(2)}))
})


test('a new binding and same-date schedule/profile updates reconcile without camera movement',()=>{
  const f=fixture(),frame=m.make(f.date,f.ref)
  f.date.current=new Date('2026-10-06');frame();frame()
  const added=fixture().ref.current[0]
  added.cachedActiveLink=added.links[0]
  added.cachedState={positionOffset:[0,0,0],rotationOffsetDeg:0,scaleMultiplier:1,opacity:.25,color:null,growProgress:.25}
  f.ref.current=[...f.ref.current,added];frame()
  assert.equal(added.materials[0].material.opacity,.25)
  added.cachedState={...added.cachedState,opacity:.75,growProgress:.75};frame()
  assert.equal(added.materials[0].material.opacity,.75)
  const material=added.materials[0].material
  material.userData.surfaceBaseOpacity=.5;frame.invalidate();frame()
  assert.equal(material.opacity,.375,'same-date authored material edit remains composed with animation')
  assert.equal(material.userData.realisticVariant.opacity,.375)
})


test('paused guard detects in-place display material slot replacement',()=>{
  const f=fixture(),target=f.ref.current[0],mesh=target.object,gate=m.createIndividualAnimationGate()
  mesh.material=[mesh.material];gate.applied(target)
  assert.equal(gate.needsUpdate(target,false),false)
  mesh.material[0]=new T.MeshStandardMaterial()
  assert.equal(gate.needsUpdate(target,false),true)
})

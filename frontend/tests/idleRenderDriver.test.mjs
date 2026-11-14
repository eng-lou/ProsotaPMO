import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'

const {outputFiles}=await build({stdin:{contents:`
export * from './src/modules/fourD/IdleRenderDriver';
export * as THREE from 'three';
`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',plugins:[{
 name:'driver-hooks',setup(b){
  b.onResolve({filter:/^(react|@react-three\/fiber)$/},args=>({path:args.path,namespace:'hooks'}))
  b.onLoad({filter:/.*/,namespace:'hooks'},args=>({contents:args.path==='react'
    ? 'export const useRef=current=>({current}); export const useEffect=effect=>globalThis.driverHarness.effects.push(effect);'
    : 'export const useThree=select=>select(globalThis.driverHarness.state);',loader:'js'}))
 }
}]})
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//# sourceURL=idle-driver-fixture.js').toString('base64'))

test('release settles quickly; hover stays idle; damping, playback, changes and export remain supported',()=>{
 const original={window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,
   cancelAnimationFrame:globalThis.cancelAnimationFrame,HTMLCanvasElement:globalThis.HTMLCanvasElement,performance:globalThis.performance}
 let now=0,frames=0,id=0,advances=0
 const raf=new Map(),events=new Map(),effects=[],cleanups=[]
 const camera=new m.THREE.PerspectiveCamera(),dateRef={current:new Date('2026-11-01')}
 globalThis.performance={now:()=>now}
 globalThis.HTMLCanvasElement=class Canvas{}
 globalThis.window={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name)=>events.delete(name)}
 globalThis.requestAnimationFrame=fn=>{raf.set(++id,fn);return id}
 globalThis.cancelAnimationFrame=id=>raf.delete(id)
 const canvas=new globalThis.HTMLCanvasElement()
 globalThis.driverHarness={effects,state:{frameloop:'demand',camera,gl:{domElement:canvas},invalidate:()=>frames++,advance:()=>advances++}}
 const tick=time=>{now=time;const work=[...raf.values()];raf.clear();for(const fn of work)fn(time)}
 const emit=(type,buttons=0,target=canvas)=>events.get(type)?.({type,buttons,target,pointerId:1})
 try {
  m.IdleRenderDriver({dateRef,continuous:false});for(const effect of effects)cleanups.push(effect())
  tick(0);emit('pointerdown',1);tick(16);emit('pointerup');tick(32)
  const releaseFrames=frames;tick(200);tick(400);tick(800)
  assert.equal(frames,releaseFrames,'no 1.5-second full-render burst after release')
  emit('pointermove');tick(820);assert.equal(frames,releaseFrames,'plain hover must not wake expensive effects')
  for (const type of ['wheel','keydown','pointerdown','pointermove','pointerup']) emit(type,1,{})
  tick(840);assert.equal(frames,releaseFrames,'side-panel input must not wake a settled viewport')
  tick(1000);assert.equal(frames,releaseFrames+1,'async resources retain an idle heartbeat')
  camera.matrixWorld.elements[12]=1;tick(1100)
  assert.equal(frames,releaseFrames+2,'real camera movement/damping wakes rendering')
  tick(1400);const beforeCommit=frames
  effects[1]() // an unrelated parent UI commit
  assert.equal(frames,beforeCommit+1,'commit reconciles the scene once')
  tick(1410);assert.equal(frames,beforeCommit+1,'UI commits must not start a continuous-render tail')
  const quiet=frames
  dateRef.current=new Date('2026-11-02');tick(1420);assert.equal(frames,quiet+1,'scrub wakes rendering')
  tick(1450);dateRef.current=new Date('2026-11-03');tick(1470);assert.ok(frames>quiet+2)
  tick(1800);const beforeExternal=frames;m.markRenderActivity();tick(1816)
  assert.equal(frames,beforeExternal+1,'mixers and capture requests can request frames')
  m.setOfflineExportActive(true);const beforeExport=frames;tick(1832)
  assert.equal(frames,beforeExport,'offline export does not double-render')
  m.renderAllViewsNow();assert.equal(advances,1)
 } finally {
  m.setOfflineExportActive(false)
  for(const cleanup of cleanups.reverse())cleanup?.()
  assert.equal(events.size,0);assert.equal(raf.size,0)
  delete globalThis.driverHarness;Object.assign(globalThis,original)
 }
})

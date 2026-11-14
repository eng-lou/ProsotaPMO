import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
const source = readFileSync('src/modules/fourD/Viewport3D.tsx', 'utf8')
const start = source.indexOf('  useFrame(() => {', source.indexOf('  const lastAppliedDateMs = useRef'))
const end = source.indexOf('  })', start)
const body = source.slice(start + '  useFrame(() => {'.length, end)
const code = (await transform(`export function make(env) {
const {dateRef, onTick, reconcile} = env;
const targetsRef={current:[]}, batchVisibilityTargetsRef={current:[]};
const pathTargetsRef={current:[{object:{userData:{}}}]};
const sceneObjects=[{object:{}}], activeObjectId='selected', upAxis='y';
const lastAppliedDateMs={current:null};
const batchFrameGate={needsUpdate:()=>true,applied:()=>{}};
const individualFrameGate={needsUpdate:()=>true,applied:()=>{}};
const timingRenderer={},beginViewportWork=()=>null,endViewportWork=()=>{};
const applyPathFollow=()=>{}, syncEdgesBatch=reconcile;
return () => {${body}};
}`, {loader:'ts',format:'esm'})).code
const {make} = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('paused selection avoids repeated React updates while scrub and reverse update',()=>{
 let updates=0, reconciliations=0
 const dateRef={current:new Date(2026,0,1)}
 const frame=make({dateRef,onTick:()=>updates++,reconcile:()=>reconciliations++})
 frame()
 for(let i=0;i<120;i++) frame()
 assert.equal(updates,1)
 assert.equal(reconciliations,121)
 dateRef.current=new Date(2026,1,1);frame()
 dateRef.current=new Date(2026,0,1);frame()
 assert.equal(updates,3)
})
const fourD=readFileSync('src/modules/fourD/FourD.tsx','utf8')
const expression=fourD.match(/const needsResourceData = (.*)/)[1]
const demand=new Function('active','openWindows','needsCostProfile',`return ${expression}`)
test('BIM resource data is requested only for an open consumer',()=>{
 assert.equal(demand(true,new Set(),false),false)
 assert.equal(demand(true,new Set(['schedule']),false),false)
 for(const panel of ['tracking','usage']) assert.equal(demand(true,new Set([panel]),false),true)
 assert.equal(demand(true,new Set(),true),true)
 assert.equal(demand(false,new Set(['tracking']),true),false)
})


test('first/last selection does not invalidate the whole model unless fading unselected',()=>{
 const body=source.match(/const heavyDeps = \[([\s\S]*?)\n    \]/)[1]
 const names=['objects','settings','hasSelection','upAxis','customTextures','customOpacity','isolateMode','isolatedObjectIds','isolatedElementKeys','hiddenExpressIds','varianceByElementKey','clashByElementKey','materializeVersion','realisticMapping','realisticInfoVersion']
 const evaluate=new Function(...names,`return [${body}]`)
 const dependencies=Array.from({length:names.length},()=>({}))
 const settings={xrayUnselected:false};dependencies[1]=settings
 const run=selected=>{dependencies[2]=selected;return evaluate(...dependencies)}
 assert.deepEqual(run(false),run(true))
 settings.xrayUnselected=true
 assert.notDeepEqual(run(false),run(true))
})

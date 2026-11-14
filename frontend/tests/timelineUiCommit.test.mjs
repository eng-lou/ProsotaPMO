import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

// Execute the production memo/effect with React's dependency comparison. This
// catches accidental cache invalidation by unrelated parent UI renders.
const source=readFileSync('src/modules/fourD/Viewport3D.tsx','utf8').replace(/\r\n/g,'\n')
const memo=source.match(/const animationAppearanceRevision = useMemo\(\(\) => \(\{\}\), \[([\s\S]*?)\]\)/)
const effect=source.match(/useLayoutEffect\(\(\) => \{ batchFrameGate.invalidate\(\); individualFrameGate.invalidate\(\) \}, appearanceRevision \? \[([\s\S]*?)\] : undefined\)/)
const names=text=>text.split(',').map(s=>s.trim()).filter(Boolean)
const memoNames=names(memo[1]),effectNames=names(effect[1])
const readMemo=new Function('useMemo',...memoNames,`${memo[0]};return animationAppearanceRevision`)
const runEffect=new Function('useLayoutEffect','batchFrameGate','individualFrameGate',...effectNames,effect[0])
const equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]))

test('panel/button commits retain paused caches; selection, appearance, transforms and schedule edits invalidate them',()=>{
 const values=Object.fromEntries([...new Set([...memoNames,...effectNames])].map(name=>[name,{}]))
 let memoDeps,effectDeps,token,batch=0,individual=0
 const useMemo=(create,deps)=>{if(!equal(memoDeps,deps)){token=create();memoDeps=deps}return token}
 const useLayoutEffect=(effect,deps)=>{if(!equal(effectDeps,deps))effect();effectDeps=deps}
 const render=()=>{
  values.appearanceRevision=readMemo(useMemo,...memoNames.map(name=>values[name]))
  runEffect(useLayoutEffect,{invalidate:()=>batch++},{invalidate:()=>individual++},...effectNames.map(name=>values[name]))
 }
 render()
 for(let i=0;i<30;i++){values.panelOpen=i%2;values.search=String(i);render()}
 assert.equal(individual,1);assert.equal(batch,1)
 const changes=['selectedObjectIds','selectedExpressIds','hiddenExpressIds','isolatedElementKeys','customTextures','customOpacity',
  'settings','realisticMapping','realisticInfoVersion','transformTick','sectionBoxes','materializeVersion',
  'activities','links','profiles','elementKeyframes','paths','sceneObjects','simulationScenario']
 for(const name of changes){const before=individual;values[name]={};render();assert.equal(individual,before+1,name);render();assert.equal(individual,before+1)}
 assert.equal(batch,individual)
})

test('comparison callers without a token retain their reconciliation fallback',()=>{
 const values=Object.fromEntries(effectNames.map(name=>[name,{}]));values.appearanceRevision=undefined
 let reconciles=0
 for(let i=0;i<3;i++)runEffect((effect,deps)=>{assert.equal(deps,undefined);effect()},
  {invalidate:()=>reconciles++},{invalidate:()=>{}},...effectNames.map(name=>values[name]))
 assert.equal(reconciles,3)
})

test('parent section-box props stay stable across UI renders but update for real box changes',()=>{
 const parent=readFileSync('src/modules/fourD/FourD.tsx','utf8').replace(/\r\n/g,'\n')
 const all=parent.match(/const allSectionBoxes = useMemo\([^\n]+/)[0]
 const resolved=parent.match(/const resolvedSectionBoxes: ResolvedSectionBox\[\] = useMemo\([\s\S]*?\n  \}\), \[[^\n]+\]\)/)[0].replace(': ResolvedSectionBox[]','')
 const evaluate=new Function('useMemo','sectionBoxes','siteBoxes','siteRoots','sceneObjects','sectionBoxElementIds','draggingSectionBox','draggingSectionBoxRotation',
  `${all};${resolved};return resolvedSectionBoxes`)
 let cursor=0;const slots=[]
 const useMemo=(create,deps)=>{const i=cursor++;if(!equal(slots[i]?.deps,deps))slots[i]={deps,value:create()};return slots[i].value}
 const box={id:'box',model3d_file_id:'file',element_ref:null,active:true,visible:true,rot_x:0,rot_y:0,rot_z:0}
 const boxes=[box],site=[],roots=new Map(),scene=[{id:'model',fileId:'file'}],ids={}
 const render=(drag=null,models=scene)=>{cursor=0;return evaluate(useMemo,boxes,site,roots,models,ids,drag,null)}
 const first=render();assert.equal(render(),first);assert.equal(render(),first)
 const drag={id:'box',bounds:{min_x:3}}
 const moving=render(drag);assert.notEqual(moving,first);assert.equal(moving[0].bounds,drag.bounds)
 assert.equal(moving[0].pivotBounds,box);assert.equal(render(drag),moving)
 assert.deepEqual(render(null,[]),[],'unloaded geometry is removed from clipping targets')
})

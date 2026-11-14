import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'
import * as THREE from 'three'
const s=readFileSync('src/modules/fourD/Viewport3D.tsx','utf8')
const publish=s.slice(s.indexOf('        // Selection materializes batch instances'),s.indexOf('        for (const previous of pathTargetsRef.current)'))
const start=s.indexOf('    if (selectedExpressId === null) return',s.indexOf('// Surgical migration'))
const migrate=s.slice(start,s.indexOf('  }, [selectedExpressId])',start))
const code=(await transform(`export function run(env){
const {ifcHandles,batchVisibilityTargetsRef,expressIdToBatchTargetRef,selectedExpressId,targetsRef,dateRef,getMaterializedMeshes}=env;
const upAxis='y',varianceByElementKey=new Map();
const pickActiveLink=links=>links[0],computeAppliedAnimationStateAt=()=>({opacity:0}),getOriginalMaterialSlots=()=>[],collectStandardMaterials=()=>[],resolveVarianceTint=()=>({magnitude:0,isLate:false});
${publish}
${migrate}
}`,{loader:'ts',format:'esm'})).code
const {run}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
test('production selection migration reconnects paused animation, including duplicate IDs in separate models',()=>{
 const roots=[new THREE.Group(),new THREE.Group()],meshes=roots.map(()=>new THREE.Mesh())
 const targets=roots.map(root=>({root,expressID:56,links:[{activityId:'cabin'}]}))
 const env={ifcHandles:roots.map((object,i)=>({object,modelID:i})),batchVisibilityTargetsRef:{current:targets},expressIdToBatchTargetRef:{current:new Map()},selectedExpressId:56,targetsRef:{current:[]},dateRef:{current:new Date('2026-01-01')},getMaterializedMeshes:root=>[meshes[roots.indexOf(root)]]}
 run(env)
 assert.equal(env.batchVisibilityTargetsRef.current.length,0)
 assert.deepEqual(env.targetsRef.current.map(t=>t.elementKey),['ifc-0::56','ifc-1::56'])
 for(const target of env.targetsRef.current){assert.equal(target.cachedState.opacity,0);assert.equal(target.links[0].activityId,'cabin')}
 assert.equal(env.expressIdToBatchTargetRef.current.get(56).length,0)
})

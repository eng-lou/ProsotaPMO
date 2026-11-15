import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`
export {createBatchAnimationGate} from './src/modules/fourD/batchAnimationGate';
export {ensureBatchAnimation,setBatchAnimation,clearBatchAnimation,batchAnimationRevision,batchPieceWorldBounds} from './src/modules/fourD/batchAnimationShader';
export {DEFAULT_ANIMATION_CONFIG} from './src/modules/fourD/animationDefaults';
export {simplifyContextGeometry,registerContextGeometry,fullDetailGeometry} from './src/modules/fourD/contextGeometry';
export * as T from 'three';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'})
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//# sourceURL=batch-regression.js').toString('base64'))
const {T}=m
const day=86400000
const link=(start,end,extra={})=>({startMs:start*day,finishMs:end*day,profile:{...m.DEFAULT_ANIMATION_CONFIG,trigger:'over_duration',...extra}})
function batch(count=4){const mesh=new T.BatchedMesh(count,24,36,new T.MeshStandardMaterial());const shape=mesh.addGeometry(new T.BoxGeometry());for(let i=0;i<count;i++)mesh.addInstance(shape);return {mesh,shape}}

test('event index updates crossing/active windows and skips settled work in both directions',()=>{
 const {mesh}=batch(),gate=m.createBatchAnimationGate()
 const targets=[{mesh,links:[link(10,20)]},{mesh,links:[link(30,40)]},{mesh,links:[link(50,60)]}]
 const step=(at)=>{const changed=gate.needsUpdate(targets,true,at*day),result=[...gate.targetsToUpdate()];if(changed)gate.applied();return result}
 assert.equal(step(0).length,3)
 assert.equal(step(1).length,0)
 assert.deepEqual(step(15),[targets[0]])
 assert.deepEqual(step(25),[targets[0]])
 assert.equal(step(26).length,0)
 assert.deepEqual(step(45),[targets[1]])
 assert.deepEqual(step(5),[targets[1],targets[0]])
 assert.equal(step(4).length,0)
 gate.invalidate();assert.equal(step(4).length,3,'paused metadata/appearance edits invalidate the index')
})

test('event index includes extended start/finish transitions, gaps and multiple links',()=>{
 const {mesh}=batch(),gate=m.createBatchAnimationGate()
 const targets=[{mesh,links:[link(10,11,{trigger:'on_start',duration_frames:8})]},
 {mesh,links:[link(30,31,{trigger:'on_finish',duration_frames:8})]},
 {mesh,links:[link(40,41),link(50,51)]}]
 gate.needsUpdate(targets,true,0);gate.applied()
 for(const [from,to,wanted] of [[15,16,0],[24,25,1],[45,46,2]]) {
  gate.needsUpdate(targets,true,from*day);gate.applied()
  assert.equal(gate.needsUpdate(targets,true,to*day),true)
  assert.deepEqual(gate.targetsToUpdate(),[targets[wanted]]);gate.applied()
 }
 // Schedule-only mutation reuses target identity; invalidation must rebuild.
 targets[0].links=[link(100,110)]
 gate.invalidate();gate.needsUpdate(targets,true,95*day);gate.applied()
 assert.equal(gate.needsUpdate(targets,true,101*day),true)
 assert.deepEqual(gate.targetsToUpdate(),[targets[0]])
})

test('batch state resets reused slots, respects manual visibility and releases owned textures',()=>{
 const {mesh,shape}=batch(),plane=new T.Plane(new T.Vector3(0,1,0),-3)
 m.setBatchAnimation(mesh,1,.3,plane)
 const state=m.ensureBatchAnimation(mesh),data=state.texture.image.data
 assert.deepEqual([...data.slice(8,13)],[0,1,0,-3,Math.fround(.3)])
 const revision=m.batchAnimationRevision(mesh)
 m.setBatchAnimation(mesh,1,.3,plane)
 assert.equal(m.batchAnimationRevision(mesh),revision,'identical frames do not upload state')
 mesh.setVisibleAt(1,false);m.clearBatchAnimation(mesh,[1])
 assert.equal(mesh.getVisibleAt(1),false,'unlinking must not override manual hiding')
 m.setBatchAnimation(mesh,1,0,plane);mesh.deleteInstance(1)
 assert.equal(mesh.addInstance(shape),1)
 assert.deepEqual([...data.slice(8,13)],[0,0,0,0,1])
 let disposed=0;state.texture.addEventListener('dispose',()=>disposed++)
 mesh.dispose();assert.equal(disposed,1)
})

test('Grow bounds include model transforms and each representation placement',()=>{
 const {mesh,shape}=batch(),root=new T.Group();root.position.set(10,20,30);root.add(mesh)
 const bounds=m.batchPieceWorldBounds(mesh,shape,new T.Matrix4().makeTranslation(2,3,4))
 assert.deepEqual(bounds.min.toArray(),[11.5,22.5,33.5]);assert.deepEqual(bounds.max.toArray(),[12.5,23.5,34.5])
})

test('context reduction preserves source arrays and export resolves full detail',()=>{
 const source=new T.PlaneGeometry(100,100,256,256),before=source.attributes.position.array.slice()
 const data={position:source.attributes.position.array,normal:source.attributes.normal.array,uv:source.attributes.uv.array,index:new Uint32Array(source.index.array)}
 const reduced=m.simplifyContextGeometry(data)
 assert.ok(reduced.index.length<source.index.count*.2)
 assert.deepEqual(source.attributes.position.array,before)
 const coarse=new T.BufferGeometry();m.registerContextGeometry(coarse,source)
 assert.equal(m.fullDetailGeometry(coarse),source);assert.equal(m.fullDetailGeometry(source),source)
 assert.ok([...reduced.index].every(i=>i<reduced.position.length/3))
})

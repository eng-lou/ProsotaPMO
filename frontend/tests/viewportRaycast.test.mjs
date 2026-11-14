import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/viewportRaycast'; export * as T from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {enableVisibleViewportRaycast,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const ray=()=>new T.Raycaster(new T.Vector3(0,0,4),new T.Vector3(0,0,-1))
test('viewport prunes hidden groups and meshes, restores on scrub; geometry queries unchanged',()=>{
 const group=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial())
 group.add(mesh);group.updateMatrixWorld(true)
 const viewport=ray(),geometryQuery=ray();enableVisibleViewportRaycast(viewport)
 assert.ok(viewport.intersectObject(group).length)
 for(const hidden of [group,mesh]) {
  hidden.visible=false
  assert.equal(viewport.intersectObject(group).length,0)
  assert.ok(geometryQuery.intersectObject(group).length)
  hidden.visible=true
  assert.ok(viewport.intersectObject(group).length)
 }
})
test('instance and batched picking retain IDs and per-instance visibility',()=>{
 const geometry=new T.BoxGeometry(),material=new T.MeshBasicMaterial()
 const inst=new T.InstancedMesh(geometry,material,1);inst.setMatrixAt(0,new T.Matrix4());inst.updateMatrixWorld(true)
 const batch=new T.BatchedMesh(2,100,200,material),g=batch.addGeometry(geometry),id=batch.addInstance(g)
 batch.updateMatrixWorld(true)
 const r=ray();enableVisibleViewportRaycast(r)
 assert.equal(r.intersectObject(inst)[0].instanceId,0)
 assert.equal(r.intersectObject(batch)[0].batchId,id)
 batch.setVisibleAt(id,false);assert.equal(r.intersectObject(batch).length,0)
 batch.setVisibleAt(id,true);assert.equal(r.intersectObject(batch)[0].batchId,id)
 inst.visible=false;batch.visible=false
 assert.equal(r.intersectObjects([inst,batch]).length,0)
})
test('hidden-model benchmark uses real triangle intersection',()=>{
 const root=new T.Group(),geometry=new T.SphereGeometry(1,24,16),material=new T.MeshBasicMaterial()
 for(let i=0;i<800;i++) root.add(new T.Mesh(geometry,material))
 root.updateMatrixWorld(true);root.visible=false
 const r=ray();const run=()=>{const start=performance.now();for(let i=0;i<12;i++)r.intersectObject(root);return performance.now()-start}
 const before=run();enableVisibleViewportRaycast(r);const after=run()
 console.log(JSON.stringify({hiddenMeshes:800,rays:12,beforeMs:+before.toFixed(2),afterMs:+after.toFixed(2)}))
 assert.equal(r.intersectObject(root).length,0)
})

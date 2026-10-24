import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/clipPathAnchor';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {clipPathAnchor,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('clip footprint anchoring samples a detached copy without changing the live pose',()=>{
 const root=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(2,4,2));mesh.name='actor';mesh.position.set(20,7,3);root.add(mesh);root.scale.setScalar(.5)
 const clip=new T.AnimationClip('walk',1,[new T.VectorKeyframeTrack('actor.position',[0,1],[4,2,6,5,2,6])]);const original=mesh.position.clone()
 const offset=clipPathAnchor(root,clip);assert.ok(offset.distanceTo(new T.Vector3(-2,0,-3))<1e-7);assert.ok(mesh.position.equals(original))
})

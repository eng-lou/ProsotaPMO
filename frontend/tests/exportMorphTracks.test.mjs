import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ stdin: { contents: "export * from './src/modules/fourD/exportMorphTracks'; export * as T from 'three'; export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'; export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';", resolveDir: process.cwd() }, bundle:true,write:false,format:'esm' })
const {exportMorphTracks,T,GLTFExporter,GLTFLoader}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
globalThis.FileReader=class {
 readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()})}
 readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result='data:application/octet-stream;base64,'+Buffer.from(result).toString('base64');this.onloadend?.()})}
}
function fixture(){
 const root=new T.Group(),geometry=new T.BoxGeometry(),mesh=new T.Mesh(geometry,new T.MeshStandardMaterial())
 mesh.name='Kevin';geometry.morphAttributes.position=[geometry.attributes.position.clone(),geometry.attributes.position.clone()]
 geometry.morphAttributes.position[0].name='Smile';geometry.morphAttributes.position[1].name='Blink';mesh.updateMorphTargets();root.add(mesh)
 const clip=new T.AnimationClip('Walk',1,[new T.NumberKeyframeTrack('Kevin.morphTargetInfluences[0]',[0,1],[0,1]),new T.NumberKeyframeTrack('Kevin.morphTargetInfluences[1]',[0,1],[1,0]),new T.VectorKeyframeTrack('Kevin.position',[0,1],[0,0,0,2,0,0])])
 return {root,mesh,clip}
}
test('indexed FBX blend shapes round-trip through GLB with motion and weights intact',async()=>{
 const {root,clip}=fixture()
 await assert.rejects(new GLTFExporter().parseAsync(root,{binary:true,animations:[clip]}),/Morph target name not found: 0/)
 const clips=exportMorphTracks(root,[clip])
 assert.equal(clip.tracks[0].name,'Kevin.morphTargetInfluences[0]')
 const bytes=await new GLTFExporter().parseAsync(root,{binary:true,animations:clips})
 const loaded=await new GLTFLoader().parseAsync(bytes,'')
 assert.equal(loaded.animations.length,1)
 const mixer=new T.AnimationMixer(loaded.scene);mixer.clipAction(loaded.animations[0]).play();mixer.setTime(.25)
 const mesh=loaded.scene.getObjectByName('Kevin')
 assert.ok(Math.abs(mesh.morphTargetInfluences[0]-.25)<1e-6)
 assert.ok(Math.abs(mesh.morphTargetInfluences[1]-.75)<1e-6)
 assert.ok(Math.abs(mesh.position.x-.5)<1e-6)
})
test('numeric shape names retain their binding and interpolation',()=>{
 const {root,mesh,clip}=fixture();mesh.morphTargetDictionary={'0':1,Smile:0}
 clip.tracks[0].setInterpolation(T.InterpolateDiscrete)
 const exported=exportMorphTracks(root,[clip]);assert.equal(exported[0].tracks[0].name,clip.tracks[0].name)
 assert.equal(exported[0].tracks[0].getInterpolation(),T.InterpolateDiscrete)
})
test('invalid blend shape binding fails clearly without discarding animation',()=>{
 const {root,clip}=fixture();clip.tracks[0].name='Kevin.morphTargetInfluences[99]'
 assert.throws(()=>exportMorphTracks(root,[clip]),/missing morph target "99"/)
})

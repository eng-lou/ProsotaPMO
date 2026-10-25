import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/importAssetMotion';export * from './src/modules/fourD/assetPose';export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {transferMotion,captureAssetBindPose,applyInitialAssetPose,THREE}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
function rig(){const root=new THREE.Group(),hip=new THREE.Bone(),hand=new THREE.Bone();hip.name='Hip';hand.name='Hand';hand.position.y=1;root.add(hip);hip.add(hand);captureAssetBindPose(root);return {root,hip,hand}}
test('initial pose remains without retaining or playing animation clips',()=>{
 const {root,hip}=rig();root.animations=[new THREE.AnimationClip('Pose',1,[new THREE.VectorKeyframeTrack('Hip.position',[0,1],[0,2,0,0,3,0])])]
 applyInitialAssetPose(root);root.animations=[];assert.equal(hip.position.y,2);assert.equal(hip.userData.prosotaBindPose.position[1],0)
})
test('motion transfers to matching nodes, including joints represented as groups, without mutating source or target pose',()=>{
 const a=rig(),b=rig();const replacement=new THREE.Group();replacement.name=b.hand.name;replacement.position.copy(b.hand.position);replacement.userData=structuredClone(b.hand.userData);b.hip.remove(b.hand);b.hip.add(replacement)
 a.root.animations=[new THREE.AnimationClip('Dig',1,[new THREE.QuaternionKeyframeTrack('Hand.quaternion',[0,1],[0,0,0,1,0,0,1,0])])]
 const clips=transferMotion(a.root,b.root);assert.equal(clips.length,1);assert.equal(a.root.animations[0].tracks[0].name,'Hand.quaternion');assert.equal(replacement.quaternion.w,1)
 const mixer=new THREE.AnimationMixer(b.root);mixer.clipAction(clips[0]).play();mixer.setTime(.5);assert.ok(Math.abs(replacement.quaternion.z)>.6)
})
test('missing bones and incompatible rest rotations reject before changing target',()=>{
 const a=rig(),b=rig();a.root.animations=[new THREE.AnimationClip('Dig',1,[new THREE.VectorKeyframeTrack('Hand.position',[0,1],[0,1,0,0,1,0])])]
 b.hand.name='Other';assert.throws(()=>transferMotion(a.root,b.root),/missing bone/);b.hand.name='Hand';b.hand.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),1);captureAssetBindPose(b.root);assert.throws(()=>transferMotion(a.root,b.root),/rest skeleton/)
})
test('static mesh export tracks may be ignored but animated non-bone motion is rejected',()=>{
 const a=rig(),b=rig(),mesh=new THREE.Object3D();mesh.name='Body';a.root.add(mesh)
 const track=new THREE.VectorKeyframeTrack('Body.position',[0,1],[0,0,0,0,0,0]);a.root.animations=[new THREE.AnimationClip('Dig',1,[track,new THREE.VectorKeyframeTrack('Hip.position',[0,1],[0,0,0,0,1,0])])]
 assert.equal(transferMotion(a.root,b.root)[0].tracks.length,1);track.values[4]=1;assert.throws(()=>transferMotion(a.root,b.root),/non-bone/)
})

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

function ccRig(scale=1,angle=0){
 const root=new THREE.Group(),nodes={}
 const add=(name,parent,p=[0,0,0])=>{const b=new THREE.Bone();b.name=name;b.position.fromArray(p).multiplyScalar(scale);(nodes[parent]||root).add(b);nodes[name]=b;return b}
 add('RL_BoneRoot','');add('CC_Base_Hip','RL_BoneRoot',[0,0,100]);add('CC_Base_Pelvis','CC_Base_Hip');add('CC_Base_Spine01','CC_Base_Pelvis',[0,0,20]);add('CC_Base_Head','CC_Base_Spine01',[0,0,30])
 for(const s of ['L','R']){let p='CC_Base_Pelvis';for(const n of ['Thigh','Calf','Foot']){add(`CC_Base_${s}_${n}`,p,[0,0,-20]);p=`CC_Base_${s}_${n}`}p='CC_Base_Spine01';for(const n of ['Upperarm','Forearm','Hand']){add(`CC_Base_${s}_${n}`,p,[20,0,0]);p=`CC_Base_${s}_${n}`}}
 nodes.CC_Base_L_Upperarm.rotation.z=angle;nodes.CC_Base_L_Forearm.rotation.x=angle/2;captureAssetBindPose(root)
 return {root,nodes}
}
test('CC motion adapts rest axes and body proportions without manual mapping',()=>{
 const a=ccRig(),b=ccRig(.9,.4),bone=a.nodes.CC_Base_L_Forearm,dest=b.nodes.CC_Base_L_Forearm
 const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.7)
 a.root.animations=[new THREE.AnimationClip('Work',1,[new THREE.QuaternionKeyframeTrack(bone.name+'.quaternion',[0,1],[...bone.quaternion.toArray(),...q.toArray()]),new THREE.VectorKeyframeTrack('CC_Base_Hip.position',[0,1],[0,0,100,0,0,110])])]
 const c=transferMotion(a.root,b.root)[0],r=c.tracks[0]
 assert.ok(new THREE.Quaternion().fromArray(r.values,0).angleTo(dest.quaternion)<1e-6)
 const expected=b.nodes.CC_Base_L_Upperarm.quaternion.clone().invert().multiply(q).multiply(b.nodes.CC_Base_L_Upperarm.quaternion).multiply(dest.quaternion)
 assert.ok(new THREE.Quaternion().fromArray(r.values,4).normalize().angleTo(expected.normalize())<1e-6)
 assert.equal(c.tracks[1].values[5],99)
 b.nodes.CC_Base_Head.parent.remove(b.nodes.CC_Base_Head);b.nodes.CC_Base_Hip.add(b.nodes.CC_Base_Head)
 assert.throws(()=>transferMotion(a.root,b.root),/rest skeleton/)
})
test('CC source placement is removed while travel and height are preserved; face channels do not reject body motion',()=>{
 const a=ccRig(),b=ccRig(.9),face=new THREE.Object3D();face.name='Face';a.root.add(face)
 a.root.animations=[new THREE.AnimationClip('Walk',1,[new THREE.VectorKeyframeTrack('RL_BoneRoot.position',[0,1],[30,700,2,50,710,7]),new THREE.NumberKeyframeTrack('Face.morphTargetInfluences[0]',[0,1],[0,1])])]
 const notices=new Set(),c=transferMotion(a.root,b.root,notices)[0]
 assert.equal(c.tracks.length,1);assert.equal(notices.size,1)
 Array.from(c.tracks[0].values).forEach((v,i)=>assert.ok(Math.abs(v-[0,0,1.8,18,9,6.3][i])<1e-5))
 assert.equal(a.root.animations[0].tracks[0].values[1],700)
})

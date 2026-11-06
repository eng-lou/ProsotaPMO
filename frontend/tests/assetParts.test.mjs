import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/assetParts';export * from './src/modules/fourD/siteSchedule';export * as THREE from 'three'",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'})
const {THREE,inspectAssetParts,splitSiteAsset,extractAssetPart,siteAssetPlacement,buildSiteSchedule}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-6,`${v} != ${b[i]}`))
function source(){const root=new THREE.Group();root.scale.set(.1,.2,.3);const materials=[new THREE.MeshStandardMaterial(),new THREE.MeshStandardMaterial()];for(let i=0;i<3;i++){const group=new THREE.Group();group.name='same';group.userData.prosotaSourceFile=`0${i+1}_part.glb`;group.position.set(i*4,2,0);const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,3,4),materials[i%2]);mesh.rotation.z=.2;group.add(mesh);root.add(group)}return root}
const item={id:'parent',name:'Assembly',kind:'asset',asset_id:'asset',up_axis:'z',position:{x:20,y:30,z:4},width:10,height:20,depth:30,yaw:25,rotation:{x:.1,y:.3,z:.4},scale:{x:2,y:.7,z:1.2},object_state:{content_position:{x:1,y:2,z:3},content_rotation:{x:.2,y:0,z:.5},content_scale:{x:1,y:2,z:.5}}}
test('each source file becomes its own part without duplicate-name collisions',()=>{const root=source(),parts=splitSiteAsset(item,root);assert.equal(parts.length,3);assert.equal(new Set(parts.map(p=>p.id)).size,3);assert.equal(parts[1].name,'02 part');assert.ok(parts.every(p=>p.rig_disabled&&!p.path_motion&&!p.activity_id));assert.deepEqual(inspectAssetParts(root).map(p=>p.path),[[0],[1],[2]])})
test('extraction preserves exact world geometry under pivots, nonuniform scale and rotation, including after reload',()=>{
 const root=source(),parts=JSON.parse(JSON.stringify(splitSiteAsset(item,root))),original=siteAssetPlacement(item);root.updateMatrixWorld(true)
 for(let i=0;i<3;i++){const node=root.children[i].children[0],part=extractAssetPart(root,parts[i].asset_part),mesh=part.children[0].children[0];const before=original.clone().multiply(node.matrixWorld),after=siteAssetPlacement(parts[i]).multiply(mesh.matrixWorld);for(const point of [[0,0,0],[1,1,1],[-2,3,4]])near(new THREE.Vector3(...point).applyMatrix4(before).toArray(),new THREE.Vector3(...point).applyMatrix4(after).toArray());assert.equal(mesh.geometry,node.geometry);assert.equal(mesh.material,node.material)}
})
test('mesh mode never duplicates child meshes and invalid/animated models fail explicitly',()=>{
 const root=source();const a=root.children[0].children[0];a.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));const parts=splitSiteAsset({...item,object_state:null},root,'meshes');assert.equal(parts.length,4);assert.equal(parts.reduce((sum,p)=>{let count=0;extractAssetPart(root,p.asset_part).traverse(n=>{if(n.isMesh)count++});return sum+count},0),4)
 assert.throws(()=>extractAssetPart(root,{path:[99],transform:new THREE.Matrix4().toArray()}),/missing/);root.animations=[new THREE.AnimationClip('walk',1,[])];assert.throws(()=>inspectAssetParts(root),/skeleton or animation/)
})
test('3D schedule respects checked order, durations, source kind and profile without making IFC assumptions',()=>{
 const parts=splitSiteAsset(item,source()),rows=parts.map((p,i)=>({id:p.id,name:p.name,hours:2+i,include:i!==1})).reverse();const payload=buildSiteSchedule('p','period',parts,rows,{name:'Build',calendarId:'cal',sequence:true,profile:'drop',upAxis:'z',distance:7})
 assert.equal(payload.activities.length,3);assert.deepEqual(payload.activities.slice(1).map(a=>a.element_refs[0]),[parts[2].id,parts[0].id]);assert.equal(payload.activities[1].source_kind,'site');assert.equal(payload.relationships[0].successor_temp_id,parts[0].id);assert.equal(payload.site_animation_profile.distance,7);assert.equal(payload.site_animation_profile.color_from,null)
})

test('large assemblies retain every independent part and extraction skips unrelated branches',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(2,3,4),material=new THREE.MeshStandardMaterial()
 root.position.set(3,4,5);root.scale.set(.1,.2,.3)
 for(let i=0;i<3447;i++){const group=new THREE.Group();group.name=`Part ${i}`;group.position.set(i%60,Math.floor(i/60),i%7);group.add(new THREE.Mesh(geometry,material));root.add(group)}
 let siblingUpdates=0
 root.children[1].updateWorldMatrix=()=>{siblingUpdates++;throw Error('Unrelated branch updated')}
 const parts=JSON.parse(JSON.stringify(splitSiteAsset({...item,object_state:null},root)))
 assert.equal(parts.length,3447);assert.equal(new Set(parts.map(p=>p.id)).size,3447);assert.equal(siblingUpdates,0)
 for(const i of [0,1723,3446]){
   const original=root.children[i].children[0];original.updateWorldMatrix(true,false)
   const extracted=extractAssetPart(root,parts[i].asset_part),mesh=extracted.children[0].children[0]
   const before=siteAssetPlacement({...item,object_state:null}).multiply(original.matrixWorld),after=siteAssetPlacement(parts[i]).multiply(mesh.matrixWorld)
   near(new THREE.Vector3(1,1,1).applyMatrix4(before).toArray(),new THREE.Vector3(1,1,1).applyMatrix4(after).toArray())
   assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material)
 }
})

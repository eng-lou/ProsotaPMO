import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/animatedAssetBounds';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {animatedAssetBounds,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('animated skin remains pickable at current pose after cached bounds and path movement',()=>{
 const g=new T.BoxGeometry(1,2,1),count=g.attributes.position.count
 g.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(count*4),4))
 const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1
 g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4))
 const mesh=new T.SkinnedMesh(g,new T.MeshBasicMaterial()),bone=new T.Bone(),root=new T.Group();root.add(mesh);mesh.add(bone);mesh.bind(new T.Skeleton([bone]));root.updateMatrixWorld(true)
 const ray=new T.Raycaster(new T.Vector3(0,0,10),new T.Vector3(0,0,-1))
 assert.ok(ray.intersectObject(root,true).length);mesh.computeBoundingBox()
 bone.position.x=5;root.updateMatrixWorld(true);ray.ray.origin.x=5
 assert.equal(ray.intersectObject(root,true).length,0,'reproduce cached pose miss')
 const invalidate=animatedAssetBounds(root);invalidate()
 assert.ok(ray.intersectObject(root,true).length)
 root.position.x=20;bone.position.x=-3;invalidate();ray.ray.origin.x=17
 assert.ok(ray.intersectObject(root,true).length)
 assert.equal(mesh.frustumCulled,false)
 let scans=0;const compute=mesh.computeBoundingSphere.bind(mesh);mesh.computeBoundingSphere=()=>{scans++;compute()}
 for(let i=0;i<60;i++){bone.position.x+=.01;invalidate();if(mesh.boundingSphere===null)mesh.computeBoundingSphere()}
 assert.equal(scans,0,'draw sorting must not rescan animated vertices')
 ray.intersectObject(root,true);assert.equal(scans,0,'picking uses exact triangles without an extra full skin scan')
 ray.intersectObject(root,true);assert.equal(scans,0,'same-pose picking avoids skin bounds scans')
})

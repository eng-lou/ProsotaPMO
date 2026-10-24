import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/siteObjectTransform';export * from './src/modules/fourD/elementPivot';export * from './src/modules/fourD/applyTransform';export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {THREE,captureSiteObjectState,restoreSiteObjectState,setPivot,setPivotRotation,applyTransformKeepPosition}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const make=()=>{const root=new THREE.Group(),content=new THREE.Group(),animation=new THREE.Group();root.add(content);content.add(animation);animation.add(new THREE.Mesh(new THREE.BoxGeometry(2,3,4)));return root}
const matrix=root=>{root.updateMatrixWorld(true);return root.children[0].children[0].children[0].matrixWorld.elements.slice()}
const close=(a,b)=>a.forEach((x,i)=>assert.ok(Math.abs(x-b[i])<1e-8,`${i}: ${x} != ${b[i]}`))
for(const bake of [false,true])test(`pivot and content transforms persist (apply=${bake})`,()=>{
 const root=make();root.position.set(5,6,7);root.rotation.set(.2,.3,.4)
 setPivot(root,new THREE.Vector3(1,2,3));setPivotRotation(root,new THREE.Euler(.1,.2,.3))
 if(bake)applyTransformKeepPosition(root)
 const expected=matrix(root),saved=JSON.parse(JSON.stringify(captureSiteObjectState(root))),reloaded=make()
 reloaded.position.copy(root.position);reloaded.quaternion.copy(root.quaternion);reloaded.scale.copy(root.scale)
 restoreSiteObjectState(reloaded,saved);close(matrix(reloaded),expected)
 setPivot(root,new THREE.Vector3(2,1,0));setPivot(reloaded,new THREE.Vector3(2,1,0));close(matrix(reloaded),matrix(root))
 assert.deepEqual(reloaded.children[0].children[0].position.toArray(),[0,0,0])
})

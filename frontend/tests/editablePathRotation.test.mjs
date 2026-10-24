import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/editablePathRotation';export * from './src/modules/fourD/pathCurve';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {applyEditablePathRotation,buildPathCurve,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('legacy mesh binding retains orientation and accepts panel corrections after turns',()=>{
 const parent=new T.Group(),object=new T.Group();parent.rotation.x=Math.PI/2;parent.add(object);object.rotation.set(.2,.3,.4);object.scale.setScalar(.01)
 const curve=buildPathCurve([{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:10,z:0}],false,'straight')
 const initial=object.quaternion.clone(),state={base:initial.clone(),last:null}
 applyEditablePathRotation(object,state,curve,0,0,'z');assert.ok(initial.angleTo(object.quaternion)<1e-7)
 applyEditablePathRotation(object,state,curve,75,0,'z');const turned=object.quaternion.clone();object.rotation.z+=.4;const corrected=object.quaternion.clone()
 applyEditablePathRotation(object,state,curve,75,0,'z');assert.ok(corrected.angleTo(object.quaternion)<1e-7);assert.ok(turned.angleTo(object.quaternion)>.1);assert.equal(object.scale.x,.01)
})

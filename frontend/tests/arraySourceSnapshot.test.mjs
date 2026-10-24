import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/arraySourceSnapshot';export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {arraySourceSnapshot,disposeArraySnapshot,THREE}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('scene source preserves dimensions and authored material without changing source',()=>{
 const parent=new THREE.Group(),source=new THREE.Group();parent.position.set(40,50,60);parent.add(source)
 const material=new THREE.MeshStandardMaterial({color:'red'}),highlight=new THREE.MeshBasicMaterial({color:'blue'})
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,3,4),highlight);mesh.userData.standardMaterial=material;source.add(mesh);source.scale.set(2,1,1)
 const snapshot=arraySourceSnapshot(source,'z','Traffic light');const box=new THREE.Box3().setFromObject(snapshot)
 assert.deepEqual(box.getSize(new THREE.Vector3()).toArray().map(v=>Math.round(v)),[4,4,3]);assert.equal(box.min.y,0)
 assert.equal(snapshot.children[0].material.color.getHexString(),'ff0000');assert.equal(mesh.material,highlight);assert.equal(source.parent,parent)
 disposeArraySnapshot(snapshot);assert.equal(mesh.geometry.getAttribute('position').count,24)
})
test('instanced and generated geometry can become an independent array source',()=>{
 const instanced=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),2)
 instanced.setMatrixAt(0,new THREE.Matrix4());instanced.setMatrixAt(1,new THREE.Matrix4().makeTranslation(3,0,0))
 const source=arraySourceSnapshot(instanced,'y','Fence');assert.equal(source.children.length,2)
 assert.equal(new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3()).x,4)
 disposeArraySnapshot(source)
})

test('single-material extrusions retain every face when converted to grouped results',()=>{
 const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(4,0);shape.lineTo(4,4);shape.lineTo(0,4);shape.closePath()
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:2,bevelEnabled:false})
 assert.ok(geometry.groups.some(g=>g.materialIndex===1))
 const source=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial())
 const copy=arraySourceSnapshot(source,'z','Ground')
 assert.equal(copy.children[0].geometry.groups.length,0)
 assert.ok(geometry.groups.some(g=>g.materialIndex===1))
 disposeArraySnapshot(copy)
})

test('serialized material metadata does not replace the live material',()=>{
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:'red'}))
 mesh.userData.standardMaterial=mesh.material.toJSON()
 const copy=arraySourceSnapshot(mesh,'y','Restored mesh')
 assert.equal(copy.children[0].material.color.getHexString(),'ff0000')
 disposeArraySnapshot(copy)
})

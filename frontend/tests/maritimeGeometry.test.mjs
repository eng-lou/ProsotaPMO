import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * as THREE from 'three'; export {buildPortGeometry} from './src/modules/maritime/importedPortGeometry.ts';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'})
const {THREE:T,buildPortGeometry}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const target=(objects,keys=[])=>({objectIds:new Set(objects),expressKeys:new Set(keys),expressIds:new Set(keys.map(k=>+k.split('::').at(-1)))})
const source=(id,object,sourceUpAxis='y',kind='mesh')=>({id,name:id,object,kind,sourceUpAxis})
const near=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-6,`${a} != ${b}`))

test('linked model keeps imported dimensions, axis and position without reparenting the source',()=>{
 const root=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(4,6,8),new T.MeshStandardMaterial({color:'red'}))
 root.position.set(10,20,30);root.scale.set(2,3,4);root.add(mesh)
 mesh.material.userData.viewerCache={material:mesh.material}
 const originalParent=new T.Group();originalParent.add(root)
 const scene=buildPortGeometry([source('crane.glb',root,'z')],new Map([['crane',target(['crane.glb'])]]))
 const asset=scene.assets.get('crane')
 near(asset.origin,[10,14,-20]);near(asset.size,[8,32,18])
 assert.equal(asset.elements,1);assert.equal(root.parent,originalParent);assert.equal(mesh.parent,root)
 assert.equal(scene.context.children[0].children.length,0,'assigned geometry is not drawn twice')
 let clone;asset.object.traverse(n=>{if(n.isMesh)clone=n})
 assert.equal(clone.geometry,mesh.geometry,'vertex buffers are shared')
 assert.notEqual(clone.material,mesh.material,'selection/status cannot alter the import material')
 clone.material.color.set('green');assert.equal(mesh.material.color.getHexString(),'ff0000')
 let disposed=false;mesh.geometry.addEventListener('dispose',()=>disposed=true)
 scene.dispose();assert.equal(disposed,false,'port cleanup must not dispose source geometry')
})

test('IFC links are scoped to the owning model and include every geometry piece',()=>{
 const roots=[new T.Group(),new T.Group()]
 roots.forEach((root,i)=>{root.position.x=i*100;for(const z of [0,4]){const mesh=new T.Mesh(new T.BoxGeometry(2,2,2),new T.MeshStandardMaterial());mesh.position.z=z;mesh.userData.expressID=10;root.add(mesh)}})
 const scene=buildPortGeometry(roots.map((r,i)=>source(`ifc-${i}`,r,'y','ifc')),new Map([['crane',target(['ifc-1'],['ifc-1::10'])]]))
 const asset=scene.assets.get('crane');near(asset.origin,[100,-1,2]);near(asset.size,[2,2,6])
 let count=0;asset.object.traverse(n=>{if(n.isMesh)count++});assert.equal(count,2)
 assert.equal(scene.context.children[0].children[0].children.length,2,'same EXPRESS id in another model stays unassigned')
 assert.equal(roots[1].children.length,2);scene.dispose()
})

test('batched IFC extraction preserves the rest of the model and independent comparison views',()=>{
 const root=new T.Group(),geometry=new T.BoxGeometry(2,4,2),batch=new T.BatchedMesh(3,100,150,new T.MeshStandardMaterial())
 const geometryId=batch.addGeometry(geometry),byExpressId=new Map(),reverse=new Map()
 for(let id=1;id<=2;id++){
  const instanceId=batch.addInstance(geometryId),matrix=new T.Matrix4().makeTranslation(id*20,2,0)
  batch.setMatrixAt(instanceId,matrix);batch.setColorAt(instanceId,new T.Color('yellow'))
  byExpressId.set(id,[{geometryId,instanceId,matrix,color:new T.Color('yellow'),colorAlpha:1,ifcGeometryId:1}]);reverse.set(instanceId,id)
 }
 root.add(batch);root.userData.batch={mesh:batch,byExpressId,expressIdByInstanceId:reverse,geometryById:new Map([[geometryId,geometry]]),geometryByIfcId:new Map()}
 const models=[source('ifc-1',root,'y','ifc')],targets=new Map([['crane',target(['ifc-1'],['ifc-1::1'])]])
 const a=buildPortGeometry(models,targets),b=buildPortGeometry(models,targets)
 near(a.assets.get('crane').origin,[20,0,0]);a.assets.get('crane').object.position.x+=50
 assert.notEqual(a.assets.get('crane').object.position.x,b.assets.get('crane').object.position.x)
 assert.equal(byExpressId.size,2);assert.equal(batch.getVisibleAt(0),true)
 const contextBatch=a.context.children[0].children[0].userData.batch
 assert.equal(contextBatch.byExpressId.size,1);assert.equal(contextBatch.mesh.getVisibleAt(1),true)
 a.dispose();b.dispose();assert.equal(batch.getVisibleAt(0),true)
})

test('unresolved or removed links do not produce substitute geometry',()=>{
 const scene=buildPortGeometry([],new Map([['missing',target(['gone.glb'])]]))
 assert.equal(scene.assets.size,0);assert.equal(scene.bounds.isEmpty(),true);scene.dispose()
})

import { Box3, Group, Material, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Object3D } from 'three'
import { cloneSceneHierarchy, disposeClonedBatch } from '../fourD/sceneClone'
import { getMaterializedMeshes, type BatchState } from '../fourD/elementBatching'
import { axisCorrectionRotation } from '../fourD/upAxis'
import { parseElementKey, type ResolvedIsolationTarget } from '../fourD/linkedElements'
import type { SharedSceneModel } from '../fourD/modelSceneBridge'
import type { Position } from './portPlayback'
import { getOriginalMaterialSlots } from '../fourD/elementBaseline'

export interface ImportedAssetGeometry {object:Group;origin:Position;size:Position;elements:number}
export interface PortGeometry {context:Group;assets:Map<string,ImportedAssetGeometry>;bounds:Box3;dispose:()=>void}

/** Separate scene nodes, shared vertex buffers. Only clones are moved or tinted. */
export function buildPortGeometry(models:SharedSceneModel[],targets:Map<string,ResolvedIsolationTarget>):PortGeometry {
  const context=new Group(),roots=new Map<string,Object3D>(),assets=new Map<string,ImportedAssetGeometry>()
  const materials=new Set<Material>(),geometries=new Set<BufferGeometry>(),batches:BatchState[]=[]
  const baseColours=new Map<Material,import('three').Color>()
  for(const model of models)model.object.traverse(node=>{
    if(!(node instanceof Mesh))return
    const slots=getOriginalMaterialSlots(node),standard=node.userData.standardMaterial??node.material
    ;(Array.isArray(standard)?standard:[standard]).forEach((m:Material,i:number)=>{if(slots[i])baseColours.set(m,slots[i].color)})
  })
  const copyMaterial=(m:Material)=>{
    // Viewer material caches can contain circular references to other materials.
    // Mask only that metadata while copying, without touching the source.
    const source=Object.create(m) as Material;source.userData={}
    const copy=source.clone();copy.clippingPlanes=null
    if('color' in copy&&baseColours.has(m))(copy.color as import('three').Color).copy(baseColours.get(m)!)
    if(copy instanceof MeshStandardMaterial){copy.emissive.set(0);copy.emissiveIntensity=0}
    materials.add(copy);return copy
  }
  for(const model of models){
    const root=cloneSceneHierarchy(model.object),wrapper=new Group()
    roots.set(model.id,root)
    const rotation=axisCorrectionRotation(model.sourceUpAxis,'y');wrapper.rotation.set(...rotation)
    wrapper.add(root);context.add(wrapper)
    root.traverse(node=>{
      node.visible=!node.userData.isSplitAway
      if(node instanceof Mesh && !('isBatchedMesh' in node)){
        node.material=Array.isArray(node.material)?node.material.map(copyMaterial):copyMaterial(node.material)
        node.userData.standardMaterial=node.material;node.castShadow=true;node.receiveShadow=true
      }
    })
    const batch=root.userData.batch as BatchState|undefined
    if(batch){
      batches.push(batch)
      for(const infos of batch.byExpressId.values())for(const info of infos){
        batch.mesh.setVisibleAt(info.instanceId,true)
        batch.mesh.setColorAt(info.instanceId,info.color)
        batch.mesh.setMatrixAt(info.instanceId,info.matrix)
      }
    }
  }
  context.updateMatrixWorld(true)
  const claimed=new Set<Object3D>()
  for(const [id,target] of targets){
    const group=new Group();group.name=`Maritime asset ${id}`
    let count=0
    const take=(node:Object3D)=>{
      if(claimed.has(node)||node.userData.isSplitAway)return false
      claimed.add(node)
      // Preserve the complete parent matrix, including nonuniform scale.
      const frame=new Group();frame.matrixAutoUpdate=false
      frame.matrix.copy(node.parent?.matrixWorld??context.matrixWorld)
      frame.add(node);group.add(frame);return true
    }
    for(const objectId of target.objectIds){
      const root=roots.get(objectId);if(!root)continue
      const keys=[...target.expressKeys].map(parseElementKey).filter(k=>k?.objectId===objectId)
      if(!keys.length){if(take(root))count++;continue}
      for(const key of keys){
        const wasBatched=(root.userData.batch as BatchState|undefined)?.byExpressId.has(key!.expressId)
        const meshes=getMaterializedMeshes(root,key!.expressId)
        root.updateMatrixWorld(true)
        for(const mesh of meshes){
          if(wasBatched){geometries.add(mesh.geometry);(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>materials.add(m))}
          mesh.castShadow=true;mesh.receiveShadow=true
        }
        if(meshes.map(take).some(Boolean))count++
      }
    }
    const bounds=new Box3().setFromObject(group)
    if(bounds.isEmpty())continue
    const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3())
    const origin:Position=[center.x,bounds.min.y,center.z]
    group.position.set(-origin[0],-origin[1],-origin[2])
    assets.set(id,{object:group,origin,size:size.toArray() as Position,elements:count})
  }
  // Overall framing includes linked elements removed from the context hierarchy.
  const bounds=new Box3().setFromObject(context)
  for(const a of assets.values())bounds.union(new Box3(new Vector3(a.origin[0]-a.size[0]/2,a.origin[1],a.origin[2]-a.size[2]/2),new Vector3(a.origin[0]+a.size[0]/2,a.origin[1]+a.size[1],a.origin[2]+a.size[2]/2)))
  return {context,assets,bounds,dispose:()=>{materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());batches.forEach(disposeClonedBatch)}}
}

import { useEffect, useMemo, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import type { SiteItem } from './siteScene'
import { attachmentNode } from './workerActions'
import { loadRoots,loadDates,loadEventAt,loadEventWorld,liftingPointWorld } from './loadHandling'

export function LoadHandlingLayer({items,roots,dateRef}:{items:SiteItem[];roots:MutableRefObject<Map<string,T.Group>>;dateRef:MutableRefObject<Date|null>}){
  const rig=useMemo(()=>new T.Group(),[])
  const material=useMemo(()=>new T.MeshStandardMaterial({color:'#d6a63c',metalness:.65,roughness:.5}),[])
  const geometry=useMemo(()=>new T.CylinderGeometry(.014,.014,1,8),[])
  useEffect(()=>()=>{geometry.dispose();material.dispose();for(const [id,root] of roots.current)if(loadRoots.get(id)===root){loadRoots.delete(id);loadDates.delete(id)}},[geometry,material,roots])
  useFrame(()=>{
    const date=dateRef.current?.getTime()??NaN,done=new Set<string>(),visiting=new Set<string>();let leg=0
    for(const [id,root] of roots.current){loadRoots.set(id,root);loadDates.set(id,date)}
    for(const id of loadRoots.keys())if(!roots.current.has(id)){loadRoots.delete(id);loadDates.delete(id)}
    const apply=(item:SiteItem):void=>{
      if(done.has(item.id)||visiting.has(item.id))return
      visiting.add(item.id)
      const object=roots.current.get(item.id),event=loadEventAt(item.load_handling?.events||[],date)
      if(!object)return
      if(object.userData.simulatorOwnsPose){delete object.userData.loadHandlingActive;return}
      if(!event){
        if(object.userData.loadHandlingActive){object.position.set(item.position.x,item.position.y,item.position.z);object.rotation.set(item.rotation?.x||0,item.rotation?.y||0,item.rotation?.z||0);object.scale.set(item.scale?.x??1,item.scale?.y??1,item.scale?.z??1);object.updateWorldMatrix(true,true)}
        delete object.userData.loadHandlingActive;done.add(item.id);return
      }
      const parentItem=items.find(i=>i.id===event.parent_id)
      if(parentItem)apply(parentItem)
      const parent=event.parent_id&&roots.current.get(event.parent_id),anchor=parent?attachmentNode(parent,event.node):null
      const world=loadEventWorld(event,anchor)
      if(!world&&object.userData.loadHandlingActive){
        object.position.set(item.position.x,item.position.y,item.position.z);object.rotation.set(item.rotation?.x||0,item.rotation?.y||0,item.rotation?.z||0);object.scale.set(item.scale?.x??1,item.scale?.y??1,item.scale?.z??1);object.updateWorldMatrix(true,true);delete object.userData.loadHandlingActive
      }
      if(world&&object.parent){
        object.parent.updateWorldMatrix(true,false)
        const local=object.parent.matrixWorld.clone().invert().multiply(world)
        local.decompose(object.position,object.quaternion,object.scale);object.updateWorldMatrix(true,true);object.userData.loadHandlingActive=true
        if(event.slings&&anchor){
          rig.updateWorldMatrix(true,false);const inverse=rig.matrixWorld.clone().invert(),top=anchor.getWorldPosition(new T.Vector3()).applyMatrix4(inverse)
          for(const [index,point] of (item.load_handling?.lifting_points||[]).entries()){
            const endpoint=liftingPointWorld(object,point,item.load_handling?.lifting_nodes?.[index]);if(!endpoint)continue
            const bottom=endpoint.applyMatrix4(inverse),length=top.distanceTo(bottom)
            let mesh=rig.children[leg++] as T.Mesh
            if(!mesh){mesh=new T.Mesh(geometry,material);rig.add(mesh)}
            mesh.visible=length>1e-6&&object.visible
            for(let n:T.Object3D|null=object;n;n=n.parent)if(!n.visible)mesh.visible=false
            for(let n:T.Object3D|null=anchor;n;n=n.parent)if(!n.visible)mesh.visible=false
            mesh.position.copy(bottom).add(top).multiplyScalar(.5);mesh.scale.set(1,length,1);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),top.clone().sub(bottom).normalize())
          }
        }
      }
      done.add(item.id);visiting.delete(item.id)
    }
    items.forEach(apply);for(let i=leg;i<rig.children.length;i++)rig.children[i].visible=false
  })
  return <primitive object={rig}/>
}

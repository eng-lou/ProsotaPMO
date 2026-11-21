import {applyLiftRig,liftDiagnostics} from './liftRigRuntime'
import {balanceSuspendedLoad} from './suspendedLoad'
import { useEffect, useMemo, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import type { SiteItem } from './siteScene'
import { attachmentNode } from './workerActions'
import { loadRoots,loadDates,loadEventAt,loadEventWorld,liftingPointWorld,slingConnection,slingEditors } from './loadHandling'

export function LoadHandlingLayer({items,roots,dateRef,rendering=false}:{rendering?:boolean;items:SiteItem[];roots:MutableRefObject<Map<string,T.Group>>;dateRef:MutableRefObject<Date|null>}){
  const rig=useMemo(()=>new T.Group(),[])
  const rings=useMemo(()=>new T.Group(),[])
  const markers=useMemo(()=>new T.Group(),[])
  const ringGeometry=useMemo(()=>new T.TorusGeometry(.12,.018,8,32),[])
  const markerGeometry=useMemo(()=>new T.SphereGeometry(.04,12,8),[])
  const markerMaterial=useMemo(()=>new T.MeshBasicMaterial({color:'#00ffff',depthTest:false}),[])
  const material=useMemo(()=>new T.MeshStandardMaterial({color:'#d6a63c',metalness:.65,roughness:.5}),[])
  const geometry=useMemo(()=>new T.CylinderGeometry(.014,.014,1,8),[])
  useEffect(()=>()=>{geometry.dispose();material.dispose();ringGeometry.dispose();markerGeometry.dispose();markerMaterial.dispose();for(const [id,root] of roots.current)if(loadRoots.get(id)===root){loadRoots.delete(id);loadDates.delete(id);liftDiagnostics.delete(id)}},[geometry,material,roots,ringGeometry,markerGeometry,markerMaterial])
  useFrame(()=>{
    const date=dateRef.current?.getTime()??NaN,done=new Set<string>(),visiting=new Set<string>();let leg=0,ringIndex=0
    for(const [id,root] of roots.current){loadRoots.set(id,root);loadDates.set(id,date)}
    for(const id of loadRoots.keys())if(!roots.current.has(id)){loadRoots.delete(id);loadDates.delete(id);liftDiagnostics.delete(id)}
    const apply=(item:SiteItem):void=>{
      if(done.has(item.id)||visiting.has(item.id))return
      visiting.add(item.id)
      const object=roots.current.get(item.id),event=loadEventAt(item.load_handling?.events||[],date)
      if(!object)return
      if(object.userData.simulatorOwnsPose){delete object.userData.loadHandlingActive;return}
      if(!event){
        liftDiagnostics.delete(item.id)
        if(object.userData.loadHandlingActive){object.position.set(item.position.x,item.position.y,item.position.z);object.rotation.set(item.rotation?.x||0,item.rotation?.y||0,item.rotation?.z||0);object.scale.set(item.scale?.x??1,item.scale?.y??1,item.scale?.z??1);object.updateWorldMatrix(true,true)}
        delete object.userData.loadHandlingActive;done.add(item.id);return
      }
      for(const leg of event.rigging?.legs||[]){const carrier=items.find(i=>i.id===leg.parent_id);if(carrier)apply(carrier)}
      const parentItem=items.find(i=>i.id===event.parent_id)
      if(parentItem)apply(parentItem)
      const parent=event.parent_id&&roots.current.get(event.parent_id),anchor=parent?attachmentNode(parent,event.node):null
      const world=loadEventWorld(event,anchor)
      if(!world&&object.userData.loadHandlingActive){
        object.position.set(item.position.x,item.position.y,item.position.z);object.rotation.set(item.rotation?.x||0,item.rotation?.y||0,item.rotation?.z||0);object.scale.set(item.scale?.x??1,item.scale?.y??1,item.scale?.z??1);object.updateWorldMatrix(true,true);delete object.userData.loadHandlingActive
      }
      if(!event.parent_id)liftDiagnostics.delete(item.id)
      if(world&&object.parent){
        object.parent.updateWorldMatrix(true,false)
        const local=object.parent.matrixWorld.clone().invert().multiply(world)
        local.decompose(object.position,object.quaternion,object.scale);object.updateWorldMatrix(true,true);object.userData.loadHandlingActive=true
        if(event.slings&&anchor){
          const solved=event.rigging&&item.load_handling?applyLiftRig(item.id,object,event,item.load_handling,roots.current,item.up_axis):null
          if(!event.rigging&&item.load_handling){liftDiagnostics.delete(item.id);balanceSuspendedLoad(object,item.load_handling,item.up_axis)}
          rig.updateWorldMatrix(true,false);const inverse=rig.matrixWorld.clone().invert(),connection=slingConnection(solved?.anchors[0]||anchor,solved?{...event,sling_offset:event.rigging!.legs[0].offset||[0,0,0]}:event),top=connection.bottom.clone().applyMatrix4(inverse)
          let ring=rings.children[ringIndex] as T.Mesh,marker=markers.children[ringIndex] as T.Mesh
          if(!ring){ring=new T.Mesh(ringGeometry,material);rings.add(ring);marker=new T.Mesh(markerGeometry,markerMaterial);marker.renderOrder=1000;markers.add(marker)}
          ringIndex++
          ring.position.copy(connection.center).applyMatrix4(inverse);ring.quaternion.copy(new T.Quaternion().setFromRotationMatrix(rig.matrixWorld).invert()).multiply(connection.rotation)
          ring.visible=true
          for(const root of [object,anchor])for(let n:T.Object3D|null=root;n;n=n.parent)if(!n.visible)ring.visible=false
          marker.position.copy(connection.seat).applyMatrix4(inverse);marker.visible=ring.visible&&!rendering&&slingEditors.has(event.id)
          const displayLegs=event.rigging?.legs.map((leg,i)=>({index:leg.point,point:item.load_handling!.lifting_points[leg.point],top:solved?.cables[i].anchor.clone().applyMatrix4(inverse),slack:solved?.result.slack[i],anchor:solved?.anchors[i]}))||(item.load_handling?.lifting_points||[]).map((point,index)=>({index,point,top,slack:false,anchor}));
          const seenConnections=new Set([JSON.stringify([event.rigging?.legs[0]?.parent_id,event.rigging?.legs[0]?.node,event.rigging?.legs[0]?.offset||[0,0,0]])])
          for(const [displayIndex,{index,point,top:legTop,slack,anchor:legAnchor}] of displayLegs.entries()){
            if(!point||!legTop)continue
            const top=legTop
            const endpoint=liftingPointWorld(object,point,item.load_handling?.lifting_nodes?.[index]);if(!endpoint)continue
            const bottom=endpoint.applyMatrix4(inverse)
            const rigLeg=event.rigging?.legs[displayIndex],connectionKey=JSON.stringify([rigLeg?.parent_id,rigLeg?.node,rigLeg?.offset||[0,0,0]])
            if(solved&&!seenConnections.has(connectionKey)){
              seenConnections.add(connectionKey)
              const c=slingConnection(legAnchor!,{...event,sling_offset:event.rigging!.legs[displayIndex].offset||[0,0,0]})
              let extra=rings.children[ringIndex] as T.Mesh,mark=markers.children[ringIndex] as T.Mesh
              if(!extra){extra=new T.Mesh(ringGeometry,material);rings.add(extra);mark=new T.Mesh(markerGeometry,markerMaterial);markers.add(mark)}ringIndex++;mark.visible=false
              extra.position.copy(c.center).applyMatrix4(inverse);extra.quaternion.copy(new T.Quaternion().setFromRotationMatrix(rig.matrixWorld).invert()).multiply(c.rotation);extra.visible=ring.visible
            }
            const down=new T.Vector3(0,item.up_axis==='y'?-1:0,item.up_axis==='z'?-1:0).transformDirection(inverse)
            const segments=slack?12:1,lengthTarget=event.rigging?.legs[displayIndex]?.length||top.distanceTo(bottom)
            const curve=(sag:number)=>Array.from({length:segments+1},(_,i)=>bottom.clone().lerp(top,i/segments).addScaledVector(down,sag*4*(i/segments)*(1-i/segments)))
            let low=0,high=lengthTarget
            if(slack)for(let n=0;n<18;n++){const mid=(low+high)/2,pts=curve(mid),length=pts.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(pts[i]),0);if(length<lengthTarget)low=mid;else high=mid}
            const points=curve(slack?(low+high)/2:0)
            for(let i=1;i<points.length;i++){
              const a=points[i-1],b=points[i],length=a.distanceTo(b);let mesh=rig.children[leg++] as T.Mesh
              if(!mesh){mesh=new T.Mesh(geometry,material);rig.add(mesh)}
              mesh.visible=length>1e-6&&object.visible
              for(const root of [object,legAnchor||anchor])for(let n:T.Object3D|null=root;n;n=n.parent)if(!n.visible)mesh.visible=false
              mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.set(1,length,1);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize())
            }
          }
        }
      }
      done.add(item.id);visiting.delete(item.id)
    }
    items.forEach(apply);for(let i=ringIndex;i<rings.children.length;i++){rings.children[i].visible=false;markers.children[i].visible=false}for(let i=leg;i<rig.children.length;i++)rig.children[i].visible=false
  })
  return <group><primitive object={rig}/><primitive object={rings}/><primitive object={markers}/></group>
}

import { useEffect, useRef, useCallback } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { equipmentNodes } from '../fourD/equipmentRig'
import { ensureMaterialized, getMaterializedMeshes } from '../fourD/elementBatching'
import type { IfcModelHandle } from '../fourD/ifcModel'
import type { Scenario } from './types'
import { designPose, designBounds, handlingAt, handlingKey, handlingMatrix } from './handling'

import { WorkerMethodPlayback } from './WorkerMethodPlayback'
import type { SiteItem } from '../fourD/siteScene'
const emptyItems:SiteItem[]=[]
const emptyObjects:{id:string;object:THREE.Object3D}[]=[]
type Source={name:string;kind:string;object:THREE.Object3D}
type Piece={object:THREE.Object3D;local:THREE.Matrix4;world:THREE.Matrix4;visible:boolean;matrixAutoUpdate:boolean}
type Target={key:string;pieces:Piece[];anchor:THREE.Matrix4}
export function SimulationPlayback({scenario,objects,siteObjects,ifcHandles,dateRef,onError,onReady,items=emptyItems}:{items?:SiteItem[];scenario:Scenario|null;objects:Source[];siteObjects?:{id:string;object:THREE.Object3D}[];ifcHandles:IfcModelHandle[];dateRef:React.MutableRefObject<Date|null>;onError:(e:string)=>void;onReady?:(ready:boolean)=>void}){
 const messages=useRef({handling:'',worker:''})
 // Report synchronously so an offline export can reject the current frame.
 const report=useCallback((s:string)=>{messages.current.handling=s;onError(Object.values(messages.current).filter(Boolean).join('; '))},[onError])
 const reportWorker=useCallback((s:string)=>{messages.current.worker=s;onError(Object.values(messages.current).filter(Boolean).join('; '))},[onError])
 const targets=useRef<Target[]>([]);const {invalidate}=useThree();const errors=useRef('')
 useEffect(()=>{let cancelled=false;const owned:Target[]=[];targets.current=[];onReady?.(false)
 const restore=()=>{for(const target of owned)for(const p of target.pieces){p.object.matrix.copy(p.local);p.object.matrix.decompose(p.object.position,p.object.quaternion,p.object.scale);p.object.matrixAutoUpdate=p.matrixAutoUpdate;p.object.visible=p.visible;delete p.object.userData.simulatorOwnsPose;p.object.updateMatrixWorld(true)}invalidate()}
 const resolve=async()=>{if(!scenario?.result){onReady?.(true);return}const states=new Map(scenario.result.events.flatMap(e=>e.object_states.map(h=>[handlingKey(h),h] as const)));const messages:string[]=[]
 for(const [key,h] of states){if(cancelled)return;const candidates=objects.filter(o=>o.name===h.model_ref);if(candidates.length!==1){messages.push('Load one matching object: '+h.model_ref);continue}const source={...candidates[0],object:siteObjects?.find(o=>o.id===h.model_ref)?.object??candidates[0].object};let nodes:THREE.Object3D[]=[]
 if(h.element_id){const handle=ifcHandles.find(x=>x.object===source.object);if(!handle){messages.push('IFC model is not loaded: '+h.model_ref);continue}const {getExpressIdFromGuid}=await import('../fourD/ifcModel');if(cancelled)return;const id=getExpressIdFromGuid(handle,h.element_id);if(id===undefined){messages.push('IFC element is missing: '+h.element_id);continue}ensureMaterialized(source.object,id);nodes=getMaterializedMeshes(source.object,id)}else nodes=[source.object]
 if(!nodes.length){messages.push('No geometry found for '+h.model_ref);continue}const pieces=nodes.map(object=>{object.updateWorldMatrix(true,true);const local=designPose(object);const parent=h.model_ref.startsWith('site:')?object.parent?.parent:object.parent;parent?.updateWorldMatrix(true,false);const world=parent?parent.matrixWorld.clone().multiply(local):local.clone();return {object,local,world,visible:object.visible,matrixAutoUpdate:object.matrixAutoUpdate}})
 const box=new THREE.Box3();for(const p of pieces)box.union(designBounds(p.object,p.world));const anchor=new THREE.Matrix4().makeTranslation(...box.getCenter(new THREE.Vector3()).toArray() as [number,number,number]);owned.push({key,pieces,anchor})
 }if(!cancelled){targets.current=owned;errors.current=messages.join('; ');report(errors.current);onReady?.(true);invalidate()}}
 resolve().catch(e=>{if(!cancelled)report((e as Error).message)})
 return()=>{cancelled=true;onReady?.(false);restore();targets.current=[];report('')}
 },[scenario,objects,siteObjects,ifcHandles,invalidate,report,onReady])
 // Mark ownership before profiles run; the final pass follows paths and equipment joints.
 useFrame(()=>{const time=dateRef.current?.getTime();for(const target of targets.current){const state=time==null?null:handlingAt(scenario?.result?.events??[],target.key,time);for(const p of target.pieces){if(!state&&p.object.userData.simulatorOwnsPose){p.object.matrix.copy(p.local);p.object.matrix.decompose(p.object.position,p.object.quaternion,p.object.scale);p.object.visible=p.visible;p.object.updateMatrixWorld(true)}p.object.userData.simulatorOwnsPose=!!state}}},-2)
 useFrame(()=>{const time=dateRef.current?.getTime();if(time==null)return
 for(const target of targets.current){const sample=handlingAt(scenario?.result?.events??[],target.key,time);for(const p of target.pieces){if(!sample)continue;const {handling:h,progress}=sample;let carrier:THREE.Object3D|undefined
 if(h.state==='attached'){const root=objects.find(o=>o.name===h.carrier_ref)?.object;carrier=root?(h.carrier_part?equipmentNodes(root).get(h.carrier_part):root):undefined;if(!carrier){const message='Carrier or part is not loaded: '+h.carrier_ref;if(errors.current!==message){errors.current=message;report(message)}continue}carrier.updateWorldMatrix(true,false)}
 const world=handlingMatrix(h,progress,p.world,target.anchor,carrier?.matrixWorld);if(!world)continue;p.object.parent?.updateWorldMatrix(true,false);const local=p.object.parent?p.object.parent.matrixWorld.clone().invert().multiply(world):world;p.object.matrix.copy(local);local.decompose(p.object.position,p.object.quaternion,p.object.scale);p.object.visible=p.object.userData.baseVisible!==false;p.object.updateMatrixWorld(true)
 }}},0)
 return scenario?.result?.basis==='event_simulation'?<WorkerMethodPlayback scenario={scenario} objects={siteObjects??emptyObjects} items={items} dateRef={dateRef} onError={reportWorker}/>:null
}

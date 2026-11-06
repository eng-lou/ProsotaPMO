import * as THREE from 'three'
import type { Handling, SimEvent } from './types'
// Transient render state only. Nothing here changes the persisted design or links.
const designPoses=new WeakMap<THREE.Object3D,THREE.Matrix4>()
export function rememberDesignPose(object:THREE.Object3D,position:THREE.Vector3,rotation:THREE.Euler,scale:THREE.Vector3){if(!object.userData.simulatorOwnsPose)designPoses.set(object,new THREE.Matrix4().compose(position,new THREE.Quaternion().setFromEuler(rotation),scale))}
export function designPose(object:THREE.Object3D){return designPoses.get(object)?.clone()??object.matrix.clone()}
export function designBounds(object:THREE.Object3D, world:THREE.Matrix4){
 const box=new THREE.Box3(), inverse=object.matrixWorld.clone().invert()
 object.traverse(node=>{if(!(node instanceof THREE.Mesh))return;node.geometry.computeBoundingBox();if(node.geometry.boundingBox)box.union(node.geometry.boundingBox.clone().applyMatrix4(world.clone().multiply(inverse).multiply(node.matrixWorld)))})
 return box
}
export function handlingKey(h:Pick<Handling,'model_ref'|'element_id'>){return h.model_ref+'::'+(h.element_id??'')}
export function handlingAt(events:SimEvent[],key:string,time:number):{handling:Handling;progress:number}|null{
 let picked:SimEvent|null=null, handling:Handling|null=null
 for(const event of events){const state=event.object_states.find(h=>handlingKey(h)===key);if(!state||Date.parse(event.start)>time)continue;if(!picked||Date.parse(event.start)>=Date.parse(picked.start)){picked=event;handling=state}}
 if(!picked||!handling)return null
 const a=Date.parse(picked.start),b=Date.parse(picked.end),p=Math.min(1,Math.max(0,(time-a)/Math.max(1,b-a)))
 return {handling,progress:picked.progress_from+(picked.progress_to-picked.progress_from)*p}
}
export function handlingMatrix(h:Handling,p:number,designWorld:THREE.Matrix4,anchorWorld:THREE.Matrix4,carrierWorld?:THREE.Matrix4){
 const make=(v:typeof h.from_pose)=>new THREE.Matrix4().compose(new THREE.Vector3(...v.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...v.rotation.map(x=>x*Math.PI/180) as [number,number,number])),new THREE.Vector3(1,1,1))
 if(h.state==='installed')return designWorld.clone()
 // Each piece retains its transform relative to the object's geometric centre.
 const relative=anchorWorld.clone().invert().multiply(designWorld)
 if(h.state==='attached'){
  if(!carrierWorld)return null
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3()
  carrierWorld.decompose(position,rotation,scale)
  return new THREE.Matrix4().compose(position,rotation,new THREE.Vector3(1,1,1)).multiply(make(h.attachment)).multiply(relative)
 }
 const position=new THREE.Vector3(...h.from_pose.position).lerp(new THREE.Vector3(...h.to_pose.position),p)
 const q1=new THREE.Quaternion().setFromEuler(new THREE.Euler(...h.from_pose.rotation.map(x=>x*Math.PI/180) as [number,number,number]))
 const q2=new THREE.Quaternion().setFromEuler(new THREE.Euler(...h.to_pose.rotation.map(x=>x*Math.PI/180) as [number,number,number]))
 const anchorPosition=new THREE.Vector3().setFromMatrixPosition(anchorWorld)
 return new THREE.Matrix4().makeTranslation(...anchorPosition.clone().add(position).toArray() as [number,number,number]).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q1.slerp(q2,p))).multiply(new THREE.Matrix4().makeTranslation(...anchorPosition.clone().negate().toArray() as [number,number,number])).multiply(designWorld)
}

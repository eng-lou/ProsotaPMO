import * as THREE from 'three'
import type { SiteObjectState } from './siteScene'
const point=(v:{x:number;y:number;z:number}|undefined)=>v?{x:v.x,y:v.y,z:v.z}:null
export function captureSiteObjectState(object:THREE.Object3D):SiteObjectState {
 const content=object.children[0],data=object.userData
 const q=data.prePivotQuaternion as THREE.Quaternion|undefined
 const cq=(data.prePivotChildQuaternions as Map<THREE.Object3D,THREE.Quaternion>|undefined)?.get(content)
 return {content_position:point(content.position)!,content_rotation:point(content.rotation)!,content_scale:point(content.scale)!,
  pivot:point(data.pivotPoint),pivot_rotation:point(data.pivotRotation),base_position:point(data.prePivotPosition),
  base_rotation:q?point(new THREE.Euler().setFromQuaternion(q)):null,
  base_content_position:point((data.prePivotChildPositions as Map<THREE.Object3D,THREE.Vector3>|undefined)?.get(content)),
  base_content_rotation:cq?point(new THREE.Euler().setFromQuaternion(cq)):null}
}
export function restoreSiteObjectState(object:THREE.Object3D, state?:SiteObjectState|null) {
 const content=object.children[0];if(!content)return
 const set=(target:{set(x:number,y:number,z:number):unknown},v:{x:number;y:number;z:number}|undefined|null,fallback:number)=>target.set(v?.x??fallback,v?.y??fallback,v?.z??fallback)
 set(content.position,state?.content_position,0);set(content.rotation,state?.content_rotation,0);set(content.scale,state?.content_scale,1)
 for(const key of ['pivotPoint','pivotRotation','prePivotPosition','prePivotQuaternion','prePivotChildPositions','prePivotChildQuaternions'])delete object.userData[key]
 if(state?.pivot)object.userData.pivotPoint=new THREE.Vector3(state.pivot.x,state.pivot.y,state.pivot.z)
 if(state?.pivot_rotation)object.userData.pivotRotation=new THREE.Euler(state.pivot_rotation.x,state.pivot_rotation.y,state.pivot_rotation.z)
 if(state?.base_position){
  object.userData.prePivotPosition=new THREE.Vector3(state.base_position.x,state.base_position.y,state.base_position.z)
  const q=(v:{x:number;y:number;z:number}|null)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(v?.x||0,v?.y||0,v?.z||0))
  object.userData.prePivotQuaternion=q(state.base_rotation)
  const p=state.base_content_position
  object.userData.prePivotChildPositions=new Map([[content,new THREE.Vector3(p?.x||0,p?.y||0,p?.z||0)]])
  object.userData.prePivotChildQuaternions=new Map([[content,q(state.base_content_rotation)]])
 }
 object.updateMatrixWorld(true)
}

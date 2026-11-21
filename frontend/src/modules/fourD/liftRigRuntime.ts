import * as T from 'three'
import {attachmentNode} from './workerActions'
import {liftingPointWorld,slingConnection,type LoadEvent,type LoadHandling} from './loadHandling'
import {solveLift,type LiftResult,type Cable} from './liftSolver'
export const liftDiagnostics=new Map<string,{result?:LiftResult;message?:string;hookLoads?:Record<string,number>}>()
const cache=new WeakMap<T.Object3D,{key:string;matrix:T.Matrix4;result:LiftResult}>()
export function applyLiftRig(id:string,root:T.Object3D,event:LoadEvent,handling:LoadHandling,roots:Map<string,T.Group>,upAxis:'y'|'z'){
 const rig=event.rigging;if(!rig)return null
 root.updateWorldMatrix(true,true)
 const origin=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3();root.matrixWorld.decompose(origin,rotation,scale)
 const box=new T.Box3().setFromObject(root),centre=handling.center_of_gravity?root.localToWorld(new T.Vector3(...handling.center_of_gravity)):box.getCenter(new T.Vector3()),inverse=rotation.clone().invert()
 const cables:Cable[]=[],anchors:T.Object3D[]=[]
 for(const leg of rig.legs){
  const carrier=roots.get(leg.parent_id),anchor=carrier&&attachmentNode(carrier,leg.node),point=handling.lifting_points[leg.point],endpoint=point&&liftingPointWorld(root,point,handling.lifting_nodes?.[leg.point])
  if(!anchor||!endpoint){liftDiagnostics.set(id,{message:'Missing hook or lifting point. Rigging was not solved.'});return null}
  anchors.push(anchor);cables.push({point:endpoint.sub(centre).applyQuaternion(inverse),anchor:slingConnection(anchor,{...event,sling_offset:leg.offset||[0,0,0]}).bottom,length:leg.length,capacity:leg.capacity_kn})
 }
 const corners:T.Vector3[]=[]
 if(!box.isEmpty())for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new T.Vector3(x,y,z).sub(centre).applyQuaternion(inverse))
 const key=JSON.stringify([root.matrixWorld.elements,centre.toArray(),cables.map(c=>[c.point.toArray(),c.anchor.toArray(),c.length]),rig,upAxis,corners.map(c=>c.toArray())])
 let saved=cache.get(root)
 if(saved?.key!==key){
  const result=solveLift(centre,rotation,cables,new T.Vector3(0,upAxis==='y'?1:0,upAxis==='z'?1:0),rig.mass_kg,corners,rig.floor)
  const offset=origin.clone().sub(centre).applyQuaternion(inverse).applyQuaternion(result.rotation),matrix=new T.Matrix4().compose(result.position.clone().add(offset),result.rotation,scale)
  saved={key,result,matrix};cache.set(root,saved)
 }
 const local=root.parent!.matrixWorld.clone().invert().multiply(saved.matrix),p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();local.decompose(p,q,s)
 const rebuilt=new T.Matrix4().compose(p,q,s)
 if(local.elements.some((v,i)=>Math.abs(v-rebuilt.elements[i])>1e-6*Math.max(1,Math.abs(v)))){liftDiagnostics.set(id,{message:'Apply non-uniform parent scale before solving.'});return null}
 root.position.copy(p);root.quaternion.copy(q);root.scale.copy(s);root.updateWorldMatrix(true,true)
 const hookForces=new Map<string,T.Vector3>();rig.legs.forEach((leg,i)=>{const key=leg.parent_id+' / '+(leg.node||'origin'),point=handling.lifting_points[leg.point],end=liftingPointWorld(root,point,handling.lifting_nodes?.[leg.point])!;const force=cables[i].anchor.clone().sub(end).normalize().multiplyScalar(saved!.result.tensions[i]);hookForces.set(key,(hookForces.get(key)||new T.Vector3()).add(force))})
 const hookLoads=Object.fromEntries([...hookForces].map(([key,force])=>[key,force.length()]))
 liftDiagnostics.set(id,{result:saved.result,hookLoads})
 return {cables,anchors,result:saved.result}
}

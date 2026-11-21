import * as T from 'three'
import {liftingPointWorld,type LoadHandling} from './loadHandling'
/** Static visual equilibrium for one/two supports. Call after restoring event pose.
 * Keep the support locations fixed, preserving current sling lengths. No dynamics
 * or multi-leg tension solver; mass centre defaults to a geometry-bounds estimate. */
export function balanceSuspendedLoad(root:T.Object3D,handling:LoadHandling,upAxis:'y'|'z'){
 if(handling.balance_mode==='fixed'||handling.lifting_points.length<1||handling.lifting_points.length>2||!root.parent)return false
 root.updateWorldMatrix(true,true)
 const points=handling.lifting_points.map((p,i)=>liftingPointWorld(root,p,handling.lifting_nodes?.[i]))
 if(points.some(p=>!p))return false
 const pivot=points[0]!,gravity=new T.Vector3(0,upAxis==='y'?-1:0,upAxis==='z'?-1:0)
 const centre=handling.center_of_gravity?root.localToWorld(new T.Vector3(...handling.center_of_gravity)):new T.Box3().setFromObject(root).getCenter(new T.Vector3())
 const arm=centre.clone().sub(pivot),rotation=new T.Quaternion()
 if(points.length===2){
  const axis=points[1]!.clone().sub(pivot)
  if(axis.lengthSq()<1e-12)return false
  axis.normalize();arm.projectOnPlane(axis);gravity.projectOnPlane(axis)
  if(arm.lengthSq()<1e-12||gravity.lengthSq()<1e-12)return false
  arm.normalize();gravity.normalize()
  rotation.setFromAxisAngle(axis,Math.atan2(axis.dot(arm.clone().cross(gravity)),arm.dot(gravity)))
 }else{
  if(arm.lengthSq()<1e-12)return false
  rotation.setFromUnitVectors(arm.normalize(),gravity)
 }
 const world=new T.Matrix4().makeTranslation(pivot.x,pivot.y,pivot.z).multiply(new T.Matrix4().makeRotationFromQuaternion(rotation)).multiply(new T.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z)).multiply(root.matrixWorld)
 root.parent.updateWorldMatrix(true,false)
 const local=root.parent.matrixWorld.clone().invert().multiply(world)
 const position=new T.Vector3(),quaternion=new T.Quaternion(),scale=new T.Vector3();local.decompose(position,quaternion,scale)
 // Avoid introducing shear beneath non-uniformly scaled parents.
 const rebuilt=new T.Matrix4().compose(position,quaternion,scale)
 if(local.elements.some((v,i)=>Math.abs(v-rebuilt.elements[i])>1e-6*Math.max(1,Math.abs(v))))return false
 root.position.copy(position);root.quaternion.copy(quaternion);root.scale.copy(scale);root.updateWorldMatrix(true,true)
 return true
}

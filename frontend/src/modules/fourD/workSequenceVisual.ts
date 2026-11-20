import * as T from 'three'
import {bindAnimationShadows} from './animationRendering'
import {workWindows,workProgress,type WorkSequence} from './workSequence'
/** One target is one excavation volume or completed pile, never the whole terrain. */
export function workVisual(config:WorkSequence,activities:Parameters<typeof workWindows>[1],target:string,time:number,curve?:T.Curve<T.Vector3>|null){
 const rows=workWindows(config,activities),r=rows.find(s=>s.excavation_id===target||s.pile_id===target);
 if(!r||!Number.isFinite(time))return {visible:true,plane:null};
 const p=workProgress(r.startMs,r.finishMs,time);
 if(r.pile_id===target)return {visible:p>=.85,plane:null};
 if(p<=0)return {visible:true,plane:null};
 if(config.kind==='tbm'){
  if(!curve||r.end_chainage>curve.getLength()+1e-5)throw Error('Invalid excavation alignment');
  if(p>=1)return {visible:false,plane:null};
  const u=(r.start_chainage+(r.end_chainage-r.start_chainage)*p)/curve.getLength(),point=curve.getPointAt(u),normal=curve.getTangentAt(u).normalize();
  return {visible:true,plane:new T.Plane().setFromNormalAndCoplanarPoint(normal,point)}
 }
 if(p>=.65)return {visible:false,plane:null};
 const point=new T.Vector3(r.position.x,r.position.y,r.position.z);point[config.axis]-=r.depth*p/.65;
 const normal=new T.Vector3();normal[config.axis]=-1;
 return {visible:true,plane:new T.Plane().setFromNormalAndCoplanarPoint(normal,point)}
}
export function createWorkClip(){
 const plane=new T.Plane(),materials=new Map<T.Material,boolean>();
 function clear(){for(const [m,shadows] of materials){if(m.clippingPlanes?.includes(plane)){m.clippingPlanes=m.clippingPlanes.filter(p=>p!==plane);m.needsUpdate=true}m.clipShadows=shadows}materials.clear()}
 function apply(root:T.Object3D,value:T.Plane|null){
  if(!value){clear();return}plane.copy(value);
  root.traverse(n=>{if(!(n instanceof T.Mesh))return;bindAnimationShadows(n);for(const m of Array.isArray(n.material)?n.material:[n.material]){if(!materials.has(m))materials.set(m,m.clipShadows);if(!m.clippingPlanes?.includes(plane)){m.clippingPlanes=[...(m.clippingPlanes||[]),plane];m.needsUpdate=true}m.clipShadows=true}})
 }
 return {apply,dispose:clear}
}

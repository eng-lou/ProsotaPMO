import * as T from 'three'
export interface Cable { point:T.Vector3; anchor:T.Vector3; length:number; capacity?:number }
export interface LiftResult { position:T.Vector3; rotation:T.Quaternion; tensions:number[]; slack:boolean[]; error:number; residual:number; supported:boolean; valid:boolean }
/** Deterministic quasi-static rigid body relaxation. Cables pull only; no inertia or wind.
 * Points/corners are COM-relative in the initial body's axes (including asset scale).
 * Each solve starts from the captured pose, never the previous animation frame. */
export function solveLift(position:T.Vector3,rotation:T.Quaternion,cables:Cable[],up:T.Vector3,mass:number,corners:T.Vector3[]=[],floor?:number|null):LiftResult {
 const p=position.clone(),q=rotation.clone(),radius=Math.max(.25,...cables.map(c=>c.point.length())),invI=1/(radius*radius)
 const rotate=(v:T.Vector3)=>{const a=v.length();if(a>1e-12)q.premultiply(new T.Quaternion().setFromAxisAngle(v.multiplyScalar(1/a),a)).normalize()}
 // Take up initial vertical slack without a frame-by-frame fall (including long ropes).
 let dropLimit=Infinity
 for(const c of cables){const d=p.clone().add(c.point.clone().applyQuaternion(q)).sub(c.anchor),vertical=d.dot(up),horizontal=d.lengthSq()-vertical*vertical,disc=c.length*c.length-horizontal;if(disc>=0)dropLimit=Math.min(dropLimit,vertical+Math.sqrt(disc));else dropLimit=0}
 if(Number.isFinite(dropLimit)&&dropLimit>0){if(floor!=null&&corners.length)dropLimit=Math.min(dropLimit,Math.min(...corners.map(c=>p.clone().add(c.clone().applyQuaternion(q)).dot(up)-floor)));p.addScaledVector(up,-Math.max(0,dropLimit))}
 // Progressively reduce gravity displacement so final constraint error is small.
 for(let step=0;step<320;step++){
  const drop=.08*radius*Math.pow(.0001,step/319);p.addScaledVector(up,-drop)
  for(let sweep=0;sweep<16;sweep++){
   for(const c of cables){
    const r=c.point.clone().applyQuaternion(q),d=p.clone().add(r).sub(c.anchor),len=d.length(),excess=len-c.length
    if(excess<=0||len<1e-10)continue
    d.multiplyScalar(1/len);const torque=r.clone().cross(d),amount=excess/(1+invI*torque.lengthSq())
    p.addScaledVector(d,-amount);rotate(torque.multiplyScalar(-amount*invI))
   }
   if(floor!=null)for(const corner of corners){const r=corner.clone().applyQuaternion(q),depth=floor-p.clone().add(r).dot(up);if(depth>0){const torque=r.clone().cross(up),amount=depth/(1+invI*torque.lengthSq());p.addScaledVector(up,amount);rotate(torque.multiplyScalar(amount*invI))}}
  }
 }
 const ends=cables.map(c=>p.clone().add(c.point.clone().applyQuaternion(q))),distances=ends.map((v,i)=>v.distanceTo(cables[i].anchor))
 const slack=distances.map((d,i)=>cables[i].length-d>.003),error=Math.max(0,...distances.map((d,i)=>d-cables[i].length))
 // Nonnegative least-squares wrench balance; report residual instead of inventing forces.
 const columns=cables.map((c,i)=>{const force=c.anchor.clone().sub(ends[i]).normalize(),moment=ends[i].clone().sub(p).cross(force).multiplyScalar(1/radius);return [...force.toArray(),...moment.toArray()]})
 const supported=floor!=null&&corners.some(c=>Math.abs(p.clone().add(c.clone().applyQuaternion(q)).dot(up)-floor)<.004)
 if(supported)for(const c of corners){const r=c.clone().applyQuaternion(q);if(Math.abs(p.clone().add(r).dot(up)-floor!)<.004)columns.push([...up.toArray(),...r.cross(up).multiplyScalar(1/radius).toArray()])}
 const weight=mass*9.80665/1000,target=[...up.clone().multiplyScalar(weight).toArray(),0,0,0],forces=columns.map(()=>0),remaining=[...target]
 for(let iter=0;iter<600;iter++)for(let i=0;i<columns.length;i++){
  if(i<slack.length&&slack[i])continue
  const col=columns[i],den=col.reduce((n,v)=>n+v*v,0);if(den<1e-12)continue
  const next=Math.max(0,forces[i]+col.reduce((n,v,k)=>n+v*remaining[k],0)/den),delta=next-forces[i];forces[i]=next;for(let k=0;k<6;k++)remaining[k]-=col[k]*delta
 }
 const residual=Math.hypot(...remaining)/Math.max(weight,1e-9)
 return {position:p,rotation:q,tensions:forces.slice(0,cables.length),slack,error,residual,supported,valid:error<.005&&residual<.03&&[...p.toArray(),...q.toArray()].every(Number.isFinite)}
}

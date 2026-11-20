import * as T from 'three'
import type {PathCoordinate} from './paths'
export interface WorkStep {id:string;activity_id:string;start:string|null;finish:string|null;start_chainage:number;end_chainage:number;position:PathCoordinate;depth:number;travel_hours:number;excavation_id:string|null;pile_id:string|null}
export interface WorkSequence {kind:'tbm'|'piling';offset:PathCoordinate;path_id:string|null;axis:'y'|'z';steps:WorkStep[];tool_control:string|null;tool_travel:number;tool_rest:number;tool_full:number}
type Activity={id:string;start?:string|null;finish?:string|null}
export function workWindows(config:WorkSequence,activities:Activity[]){
 if(![config.offset.x,config.offset.y,config.offset.z,config.tool_rest,config.tool_full].every(Number.isFinite)||config.tool_rest<0||config.tool_rest>1||config.tool_full<0||config.tool_full>1)throw Error('Enter finite offsets and control values between 0 and 1.');
 if(new Set(config.steps.map(s=>s.id)).size!==config.steps.length)throw Error('Duplicate step IDs.');
 const activityById=new Map(activities.map(a=>[a.id,a]));
 const rows=config.steps.map(s=>{const a=activityById.get(s.activity_id),start=Date.parse(s.start||a?.start||''),finish=Date.parse(s.finish||a?.finish||'');
 if(!Number.isFinite(start)||!Number.isFinite(finish)||finish<=start)throw Error('Every step needs an activity with valid start and finish dates, or manual overrides.');
 if(![s.start_chainage,s.end_chainage,s.depth,s.travel_hours,s.position.x,s.position.y,s.position.z].every(Number.isFinite)||s.depth<=0||s.travel_hours<0)throw Error('Enter valid coordinates, positive depth and non-negative travel time.');
 if(config.kind==='tbm'&&(s.start_chainage<0||s.end_chainage<=s.start_chainage))throw Error('Drive end chainage must exceed its start.');
 return {...s,startMs:start,finishMs:finish,travelStart:start-s.travel_hours*3600000}
 }).sort((a,b)=>a.startMs-b.startMs);
 rows.forEach((r,i)=>{if(!i)return;const prev=rows[i-1];if((config.kind==='piling'?r.travelStart:r.startMs)<prev.finishMs)throw Error('Work or travel intervals overlap. Shorten travel or change dates.');if(config.kind==='tbm'&&Math.abs(r.start_chainage-prev.end_chainage)>1e-5)throw Error('Successive drives must have continuous chainages.');});
 if(config.tool_travel<=0||!Number.isFinite(config.tool_travel))throw Error('Tool travel must be positive.');
 if(config.kind==='piling'&&config.tool_control&&rows.some(s=>s.depth>config.tool_travel))throw Error('Pile depth exceeds the configured tool travel.');
 return rows
}
const clamp=(v:number)=>Math.max(0,Math.min(1,v))
export function workProgress(start:number,finish:number,time:number){return clamp((time-start)/(finish-start))}
export function sampleWork(config:WorkSequence,activities:Activity[],time:number,origin:PathCoordinate,curve?:T.Curve<T.Vector3>|null,resolved?:ReturnType<typeof workWindows>){
 const rows=resolved??workWindows(config,activities),point=new T.Vector3(origin.x,origin.y,origin.z),rotation=new T.Quaternion();let depth=0,chainage=rows[0]?.start_chainage||0;
 if(!Number.isFinite(time))return {point,rotation,depth,chainage,tool:config.tool_rest};
 if(config.kind==='tbm'){
  if(!curve||curve.getLength()<=1e-6)throw Error('Choose a non-empty tunnel alignment.');const length=curve.getLength();
  if(rows.some(r=>r.end_chainage>length+1e-5))throw Error('Drive chainage exceeds the alignment length.');
  for(const r of rows){if(time<r.startMs)break;chainage=r.start_chainage+(r.end_chainage-r.start_chainage)*workProgress(r.startMs,r.finishMs,time)}
  point.copy(curve.getPointAt(clamp(chainage/length)));
  // Relative 3D rotation preserves the orientation authored at the first drive.
  rotation.setFromUnitVectors(curve.getTangentAt(clamp((rows[0]?.start_chainage||0)/length)).normalize(),curve.getTangentAt(clamp(chainage/length)).normalize());
 }else{
  for(const r of rows){
   if(time<r.travelStart)break;
   if(time<r.startMs){point.lerp(new T.Vector3(r.position.x,r.position.y,r.position.z),r.startMs===r.travelStart?1:workProgress(r.travelStart,r.startMs,time));break}
   point.set(r.position.x,r.position.y,r.position.z);
   if(time<r.finishMs){const p=workProgress(r.startMs,r.finishMs,time);depth=r.depth*(p<.65?p/.65:p<.85?1-(p-.65)/.2:0);break}
  }
 }
 return {point,rotation,depth,chainage,tool:config.tool_rest+(config.tool_full-config.tool_rest)*clamp(depth/config.tool_travel)}
}
export function applyWorkPose(parent:T.Object3D,sample:ReturnType<typeof sampleWork>,origin:PathCoordinate){
 parent.quaternion.copy(sample.rotation);parent.scale.setScalar(1);parent.position.copy(sample.point).sub(new T.Vector3(origin.x,origin.y,origin.z).applyQuaternion(sample.rotation));parent.updateMatrixWorld(true)
}

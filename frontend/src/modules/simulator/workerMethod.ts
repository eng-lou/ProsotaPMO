import { Vector3 } from 'three'
import type { Config, Pose, SimEvent } from './types'
import type { Path } from '../fourD/paths'
import type { SiteItem } from '../fourD/siteScene'
import { buildPathCurve } from '../fourD/pathCurve'

export type WorkerMethod = {
  version:1; kind:'walk_work_continue'; worker_id:string; worker_asset_id:string
  tool_id:string; tool_asset_id:string; route_id:string
  route?:{id:string;geometry:Pick<Path,'points'|'closed'|'curve_mode'>;samples:[number,number,number][];length_m:number}|null
  idle_clip:string; walk_clip:string; work_clip:string; work_position:number
  speed_mps:number; stride_mps:number; work_seconds:number; heading:number
  hand:string; grip:Pose; tool_during:'work'|'whole_method'
}
export const newWorkerMethod=():WorkerMethod=>({version:1,kind:'walk_work_continue',worker_id:'',worker_asset_id:'',tool_id:'',tool_asset_id:'',route_id:'',idle_clip:'',walk_clip:'',work_clip:'',work_position:50,speed_mps:1.2,stride_mps:1.2,work_seconds:10,heading:0,hand:'',grip:{position:[0,0,0],rotation:[0,0,0]},tool_during:'work'})
export function methodReadiness(m:WorkerMethod,items:SiteItem[],paths:Path[]){
  const errors:string[]=[]
  for(const role of ['worker','tool'] as const){const item=items.find(i=>i.id===m[`${role}_id`]);if(!item?.asset_id||item.asset_id!==m[`${role}_asset_id`])errors.push(`Choose the ${role} again; its object or asset has changed.`)}
  if(m.worker_id===m.tool_id)errors.push('Worker and tool must be different objects.')
  if(!paths.some(p=>p.id===m.route_id&&p.points.length>=2))errors.push('Choose a route with at least two points.')
  if(!m.idle_clip||!m.walk_clip||!m.work_clip)errors.push('Choose idle, walk and work motions.')
  if(!m.hand)errors.push('Choose the hand that holds the tool.')
  if(!(m.work_seconds>0&&m.work_seconds<=86400&&m.speed_mps>0&&m.speed_mps<=5&&m.stride_mps>0&&m.stride_mps<=5))errors.push('Enter valid work duration and walking speeds.')
  if(!Number.isFinite(m.work_position)||m.work_position<0||m.work_position>100)errors.push('Work position must be between 0% and 100%.')
  return errors
}
export function snapshotMethod(m:WorkerMethod,items:SiteItem[],paths:Path[]):WorkerMethod{
  const errors=methodReadiness(m,items,paths);if(errors.length)throw Error(errors.join(' '))
  const path=paths.find(p=>p.id===m.route_id)!,curve=buildPathCurve(path.points,path.closed,path.curve_mode)
  if(!curve)throw Error('The worker route has no travel distance.')
  const length=curve.getLength()
  if(!(length>.001))throw Error('The worker route has no travel distance.')
  return {...m,route:{id:path.id,geometry:{points:structuredClone(path.points),closed:path.closed,curve_mode:path.curve_mode||'curved'},length_m:length,samples:curve.getSpacedPoints(256).map(p=>p.toArray() as [number,number,number])}}
}
export async function prepareWorkerMethods(config:Config,items:SiteItem[],paths:Path[]){
  const {loadSiteAsset}=await import('../fourD/siteAssets')
  const steps=await Promise.all(config.steps.map(async s=>{
    if(!s.worker_method)return s
    const m=snapshotMethod(s.worker_method,items,paths),root=await loadSiteAsset(m.worker_asset_id)
    const names=root.animations.map(c=>c.name)
    for(const name of [m.idle_clip,m.walk_clip,m.work_clip])if(names.filter(n=>n===name).length!==1)throw Error(`${s.name}: motion “${name}” is missing or ambiguous. Choose its motion again.`)
    let hands=0;root.traverse(n=>{if(n.name===m.hand)hands++});if(hands!==1)throw Error(`${s.name}: the selected hand is missing or ambiguous.`)
    return {...s,worker_method:m}
  }))
  return {...config,steps}
}
export function methodAt(events:SimEvent[],stepId:string,time:number){
  const own=events.filter(e=>e.step_id===stepId&&e.worker_action).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))
  if(!own.length)return null
  const event=own.find(e=>time>=Date.parse(e.start)&&time<Date.parse(e.end))
  const previous=[...own].reverse().find(e=>Date.parse(e.end)<=time)
  const e=event??previous??own[0],a=e.worker_action!
  const active=!!event,progress=active?e.progress_from+(e.progress_to-e.progress_from)*Math.max(0,Math.min(1,(time-Date.parse(e.start))/Math.max(1,Date.parse(e.end)-Date.parse(e.start)))):previous?e.progress_to:0
  return {event:e,stage:a.stage,active,progress,routeProgress:a.from_progress+(a.to_progress-a.from_progress)*progress,clipSeconds:a.seconds*progress,finished:time>=Date.parse(own[own.length-1].end),started:time>=Date.parse(own[0].start)}
}
export function methodRoutePoint(m:WorkerMethod,u:number){
  const samples=m.route!.samples,t=Math.max(0,Math.min(1,u))*(samples.length-1),i=Math.min(samples.length-2,Math.floor(t))
  return new Vector3(...samples[i]).lerp(new Vector3(...samples[i+1]),t-i)
}
/** Templates deliberately have no project instance IDs or captured route. */
export function reusableMethod(m:WorkerMethod){return {...m,worker_id:'',worker_asset_id:'',tool_id:'',tool_asset_id:'',route_id:'',route:null}}

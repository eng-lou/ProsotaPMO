import type { Activity } from '../scheduling/types'
import type { PathPoint } from './paths'
import type { SiteItem } from './siteScene'

type Dates = Pick<Activity,'id'|'start'|'finish'>
export interface StageWindow { kit_id?:string|null; from_activity_id?:string|null; until_activity_id?:string|null; until_finish?:boolean }
export interface PickLift { activity_id:string; pickup:PathPoint; landing:PathPoint; clearance:number; hook_height:number }
export function stageInterval(window:StageWindow,activities:Dates[]){
  const boundary=(id:string|null|undefined,finish:boolean,missing:number)=>{
    if(!id)return missing
    const a=activities.find(a=>a.id===id)
    return Date.parse((finish?a?.finish:a?.start)??'')
  }
  return {start:boundary(window.from_activity_id,false,-Infinity),end:boundary(window.until_activity_id,!!window.until_finish,Infinity)}
}
export function resolvePicks(lifts:PickLift[],activities:Dates[]){
  const rows=lifts.map(lift=>{
    const a=activities.find(a=>a.id===lift.activity_id)
    const start=Date.parse(a?.start??''),end=Date.parse(a?.finish??'')
    if(!(end>start))throw Error('Choose a lift activity with a dated start and finish.')
    return {...lift,start,end}
  }).sort((a,b)=>a.start-b.start)
  rows.forEach((row,i)=>{
    if(!i)return
    const previous=rows[i-1]
    if(previous.end>row.start)throw Error('Two crane lifts for this load overlap.')
    const a=previous.landing,b=row.pickup
    if(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>.01)throw Error('The next pickup must start at the previous landing.')
  })
  return rows
}
export function samplePick(rows:ReturnType<typeof resolvePicks>,time:number,axis:'y'|'z'){
  if(!rows.length||!Number.isFinite(time))return null
  let row=rows[0]
  for(const next of rows){if(next.start>time)break;row=next}
  const t=Math.max(0,Math.min(1,(time-row.start)/(row.end-row.start)))
  const high=Math.max(row.pickup[axis],row.landing[axis])+row.clearance
  const abovePickup={...row.pickup,[axis]:high},aboveLanding={...row.landing,[axis]:high}
  function between(a:PathPoint,b:PathPoint,u:number){return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u}}
  const load=t<.15?row.pickup:t<.35?between(row.pickup,abovePickup,(t-.15)/.2):t<.65?between(abovePickup,aboveLanding,(t-.35)/.3):t<.85?between(aboveLanding,row.landing,(t-.65)/.2):row.landing
  const hook={...load,[axis]:load[axis]+row.hook_height+row.clearance*(t<.15?1-t/.15:t>.85?(t-.85)/.15:0)}
  return {load,hook,active:time>=row.start && time<row.end}
}

export function transferKit(items:SiteItem[],outIds:string[],inIds:string[],activityId:string,activities:Dates[],holdPropsUntil?:string){
  const out=items.filter(i=>outIds.includes(i.id)),dest=items.filter(i=>inIds.includes(i.id))
  if(!out.length||!dest.length||out.length!==outIds.length||dest.length!==inIds.length||out.some(i=>inIds.includes(i.id)))throw Error('Capture two different sets of site parts.')
  const modes=new Set(out.map(i=>i.construction_mode))
  if(!out.every(i=>i.construction_mode)||modes.size!==1||!dest.every(i=>modes.has(i.construction_mode)))throw Error('Choose corresponding parts of the same formwork type.')
  if(dest.some(i=>(i.construction_mode==='deck'||i.construction_mode==='beam')&&!i.measured_bearing))
    throw Error('Generate the destination layout against its actual bearing slab first.')
  if(out.some(i=>i.stage_window?.until_activity_id)||dest.some(i=>i.stage_window?.from_activity_id||i.stage_window?.kit_id))
    throw Error('One of these parts already has a transfer at this end.')
  const ids=new Set(out.map(i=>i.stage_window?.kit_id).filter(Boolean))
  if(ids.size>1)throw Error('Select parts from one reusable kit.')
  const kit=[...ids][0]??crypto.randomUUID()
  const move=stageInterval({from_activity_id:activityId},activities).start
  if(!Number.isFinite(move))throw Error('Choose a dated transfer activity.')
  return items.map(item=>{
    const leaves=outIds.includes(item.id)
    if(!leaves&&!inIds.includes(item.id))return item
    const retain=leaves && !!holdPropsUntil && /prop/i.test(item.name)
    if(retain && !(stageInterval({until_activity_id:holdPropsUntil,until_finish:true},activities).end>=move))
      throw Error('Backprop release must finish on or after the transfer.')
    const window:StageWindow={...item.stage_window,kit_id:kit,...(leaves?{until_activity_id:retain?holdPropsUntil:activityId,until_finish:retain}:{from_activity_id:activityId})}
    const {start,end}=stageInterval(window,activities)
    if(!(end>start))throw Error('Kit transfers must follow the order of the floor cycle.')
    return {...item,stage_window:window}
  })
}

import { climbWindows, type ClimbingFormwork, type ClimbLift, type PourBoomKey } from './climbingFormwork'
import type { Activity } from '@/modules/scheduling/types'

export type LiftWindow = ReturnType<typeof climbWindows>[number]
export interface CorePose { upper:number; lower:number; panels:number; deployment:number; slew:number }
const unit = (n:number) => Math.max(0,Math.min(1,n))
const progress = (date:number, from:number, to:number) => unit((date-from)/(to-from))

// Use the generator's floor, core workstream and phase together. A floor can also have ordinary wall pours.
export function corePhases(erect:Activity, tasks:Activity[]): Partial<ClimbLift> {
  if (erect.schedule_phase_key !== 'formwork_rebar') return {}
  const prefix = erect.task_name.split(' - ').slice(0,-1).join(' - ')
  if (!prefix.endsWith(' - Core walls')) return {}
  const matching = tasks.filter(t => t.parent_id === erect.parent_id && t.task_name.startsWith(prefix+' - '))
  const unique = (key:string) => { const hits=matching.filter(t=>t.schedule_phase_key===key); return hits.length===1 ? hits[0].id : null }
  return {climb_activity_id:unique('core_climb'),pour_activity_id:unique('pour'),strip_activity_id:unique('strip')}
}

export function cycleWarnings(rows:LiftWindow[]) {
  const warnings:string[]=[]
  rows.forEach((row,i)=>{
    if (row.pour_activity_id && !row.pour || row.strip_activity_id && !row.strip)
      warnings.push(`Lift ${i+1} has a missing or undated pour or strip activity.`)
    if (i && rows[i-1].strip && rows[i-1].strip!.to > row.startMs)
      warnings.push(`Lift ${i+1} starts climbing before the previous strip finishes. Review the climb activity or its dates.`)
    if (row.erect && row.finishMs > row.erect.from)
      warnings.push(`Lift ${i+1} finishes climbing after its formwork activity starts.`)
    if (row.pour && row.erect && row.pour.from < row.erect.to || row.strip && row.pour && row.strip.from < row.pour.to)
      warnings.push(`Lift ${i+1} has overlapping formwork, pour or strip activities.`)
  })
  return warnings
}

type PourPoint = { progress:number; value:number }
function channelPoints(keys:PourBoomKey[], channel:'slew'|'deployment') {
  const points:PourPoint[]=[]
  for(const key of keys) {
    const value=key[channel]
    if(value!=null)points.push({progress:key.progress,value})
  }
  points.sort((a,b)=>a.progress-b.progress)
  if(channel==='deployment' && points.length) {
    if(points[0].progress>0)points.unshift({progress:0,value:0})
    if(points[points.length-1].progress<1)points.push({progress:1,value:0})
  }
  return points
}
function interpolatePour(points:PourPoint[], t:number, restingAngle?:number) {
  let previous=points[0]
  const last=points[points.length-1]
  if(restingAngle!=null && t<previous.progress)return restingAngle+(previous.value-restingAngle)*t/previous.progress
  if(restingAngle!=null && t>last.progress)return last.value+(restingAngle-last.value)*(t-last.progress)/(1-last.progress)
  for(const next of points) {
    if(t<=next.progress) {
      if(previous===next)return next.value
      return previous.value+(next.value-previous.value)*progress(t,previous.progress,next.progress)
    }
    previous=next
  }
  return previous.value
}

const unfoldFraction=.15
function sweepAngle(rest:number, start:number, finish:number, t:number) {
  if(t<unfoldFraction)return rest+(start-rest)*t/unfoldFraction
  if(t>1-unfoldFraction)return rest+(finish-rest)*(1-t)/unfoldFraction
  return start+(finish-start)*progress(t,unfoldFraction,1-unfoldFraction)
}
export function prepareCoreCycle(config:ClimbingFormwork, rows:LiftWindow[]) {
  const keys=(config.boom_keys??[]).map(k=>({...k,time:Date.parse(k.date)})).sort((a,b)=>a.time-b.time)
  const peak=config.boom_deployment??1, heading=config.boom_slew??0
  const linkedPour=rows.some(r=>r.pour_activity_id)
  const tracks=new Map(rows.filter(row=>row.pour_keys?.length).map(row=>[row.id,{
    slew:channelPoints(row.pour_keys!,'slew'),deployment:channelPoints(row.pour_keys!,'deployment')
  }]))
  return (date:number):CorePose=>{
    const pose:CorePose={upper:0,lower:0,panels:0,deployment:linkedPour?0:config.boom_deployment??0,slew:heading}
    if (!Number.isFinite(date)) return pose
    let last=0, working:LiftWindow|undefined, climbing=false
    for (const row of rows) {
      if (date<row.startMs) break
      if (date<row.finishMs && last!==row.height) {
        const t=progress(date,row.startMs,row.finishMs), rise=row.height-last
        pose.upper=last+rise*unit((t-.12)/.45)
        pose.lower=last+rise*unit((t-.57)/.43)
        pose.panels=working?.strip ? 1 : unit(t/.12)
        climbing=true
        break
      }
      pose.upper=pose.lower=last=row.height
      working=row
    }
    if (!climbing && working) {
      if (working.erect && working!==rows[0])
        pose.panels=1-progress(date,working.erect.from,working.erect.to)
      if (working.strip && date>=working.strip.from)
        pose.panels=progress(date,working.strip.from,working.strip.to)
    }
    if (keys.length) {
      const end=keys.findIndex(k=>k.time>=date)
      const a=keys[end<0?keys.length-1:Math.max(0,end-1)], b=end<0?a:keys[end]
      const t=a===b?0:progress(date,a.time,b.time)
      pose.deployment=a.deployment+(b.deployment-a.deployment)*t
      pose.slew=a.slew+(b.slew-a.slew)*t
    }
    if (!climbing && working?.pour && date>=working.pour.from && date<=working.pour.to) {
      const t=progress(date,working.pour.from,working.pour.to)
      const sweep=config.pour_sweep, track=tracks.get(working.id)
      if(!keys.length)pose.deployment=peak*Math.min(1,t/unfoldFraction,(1-t)/unfoldFraction)
      if(track?.slew.length)pose.slew=interpolatePour(track.slew,t,pose.slew)
      else if(sweep)pose.slew=sweepAngle(pose.slew,sweep.start_angle,sweep.finish_angle,t)
      if(track?.deployment.length)pose.deployment=interpolatePour(track.deployment,t)
    }
    if (climbing) pose.deployment=0
    return pose
  }
}

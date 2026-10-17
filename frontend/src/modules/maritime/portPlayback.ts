import type { Asset, FlowResult, OperationRun, ReplaySegment, WorkspaceDefinition } from './workspaceData'

export type Position = [number, number, number]
export type Placement = {x:number;z:number;heading:number}
export interface TrackState {value:number;rate:number;state:string;reason:string;call_id:string|null}
const idle: TrackState = {value:0,rate:0,state:'idle',reason:'No handling at this time',call_id:null}

/** Interpolate integrated quantities, never rates across an outage boundary. */
export function readTrack(rows: ReplaySegment[] | undefined, hour:number): TrackState | null {
  if (!rows?.length) return null
  let lo=0,hi=rows.length-1
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(rows[mid].start<=hour)lo=mid;else hi=mid-1}
  const row=rows[lo], t=Math.max(row.start,Math.min(row.end,hour))
  return {value:Math.max(0,row.value+row.rate*(t-row.start)),rate:hour>=row.end?0:row.rate,
    state:row.state,reason:row.reason,call_id:row.call_id}
}

export function portLayout(plan:WorkspaceDefinition): Record<string,Placement> {
  const result:Record<string,Placement>={},berths=plan.assets.filter(a=>a.kind==='berth')
  const lists=(kind:string)=>plan.assets.filter(a=>a.kind===kind)
  for(const a of plan.assets){
    const i=lists(a.kind).findIndex(b=>b.id===a.id)
    let p:Placement={x:0,z:0,heading:0}
    if(a.kind==='berth')p={x:(i-(berths.length-1)/2)*130,z:0,heading:0}
    if(a.kind==='crane'){
      const call=plan.calls.find(c=>c.crane_ids.includes(a.id)),bi=berths.findIndex(b=>b.id===call?.berth_id)
      const peers=lists('crane').filter(b=>plan.calls.find(c=>c.crane_ids.includes(b.id))?.berth_id===call?.berth_id)
      p={x:(Math.max(0,bi)-(berths.length-1)/2)*130+(peers.findIndex(b=>b.id===a.id)-(peers.length-1)/2)*26,z:0,heading:0}
    }
    if(a.kind==='yard')p={x:(i%3-1)*46,z:58+Math.floor(i/3)*48,heading:0}
    if(a.kind==='truck')p={x:-42+i*20,z:22,heading:0}
    if(a.kind==='gate')p={x:70+i*26,z:70,heading:0}
    if(a.kind==='infrastructure')p={x:40+i*38,z:115,heading:0}
    if(a.kind==='vessel'){
      const c=plan.calls.find(c=>c.vessel_id===a.id),bi=berths.findIndex(b=>b.id===c?.berth_id)
      p={x:(Math.max(0,bi)-(berths.length-1)/2)*130,z:-27-i*3,heading:0}
    }
    result[a.id]=a.placement??p
  }
  return result
}

export function assetTrack(asset:Asset,plan:WorkspaceDefinition,result:FlowResult|null,hour:number): TrackState {
  if(!result?.replay?.available)return {...idle,state:'ready',reason:'Run the saved plan to see calculated activity'}
  if(asset.kind==='vessel'){
    const calls=plan.calls.filter(c=>c.vessel_id===asset.id).sort((a,b)=>a.arrival_hour-b.arrival_hour||a.id.localeCompare(b.id))
    const candidates=calls.map(c=>{
      const s=readTrack(result.replay!.tracks[`call:${c.id}`],hour),finished=result.calls.find(row=>row.id===c.id)?.finish_hour
      return {c,s:s&&finished!=null&&hour>=finished?{...s,state:'complete',rate:0,reason:'Cargo unloaded'}:s}
    })
    const current=candidates.find(({s})=>s && ['handling','blocked','waiting'].includes(s.state))
      ?? candidates.find(({s})=>s?.state==='scheduled') ?? candidates[candidates.length-1]
    return current?.s?{...current.s,call_id:current.c.id}:idle
  }
  const track=readTrack(result.replay.tracks[`asset:${asset.id}`],hour)
  if(track&&result.status==='complete'&&hour>=result.elapsed_hours)return {...track,state:'idle',rate:0,reason:'Run finished'}
  return track??idle
}

export function flowAt(result:FlowResult|null,plan:WorkspaceDefinition,hour:number){
  const initial=plan.assets.filter(a=>a.kind==='yard').reduce((n,a)=>n+a.initial_stock,0)
  if(!result)return {handled:0,yard:initial,cleared:0}
  const keys=['handled','yard','cleared'] as const
  if(result.replay?.available)return Object.fromEntries(keys.map(k=>[k,readTrack(result.replay!.tracks[`flow:${k}`],hour)?.value??0])) as Record<typeof keys[number],number>
  // Old saved runs still show their recorded aggregates, without inventing per-asset states.
  const s=[...result.samples].reverse().find(s=>s.hour<=hour)??result.samples[0]
  return {handled:s?.handled??0,yard:s?.yard_moves??initial,cleared:s?.gate_cleared??0}
}

export function vesselPosition(a:Asset,plan:WorkspaceDefinition,result:FlowResult|null,hour:number,layout:Record<string,Placement>): Position {
  const p=layout[a.id],state=assetTrack(a,plan,result,hour)
  const call=plan.calls.find(c=>c.id===state.call_id)??plan.calls.find(c=>c.vessel_id===a.id)
  const row=result?.calls.find(c=>c.id===call?.id),berth=layout[call?.berth_id??'']
  if(!row)return [p.x,0,p.z]
  const x=berth?.x??p.x,z=(berth?.z??0)-27
  if(hour<row.arrival_hour)return [x-55-Math.max(0,row.arrival_hour-hour)*18,0,z-40]
  if(row.finish_hour!==null&&hour>=row.finish_hour)return [x+Math.min(160,(hour-row.finish_hour)*30),0,z-25]
  if(state.state==='waiting')return [x-75,0,z-45-plan.calls.findIndex(c=>c.id===row.id)*18]
  return [x,0,z]
}

export function runEvents(run:OperationRun){
  const plan=run.inputs.plan, scenario=plan.scenarios.find(s=>s.id===run.inputs.scenario_id)
  const events=[...plan.calls.map(c=>({hour:c.arrival_hour,label:`${c.name} arrives`,asset:c.vessel_id})),
    ...(scenario?.downtime??[]).flatMap(d=>[
      {hour:d.start_hour,label:`${plan.assets.find(a=>a.id===d.asset_id)?.name??'Asset'} stops`,asset:d.asset_id},
      {hour:d.start_hour+d.duration_hours,label:'Availability restored',asset:d.asset_id}]),
    ...plan.work_orders.filter(w=>w.status==='scheduled').map(w=>({hour:w.start_hour,label:w.name,asset:w.asset_id})),
    ...run.results.scenario.calls.filter(c=>c.finish_hour!==null).map(c=>({hour:c.finish_hour!,label:`${c.name} unloaded`,asset:plan.calls.find(p=>p.id===c.id)?.vessel_id??''}))]
  return events.filter(e=>e.hour<=run.results.scenario.elapsed_hours).sort((a,b)=>a.hour-b.hour)
}

export const statusLabel:Record<string,string>={ready:'Ready',idle:'Idle',working:'Handling cargo',handling:'Unloading',blocked:'Handling stopped',waiting:'Waiting',unavailable:'Unavailable',scheduled:'Approaching',occupied:'Occupied',complete:'Complete'}

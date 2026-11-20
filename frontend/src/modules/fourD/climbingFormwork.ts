export interface ClimbLift { id:string; activity_id:string|null; height:number; duration_hours:number; start:string|null; finish:string|null }
export interface ClimbingFormwork { axis:'y'|'z'; reference_elevation:number; lifts:ClimbLift[] }
type ActivityDate={id:string;start?:string|null;finish?:string|null}
export function climbWindows(config:ClimbingFormwork,activities:ActivityDate[]){
 const activityById=new Map(activities.map(a=>[a.id,a]));
 const rows=config.lifts.map(l=>{
  const activity=activityById.get(l.activity_id||'')
  const finish=Date.parse(l.finish||activity?.start||'')
  const start=l.start?Date.parse(l.start):finish-l.duration_hours*3600000
  if(!Number.isFinite(start)||!Number.isFinite(finish)||finish<=start)throw Error('Each lift needs a dated activity or valid manual climb times.')
  if(!Number.isFinite(l.height)||!Number.isFinite(l.duration_hours)||l.duration_hours<=0)throw Error('Enter a valid height and positive climb duration.')
  return {...l,startMs:start,finishMs:finish}
 }).sort((a,b)=>a.startMs-b.startMs)
 if(rows.some((r,i)=>i>0&&r.startMs<rows[i-1].finishMs))throw Error('Climb intervals overlap. Adjust their times or durations.')
 return rows
}
export function climbHeight(config:ClimbingFormwork,activities:ActivityDate[],date:number,resolved?:ReturnType<typeof climbWindows>){
 if(!Number.isFinite(date))return 0
 let height=0
 for(const row of resolved??climbWindows(config,activities)){
  if(date<row.startMs)break
  if(date<row.finishMs)return height+(row.height-height)*(date-row.startMs)/(row.finishMs-row.startMs)
  height=row.height
 }
 return height
}

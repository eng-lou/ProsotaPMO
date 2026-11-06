import { DEFAULT_ANIMATION_CONFIG } from './animationDefaults'
import type { SiteItem } from './siteScene'
export interface SiteScheduleRow { id:string; name:string; hours:number; include:boolean }
export function buildSiteSchedule(projectId:string,periodId:string,items:SiteItem[],rows:SiteScheduleRow[],options:{name:string;calendarId:string;sequence:boolean;profile:string;upAxis:'y'|'z';distance:number}){
  const selected=rows.filter(r=>r.include),known=new Map(items.map(i=>[i.id,i]))
  if(!selected.length)throw Error('Choose at least one object.')
  if(!options.name.trim())throw Error('Name the schedule group.')
  if(selected.some(r=>!known.has(r.id)||!r.name.trim()||!Number.isFinite(r.hours)||r.hours<=0))throw Error('Each selected object needs a name and a positive duration.')
  if(!Number.isFinite(options.distance)||options.distance<=0)throw Error('Enter a positive animation distance.')
  const builtin=options.profile==='drop'||options.profile==='fade'
  return {project_id:projectId,schedule_period_id:periodId,calendar_id:options.calendarId||null,
    site_animation_profile:builtin?{...DEFAULT_ANIMATION_CONFIG,color_from:null,transform_kind:options.profile==='drop'?'fall':'none',direction:1,axis:options.upAxis,distance:options.distance,interpolation:'ease_out'}:null,
    site_animation_profile_name:options.name.trim()+' · '+(options.profile==='drop'?'Drop into place':'Fade in'),
    activities:[{temp_id:'root',task_name:options.name.trim(),duration_hours:0},...selected.map(r=>({temp_id:r.id,parent_temp_id:'root',task_name:r.name.trim(),duration_hours:r.hours,source_kind:'site',element_refs:[r.id],element_labels:[known.get(r.id)!.name],animation_profile_id:builtin||options.profile==='default'?null:options.profile}))],
    relationships:options.sequence?selected.slice(1).map((r,i)=>({predecessor_temp_id:selected[i].id,successor_temp_id:r.id,relationship_type:'FS',lag_hours:0})):[],resources:[],assignments:[]}
}

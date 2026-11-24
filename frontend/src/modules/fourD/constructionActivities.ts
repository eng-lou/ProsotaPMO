import type { SiteScheduleRow } from './siteSchedule'

const taskSets = {
  cycle: ['Place and finish concrete slab', 'Deliver formwork and reinforcement by crane',
    'Raise perimeter protection screens by bay', 'Install props, bearers and joists', 'Lay slab soffit panels',
    'Climb core formwork and placing boom', 'Fix core wall reinforcement',
    'Close core wall forms', 'Pour core walls', 'Strip core wall forms', 'Fix column cages', 'Erect column shutters', 'Pour columns',
    'Set out openings and cast-in items', 'Install slab reinforcement', 'Install tendons and service conduits',
    'Complete deck pre-pour checks'],
  deck: ['Deliver slab formwork', 'Install props, bearers and joists', 'Lay slab soffit panels', 'Strip slab formwork and reshore'],
  slabEdge:['Set out slab edges and openings','Fix and brace slab edge shutters','Strip slab edge shutters'],
  groundBeam:['Set out ground beams','Install beam side shutters and stops','Strip ground beam shutters'],
  beam:['Install beam props and soffit','Erect beam side shutters','Strip beam sides','Strike beam soffit and props'],
  corePlain:['Climb core formwork','Fix core wall reinforcement','Close core wall forms','Pour core walls','Strip core wall forms'],
  ground:['Excavate selected ground volumes','Place foundations','Backfill excavations'],
  shutter: ['Deliver column shutters', 'Erect and brace column shutters', 'Pour columns', 'Strip column shutters'],
  wallForm: ['Deliver wall formwork panels', 'Erect and brace first wall face', 'Fix wall reinforcement',
    'Fit stop ends and opening forms', 'Close opposite wall face and install ties', 'Pour wall concrete', 'Strip wall formwork'],
  screen: ['Install screen anchors and shoes', 'Rig perimeter screen bay', 'Crane lift and secure screen bay', 'Release crane hook'],
  mat: ['Deliver slab reinforcement', 'Fix bottom mat', 'Install cast-in items', 'Fix top mat', 'Check slab reinforcement'],
  column: ['Assemble column cages', 'Crane lift column cages', 'Position and tie column cages'],
  wall: ['Deliver wall reinforcement', 'Fix first wall curtain', 'Fix second wall curtain', 'Check wall reinforcement'],
  core: ['Climb core formwork and placing boom', 'Fix core wall reinforcement', 'Close core wall forms', 'Pour core walls', 'Strip core wall forms'],
  crane: ['Deliver materials to laydown', 'Rig load at laydown', 'Hoist and slew load into position', 'Land and release load'],
  blank: [''],
} as const
export type ConstructionTemplate = keyof typeof taskSets
export const templateLabels: Record<ConstructionTemplate,string> = {
  slabEdge:'Ground slab edge formwork', groundBeam:'Ground beam formwork', beam:'Suspended beam formwork', corePlain:'Climbing core without boom', ground:'Ground excavation',
  cycle:'Deck cycle', deck:'Slab formwork', shutter:'Column shutters', wallForm:'Wall formwork', screen:'Perimeter screens',
  mat:'Slab reinforcement', column:'Column reinforcement', wall:'Wall reinforcement', core:'Climbing core', crane:'Crane delivery and lift', blank:'Custom activities',
}
const corePhaseKeys:Record<string,string>={
  'Climb core formwork':'core_climb', 'Climb core formwork and placing boom':'core_climb', 'Close core wall forms':'formwork_rebar',
  'Pour core walls':'pour', 'Strip core wall forms':'strip',
}
export interface SimulationRow extends SiteScheduleRow { corePhase?:string }
export function phaseRows(template:ConstructionTemplate):SimulationRow[]{
  return taskSets[template].map(name=>({id:crypto.randomUUID(),name,include:true,hours:8,corePhase:corePhaseKeys[name]}))
}

export function buildSimulationActivities(projectId:string, periodId:string, parentId:string, groupName:string,
  rows:SimulationRow[], calendarId:string, sequence:boolean){
  const selected=rows.filter(row=>row.include)
  if(!selected.length)throw Error('Choose at least one activity.')
  if(!parentId && !groupName.trim())throw Error('Name the new WBS.')
  if(selected.some(row=>!row.name.trim() || !Number.isFinite(row.hours) || row.hours<=0)){
    throw Error('Enter a name and positive working hours for every checked activity.')
  }
  const tasks=selected.map(row=>({temp_id:row.id,task_name:row.name.trim(),duration_hours:row.hours,
    parent_temp_id:parentId?null:'group',...(row.corePhase?{category:'Core lift',phase_key:row.corePhase}:{})}))
  return {project_id:projectId,schedule_period_id:periodId,parent_wbs_id:parentId||null,
    calendar_id:calendarId||null,
    activities:parentId?tasks:[{temp_id:'group',task_name:groupName.trim(),duration_hours:0},...tasks],
    relationships:sequence?selected.slice(1).map((row,i)=>({predecessor_temp_id:selected[i].id,successor_temp_id:row.id,relationship_type:'FS',lag_hours:0})):[]}
}

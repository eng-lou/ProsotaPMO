import type { EquipmentRig, EquipmentKey } from './equipmentRig'
import type { PathMotion, SitePathKey } from './siteScene'

export interface SoilCycleRecipe {
  pickup: Record<string,number>; carry: Record<string,number>; tip: Record<string,number>
  approach_seconds: number; lift_seconds: number; travel_seconds: number; tip_seconds: number
  start_progress: number; pickup_progress: number; drop_progress: number
}
export function buildEquipmentCycle(rig:EquipmentRig, recipe:SoilCycleRecipe, start:number, daysPerSecond:number, motion?:PathMotion) {
  const soil=rig.definition.soil
  if(!soil)throw Error('Set up the bucket and source pile first.')
  if(!Number.isFinite(start)||!Number.isFinite(daysPerSecond)||daysPerSecond<=0)throw Error('Choose a valid cycle start and timeline speed.')
  for(const field of ['approach_seconds','lift_seconds','travel_seconds','tip_seconds'] as const)
    if(!Number.isFinite(recipe[field])||recipe[field]<.1||recipe[field]>120)throw Error('Stage durations must be between 0.1 and 120 seconds.')
  for(const field of ['start_progress','pickup_progress','drop_progress'] as const)
    if(!Number.isFinite(recipe[field])||recipe[field]<0||recipe[field]>100)throw Error('Route positions must be between 0% and 100%.')
  for(const stage of ['pickup','carry','tip'] as const)for(const c of rig.definition.controls)
    if(!Number.isFinite(recipe[stage][c.id])||recipe[stage][c.id]<0||recipe[stage][c.id]>1)throw Error(`Capture the ${stage} pose again; a rig control is missing or invalid.`)
  const arrive=recipe.approach_seconds, lifted=arrive+recipe.lift_seconds, atDrop=lifted+recipe.travel_seconds, tipped=atDrop+recipe.tip_seconds
  // Hold fully tipped for the full capacity discharge time plus a sampling margin.
  const endSeconds=tipped+soil.pour_seconds+.5
  if(endSeconds>300)throw Error('Keep the complete cycle within 300 seconds.')
  const date=(seconds:number)=>new Date(start+seconds*86400000*daysPerSecond).toISOString()
  const end=Date.parse(date(endSeconds)), old=soil.cycle
  const replaceStart=old?Math.min(start,Date.parse(soil.start)):start
  const replaceEnd=old?Math.max(end,Date.parse(soil.end)):end
  const outside=(k:{date:string})=>Date.parse(k.date)<replaceStart||Date.parse(k.date)>replaceEnd
  const next=structuredClone(rig)
  next.definition.controls=next.definition.controls.map(c=>{
    const sequence:[number,Record<string,number>][]=[[0,recipe.pickup],[arrive,recipe.pickup],[lifted,recipe.carry],[atDrop,recipe.carry],[tipped,recipe.tip],[endSeconds,recipe.tip]]
    const generated:EquipmentKey[]=sequence.map(([t,pose])=>({date:date(t),value:pose[c.id],interpolation:'linear'}))
    return {...c,keys:[...c.keys.filter(outside),...generated].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))}
  })
  next.definition.soil={...soil,enabled:true,start:date(0),end:date(endSeconds),duration_seconds:endSeconds,cycle:structuredClone(recipe)}
  let route:PathMotion|undefined
  if(motion){
    const sequence:[number,number][]=[[0,recipe.start_progress],[arrive,recipe.pickup_progress],[lifted,recipe.pickup_progress],[atDrop,recipe.drop_progress],[endSeconds,recipe.drop_progress]]
    const generated:SitePathKey[]=sequence.map(([t,progress])=>({date:date(t),progress,interpolation:'linear'}))
    const progress_keys=[...(motion.progress_keys||[]).filter(outside),...generated].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))
    if(progress_keys.length>200)throw Error('This route would exceed 200 keys. Remove unused keys first.')
    route={...motion,loop:false,progress_keys}
  }
  return {rig:next,motion:route,stages:{arrive,lifted,atDrop,tipped,end:endSeconds}}
}

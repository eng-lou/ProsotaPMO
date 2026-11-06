import {newStep, uid, type Config, type Context, type Resource, type Step} from './types'

export function excavationExample(activityId:string){
 const excavator=uid(), trucks=uid()
 const resources:Resource[]=[{id:excavator,name:'Excavator',kind:'equipment',capacity:1,hourly_cost:null},{id:trucks,name:'Haul trucks',kind:'equipment',capacity:3,hourly_cost:null}]
 const step:Step={...newStep(activityId,'Excavate and haul'),basis:'cycle',quantity:120,cycle_quantity:10,unit:'m3',hold_resources:[{resource_id:trucks,units:1}],phases:[
  {id:uid(),name:'Load',hours:null,bucket_loading:{capacity_m3:1.5,fill_factor:.9,cycle_seconds:30},resources:[{resource_id:excavator,units:1}],state:'loading',object_states:[]},
  ...['Travel loaded','Tip','Return'].map((name,i)=>({id:uid(),name,hours:[5,1,4][i]/60,resources:[],state:name,object_states:[]}))
 ],assumptions:'Example inputs for testing: 120 m³, three 10 m³ trucks, one 1.5 m³ excavator bucket at 90% fill and 30 seconds per bucket cycle. Travel loaded 5 min, tip 1 min, return 4 min. Replace these values with your method data; no truck assets or animation are inferred.'}
 return {step,resources}
}

/** Reuse operation definitions while retaining one capacity pool per programme resource. */
export function scopeDefinitions(context:Context, activityIds:string[], config:Config|null){
 const resources:Resource[]=structuredClone(config?.resources??[])
 const steps:Step[]=[]
 for(const activityId of activityIds){
  const current=config?.steps.filter(s=>s.activity_id===activityId)??[]
  if(current.length){steps.push(...structuredClone(current));continue}
  const definitions=context.steps.filter(s=>s.activity_id===activityId)
  if(!definitions.length){steps.push(newStep(activityId,context.activities.find(a=>a.id===activityId)?.task_name??'Work'));continue}
  for(const definition of definitions){
   const {_resources=[],...operation}=definition.operation??{}
   const mapping=new Map<string,string>()
   for(const resource of _resources){
    const existing=resources.find(r=>r.id===resource.id||(resource.source_resource_id&&r.source_resource_id===resource.source_resource_id))
    if(existing)mapping.set(resource.id,existing.id)
    else resources.push(structuredClone(resource))
   }
   const step={...newStep(activityId,definition.name),...structuredClone(operation),activity_id:activityId,source_step_id:definition.id,name:definition.name,is_complete:definition.is_complete}
   const demands=(rows:Step['resources'])=>rows.map(d=>({...d,resource_id:mapping.get(d.resource_id)??d.resource_id}))
   step.resources=demands(step.resources);step.hold_resources=demands(step.hold_resources)
   step.phases=step.phases.map(p=>({...p,resources:demands(p.resources)}))
   steps.push(step)
  }
 }
 const ids=new Set(steps.map(s=>s.id))
 steps.forEach(s=>{s.dependencies=s.dependencies.filter(d=>ids.has(d.step_id))})
 return {steps,resources,disruptions:(config?.disruptions??[]).filter(d=>d.target!=='step'||ids.has(d.target_id))}
}

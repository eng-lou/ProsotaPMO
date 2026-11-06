import type { Scenario } from './types'

export function SequenceOverview({scenario,onSeek}:{scenario:Scenario;onSeek:(p:number)=>void}){
 const result=scenario.result;if(!result)return null
 const start=Date.parse(result.start),span=Math.max(1,Date.parse(result.finish)-start)
 return <div className="activity-sequences">{result.activities.map(activity=>{
  const steps=result.steps.filter(s=>s.activity_id===activity.activity_id).sort((a,b)=>(a.start??'').localeCompare(b.start??''))
  return <section key={activity.activity_id} className="activity-sequence"><strong>{activity.name}</strong><small>{steps.length} connected {steps.length===1?'step':'steps'}</small>{steps.map((step,index)=><div className="row" key={step.id}>
   <span className="sequence-step-name">{index+1}. {step.name}</span><div className="bar grow">{result.events.filter(e=>e.step_id===step.id).map((event,i)=><button key={i} disabled={scenario.status!=='current'} title={event.phase+' · '+new Date(event.start).toLocaleString()+' → '+new Date(event.end).toLocaleString()} aria-label={step.name+' · '+event.phase} style={{left:100*(Date.parse(event.start)-start)/span+'%',width:Math.max(.4,100*(Date.parse(event.end)-Date.parse(event.start))/span)+'%',background:['#4d78c4','#479d8c','#aa7c42','#8872b5'][i%4]}} onClick={()=>onSeek((Date.parse(event.start)-start)/span)}>{event.phase}</button>)}</div>
  </div>)}</section>
 })}</div>
}

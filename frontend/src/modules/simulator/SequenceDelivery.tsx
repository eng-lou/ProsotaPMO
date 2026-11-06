import { useState } from 'react'
import { api } from '@/lib/api'
import type { Scenario } from './types'
import type { WorkingSequence } from './useWorkingSequence'

export function SequenceDelivery({scenario,projectId,periodId,onPromoted,onExport}:{scenario:Scenario;projectId:string;periodId:string;onPromoted?:(v:WorkingSequence)=>void;onExport?:(s:Scenario,seconds:number)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[seconds,setSeconds]=useState(30),[replace,setReplace]=useState<WorkingSequence|null>(null)
 const ready=scenario.status==='current'&&scenario.result?.basis==='event_simulation'&&scenario.result.events.some(e=>e.worker_action||e.object_states.length)
 async function promote(){setBusy(true);setError('');try{
  const {data:existing}=await api.get<WorkingSequence|null>('/api/v1/simulations/working',{params:{project_id:projectId,schedule_period_id:periodId}})
  if(existing&&replace?.revision!==existing.revision){setReplace(existing);return}
  const {data}=await api.post<WorkingSequence>('/api/v1/simulations/'+scenario.id+'/promote',{revision:scenario.revision,working_revision:existing?.revision??0})
  setReplace(null);onPromoted?.(data)
 }catch(e:any){setError(typeof e?.response?.data?.detail==='string'?e.response.data.detail:e.message)}finally{setBusy(false)}}
 return <section className="card sequence-delivery"><h3>Use the combined sequence</h3><p>Promote all connected steps into the working project. Each activity’s full sequence fits proportionally between its scheduled start and finish. Step order and relative timing stay together; programme dates and the original simulation result stay unchanged.</p>
 <div className="row">{onPromoted&&<button className="primary" disabled={!ready||busy} onClick={promote}>{busy?'Saving…':replace?'Replace working sequence':'Promote to working'}</button>}{replace&&<button onClick={()=>setReplace(null)}>Cancel replacement</button>}<span className="muted">Switch between Detailed sequence and Simple 4D in the workspace.</span></div>
 {replace&&<p>Replace “{replace.scenario.name}” in the working project? Saved scenarios remain available.</p>}
 {onExport&&<div className="row"><label>Video length (seconds)<input type="number" min={1} max={3600} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label><button disabled={!ready||busy||!Number.isFinite(seconds)||seconds<1||seconds>3600} onClick={()=>onExport(scenario,seconds)}>Export combined sequence video</button></div>}
 <small>Video captures all activities in this run, in the current camera view. Resolution and overlays use Capture settings. Export the promoted view from the workspace to use parent activity timing.</small>{error&&<p role="alert" className="error">{error}</p>}</section>
}

import {useEffect,useMemo,useRef,useState} from 'react'
import {api} from '@/lib/api'
import {siteError} from './siteScene'
import {matchFloor,readFloors,sequenceIssues,type FloorElement,type SequenceIssue} from './floorReview'
import type {IfcModelHandle} from './ifcModel'
import type {Activity} from '../scheduling/types'
import type {ModelElementLink} from './modelElementLinks'

export function FloorCyclePanel({projectId,periodId,models,activities,links,axis,inspect,refresh}:{
  projectId:string;periodId?:string;models:IfcModelHandle[];activities:Activity[];links:ModelElementLink[];axis:'y'|'z'
  inspect(issue:SequenceIssue):void;refresh():void
}){
  const [modelId,setModelId]=useState(''),[elements,setElements]=useState<FloorElement[]>([])
  const [source,setSource]=useState(''),[wbs,setWbs]=useState(''),[targets,setTargets]=useState<string[]>([])
  const [chain,setChain]=useState(true),[match,setMatch]=useState(true),[busy,setBusy]=useState(false)
  const [review,setReview]=useState(false),[message,setMessage]=useState(''),worker=useRef(0)
  const model=models.find(m=>String(m.modelID)===modelId)??models[0]
  useEffect(()=>{worker.current++;setElements([]);setSource('');setWbs('');setTargets([]);setBusy(false);setReview(false);setMessage('');return ()=>{worker.current++}},[model,axis,periodId])
  const floors=useMemo(()=>[...new Map(elements.filter(e=>e.storeyName!=='Unassigned').map(e=>[e.storeyName,e.storeyElevation??0])).entries()].sort((a,b)=>a[1]-b[1]).map(([name])=>name),[elements])
  const groups=activities.filter(a=>a.schedule_period_id===periodId&&a.activity_type==='wbs_summary')
  const previews=useMemo(()=>floors.filter(f=>targets.includes(f)).map(f=>matchFloor(elements,source,f)),[floors,targets,elements,source])
  const findings=useMemo(()=>review?sequenceIssues(elements,activities.filter(a=>a.schedule_period_id===periodId),links,axis):[],[review,elements,activities,links,periodId,axis])
  async function read(){if(!model)return;const job=++worker.current;setBusy(true);setMessage('');try{
    const rows=await readFloors(model,axis)
    if(worker.current===job){setElements(rows);setReview(true);if(!rows.length)setMessage('No IFC schedule elements found.')}
  }catch(e){if(worker.current===job)setMessage(siteError(e))}finally{if(worker.current===job)setBusy(false)}}
  async function apply(){if(!wbs||!source||!previews.length||busy)return;setBusy(true);setMessage('')
    try{const {data}=await api.post('/api/v1/schedule-bulk-generate/repeat-floor',{project_id:projectId,schedule_period_id:periodId,source_wbs_id:wbs,source_level:source,chain,
      floors:previews.map(p=>({name:p.name,hosts:match?p.hosts:{}}))});refresh();setMessage(data.created+' activities/WBS created · '+data.reused+' existing rows reused · '+data.links+' new IFC links.');setTargets([])
    }catch(e){setMessage(siteError(e))}finally{setBusy(false)}}
  const field='w-full rounded border p-1 dark:bg-prosota-panel2',button='rounded border px-2 py-1 disabled:opacity-40'
  return <details className="rounded border p-2"><summary>Floor cycles and sequence checks</summary><fieldset className="space-y-2" disabled={busy}>
    <label>IFC model<select className={field} value={model?.modelID??''} onChange={e=>setModelId(e.target.value)}>{models.map(m=><option key={m.modelID} value={m.modelID}>{m.object.name||'IFC '+m.modelID}</option>)}</select></label>
    <button className={button} disabled={!model} onClick={()=>void read()}>{busy?'Working…':'Read floors and check sequence'}</button>
    {review&&<><strong className="block">Sequence checks · {findings.length}</strong><div className="max-h-44 overflow-auto">{findings.map((p,i)=><button key={i} className={button+' block text-left'} onClick={()=>inspect(p)}>{p.message}</button>)}</div>
    {!findings.length&&<p>No material or supporting-slab timing conflicts found among the linked elements checked.</p>}
    <label>Source IFC floor<select className={field} value={source} onChange={e=>{const f=e.target.value;setSource(f);setTargets([]);setWbs(groups.find(g=>g.task_name===f)?.id??'')}}><option value="">Choose…</option>{floors.map(f=><option key={f}>{f}</option>)}</select></label>
    <label>Source schedule WBS<select className={field} value={wbs} onChange={e=>setWbs(e.target.value)}><option value="">Choose…</option>{groups.map(g=><option value={g.id} key={g.id}>{g.wbs_path} · {g.task_name}</option>)}</select></label>
    {source&&<fieldset><legend>Receiving floors</legend>{floors.slice(floors.indexOf(source)+1).map(f=><label key={f} className="block"><input type="checkbox" checked={targets.includes(f)} onChange={e=>setTargets(e.target.checked?[...targets,f]:targets.filter(n=>n!==f))}/> {f}</label>)}</fieldset>}
    <label className="block"><input type="checkbox" checked={chain} onChange={e=>setChain(e.target.checked)}/> Link each floor finish to the next start</label>
    <label className="block"><input type="checkbox" checked={match} onChange={e=>setMatch(e.target.checked)}/> Carry IFC links to matching elements</label>
    {previews.map(p=><details key={p.name}><summary>{p.name} · {Object.keys(p.hosts).length} matches · {p.review.length} to review</summary><ul className="max-h-36 overflow-auto">{p.review.map((r,i)=><li key={i}>{r}</li>)}</ul></details>)}
    <button className={button} disabled={!wbs||!periodId||!previews.length} onClick={()=>void apply()}>Apply floor cycle</button></>}
    {message&&<p role="status">{message}</p>}
  </fieldset></details>
}

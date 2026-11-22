import { useMemo, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import { controlValue, type EquipmentControl, type EquipmentDefinition } from './equipmentRig'
import { sampleCraneSweep, type CraneSweep, type craneSweepWindows } from './craneSweep'

type Window=ReturnType<typeof craneSweepWindows>[number]
const button='rounded border px-2 py-1 disabled:opacity-40'
const emptySweeps:CraneSweep[]=[]
const field='block w-full rounded border p-1 dark:bg-prosota-panel2'
const title=(a:Activity)=>[a.code,a.task_name].filter(Boolean).join(' · ')

function SweepRow({s, activity, control, window, overlap, time, edit, remove, seek, preview}:{
  s:CraneSweep; activity?:Activity; control?:EquipmentControl; window?:Window; overlap:boolean; time:number
  edit:(patch:Partial<CraneSweep>)=>void;remove:()=>void;seek:(date:Date)=>void;preview:(control:string,value:number)=>void
}) {
  const [draft,setDraft]=useState<{time:number;value:number}|null>(null)
  const start=Date.parse(activity?.start??''), end=Date.parse(activity?.finish??'')
  const valid=Number.isFinite(start)&&end>start
  const inside=valid&&time>=start&&time<=end
  const fraction=inside?(s.keys.find(k=>Math.round(start+(end-start)*k.progress)===time)?.progress??Math.round(1e6*(time-start)/(end-start))/1e6):0
  const go=(p:number)=>{if(valid){setDraft(null);seek(new Date(Math.round(start+p*(end-start))))}}
  const manual=control?controlValue(control,time):0
  const pose=draft?.time===time?draft.value:(window?sampleCraneSweep([window],time,()=>manual)[s.control]:undefined)??manual
  return <details className="rounded border p-2"><summary>{activity?title(activity):'Missing activity'} · {s.enabled?'sweep':'manual'}</summary>
    <label><input type="checkbox" checked={s.enabled} onChange={e=>edit({enabled:e.target.checked})}/> Use sweep during this activity</label>
    {!valid&&<p role="status">This link needs an activity with a start and finish.</p>}
    {overlap&&<p role="status">Linked activities overlap. The first enabled activity in this list takes priority while both run.</p>}
    <p>{control?.name??'Missing control'}</p>
    {(['start_value','end_value'] as const).map(k=><label className="block" key={k}>
      {k==='start_value'?'From':'To'} · {s[k].toFixed(2)}
      <input type="range" aria-label={k==='start_value'?'Sweep from':'Sweep to'} min="0" max="1" step=".01" value={s[k]} className="w-full" onChange={e=>edit({[k]:Number(e.target.value)})}/>
    </label>)}
    <label>Round trips per activity<input className={field} type="number" min="1" max="200" step="1" defaultValue={s.cycles} key={s.cycles}
      onBlur={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isInteger(n)&&n>=1&&n<=200){if(n!==s.cycles)edit({cycles:n})}else e.currentTarget.value=String(s.cycles)}}/></label>
    <label>Activity progress · {inside?(fraction*100).toFixed(1)+'%':'outside activity'}
      <input aria-label="Crane activity progress" className="w-full" type="range" min="0" max="100" step=".1" disabled={!valid} value={inside?fraction*100:0} onChange={e=>go(Number(e.target.value)/100)}/>
    </label>
    {valid&&!inside&&<button className={button} onClick={()=>go(.5)}>Preview midpoint</button>}
    <details><summary>Custom slew keys ({s.keys.length})</summary>
      <p>Each key follows the activity percentage. Adding keys replaces the automatic round trips for this activity.</p>
      <label>Slew pose · {pose.toFixed(2)}<input aria-label="Activity slew pose" className="w-full" type="range" min="0" max="1" step=".01" value={pose} disabled={!inside||!s.enabled}
        onChange={e=>{const value=Number(e.target.value);setDraft({time,value});preview(s.control,value)}}/></label>
      <button className={button} disabled={!inside||!s.enabled||(s.keys.length>=128&&!s.keys.some(k=>k.progress===fraction))}
        onClick={()=>{edit({keys:[...s.keys.filter(k=>k.progress!==fraction),{progress:fraction,value:pose}].sort((a,b)=>a.progress-b.progress)});setDraft(null)}}>Key slew at this percentage</button>
      {s.keys.map(k=><div key={k.progress}><button className={button} disabled={!valid} onClick={()=>go(k.progress)}>{Number((100*k.progress).toFixed(3))}% · {k.value.toFixed(2)}</button>
        <button className={button} onClick={()=>edit({keys:s.keys.filter(key=>key!==k)})}>Remove key</button></div>)}
    </details>
    <button className={button} onClick={remove}>Unlink activity</button>
  </details>
}

export function CraneSweepPanel({definition,activities,windows,time,change,seek,preview}:{
  definition:EquipmentDefinition;activities:Activity[];windows:Window[];time:number
  change:(sweeps:CraneSweep[])=>void;seek:(d:Date)=>void;preview:(id:string,value:number)=>void
}) {
  const [query,setQuery]=useState(''),[choice,setChoice]=useState('')
  const [open,setOpen]=useState(false)
  const [selected,setSelected]=useState<string[]>([])
  const hinges=definition.controls.filter(c=>definition.joints.some(j=>j.control===c.id&&j.kind==='hinge'))
  const chosen=hinges.find(c=>c.id===choice)??hinges.find(c=>/slew|swing|turntable/i.test(c.name))
  const rows=definition.crane_sweeps??emptySweeps
  const byId=useMemo(()=>new Map(activities.map(a=>[a.id,a])),[activities])
  const available=useMemo(()=>{
    if(!open)return []
    const linked=new Set(rows.map(s=>s.activity_id))
    const search=query.trim().toLowerCase()
    return activities.filter(a=>a.activity_type==='task'&&Date.parse(a.finish??'')>Date.parse(a.start??'')&&
      !linked.has(a.id)&&title(a).toLowerCase().includes(search)).slice(0,100)
  },[open,rows,query,activities])
  if(!hinges.length&&!rows.length)return null
  const additions=!selected.length?[]:activities.filter(a=>selected.includes(a.id)&&a.activity_type==='task'&&Date.parse(a.finish??'')>Date.parse(a.start??'')&&!rows.some(s=>s.activity_id===a.id))
  return <details className="space-y-2 rounded border p-2" onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open)}}><summary className="font-semibold">Scheduled crane sweeps ({rows.length})</summary>
    {open&&<>
    <label>Slew control<select className={field} value={chosen?.id??''} onChange={e=>setChoice(e.target.value)}>
      <option value="">Choose a hinge control</option>{hinges.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>
    <label>Find activities<input className={field} value={query} placeholder="Activity name or code" onChange={e=>setQuery(e.target.value)}/></label>
    <div className="max-h-36 overflow-y-auto">{available.map(a=><label className="block" key={a.id}><input type="checkbox" checked={selected.includes(a.id)}
      onChange={e=>setSelected(ids=>e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/> {title(a)}</label>)}</div>
    <button className={button} disabled={!chosen||!additions.length||rows.length+additions.length>300} onClick={()=>{
      if(!chosen)return
      change([...rows,...additions.map(a=>({activity_id:a.id,control:chosen.id,start_value:.25,end_value:.75,cycles:1,enabled:true,keys:[]}))])
      setSelected([])
    }}>Link selected activities ({additions.length})</button>
    {rows.map(s=>{
      const w=windows.find(x=>x.activity_id===s.activity_id)
      return <SweepRow key={s.activity_id} s={s} window={w} overlap={!!w&&windows.some(x=>x!==w&&x.start<w.end&&x.end>w.start)}
        activity={byId.get(s.activity_id)} control={definition.controls.find(c=>c.id===s.control)} time={time}
        edit={patch=>change(rows.map(row=>row===s?{...s,...patch}:row))} remove={()=>change(rows.filter(row=>row!==s))} seek={seek} preview={preview}/>
    })}</>}
  </details>
}

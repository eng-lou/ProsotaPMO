import {useRef, useState} from 'react'
import {api} from '@/lib/api'
import type {Activity} from '../scheduling/types'
import {buildSimulationActivities, phaseRows, templateLabels, type ConstructionTemplate} from './constructionActivities'
import {siteError} from './siteScene'
import type {SiteScheduleRow} from './siteSchedule'

export function SimulationActivityPlanner({projectId,periodId,activities,calendars,initialTemplate,busy,onBusy,onCancel,onGenerated}:{
  projectId:string; periodId?:string; activities:Activity[]; calendars:{id:string; name:string}[]
  initialTemplate:ConstructionTemplate; busy:boolean; onBusy(value:boolean):void; onCancel():void; onGenerated():void
}){
  const groups=activities.filter(a=>a.activity_type==='wbs_summary' && a.schedule_period_id===periodId)
  const [parent,setParent]=useState(groups.length?'':'new')
  const [template,setTemplate]=useState(initialTemplate)
  const [groupName,setGroupName]=useState(templateLabels[initialTemplate])
  const [rows,setRows]=useState(()=>phaseRows(initialTemplate))
  const [calendar,setCalendar]=useState(''),[sequence,setSequence]=useState(false)
  const [allowMatching,setAllowMatching]=useState(false),[error,setError]=useState('')
  const submitting=useRef(false)
  const input='border rounded p-1.5 bg-white dark:bg-prosota-panel2 min-w-0'
  const button='border rounded px-2 py-1 disabled:opacity-40'
  const normalize=(name:string)=>name.trim().toLocaleLowerCase()
  const existing=new Set(activities.filter(a=>a.parent_id===parent).map(a=>normalize(a.task_name)))
  const matches=(row:SiteScheduleRow)=>existing.has(normalize(row.name))
  const eligible=rows.map(row=>matches(row)&&!allowMatching?{...row,include:false}:row)
  const selected=eligible.filter(row=>row.include)
  function change(id:string,patch:Partial<SiteScheduleRow>){
    setRows(items=>items.map(row=>row.id===id?{...row,...patch}:row))
  }
  function move(index:number,delta:number){
    setRows(old=>{
      const next=[...old]
      next.splice(index+delta,0,...next.splice(index,1))
      return next
    })
  }
  function chooseTemplate(t:ConstructionTemplate){
    setTemplate(t);setRows(phaseRows(t));setError('')
    if(groupName===templateLabels[template])setGroupName(templateLabels[t])
  }
  async function create(){
    if(!periodId||!parent||submitting.current)return
    submitting.current=true;onBusy(true);setError('')
    try{
      const payload=buildSimulationActivities(projectId,periodId,parent==='new'?'':parent,groupName,eligible,calendar,sequence)
      await api.post('/api/v1/schedule-bulk-generate/',payload)
      onGenerated()
    }catch(e){setError(siteError(e))}
    finally{submitting.current=false;onBusy(false)}
  }
  return <fieldset disabled={busy} className="space-y-3">
    <p className="text-sm">Add tasks to a floor or work package. Assign IFC elements, site objects and rig activities afterwards.</p>
    {!periodId&&<p role="alert">Choose a live schedule period to add activities.</p>}
    <div className="grid grid-cols-2 gap-3">
      <label className="grid">Destination WBS<select className={input} value={parent} onChange={e=>setParent(e.target.value)}>
        {groups.length>0&&<option value="">Choose a WBS…</option>}
        {groups.map(a=><option key={a.id} value={a.id}>{a.wbs_path||a.code} · {a.task_name}</option>)}
        <option value="new">Create a new WBS</option>
      </select></label>
      {parent==='new'&&<label className="grid">New WBS name<input className={input} maxLength={100} value={groupName} onChange={e=>setGroupName(e.target.value)}/></label>}
      <label className="grid">Activity template<select className={input} value={template} onChange={e=>chooseTemplate(e.target.value as ConstructionTemplate)}>
        {Object.entries(templateLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select></label>
      <label className="grid">Calendar<select className={input} value={calendar} onChange={e=>setCalendar(e.target.value)}>
        <option value="">Project default</option>{calendars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
    </div>
    <p className="text-sm">Review the working hours for this lift. Each task starts with an editable 8-hour allowance.</p>
    {rows.some(matches)&&<label className="flex gap-2"><input type="checkbox" checked={allowMatching} onChange={e=>setAllowMatching(e.target.checked)}/>Allow activities with names already in this WBS</label>}
    <div className="max-h-[42vh] overflow-auto"><table className="w-full text-sm"><thead><tr><th>Use</th><th>Activity</th><th>Hours</th><th>Order</th></tr></thead>
      <tbody>{rows.map((row,i)=><tr className="border-t" key={row.id}>
        <td><input aria-label={'Include '+row.name} type="checkbox" checked={eligible[i].include} disabled={matches(row)&&!allowMatching} onChange={e=>change(row.id,{include:e.target.checked})}/></td>
        <td><input aria-label={'Activity '+(i+1)} className={input+' w-full'} maxLength={500} value={row.name} onChange={e=>change(row.id,{name:e.target.value})}/>{matches(row)&&<small>Already in this WBS</small>}</td>
        <td><input aria-label={'Hours for '+row.name} className={input+' w-20'} type="number" min=".01" step="any" value={Number.isFinite(row.hours)?row.hours:''} onChange={e=>change(row.id,{hours:e.target.valueAsNumber})}/></td>
        <td className="whitespace-nowrap"><button className={button} aria-label={'Move '+row.name+' up'} disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button className={button} aria-label={'Move '+row.name+' down'} disabled={i===rows.length-1} onClick={()=>move(i,1)}>↓</button></td>
      </tr>)}</tbody></table></div>
    <div className="flex gap-2"><button className={button} onClick={()=>setRows(old=>[...old,...phaseRows('blank')])}>Add row</button>
      <button className={button} onClick={()=>setRows(old=>old.map(r=>({...r,include:false})))}>Clear selection</button>
      <button className={button} onClick={()=>setRows(old=>old.map(r=>({...r,include:true})))}>Check all</button></div>
    <label className="flex gap-2"><input type="checkbox" checked={sequence} onChange={e=>setSequence(e.target.checked)}/>Link checked activities in order (finish-to-start)</label>
    {error&&<p role="alert" className="text-red-600">{error}</p>}
    <div className="flex items-center gap-2"><button className={button+' bg-blue-600 text-white'} disabled={!periodId||!parent||!selected.length} onClick={()=>void create()}>{busy?'Creating…':'Create '+selected.length+' '+(selected.length===1?'activity':'activities')}</button>
      <button className={button} onClick={onCancel}>Cancel</button></div>
  </fieldset>
}

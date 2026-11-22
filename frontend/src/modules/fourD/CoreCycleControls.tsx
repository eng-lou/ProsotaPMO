import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Object3D } from 'three'
import type { Activity } from '@/modules/scheduling/types'
import { climbWindows, type ClimbLift, type ClimbingFormwork } from './climbingFormwork'
import { prepareCoreCycle, type LiftWindow } from './coreCycle'
import { markRenderActivity } from './IdleRenderDriver'

export function CoreLiftTiming({lift,row,activities,onSeek,change}:{
  lift:ClimbLift;row?:LiftWindow;activities:Activity[];onSeek(date:Date):void;change(patch:Partial<ClimbLift>):void
}) {
  const [query,setQuery]=useState(''), [position,setPosition]=useState(0)
  const anchor=activities.find(a=>a.id===lift.activity_id)
  const names=[['climb_activity_id','Climb activity','Count back from formwork start'],['pour_activity_id','Pour activity','No linked pour'],['strip_activity_id','Strip activity','Retract during the climb']] as const
  return <>
    <label>Find phase activities<input className="w-full" value={query} placeholder="Search by name or code" onChange={e=>setQuery(e.target.value)}/></label>
    {names.map(([key,label,empty])=>{
      const q=query.trim().toLowerCase(), current=activities.find(a=>a.id===lift[key])
      const options=activities.filter(a=>a.start && a.finish && a.activity_type!=='wbs_summary' &&
        (q?(a.code+' '+a.task_name).toLowerCase().includes(q):a.parent_id===anchor?.parent_id)).slice(0,100)
      if(current && !options.includes(current))options.unshift(current)
      return <label key={key}>{label}<select className="w-full" value={lift[key]||''} onChange={e=>change({[key]:e.target.value||null})}>
        <option value="">{empty}</option>{options.map(a=><option key={a.id} value={a.id}>{a.code} · {a.task_name}</option>)}
      </select></label>
    })}
    {row&&<label>Preview climb progress · {position.toFixed(2)}<input className="w-full" type="range" min="0" max="1" step=".01" value={position}
      onChange={e=>{const value=Number(e.target.value);setPosition(value);onSeek(new Date(row.startMs+(row.finishMs-row.startMs)*value))}}/></label>}
  </>
}

export function CoreBoomControls({config,activities,source,dateRef,save,onSeek}:{
  config:ClimbingFormwork;activities:Activity[];source?:Object3D;dateRef?:RefObject<Date|null>
  save(config:ClimbingFormwork):Promise<boolean>;onSeek(date:Date):void
}) {
  const [open,setOpen]=useState(false), [clock,setClock]=useState(dateRef?.current?.getTime()??NaN)
  const [manual,setManual]=useState<{deployment:number;slew:number;time:number}|null>(null)
  const details=useRef<HTMLDetailsElement>(null)
  const sample=useMemo(()=>{try{return prepareCoreCycle(config,climbWindows(config,activities))}catch{return null}},[config,activities])
  useEffect(()=>{
    const outer=details.current?.parentElement?.closest('details')
    if(!outer)return
    const closed=()=>{if(!outer.open && details.current){details.current.open=false;setManual(null)}}
    outer.addEventListener('toggle',closed);return ()=>outer.removeEventListener('toggle',closed)
  },[])
  useEffect(()=>{
    if(!open)return
    const tick=()=>setClock(dateRef?.current?.getTime()??NaN)
    tick();const timer=setInterval(tick,120);return ()=>clearInterval(timer)
  },[dateRef,open])
  useEffect(()=>{
    if(!source || !manual || !open || !Object.is(manual.time,clock))return
    source.userData.coreBoomPreview=manual;markRenderActivity()
    return ()=>{if(source.userData.coreBoomPreview===manual)delete source.userData.coreBoomPreview;markRenderActivity()}
  },[source,manual,open,clock])
  const at=sample?.(clock)
  const draft=manual && Object.is(manual.time,clock)?manual:null
  const deployment=draft?.deployment??at?.deployment??0, slew=draft?.slew??at?.slew??0
  const keys=config.boom_keys??[]
  const write=async(value:ClimbingFormwork)=>{if(await save(value))setManual(null)}
  return <details ref={details} onToggle={e=>{if(e.target===e.currentTarget){setOpen(e.currentTarget.open);if(!e.currentTarget.open)setManual(null)}}}>
    <summary>Placing boom pose</summary>
    <label>Deployment · {deployment.toFixed(2)}<input type="range" className="w-full" min="0" max="1" step=".01" value={deployment}
      onChange={e=>setManual({deployment:Number(e.target.value),slew,time:clock})}/></label>
    <label>Slew · {slew.toFixed(0)}°<input type="range" className="w-full" min="-180" max="180" value={slew}
      onChange={e=>setManual({deployment,slew:Number(e.target.value),time:clock})}/></label>
    <button disabled={!draft} onClick={()=>void write({...config,boom_deployment:deployment,boom_slew:slew})}>Set working pose</button>
    <button disabled={!Number.isFinite(clock)||(!keys.some(k=>Date.parse(k.date)===clock)&&keys.length>=128)}
      onClick={()=>void write({...config,boom_keys:[...keys.filter(k=>Date.parse(k.date)!==clock),{date:new Date(clock).toISOString(),deployment,slew}].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))})}>Key pose at playhead</button>
    {draft&&<button onClick={()=>setManual(null)}>Cancel preview</button>}
    {keys.length>0?<><p>Boom keys drive deployment and slew between climbs.</p>{keys.map(k=><div key={k.date}>
      <button onClick={()=>onSeek(new Date(k.date))}>{new Date(k.date).toLocaleString()} · {k.deployment.toFixed(2)} · {k.slew}°</button>
      <button onClick={()=>void write({...config,boom_keys:keys.filter(v=>v!==k)})}>Remove key</button></div>)}</>:
      <p>Linked pours deploy to the working pose and fold at the end. The boom stows for each climb.</p>}
  </details>
}

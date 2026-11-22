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

export function CoreBoomControls({config,activities,source,dateRef,save,onSeek,lift,editorGroup}:{
  config:ClimbingFormwork;activities:Activity[];source?:Object3D;dateRef?:RefObject<Date|null>;lift?:ClimbLift
  save(config:ClimbingFormwork):Promise<boolean>;onSeek(date:Date):void;editorGroup:string
}) {
  const [open,setOpen]=useState(false), [clock,setClock]=useState(dateRef?.current?.getTime()??NaN)
  const [manual,setManual]=useState<{deployment:number;slew:number;time:number}|null>(null)
  const details=useRef<HTMLDetailsElement>(null)
  const rows=useMemo(()=>{try{return climbWindows(config,activities)}catch{return []}},[config,activities])
  const sample=useMemo(()=>prepareCoreCycle(config,rows),[config,rows])
  const pour=lift && rows.find(row=>row.id===lift.id)?.pour
  useEffect(()=>{
    const ancestors:HTMLDetailsElement[]=[]
    for(let el=details.current?.parentElement;el;el=el.parentElement) {
      if(el instanceof HTMLDetailsElement)ancestors.push(el)
    }
    const closed=(event:Event)=>{
      if(event.target instanceof HTMLDetailsElement && !event.target.open && details.current) {
        details.current.open=false
        setManual(null)
      }
    }
    ancestors.forEach(el=>el.addEventListener('toggle',closed))
    return ()=>ancestors.forEach(el=>el.removeEventListener('toggle',closed))
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
  const at=sample(clock)
  const draft=manual && Object.is(manual.time,clock)?manual:null
  const deployment=draft?.deployment??at.deployment, slew=draft?.slew??at.slew
  const keys=config.boom_keys??[]
  const write=async(value:ClimbingFormwork)=>{if(await save(value))setManual(null)}
  const pourKeys=lift?.pour_keys??[]
  const inPour=!!pour && clock>=pour.from && clock<=pour.to
  const storedProgress=pour && pourKeys.find(k=>Math.round(pour.from+k.progress*(pour.to-pour.from))===clock)?.progress
  const fraction=inPour && pour ? storedProgress??Math.round(1e6*(clock-pour.from)/(pour.to-pour.from))/1e6 : 0
  const seekPour=(progress:number)=>{
    if(pour){const time=Math.round(pour.from+progress*(pour.to-pour.from));setManual(null);setClock(time);onSeek(new Date(time))}
  }
  const current=pourKeys.find(k=>k.progress===fraction)
  const editKey=(progress:number,channel:'deployment'|'slew',value:number|null)=>{
    if(!lift)return
    const key={...pourKeys.find(k=>k.progress===progress),progress,[channel]:value}
    const updated=pourKeys.filter(k=>k.progress!==progress)
    if(key.slew!=null || key.deployment!=null)updated.push(key)
    updated.sort((a,b)=>a.progress-b.progress)
    void write({...config,lifts:config.lifts.map(row=>row.id===lift.id?{...row,pour_keys:updated}:row)})
  }
  const sweep=config.pour_sweep
  return <details ref={details} name={editorGroup} onToggle={e=>{if(e.target===e.currentTarget){setOpen(e.currentTarget.open);if(!e.currentTarget.open)setManual(null)}}}>
    <summary>{lift?'Boom animation for this pour':'Placing boom pose'}</summary>
    {lift&&<>
      <label>Pour progress · {inPour?(fraction*100).toFixed(1)+'%':'outside pour'}<input aria-label="Pour progress" type="range" className="w-full" min="0" max="100" step=".1" disabled={!pour}
        value={inPour?fraction*100:0} onChange={e=>seekPour(Number(e.target.value)/100)}/></label>
      {pour&&!inPour&&<button onClick={()=>seekPour(.5)}>Go to middle of pour</button>}
      {!pour&&<p>Link a dated pour activity to preview and record its boom movement.</p>}
    </>}
    <fieldset disabled={!!lift&&!inPour}>
    <label>Deployment · {deployment.toFixed(2)}<input type="range" className="w-full" min="0" max="1" step=".01" value={deployment}
      onChange={e=>setManual({deployment:Number(e.target.value),slew,time:clock})}/></label>
    <label>Slew · {slew.toFixed(0)}°<input type="range" className="w-full" min="-180" max="180" value={slew}
      onChange={e=>setManual({deployment,slew:Number(e.target.value),time:clock})}/></label>
    {lift ? <>
      <button disabled={!current&&pourKeys.length>=128} onClick={()=>editKey(fraction,'slew',slew)}>Key slew</button>
      <button disabled={!current&&pourKeys.length>=128} onClick={()=>editKey(fraction,'deployment',deployment)}>Key deployment</button>
    </> : <button disabled={!draft} onClick={()=>void write({...config,boom_deployment:deployment,boom_slew:slew})}>Set working pose</button>}
    {draft&&<button onClick={()=>setManual(null)}>Cancel preview</button>}
    </fieldset>
    {lift ? <>
      {pourKeys.map(k=><div key={k.progress}>
        <button disabled={!pour} onClick={()=>seekPour(k.progress)}>{Number((k.progress*100).toFixed(4))}%</button>
        {k.slew!=null&&<button onClick={()=>editKey(k.progress,'slew',null)}>Remove slew {k.slew}°</button>}
        {k.deployment!=null&&<button onClick={()=>editKey(k.progress,'deployment',null)}>Remove deployment {k.deployment}</button>}
      </div>)}
      <p>Keys follow this pour when its dates change. Each channel can be keyed separately.</p>
    </> : <>
    <label><input type="checkbox" checked={!!sweep} onChange={e=>void write({...config,pour_sweep:e.target.checked?{start_angle:-45,finish_angle:45}:null})}/> Sweep automatically during linked pours</label>
    {sweep&&(['start_angle','finish_angle'] as const).map(field=><label key={field}>
      {field==='start_angle'?'Sweep start (°)':'Sweep finish (°)'}
      <input type="number" min="-180" max="180" step="any" key={sweep[field]} defaultValue={sweep[field]}
        onBlur={e=>{const angle=e.currentTarget.valueAsNumber
          if(!Number.isFinite(angle)||!e.currentTarget.validity.valid){e.currentTarget.value=String(sweep[field]);return}
          if(angle!==sweep[field])void write({...config,pour_sweep:{...sweep,[field]:angle}})
        }}/>
    </label>)}
    <details><summary>Fixed-date keys{keys.length?' ('+keys.length+')':''}</summary>
    <button disabled={!Number.isFinite(clock)||(!keys.some(k=>Date.parse(k.date)===clock)&&keys.length>=128)}
      onClick={()=>void write({...config,boom_keys:[...keys.filter(k=>Date.parse(k.date)!==clock),{date:new Date(clock).toISOString(),deployment,slew}].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))})}>Key pose at playhead</button>
    <p>These keys stay at their calendar dates. For movement that follows a lift, open its Boom animation for this pour controls.</p>
    {keys.map(k=><div key={k.date}>
      <button onClick={()=>onSeek(new Date(k.date))}>{new Date(k.date).toLocaleString()} · {k.deployment.toFixed(2)} · {k.slew}°</button>
      <button onClick={()=>void write({...config,boom_keys:keys.filter(v=>v!==k)})}>Remove key</button></div>)}
    </details></>}
  </details>
}

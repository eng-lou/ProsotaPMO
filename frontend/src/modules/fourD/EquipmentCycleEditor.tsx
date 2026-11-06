import { useEffect, useRef, useState } from 'react'
import type { EquipmentRig } from './equipmentRig'
import { controlValue } from './equipmentRig'
import type { PathMotion } from './siteScene'
import { TimelinePointInput, type TimelineFormat } from './TimelinePointInput'
import { buildEquipmentCycle, type SoilCycleRecipe } from './equipmentCycle'
import { sitePathProgress } from './sitePathMotion'

const button='border rounded px-2 py-1 disabled:opacity-40'
const stages=['pickup','carry','tip'] as const
type Stage=typeof stages[number]
const labels={pickup:'1 · Pick up',carry:'2 · Carry',tip:'3 · Tip'}
export function EquipmentCycleEditor({rig,time,format,route,onPose,onSave,onPending,onSeek,onCapture,onCalibrateOpening,onAdjustRange,active,editing}:{
  rig:EquipmentRig;time:number;format:TimelineFormat;route?:{motion:PathMotion;length:number}
  onPose:(values:Record<string,number>)=>void
  onSave:(rig:EquipmentRig,motion?:PathMotion)=>Promise<boolean>
  onPending:(dirty:boolean)=>void;onSeek:(date:Date)=>void
  active:boolean;editing:boolean;onAdjustRange:()=>void
  onCapture:(stage:Stage,values:Record<string,number>)=>string|null
  onCalibrateOpening:(values:Record<string,number>)=>void
}) {
  const soil=rig.definition.soil!
  const progress=()=>Number((route?sitePathProgress(route.motion,time)??Math.max(0,Math.min(100,(time-Date.parse(route.motion.start))/(86400000*format.speedDaysPerSecond)*route.motion.speed/Math.max(.001,route.length)*100)):0).toFixed(3))
  const [recipe,setRecipe]=useState<SoilCycleRecipe>(()=>soil.cycle||{pickup:{},carry:{},tip:{},approach_seconds:4,lift_seconds:2,travel_seconds:5,tip_seconds:1,start_progress:progress(),pickup_progress:progress(),drop_progress:100})
  const [start,setStart]=useState(()=>new Date(soil.cycle?soil.start:time))
  const [stage,setStage]=useState<Stage>('pickup')
  const [values,setValues]=useState<Record<string,number>>(()=>soil.cycle?.pickup||Object.fromEntries(rig.definition.controls.map(c=>[c.id,controlValue(c,time)])))
  const [captured,setCaptured]=useState<Stage[]>(()=>soil.cycle?[...stages]:[])
  const [busy,setBusy]=useState(false), [notice,setNotice]=useState('')
  const [issues,setIssues]=useState<Partial<Record<Stage,string|null>>>({})
  const inspect=useRef(onCapture);inspect.current=onCapture
  const resume=useRef({editing,values,onPose});resume.current={editing,values,onPose}
  useEffect(()=>{if(active&&resume.current.editing)resume.current.onPose(resume.current.values)},[active])
  const validationKey=JSON.stringify([rig.definition.joints,rig.definition.controls.map(c=>[c.id,c.rest]),soil.bucket_node,soil.rotation,soil.opening_direction,soil.dump_angle,soil.up_axis,recipe.pickup,recipe.carry,recipe.tip,captured])
  useEffect(()=>{
    if(!active)return
    let frame2=0
    const frame1=requestAnimationFrame(()=>{frame2=requestAnimationFrame(()=>setIssues(Object.fromEntries(captured.map(s=>[s,inspect.current(s,recipe[s])]))))})
    return ()=>{cancelAnimationFrame(frame1);cancelAnimationFrame(frame2)}
  },[active,validationKey])
  const edit=(patch:Partial<SoilCycleRecipe>)=>{setRecipe(r=>({...r,...patch}));onPending(true);setNotice('')}
  const ready=stages.every(s=>captured.includes(s))
  const duration=recipe.approach_seconds+recipe.lift_seconds+recipe.travel_seconds+recipe.tip_seconds+soil.pour_seconds+.5
  const number=(label:string,field:'approach_seconds'|'lift_seconds'|'travel_seconds'|'tip_seconds'|'start_progress'|'pickup_progress'|'drop_progress',max=120)=><label className="block">{label}<input aria-label={label} className="w-full border rounded p-1 dark:bg-prosota-panel2" type="number" step="0.1" min={field.endsWith('progress')?0:.1} max={max} value={Number(recipe[field].toFixed(3))} onChange={e=>edit({[field]:Number(e.target.value)})}/></label>
  return <details className="border rounded p-2 space-y-2" open>
    <summary className="font-semibold">Simple pickup & dump cycle</summary>
    <p>Choose each stage, adjust the controls here, then capture its pose. Create cycle saves the movement, stops and soil timing together.</p>
    <div className="flex flex-wrap gap-1">{stages.map(s=><button key={s} className={`${button} ${stage===s?'bg-blue-600 text-white border-blue-500':'border-gray-300 dark:border-prosota-line'}`} aria-pressed={stage===s} onClick={()=>{
      setNotice('');setStage(s);const pose=captured.includes(s)?recipe[s]:values;setValues(pose);onPose(pose)
    }}>{labels[s]}{captured.includes(s)?(issues[s]?' ⚠':' ✓'):''}</button>)}</div>
    <p>{stage==='pickup'?'Lower the bucket into a scooping pose.':stage==='carry'?'Raise and curl the bucket so the opening holds the load.':'Tilt the opening down far enough to release the load.'}</p>
    {rig.definition.controls.map(c=><label key={c.id} className="block">{c.name}<input aria-label={`Cycle ${c.name}`} className="w-full" type="range" min={0} max={1} step={.001} value={values[c.id]??c.rest} onChange={e=>{
      const next={...values,[c.id]:Number(e.target.value)};setValues(next);onPose(next);setCaptured(p=>p.filter(s=>s!==stage));setIssues(p=>({...p,[stage]:null}));setNotice('');onPending(true)
    }}/></label>)}
    <button className={button} disabled={busy} onClick={async()=>{
      setBusy(true)
      try {
        onPose(values)
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
        const warning=onCapture(stage,values)
        edit({[stage]:{...values}});setCaptured(p=>[...p.filter(s=>s!==stage),stage]);setIssues(p=>({...p,[stage]:warning}));setNotice(`${labels[stage]} pose captured.`)
      }catch(e){setNotice(`Could not capture pose: ${(e as Error).message}`)}finally{setBusy(false)}
    }}>Capture {stage==='pickup'?'pickup':stage} pose</button>
    <div aria-live="polite" className="space-y-1">
      {notice&&<p role="status">{notice}</p>}
      {issues[stage]&&<p role="alert" className="text-amber-700 dark:text-amber-300">{issues[stage]}</p>}
    </div>
    {stage==='carry'&&<div className="border rounded p-2 space-y-1">
      <p>If the bucket is mouth-up but reports spilling, set the reference here. Face its opening straight up first; the pile, fitted volume and timing stay in place.</p>
      <button className={button} disabled={busy} onClick={async()=>{
        setBusy(true)
        try{
          onPose(values)
          await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
          onCalibrateOpening(values)
          edit({carry:{...values}});setCaptured(p=>[...p.filter(s=>s!=='carry'),'carry']);setIssues({});setNotice('Mouth-up reference set and Carry captured. Check the Tip pose against this reference.')
        }catch(e){setNotice(`Could not set opening: ${(e as Error).message}`)}finally{setBusy(false)}
      }}>Set mouth-up reference & capture Carry</button>
    </div>}
    <button className={button} onClick={onAdjustRange}>Adjust bucket travel</button>
    {route?<div className="border-t pt-2 space-y-2">
      <p>Travel on the bound path: choose the pickup and dump positions. 0% is its start; 100% is its end. Use the timeline to inspect a position, then capture it below.</p>
      {number('Pickup along route (%)','pickup_progress',100)}<button className={button} onClick={()=>edit({pickup_progress:progress()})}>Pickup at current position</button>
      {number('Dump along route (%)','drop_progress',100)}<button className={button} onClick={()=>edit({drop_progress:progress()})}>Dump at current position</button>
    </div>:<p>No route bound: the machine stays in place. Bind a single path first if it needs to travel; bucket poses can still move through the pile.</p>}
    <label className="block">Cycle starts<TimelinePointInput value={start} format={format} placeholder="Start" dayEdge="start" onChange={d=>{if(d){setStart(d);onPending(true)}}}/></label>
    <button className={button} onClick={()=>{setStart(new Date(time));edit({start_progress:progress()})}}>Start at playhead</button>
    <details><summary>Stage durations & starting position</summary>
      {number('Approach (seconds)','approach_seconds')}{number('Scoop and lift (seconds)','lift_seconds')}{number('Travel loaded (seconds)','travel_seconds')}{number('Tilt to pour (seconds)','tip_seconds')}
      {route&&number('Start along route (%)','start_progress',100)}
    </details>
    <p>{duration.toFixed(1)} seconds total, including {soil.pour_seconds.toFixed(1)} seconds to empty and a short margin. The machine pauses while lifting and pouring.</p>
    <p className="text-gray-500 dark:text-prosota-muted">Creating replaces control and route keys inside this cycle window; other keys remain. The source pile stays where you placed it. Bucket calibration and pile placement are under Soil settings below.</p>
    <button className={button} disabled={!ready||busy||Object.values(issues).some(Boolean)} onClick={async()=>{
      setBusy(true);setNotice('')
      try{
        const checks=Object.fromEntries(stages.map(s=>[s,onCapture(s,recipe[s])]))
        setIssues(checks)
        const invalid=stages.find(s=>checks[s]);if(invalid){setStage(invalid);setValues(recipe[invalid]);onPose(recipe[invalid]);setNotice('Adjust this captured pose before saving the cycle.');return}
        const result=buildEquipmentCycle(rig,recipe,start.getTime(),format.speedDaysPerSecond,route?.motion)
        if(await onSave(result.rig,result.motion)){onPending(false);setNotice('Cycle saved. Rewind, then press Play in the animation timeline.');onSeek(start)}
        else setNotice('The cycle is still a draft. Resolve the save error above, then try again.')
      }catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
    }}>{busy?'Saving cycle…':'Create & save cycle'}</button>
    <button className={button} onClick={()=>onSeek(new Date(soil.start))}>Rewind saved cycle</button>
    {!ready&&<p>Capture all three poses to create the cycle.</p>}
    {ready&&Object.values(issues).some(Boolean)&&<p>Check the stage marked ⚠ before creating the cycle.</p>}
  </details>
}

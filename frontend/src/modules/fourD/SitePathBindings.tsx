import { useState, type MutableRefObject } from 'react'
import { ToolVisualGuide } from './ToolVisualGuide'
import type { Path } from './paths'
import type { SiteItem, PathMotion, SitePathKey } from './siteScene'
import { buildPathCurve } from './pathCurve'
import { sampleSitePath, sitePathRange } from './sitePathMotion'
import { TimelinePointInput, type TimelineFormat } from './TimelinePointInput'

function NumberField({label,value,min=0.01,max=100,onChange}:{label:string;value:number;min?:number;max?:number;onChange(value:number):void}) {
  return <label className="block">{label}<input aria-label={label} key={value} type="number" step="0.1" min={min} max={max} defaultValue={value}
    className="w-full rounded border p-1 dark:bg-prosota-panel2" onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
    onBlur={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&n>=min&&n<=max&&n!==value)onChange(n);else e.currentTarget.value=String(value)}}/></label>
}
type Props={path:Path;items:SiteItem[];busy:boolean;dateRef?:MutableRefObject<Date|null>;format?:TimelineFormat|null;onSeek?:(d:Date)=>void;onChange(id:string,motion:PathMotion|null):void}
function Binding({item,path,busy,dateRef,format,onSeek,onChange}:Omit<Props,'items'>&{item:SiteItem}) {
  const [notice,setNotice]=useState(''), [pause,setPause]=useState(2)
  const motion=item.path_motion!, curve=buildPathCurve(path.points,path.closed,path.curve_mode)
  if(!curve)return null
  const change=(patch:Partial<PathMotion>)=>onChange(item.id,{...motion,...patch})
  const keys=[...(motion.progress_keys||[])].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))
  const speed=format?.speedDaysPerSecond||1, range=sitePathRange(motion,curve.getLength(),speed)
  const saveKeys=(next:SitePathKey[])=>{
    if(new Set(next.map(k=>Date.parse(k.date))).size!==next.length){setNotice('Two route keys cannot share a time. Choose a later time for the pause.');return}
    if(next.length>200){setNotice('This route supports up to 200 keys.');return}
    setNotice('');change({progress_keys:next,loop:false})
  }
  const keyAtPlayhead=()=>{
    const date=dateRef?.current||new Date(motion.start), time=date.getTime()
    const progress=sampleSitePath(curve,motion,(time-Date.parse(motion.start))/(86400000*speed),item.up_axis,speed).progress
    saveKeys([...keys.filter(k=>Date.parse(k.date)!==time),{date:date.toISOString(),progress,interpolation:'linear'}])
  }
  return <fieldset disabled={busy||item.locked} className="border rounded p-2 space-y-2 text-xs">
    <legend>Following: {item.name}</legend>
    <ToolVisualGuide topic="path" mode={motion.orient?'orient':'fixed'} heading={motion.heading}/>
    <p>{((range.end.getTime()-range.start.getTime())/(86400000*speed)).toFixed(1)} seconds · Play or scrub the animation timeline.</p>
    {!keys.length&&<><NumberField label="Travel speed (m/s)" value={motion.speed} onChange={v=>change({speed:v})}/>
      {format&&<label className="block">Journey starts<TimelinePointInput value={new Date(motion.start)} format={format} placeholder="Start" dayEdge="start" onChange={d=>{if(d)change({start:d.toISOString()})}}/></label>}
      <label className="flex gap-2"><input type="checkbox" checked={motion.loop} onChange={e=>change({loop:e.target.checked})}/>Loop journey</label>
      <button onClick={()=>saveKeys([{date:motion.start,progress:0,interpolation:'linear'},{date:range.end.toISOString(),progress:100,interpolation:'linear'}])}>Add timed stops</button></>}
    {!!keys.length&&<details open><summary>Timed route · travel and pauses</summary>
      <p>0% is the start; 100% is the end. Repeat a position at a later time to wait there. Lower progress reverses along the same route. Equipment controls still animate during a pause.</p>
      {keys.map((k,index)=><div className="border-t space-y-1 py-2" key={k.date}>
        <label className="block">Route key {index+1}{format?<TimelinePointInput value={new Date(k.date)} format={format} placeholder="Key time" dayEdge="start" onChange={d=>{if(d)saveKeys(keys.map(x=>x===k?{...x,date:d.toISOString()}:x))}}/>:<span>{k.date}</span>}</label>
        <NumberField label={`Route position ${index+1} (%)`} min={0} value={Number(k.progress.toFixed(3))} onChange={progress=>saveKeys(keys.map(x=>x===k?{...x,progress}:x))}/>
        <label>Travel to next key<select aria-label={`Route interpolation ${index+1}`} value={k.interpolation} onChange={e=>saveKeys(keys.map(x=>x===k?{...x,interpolation:e.target.value as SitePathKey['interpolation']}:x))}><option value="linear">Steady</option><option value="smooth">Ease in/out</option><option value="hold">Hold, then jump</option></select></label>
        <div className="flex flex-wrap gap-2"><button onClick={()=>onSeek?.(new Date(k.date))}>Go</button><button onClick={()=>{
          const end=Date.parse(k.date)+pause*86400000*speed
          saveKeys([...keys.map((x,i)=>i>index?{...x,date:new Date(Date.parse(x.date)+pause*86400000*speed).toISOString()}:x),{...k,date:new Date(end).toISOString()}])
        }}>Pause here {pause}s</button><button disabled={keys.length===1} onClick={()=>saveKeys(keys.filter(x=>x!==k))}>Remove key</button></div>
      </div>)}
      <NumberField label="Pause length (seconds)" value={pause} min={.1} max={300} onChange={setPause}/>
      <button onClick={keyAtPlayhead}>Add key at playhead</button>
      <button onClick={()=>{if(window.confirm('Remove timed route keys and return to constant travel speed?'))change({progress_keys:[]})}}>Use constant speed</button>
      <p>Adding a pause shifts later route keys. Check your bucket keys and soil window if you change timings after creating a cycle.</p>
    </details>}
    {notice&&<p role="alert">{notice}</p>}
    <label className="flex gap-2"><input type="checkbox" checked={motion.orient} onChange={e=>change({orient:e.target.checked})}/>Follow turns</label>
    <NumberField label="Heading offset (degrees)" min={-36000} max={36000} value={motion.heading} onChange={heading=>change({heading})}/>
    <p>This route controls the whole machine's position. Use rig controls for its moving parts; rotation and scale remain editable in the transform panel.</p>
    {item.asset_id&&<details><summary>Embedded clip pace</summary><NumberField label="Clip travel speed at 1× (m/s)" value={motion.animation_reference_speed} onChange={animation_reference_speed=>change({animation_reference_speed})}/><p>The clip follows route distance, stops during pauses and reverses when backing up.</p></details>}
    <button className="border rounded px-2 py-1" onClick={()=>onChange(item.id,null)}>Unbind {item.name}</button>
  </fieldset>
}
export function SitePathBindings({items,...props}:Props) {
  return <>{items.filter(item=>item.path_motion?.path_id===props.path.id).map(item=><Binding key={item.id} item={item} {...props}/>)}</>
}

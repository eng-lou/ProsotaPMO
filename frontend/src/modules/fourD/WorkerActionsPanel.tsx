import { useEffect, useState, type MutableRefObject } from 'react'
import { loadSiteAsset } from './siteAssets'
import { TimelinePointInput, type TimelineFormat } from './TimelinePointInput'
import type { SiteItem } from './siteScene'
import type { Path } from './paths'
import { buildPathCurve } from './pathCurve'
import { routeStopForAction, validateActions, type WorkerAction, type SiteAttachment } from './workerActions'

const input='w-full rounded border p-1 dark:bg-prosota-panel2',button='border rounded px-2 py-1 disabled:opacity-40'
function NumberInput({label,value,onChange,min=-10000,max=10000}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number}){
  return <label className="block">{label}<input className={input} aria-label={label} key={value} type="number" step="any" defaultValue={value} min={min} max={max} onBlur={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=min&&n<=max){if(n!==value)onChange(n)}else e.target.value=String(value)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>
}
type Props={item:SiteItem;items:SiteItem[];paths:Path[];disabled:boolean;format:TimelineFormat;dateRef:MutableRefObject<Date|null>;onSeek:(date:Date)=>void;onEditAttachment?:(mode:'translate'|'rotate')=>void;onApply:(patch:Partial<SiteItem>)=>Promise<void>}
const handName=(nodes:string[],side:'R'|'L')=>nodes.find(n=>n===`CC_Base_${side}_Hand`)||nodes.find(n=>new RegExp(`(?:^|[_:])${side}[_ ]?Hand$`,'i').test(n))
const anchorLabel=(name:string)=>name==='CC_Base_R_Hand'?'Right hand':name==='CC_Base_L_Hand'?'Left hand':name==='CC_Base_Waist'?'Waist / hips':name
export function WorkerActionsPanel({item,items,paths,disabled,format,dateRef,onSeek,onEditAttachment,onApply}:Props){
  const [clips,setClips]=useState<{name:string;duration:number}[]>([]),[nodes,setNodes]=useState<string[]>([]),[error,setError]=useState(''),[saving,setSaving]=useState(false)
  useEffect(()=>{let active=true;setClips([]);if(item.asset_id)void loadSiteAsset(item.asset_id).then(r=>{if(active)setClips(r.animations.map(c=>({name:c.name,duration:c.duration})))}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[item.asset_id])
  const parent=items.find(i=>i.id===item.attachment?.parent_id)
  useEffect(()=>{let active=true;setNodes([]);if(parent?.asset_id)void loadSiteAsset(parent.asset_id).then(root=>{const counts=new Map<string,number>();root.traverse(n=>{if(n.name)counts.set(n.name,(counts.get(n.name)||0)+1)});if(active)setNodes([...counts].filter(([,n])=>n===1).map(([name])=>name).sort())}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[parent?.asset_id])
  const actions=item.motion_actions||[],a=item.attachment,scale=86400000*format.speedDaysPerSecond
  async function save(patch:Partial<SiteItem>){setSaving(true);setError('');try{if(patch.motion_actions)validateActions(patch.motion_actions,clips.length);await onApply(patch)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setSaving(false)}}
  const change=(id:string,patch:Partial<WorkerAction>)=>void save({motion_actions:actions.map(a=>a.id===id?{...a,...patch}:a)})
  const attach=(patch:Partial<SiteAttachment>)=>{if(a)void save({attachment:{...a,...patch}})}
  const start=()=>dateRef.current||format.scheduleStart
  function editAttachment(mode:'translate'|'rotate'){
    if(!a)return
    const now=dateRef.current?.getTime()??NaN,from=Date.parse(a.start),to=Date.parse(a.end)
    onSeek(new Date(now>=from&&now<to?now:(from+to)/2))
    onEditAttachment?.(mode)
  }
  function pauseFor(action:WorkerAction){
    const motion=item.path_motion,path=paths.find(p=>p.id===motion?.path_id),curve=path&&buildPathCurve(path.points,path.closed,path.curve_mode)
    if(!motion||!curve)return
    try{void save({path_motion:routeStopForAction(motion,curve,action,format.speedDaysPerSecond)})}catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  return <fieldset disabled={disabled||saving} className="border rounded p-2 space-y-3 text-xs">
    <legend>Construction actions & attachments</legend>
    <div className="rounded bg-blue-50 dark:bg-prosota-panel2 p-2 flex flex-wrap gap-2" aria-label="Action sequence guide"><span>Follow route</span><span>→</span><span>Work / operate</span><span>→</span><span>Continue</span></div>
    <p>Actions use the animation timeline. Changes save immediately and remain when you close this panel.</p>
    {!!clips.length&&<>
      <p>The normal Asset animation clip plays between actions. Choose an in-place walk there for a route, or an idle for a stationary worker.</p>
      {[...actions].sort((x,y)=>Date.parse(x.start)-Date.parse(y.start)).map(action=><div className="border rounded p-2 space-y-2" key={action.id}>
        <input aria-label="Action name" className={input} key={action.name} defaultValue={action.name} maxLength={100} onBlur={e=>{if(e.target.value.trim()&&e.target.value!==action.name)change(action.id,{name:e.target.value.trim()})}}/>
        <label className="block">Motion<select className={input} value={action.clip} onChange={e=>change(action.id,{clip:Number(e.target.value)})}>{clips.map((c,i)=><option key={i} value={i}>{c.name} · {c.duration.toFixed(1)}s</option>)}</select></label>
        <div className="flex flex-wrap gap-3"><label>Start<TimelinePointInput value={new Date(action.start)} format={format} placeholder="Start" dayEdge="start" onChange={d=>{if(d)change(action.id,{start:d.toISOString()})}}/></label><label>Finish<TimelinePointInput value={new Date(action.end)} format={format} placeholder="Finish" onChange={d=>{if(d)change(action.id,{end:d.toISOString()})}}/></label></div>
        <p>{((Date.parse(action.end)-Date.parse(action.start))/scale).toFixed(2)} playback seconds at the current timeline speed.</p>
        <label className="flex gap-2"><input type="checkbox" checked={action.loop} onChange={e=>change(action.id,{loop:e.target.checked})}/>Repeat motion for this action</label>
        <details><summary>Motion pace & transition</summary><NumberInput label="Action speed" value={action.speed} min={.01} max={10} onChange={speed=>change(action.id,{speed})}/><NumberInput label="Blend with normal clip (seconds)" value={action.blend} min={0} max={5} onChange={blend=>change(action.id,{blend})}/><p>Uncheck Repeat to play once then hold its last pose. Repeating a clip with no matching start/end can jump; choose a loopable work section.</p></details>
        <div className="flex flex-wrap gap-2"><button className={button} onClick={()=>onSeek(new Date(action.start))}>Go to start</button><button className={button} onClick={()=>onSeek(new Date((Date.parse(action.start)+Date.parse(action.end))/2))}>See action</button><button className={button} onClick={()=>void save({motion_actions:actions.filter(x=>x.id!==action.id)})}>Remove action</button>{item.path_motion&&<button className={button} onClick={()=>pauseFor(action)}>Add route stop for this action</button>}</div>
        {item.path_motion&&<p>A route stop holds the current route position for this action and shifts later route keys. Other actions and rig keys keep their times; review them after changing the route.</p>}
      </div>)}
      <button className={button} disabled={actions.length>=200} onClick={()=>{const time=Math.max(start().getTime(),...actions.map(a=>Date.parse(a.end)));void save({motion_actions:[...actions,{id:crypto.randomUUID(),name:'Work',start:new Date(time).toISOString(),end:new Date(time+5*scale).toISOString(),clip:item.animation_clip||0,speed:1,loop:true,blend:.2}]})}}>+ Timed action at playhead / after last</button>
    </>}
    <details open={!!a}><summary>Attach this object to a worker or machine</summary>
      <p>Choose the worker and a hand, then move or rotate the tool in the viewport to fit its grip. For an operator, choose the machine’s cab or seat part instead.</p>
      {!a?<button className={button} disabled={!!item.path_motion||items.length<2} onClick={()=>{const target=items.find(i=>i.id!==item.id);if(target)void save({attachment:{parent_id:target.id,node:'',start:start().toISOString(),end:new Date(start().getTime()+5*scale).toISOString(),position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},only_during:false}})}}>Set attachment</button>:<div className="space-y-2">
        <label>Follow object<select className={input} value={a.parent_id} onChange={e=>attach({parent_id:e.target.value,node:''})}>{items.filter(i=>i.id!==item.id).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <div className="flex flex-wrap gap-2">{(['R','L'] as const).map(side=>{const node=handName(nodes,side);return node&&<button key={side} className={button} aria-pressed={a.node===node} onClick={()=>attach({node})}>Use {side==='R'?'right':'left'} hand</button>})}</div>
        <label>Attach to<select className={input} value={a.node} onChange={e=>attach({node:e.target.value})}><option value="">Object origin</option>{a.node&&!nodes.includes(a.node)&&<option value={a.node}>Missing: {a.node}</option>}{nodes.map(n=><option key={n} value={n}>{anchorLabel(n)}</option>)}</select></label>
        {a.node&&!nodes.includes(a.node)&&<p role="alert">The saved anchor is unavailable. Choose a unique named bone or part; the object stays at its original placement until the anchor is found.</p>}
        <div className="flex flex-wrap gap-3"><label>Attach at<TimelinePointInput value={new Date(a.start)} format={format} placeholder="Attach" dayEdge="start" onChange={d=>{if(d)attach({start:d.toISOString()})}}/></label><label>Release at<TimelinePointInput value={new Date(a.end)} format={format} placeholder="Release" onChange={d=>{if(d)attach({end:d.toISOString()})}}/></label></div>
        {!!parent?.motion_actions?.length&&<label>Use action timing<select className={input} value="" onChange={e=>{const action=parent.motion_actions!.find(x=>x.id===e.target.value);if(action)attach({start:action.start,end:action.end})}}><option value="">Choose action…</option>{parent.motion_actions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="flex gap-2"><input type="checkbox" checked={a.only_during} onChange={e=>attach({only_during:e.target.checked})}/>Show only while attached</label>
        <p>Otherwise the object returns to its original placement outside this interval. Use Simulator element handling for a delivered → carried → placed sequence.</p>
        {onEditAttachment&&<div className="rounded border p-2 space-y-2"><div className="flex flex-wrap gap-2"><button className={button} onClick={()=>editAttachment('translate')}>Move attached tool</button><button className={button} onClick={()=>editAttachment('rotate')}>Rotate attached tool</button></div><p>Pauses inside the attachment interval. Drag the viewport arrows or rotation rings; the grip offset saves automatically. The original placement outside the interval stays unchanged.</p></div>}
        <p>The motion provides the hand posture. A two-handed tool needs a matching work motion; attaching it does not reposition the other hand.</p>
        <div className="grid grid-cols-3 gap-1">{(['x','y','z'] as const).map(k=><NumberInput key={k} label={`Offset ${k.toUpperCase()} (m)`} value={a.position[k]} onChange={n=>attach({position:{...a.position,[k]:n}})}/>)}</div>
        <div className="grid grid-cols-3 gap-1">{(['x','y','z'] as const).map(k=><NumberInput key={k} label={`Turn ${k.toUpperCase()} (°)`} value={a.rotation[k]} onChange={n=>attach({rotation:{...a.rotation,[k]:n}})}/>)}</div>
        <button className={button} onClick={()=>onSeek(new Date((Date.parse(a.start)+Date.parse(a.end))/2))}>See attachment</button> <button className={button} onClick={()=>void save({attachment:null})}>Remove attachment</button>
      </div>}
      {item.path_motion&&<p>Unbind this object’s own route before attaching it. The parent’s route will carry it.</p>}
    </details>
    {saving&&<p role="status">Saving…</p>}{error&&<p role="alert" className="text-red-500">{error}</p>}
  </fieldset>
}

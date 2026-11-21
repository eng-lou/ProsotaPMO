import {LiftRigEditor} from './LiftRigEditor'
import './constructionControls.css'
import { useEffect, useState } from 'react'
import type { SiteItem } from './siteScene'
import { captureLoadEvent,loadRoots,slingEditors,validateLoadEvents,type LoadHandling } from './loadHandling'

export function LoadHandlingPanel({item,items,date,onSeek,onApply}:{item:SiteItem;items:SiteItem[];date:()=>Date;onSeek:(date:Date)=>void;onApply:(patch:Partial<SiteItem>)=>Promise<void>}){
  const [parent,setParent]=useState(''),[node,setNode]=useState(''),[slings,setSlings]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const handling=item.load_handling||{events:[],lifting_points:[]},names:string[]=[],counts=new Map<string,number>()
  loadRoots.get(parent)?.traverse(n=>{if(n.name)counts.set(n.name,(counts.get(n.name)||0)+1)});counts.forEach((count,name)=>{if(count===1)names.push(name)})
  async function save(value:LoadHandling){setBusy(true);setError('');try{validateLoadEvents(value.events);await onApply({load_handling:value})}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  function record(release:boolean){try{const event=captureLoadEvent(item,release?null:parent,node,date(),slings);void save({...handling,events:[...handling.events,event]})}catch(e){setError((e as Error).message)}}
  useEffect(()=>()=>{slingEditors.clear()},[item.id])
  const cls='border rounded p-1 w-full dark:bg-prosota-panel2'
  return <fieldset disabled={busy||!!item.work_sequence||!!item.climbing_formwork||!!item.attachment||!!item.path_motion} className="construction-controls border rounded p-3 space-y-2">
    <legend>Load transfers & lifting slings</legend>
    <p>Pause at pickup, choose the carrier and record Attach. At set-down, record Release. Each event preserves the current placement. Repeat for delivery and installation.</p>
    {(item.attachment||item.path_motion)&&<p>Remove the single attachment or this load’s own route before authoring transfers. The carrier can follow a route.</p>}
    <label>Carrier<select className={cls} value={parent} onChange={e=>{setParent(e.target.value);setNode('')}}><option value="">Choose truck or crane…</option>{items.filter(i=>i.id!==item.id).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <label>Connection<select className={cls} value={node} onChange={e=>setNode(e.target.value)}><option value="">Object origin</option>{names.sort().map(n=><option key={n}>{n}</option>)}</select></label>
    <label className="flex gap-2"><input type="checkbox" checked={slings} onChange={e=>setSlings(e.target.checked)}/>Show slings for this attachment</label>
    <div className="flex gap-2"><button className="border rounded p-1" disabled={!parent||handling.events.length>=200} onClick={()=>record(false)}>Attach / transfer at playhead</button><button className="border rounded p-1" disabled={!handling.events.length||handling.events.length>=200} onClick={()=>record(true)}>Release here</button></div>
    <p>Record with playback paused. After changing earlier carrier motion, delete and recapture affected events to preserve continuity.</p>
    {[...handling.events].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).map(e=><div key={e.id}>
      <div className="flex gap-2"><button className="underline" onClick={()=>onSeek(new Date(e.date))}>{new Date(e.date).toLocaleString()} � {e.parent_id?`Follow ${items.find(i=>i.id===e.parent_id)?.name||'missing carrier'}`:'Release'}</button><button aria-label="Delete load event" onClick={()=>{slingEditors.delete(e.id);void save({...handling,events:handling.events.filter(x=>x.id!==e.id)})}}>x</button></div>
      {e.parent_id&&e.slings&&<LiftRigEditor item={item} items={items} event={e} handling={handling} date={date} onSeek={onSeek} onSave={event=>void save({...handling,events:handling.events.map(x=>x.id===e.id?event:x)})}/>}
      {e.parent_id&&e.slings&&<details onToggle={ev=>{if(ev.currentTarget.open){slingEditors.add(e.id);onSeek(new Date(e.date))}else slingEditors.delete(e.id)}}><summary>Adjust hook connection</summary>
        <p>The cyan marker is the ring's upper contact point. Adjust it into the curved hook. Offsets are metres along the connection's local axes; the deck stays in place.</p>
        <div className="flex gap-1">{(['X','Y','Z'] as const).map((axis,k)=><label key={axis}>{axis}<input className={cls} aria-label={`Hook offset ${axis}`} type="number" step=".01" defaultValue={e.sling_offset?.[k]||0} key={`${e.id}:${k}:${e.sling_offset?.[k]}`} onBlur={ev=>{const value=ev.target.valueAsNumber;if(!Number.isFinite(value)||Math.abs(value)>1000)return;const offset=[...(e.sling_offset||[0,0,0])] as [number,number,number];offset[k]=value;void save({...handling,events:handling.events.map(x=>x.id===e.id?{...x,sling_offset:offset}:x)})}}/></label>)}</div>
        <label>Ring rotation (degrees)<input className={cls} aria-label="Ring rotation" type="number" min="-360" max="360" step="5" defaultValue={e.sling_ring_angle||0} onBlur={ev=>{const value=ev.target.valueAsNumber;if(Number.isFinite(value)&&Math.abs(value)<=360)void save({...handling,events:handling.events.map(x=>x.id===e.id?{...x,sling_ring_angle:value}:x)})}}/></label>
        <p>Press Tab after changing a value to save and update the connection.</p>
      </details>}
    </div>)}
    <details><summary>Hanging balance</summary>
      <label>Load orientation<select className={cls} value={handling.balance_mode||'gravity'} onChange={e=>void save({...handling,balance_mode:e.target.value as 'gravity'|'fixed'})}><option value="gravity">Hang from remaining points (1 or 2)</option><option value="fixed">Keep recorded orientation</option></select></label>
      <p>One point allows the load to hang beneath it. Two points let it tilt about their connecting line. Three or more points keep the recorded orientation. This is a static visual pose, not a lifting-design calculation.</p>
      <label><input type="checkbox" checked={!!handling.center_of_gravity} onChange={e=>void save({...handling,center_of_gravity:e.target.checked?[0,0,0]:null})}/>Set centre of gravity manually</label>
      {handling.center_of_gravity?<div className="flex gap-1">{handling.center_of_gravity.map((v,k)=><label key={k}>{'XYZ'[k]} (local m)<input className={cls} aria-label={`Centre of gravity ${'XYZ'[k]}`} type="number" step=".01" key={v} defaultValue={v} onBlur={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&Math.abs(n)<=1000000&&n!==v){const centre=[...handling.center_of_gravity!] as [number,number,number];centre[k]=n;void save({...handling,center_of_gravity:centre})}}}/></label>)}</div>:<p>Using the model bounds centre as an estimate. Adjust it manually if the weight is uneven.</p>}
      <p>Changing lifting points affects attached poses throughout the timeline. Existing release poses stay recorded; recapture a release if needed.</p>
    </details>
    <details><summary>Deck lifting points</summary><p>Coordinates in the load’s local axes. Use the supplied deck’s four named lifting eyes as reference. Slings run from these points to the selected hook connection.</p>
      {handling.lifting_points.map((p,i)=><div className="flex gap-1" key={i}>{handling.lifting_nodes?.[i]&&<span>{handling.lifting_nodes[i]}</span>}{p.map((v,k)=><input key={`${k}:${v}`} aria-label={`Lifting point ${i+1} ${'XYZ'[k]}`} type="number" step=".01" className={cls} defaultValue={v} onBlur={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&Math.abs(n)<=1000000&&n!==v){const points=handling.lifting_points.map(p=>[...p] as [number,number,number]);points[i][k]=n;void save({...handling,lifting_points:points,lifting_nodes:handling.lifting_points.map((_,j)=>j===i?'':handling.lifting_nodes?.[j]||'')})}}}/>)}<button disabled={handling.events.some(e=>!!e.rigging)} title="Remove saved rigging before deleting lifting points" onClick={()=>void save({...handling,lifting_points:handling.lifting_points.filter((_,j)=>i!==j),lifting_nodes:handling.lifting_nodes?.filter((_,j)=>i!==j)})}>×</button></div>)}
      <button disabled={handling.lifting_points.length>=8} onClick={()=>void save({...handling,lifting_points:[...handling.lifting_points,[0,0,0]],lifting_nodes:[...handling.lifting_points.map((_,i)=>handling.lifting_nodes?.[i]||''),'']})}>+ Lifting point</button>
      <button disabled={handling.events.some(e=>!!e.rigging)} className="ml-2" onClick={()=>{const nodes:string[]=[];const root=loadRoots.get(item.id);if(root){root.traverse(n=>{if(/^LiftEye_/.test(n.name))nodes.push(n.name)})}if(nodes.length&&new Set(nodes).size===nodes.length)void save({...handling,lifting_points:nodes.slice(0,8).map(()=>[0,0,0] as [number,number,number]),lifting_nodes:nodes.slice(0,8)});else setError('No unique named LiftEye_ connections found. Enter the local points manually.')}}>Use named lifting eyes</button>
    </details>
    {error&&<p role="alert" className="text-red-500">{error}</p>}
  </fieldset>
}

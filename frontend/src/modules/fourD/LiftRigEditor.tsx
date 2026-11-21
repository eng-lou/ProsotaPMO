import {useEffect,useState} from 'react'
import type {SiteItem} from './siteScene'
import {loadEventAt,loadRoots,liftingPointWorld,slingConnection,type LoadEvent,type LoadHandling,type LiftRig} from './loadHandling'
import {attachmentNode} from './workerActions'
import {liftDiagnostics} from './liftRigRuntime'
export function LiftRigEditor({item,items,event,handling,date,onSeek,onSave}:{item:SiteItem;items:SiteItem[];event:LoadEvent;handling:LoadHandling;date:()=>Date;onSeek:(d:Date)=>void;onSave:(event:LoadEvent)=>void}){
 const [draft,setDraft]=useState<LiftRig|null>(event.rigging||null),[error,setError]=useState(''),[open,setOpen]=useState(false),[,tick]=useState(0)
 useEffect(()=>{setDraft(event.rigging||null)},[event])
 useEffect(()=>{if(!open)return;const id=setInterval(()=>tick(n=>n+1),700);return()=>clearInterval(id)},[open])
 const cls='border rounded p-1 w-full dark:bg-prosota-panel2'
 function capture(){try{
  if(date().getTime()!==Date.parse(event.date))throw Error('Seek to this attachment event before capturing lengths.')
  const root=loadRoots.get(item.id);if(!root)throw Error('Load is not available.')
  const legs=(draft?.legs||handling.lifting_points.map((_,point)=>({point,parent_id:event.parent_id!,node:event.node,length:1,offset:event.sling_offset||[0,0,0]}))).map(leg=>{
   const carrier=loadRoots.get(leg.parent_id),anchor=carrier&&attachmentNode(carrier,leg.node),point=handling.lifting_points[leg.point],endpoint=point&&liftingPointWorld(root,point,handling.lifting_nodes?.[leg.point]);if(!anchor||!endpoint)throw Error('A hook or lifting point is missing.')
   return {...leg,length:Math.max(.002,slingConnection(anchor,{...event,sling_offset:leg.offset}).bottom.distanceTo(endpoint))}
  });if(!legs.length)throw Error('Add lifting points first.');setDraft({mass_kg:draft?.mass_kg||1000,floor:draft?.floor,legs});setError('')
 }catch(e){setError((e as Error).message)}}
 const diagnostic=loadEventAt(handling.events,date().getTime())?.id===event.id?liftDiagnostics.get(item.id):undefined,result=diagnostic?.result
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>Rigging solver / multiple hooks</summary>{open&&<>
 <p>Set up at this attachment time. Assign each leg to a hook, capture or enter its fixed length, then save. Crane motion drives the suspended pose. Mass is in kg; estimated forces are in kN.</p>
 <button onClick={()=>onSeek(new Date(event.date))}>Seek to attachment</button> <button onClick={capture}>{draft?'Capture current lengths':'Create rig from current slings'}</button>
 {draft&&<>
 <label>Load mass (kg)<input className={cls} type="number" min="1" value={draft.mass_kg} onChange={e=>setDraft({...draft,mass_kg:e.target.valueAsNumber})}/></label>
 <label><input type="checkbox" checked={draft.floor!=null} onChange={e=>setDraft({...draft,floor:e.target.checked?0:null})}/>Landing plane</label>
 {draft.floor!=null&&<label>Landing elevation (world up axis, m)<input className={cls} type="number" value={draft.floor} onChange={e=>setDraft({...draft,floor:e.target.valueAsNumber})}/></label>}
 {draft.legs.map((leg,i)=>{const carrier=loadRoots.get(leg.parent_id),names:string[]=[];carrier?.traverse(n=>{if(n.name)names.push(n.name)});const patch=(value:Partial<typeof leg>)=>setDraft({...draft,legs:draft.legs.map((l,k)=>k===i?{...l,...value}:l)});return <fieldset key={i} className="border rounded p-1"><legend>Leg {i+1}</legend>
 <label>Lifting point<select className={cls} value={leg.point} onChange={e=>patch({point:Number(e.target.value)})}>{handling.lifting_points.map((_,p)=><option key={p} value={p}>{handling.lifting_nodes?.[p]||`Point ${p+1}`}</option>)}</select></label>
 <label>Crane / carrier<select className={cls} value={leg.parent_id} onChange={e=>patch({parent_id:e.target.value,node:'',offset:[0,0,0]})}>{items.filter(x=>x.id!==item.id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
 <label>Hook<select className={cls} value={leg.node} onChange={e=>patch({node:e.target.value})}><option value="">Object origin</option>{[...new Set(names)].filter(n=>names.filter(v=>v===n).length===1).sort().map(n=><option key={n}>{n}</option>)}</select></label>
 <label>Length (m)<input className={cls} type="number" step=".01" min=".002" value={leg.length} onChange={e=>patch({length:e.target.valueAsNumber})}/></label>
 <label>Leg capacity (kN, optional)<input className={cls} type="number" min=".001" value={leg.capacity_kn??''} onChange={e=>patch({capacity_kn:e.target.value===''?undefined:e.target.valueAsNumber})}/></label>
 <div className="flex gap-1">{[0,1,2].map(k=><label key={k}>Hook {'XYZ'[k]} offset<input className={cls} type="number" step=".01" value={leg.offset?.[k]||0} onChange={e=>{const offset=[...(leg.offset||[0,0,0])] as [number,number,number];offset[k]=e.target.valueAsNumber;patch({offset})}}/></label>)}</div>
 <button disabled={draft.legs.length===1} onClick={()=>setDraft({...draft,legs:draft.legs.filter((_,k)=>k!==i)})}>Remove leg</button>
 </fieldset>})}
 <button disabled={draft.legs.length>=8} onClick={()=>setDraft({...draft,legs:[...draft.legs,{...draft.legs[0]}]})}>Add leg</button>
 <button onClick={()=>{if(!Number.isFinite(draft.mass_kg)||draft.mass_kg<=0||draft.legs.some(l=>!Number.isFinite(l.length)||l.length<=.001)){setError('Enter positive mass and sling lengths.');return}onSave({...event,rigging:draft});setError('')}}>Save rigging</button>
 <button onClick={()=>{setDraft(null);onSave({...event,rigging:null})}}>Use simple attachment</button>
 </>}
 {event.rigging&&result&&<div role="status"><p>{result.valid?(result.supported?'Resting on landing plane':'Balanced suspended pose'):'No verified equilibrium — adjust hooks, lengths or centre of gravity'}</p><p>Length error: {result.error.toFixed(3)} m · force/moment residual: {(result.residual*100).toFixed(1)}%</p>{result.tensions.map((force,i)=><p key={i}>Leg {i+1}: {result.slack[i]?'Slack':`${force.toFixed(2)} kN`}{event.rigging?.legs[i]?.capacity_kn&&force>event.rigging.legs[i].capacity_kn!?' — exceeds entered capacity':''}</p>)}{diagnostic?.hookLoads&&Object.entries(diagnostic.hookLoads).map(([key,force])=><p key={key}>{items.find(i=>i.id===key.split(' / ')[0])?.name||'Hook'} / {key.split(' / ')[1]}: {force.toFixed(2)} kN resultant load</p>)}</div>}
 {diagnostic?.message&&<p role="alert">{diagnostic.message}</p>}{error&&<p role="alert">{error}</p>}
 <p>Quasi-static estimate using the configured centre of gravity. Landing uses an approximate bounding box. No sway, wind, mesh collision or crane load-chart checks.</p>
 </>}</details>
}

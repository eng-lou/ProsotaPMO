import {useState} from 'react'
import {Box3, Vector3} from 'three'
import type {Activity} from '../scheduling/types'
import type {HostSource} from './constructionLayout'
import type {PathPoint} from './paths'
import {siteError,type useSiteScene} from './siteScene'
import {transferKit,resolvePicks} from './constructionStages'

type Props={state:ReturnType<typeof useSiteScene>; activities:Activity[]; selected():HostSource[]; axis:'y'|'z'}
const button='border rounded px-2 py-1 disabled:opacity-40'
const field='w-full rounded border p-1 bg-white dark:bg-prosota-panel2'
export function KitAndLiftPanel({state,activities,selected,axis}:Props){
  const [from,setFrom]=useState<string[]>([]),[to,setTo]=useState<string[]>([])
  const [load,setLoad]=useState(''),[pickup,setPickup]=useState<PathPoint>({x:0,y:0,z:0}),[land,setLand]=useState<PathPoint|null>(null)
  const [activity,setActivity]=useState(''),[retain,setRetain]=useState(''),[clearance,setClearance]=useState('3')
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const item=state.scene.items.find(i=>i.id===load)
  const dated=activities.filter(a=>a.activity_type==='task'&&a.start&&a.finish)
  const activityField=(label:string,value:string,change:(id:string)=>void)=><label>{label}<select className={field} value={value} onChange={e=>change(e.target.value)}><option value="">Choose…</option>{dated.map(a=><option key={a.id} value={a.id}>{a.code} · {a.task_name}</option>)}</select></label>
  async function act(fn:()=>unknown|Promise<unknown>){if(busy)return;setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(siteError(e))}finally{setBusy(false)}}
  function selectedParts(){const sources=selected();if(!sources.length||sources.some(s=>!s.id.startsWith('site:')))throw Error('Select the installed site parts in the viewport.');return sources.map(s=>s.id.slice(5))}
  const names=(ids:string[])=>ids.map(id=>state.scene.items.find(i=>i.id===id)?.name??'Missing part').join(', ')
  function target(){const sources=selected();if(sources.length!==1)throw Error('Select one landing surface or marker.');const box=new Box3().setFromObject(sources[0].object,true);if(box.isEmpty())throw Error('The landing selection has no geometry.');const p=box.getCenter(new Vector3());p[axis]=box.max[axis];return {x:p.x,y:p.y,z:p.z}}
  const point=(label:string,p:PathPoint,change:(p:PathPoint)=>void)=><fieldset><legend>{label} (m)</legend><div className="grid grid-cols-3 gap-1">{(['x','y','z'] as const).map(k=><label key={k}>{k.toUpperCase()}<input className={field} type="number" step="any" value={p[k]} onChange={e=>change({...p,[k]:e.target.valueAsNumber})}/></label>)}</div></fieldset>
  return <fieldset disabled={busy||state.busy||!state.ready} className="space-y-2">
    <details className="rounded border p-2"><summary>Transfer reusable formwork</summary><div className="space-y-2">
      <p>Generate the receiving floor layout first. Select matching tables, props or individual screen bays at each floor.</p>
      <button className={button} onClick={()=>void act(()=>setFrom(selectedParts()))}>Capture outgoing parts</button><p>{names(from)}</p>
      <button className={button} onClick={()=>void act(()=>setTo(selectedParts()))}>Capture receiving parts</button><p>{names(to)}</p>
      {activityField('Transfer at activity start',activity,setActivity)}
      {activityField('Optional backprop release at activity finish',retain,setRetain)}
      <button className={button} disabled={!from.length||!to.length||!activity} onClick={()=>void act(async()=>{
        if(!await state.save(old=>transferKit(old,from,to,activity,dated,retain),'Transfer reusable formwork'))throw Error('The scene is busy.')
        setFrom([]);setTo([]);setMessage('Transfer saved.')
      })}>Save transfer</button></div></details>
    <details className="rounded border p-2"><summary>Crane pick and place</summary><div className="space-y-2">
      <button className={button} onClick={()=>void act(()=>{const ids=selectedParts();const i=state.scene.items.find(i=>i.id===ids[0]);if(ids.length!==1||!i)throw Error('Select one load.');const rows=resolvePicks(i.pick_lifts??[],dated);setLoad(i.id);setPickup(rows[rows.length-1]?.landing??i.position);setLand(null)})}>Pick load</button>
      {item&&<><p>{item.name} · {item.pick_lifts?.length??0} saved lifts</p>
      {point('Pickup / delivery point',pickup,setPickup)}
      <button className={button} onClick={()=>void act(()=>setLand(target()))}>Pick landing from selection</button>
      {land&&point('Landing',land,setLand)}
      {activityField('Lift activity',activity,setActivity)}
      <label>Lift clearance (m)<input className={field} type="number" value={clearance} onChange={e=>setClearance(e.target.value)}/></label>
      <button className={button} disabled={!activity||!land} onClick={()=>void act(async()=>{
        if(!land)return
        const h=Number(clearance)
        if(!(h>0&&h<=200)||![...Object.values(pickup),...Object.values(land)].every(Number.isFinite))throw Error('Check the coordinates and lift clearance.')
        const lift={activity_id:activity,pickup,landing:land,clearance:h,hook_height:Math.max(.2,item.height*(item.scale?.y??1))}
        if(!await state.save(old=>{const current=old.find(i=>i.id===load);if(!current)throw Error('Load is missing.');if(current.locked||current.path_motion||current.attachment||current.climbing_formwork||current.work_sequence||current.load_handling?.events.length)throw Error('Unlock this load and clear its existing motion first.');const picks=[...(current.pick_lifts??[]),lift];resolvePicks(picks,dated);return old.map(i=>i.id===load?{...i,pick_lifts:picks}:i)},'Add crane pick'))throw Error('The scene is busy.')
        setPickup(land);setLand(null);setMessage('Lift saved.')
      })}>Save lift</button>
      {!!item.pick_lifts?.length&&<button className={button} onClick={()=>void act(async()=>{if(await state.save(old=>old.map(i=>i.id===load?{...i,pick_lifts:i.pick_lifts?.slice(0,-1)}:i),'Remove last crane pick')){setLoad('');setMessage('Last lift removed.')}})}>Remove last lift</button>}
      </>}</div></details>
    {message&&<p role="status">{message}</p>}
  </fieldset>
}

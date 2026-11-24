import {useEffect,useRef,useState} from 'react'
import {ConstructionPreviewView} from './ConstructionPreviewView'
import {constructionPlacements,releaseConstruction,type ConstructionPreview,type HostSource} from './constructionLayout'
import {divideSlab} from './pourBreak'
import type {Path} from './paths'
import {siteError,type SiteItem,type useSiteScene} from './siteScene'
import type {Activity} from '../scheduling/types'
export function PourZonesPanel({projectId,axis,paths,activities,state,selection,hideSources,onSelect,openPaths}:{
  projectId:string;axis:'y'|'z';paths:Path[];activities:Activity[];state:ReturnType<typeof useSiteScene>;selection():HostSource[]
  hideSources(ids:string[]):()=>void;onSelect(ids:string[]):void;openPaths():void
}){
  const [path,setPath]=useState(''),[parts,setParts]=useState<ConstructionPreview[]>([]),[view,setView]=useState(0)
  const [activity,setActivity]=useState(['','']),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const source=useRef<HostSource|null>(null),pending=useRef(false)
  useEffect(()=>()=>parts.forEach(p=>releaseConstruction(p.scene)),[parts])
  const button='rounded border px-2 py-1 disabled:opacity-40',field='w-full border rounded p-1 dark:bg-prosota-panel2'
  function preview(){try{
    setError('');setParts([]);const selected=selection(),line=paths.find(p=>p.id===path)
    if(selected.length!==1||!line)throw Error('Select one slab and a two-point path.')
    source.current=selected[0];setParts(divideSlab(selected[0],line,axis));setView(0)
  }catch(e){setError(siteError(e))}}
  async function save(){if(!source.current||pending.current)return;pending.current=true;setBusy(true);setError('')
    try{const original=source.current,items:SiteItem[]=[]
      for(const [i,p] of parts.entries()){
        const [item]=await constructionPlacements(p,projectId,axis,false)
        if(activity[i])item.stage_window={from_activity_id:activity[i]}
        item.operation_inputs=[original.backupRef??original.id];items.push(item)
      }
      let restore:(()=>void)|undefined
      if(!await state.save(old=>[...old,...items],'Split slab into pour zones',{redo:()=>{restore=hideSources([original.id])},undo:()=>restore?.()}))throw Error('The scene is busy.')
      onSelect(items.map(i=>i.id));setParts([])
    }catch(e){setError(siteError(e))}finally{pending.current=false;setBusy(false)}
  }
  return <details className="rounded border p-2"><summary>Split slab into pour zones</summary><fieldset className="space-y-2" disabled={busy||state.busy}>
    <p>Select a slab and draw a straight two-point path through the pour break. Each zone can then host its own formwork and reinforcement.</p>
    <button className={button} onClick={openPaths}>Open Paths</button><select aria-label="Pour break" className={field} value={path} onChange={e=>{setPath(e.target.value);setParts([])}}><option value="">Choose a pour break…</option>{paths.filter(p=>!p.closed&&p.points.length===2).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <button className={button} onClick={preview}>Preview selected slab</button>
    {!!parts.length&&<><ConstructionPreviewView scene={parts[view].scene} label={parts[view].label}/>
    {parts.map((p,i)=><div key={i}><button className={button} onClick={()=>setView(i)}>{p.label}</button><select aria-label={p.label+' activity'} className={field} value={activity[i]} onChange={e=>setActivity(activity.map((v,j)=>i===j?e.target.value:v))}><option value="">Assign pour activity later</option>{activities.filter(a=>a.activity_type==='task').map(a=><option key={a.id} value={a.id}>{a.code} · {a.task_name}</option>)}</select></div>)}
    <button className={button} onClick={()=>void save()}>Create both pour zones</button></>}
    {error&&<p role="alert">{error}</p>}
  </fieldset></details>
}

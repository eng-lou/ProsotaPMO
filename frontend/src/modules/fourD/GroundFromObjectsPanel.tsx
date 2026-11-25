import { useEffect, useMemo, useRef, useState } from 'react'
import type {Activity} from '../scheduling/types'
import { previewGround } from './groundPreview'
import { Group, Vector3 } from 'three'
import { ConstructionPreviewView } from './ConstructionPreviewView'
import { constructionPlacements, type HostSource } from './constructionLayout'
import { groundCutSource, type GroundCut } from './groundFromObjects'
import { disposeArraySnapshot } from './arraySourceSnapshot'
import { siteError, type SiteItem, type useSiteScene } from './siteScene'

const field='block w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:border-prosota-line'
const button='rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
type Ground=Awaited<ReturnType<typeof previewGround>>
function release(ground:Ground|null){ground?.pieces.forEach(p=>disposeArraySnapshot(p.preview.scene))}

export function GroundFromObjectsPanel({projectId,axis,state,selection,hideSources,onSelect,onPlan,activities=[]}:{
  activities?:Activity[];projectId:string;axis:'y'|'z';state:ReturnType<typeof useSiteScene>;selection():HostSource[]
  hideSources(ids:string[]):()=>void;onSelect(ids:string[]):void;onPlan(ids:string[]):void
}){
  const [base,setBase]=useState<HostSource|null>(null),[cuts,setCuts]=useState<GroundCut[]>([])
  const [phased,setPhased]=useState(false),[space,setSpace]=useState('0.4'),[blind,setBlind]=useState('0.05')
  const [phaseIds,setPhaseIds]=useState<Record<string,string>>({}),[phaseView,setPhaseView]=useState('excavation')
  const [margin,setMargin]=useState('3'),[top,setTop]=useState(''),[bottom,setBottom]=useState('')
  const [ground,setGround]=useState<Ground|null>(null),prepared=useRef<Ground|null>(null)
  const [showCuts,setShowCuts]=useState(false),[keepCuts,setKeepCuts]=useState(true),[hideBase,setHideBase]=useState(true)
  const [busy,setBusy]=useState(false),pending=useRef(false),alive=useRef(true)
  const [error,setError]=useState(''),[message,setMessage]=useState('')
  const previewJob=useRef<AbortController|null>(null),[progress,setProgress]=useState('')
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;previewJob.current?.abort();release(prepared.current)}},[])
  function clear(){previewJob.current?.abort();release(prepared.current);prepared.current=null;setGround(null);setError('');setMessage('')}
  function capture(asBase:boolean){
    try{
      const sources=selection()
      if(!sources.length)throw Error('Select '+(asBase?'one closed site solid.':'one or more foundation elements.'))
      if(asBase){
        if(sources.length!==1)throw Error('Select one closed ground base.')
        if(cuts.some(c=>c.id===(sources[0].backupRef??sources[0].id)))throw Error('This element is already an exclusion.')
        clear();setBase(sources[0])
      }else{
        if(base&&sources.some(s=>s.id===base.id))throw Error('The site base is also selected. Select only the exclusions.')
        const added=sources.map(s=>groundCutSource(s,axis))
        clear();setCuts(old=>[...new Map([...old,...added].map(c=>[c.id,c])).values()])
      }
    }catch(e){setError(siteError(e))}
  }
  async function preview(){
    if(pending.current)return
    const job=new AbortController()
    clear()
    previewJob.current=job
    pending.current=true;setBusy(true);setProgress('Preparing exclusions…')
    try{
      const options={margin:Number(margin),top:top.trim()?Number(top):undefined,bottom:bottom.trim()?Number(bottom):undefined}
      const result=await previewGround(cuts,base,axis,options,phased,Number(space),Number(blind),job.signal,setProgress)
      if(!alive.current||job.signal.aborted){release(result);return}
      prepared.current=result;setGround(result);setShowCuts(false);setPhaseView('excavation')
    }catch(e){if(alive.current&&!job.signal.aborted)setError(siteError(e))}
    finally{previewJob.current=null;pending.current=false;if(alive.current){setBusy(false);setProgress('')}}
  }
  const scene=useMemo(()=>{
    const scene=new Group()
    if(!ground)return scene
    const origin=ground.pieces[0].preview.anchor
    for(const {preview} of phased?ground.pieces.filter(p=>p.phase===phaseView):showCuts?ground.pieces.slice(1):ground.pieces.slice(0,1)){
      const clone=preview.scene.clone(true)
      clone.position.copy(preview.anchor).sub(origin).applyAxisAngle(new Vector3(1,0,0),axis==='z'?-Math.PI/2:0)
      scene.add(clone)
    }
    return scene
  },[ground,showCuts,axis,phased,phaseView])
  async function create(plan:boolean){
    if(!ground||pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{
      if(phased){
        let previous=-Infinity
        for(const phase of ['excavation','blinding','concrete','backfill'] as const){
          if(!ground.pieces.some(p=>p.phase===phase))continue
          const task=activities.find(a=>a.id===phaseIds[phase])
          if(!task?.start||!task.finish)throw Error('Choose a dated activity for each generated phase.')
          const date=Date.parse(phase==='excavation'?task.finish:task.start)
          if(date<previous)throw Error('Check the activity dates for excavation, blinding, concrete and backfill.')
          previous=date
        }
      }
      const concreteRefs=new Set(ground.pieces.find(p=>p.phase==='concrete')?.preview.sourceRefs)
      const items:SiteItem[]=[]
      for(const piece of phased||keepCuts?ground.pieces:ground.pieces.slice(0,1)){
        const [item]=await constructionPlacements(piece.preview,projectId,axis,false)
        if(!alive.current)return
        if(base&&hideBase&&piece===ground.pieces[0])item.operation_inputs=[base.backupRef??base.id]
        if(phased&&piece.phase){
          const id=phaseIds[piece.phase]
          if(!id)throw Error('Choose an activity for each phase before saving the animation.')
          item.stage_window=piece.phase==='excavation'?{until_activity_id:id,until_finish:true}:{from_activity_id:id}
          if(piece.phase==='concrete')item.operation_inputs=[...concreteRefs]
        }
        items.push(item)
      }
      let restore:(()=>void)|undefined
      const hideIds=[...(base&&hideBase?[base.id]:[]),...(phased?cuts.filter(c=>concreteRefs.has(c.id)).map(c=>c.source.id):[])]
      const effects=hideIds.length?{redo:()=>{restore=hideSources(hideIds)},undo:()=>restore?.()}:undefined
      if(!await state.save(old=>[...old,...items],'Generate ground from objects',effects))throw Error('The scene is busy. Try again.')
      if(!alive.current)return
      const ids=items.map(i=>i.id)
      clear();setMessage('Created '+items.length+' ground object'+(items.length===1?'':'s')+'.')
      onSelect(ids);if(plan)onPlan(ids.slice(1))
    }catch(e){if(alive.current)setError(siteError(e))}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  const input=(title:string,v:string,set:(s:string)=>void,placeholder?:string)=><label>{title}<input type="number" step="any" className={field} placeholder={placeholder} value={v} onChange={e=>{clear();set(e.target.value)}}/></label>
  return <details className="rounded border p-2 dark:border-prosota-line"><summary>Ground from objects</summary>
    <fieldset disabled={(busy&&!progress)||state.busy||!state.ready} className="mt-2 space-y-2">
      <strong>Ground base</strong><p>{base?base.name:'Automatic site around exclusions'}</p>
      <button className={button} onClick={()=>capture(true)}>Use selected solid as base</button>
      {base?<button className={button} onClick={()=>{clear();setBase(null)}}>Use automatic site</button>:<>
        {input('Site margin (m)',margin,setMargin)}
        <div className="grid grid-cols-2 gap-2">{input('Ground level (m)',top,setTop,'Highest selected top')}{input('Base elevation (m)',bottom,setBottom,'Below deepest cut')}</div>
      </>}
      <label className="flex gap-2"><input type="checkbox" checked={phased} onChange={e=>{clear();setPhased(e.target.checked)}}/>Combine excavations and generate foundation phases</label>
      {phased&&<div className="grid grid-cols-2 gap-2">{input('Working space (m)',space,setSpace)}{input('Blinding (m)',blind,setBlind)}</div>}
      <strong className="block">Exclusions</strong>
      <p>Select piles, pile caps, slabs or beams. Each cut extends from the ground surface to the underside of its object. Earlier cuts take shared soil first.</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={()=>capture(false)}>Add selected exclusions</button>
        <button className={button} disabled={!cuts.length} onClick={()=>{clear();setCuts([])}}>Remove all</button>
      </div>
      <ol className="max-h-36 overflow-auto">{cuts.map((c,i)=><li className="flex items-center gap-2" key={c.id}>
        <span className="flex-1">{i+1}. {c.name}</span>
        {i>0&&<button aria-label={'Move '+c.name+' earlier'} onClick={()=>{clear();const next=[...cuts];[next[i-1],next[i]]=[next[i],next[i-1]];setCuts(next)}}>↑</button>}
        <button aria-label={'Remove '+c.name} onClick={()=>{clear();setCuts(cuts.filter(x=>x!==c))}}>×</button></li>)}</ol>
      <button className={button} disabled={busy||!cuts.length} onClick={()=>void preview()}>{busy?'Working…':'Preview ground cuts'}</button>
      {ground&&<>{phased&&ground.skipped.length>0&&<p>{ground.skipped.length} exclusion{ground.skipped.length===1?' outside the ground cut was':'s outside the ground cut were'} skipped.</p>}{phased?<><label>Preview phase<select className={field} value={phaseView} onChange={e=>setPhaseView(e.target.value)}>{ground.pieces.filter(p=>p.phase).map(p=><option key={p.phase} value={p.phase}>{p.preview.label}</option>)}</select></label>
        {ground.pieces.filter(p=>p.phase).map(p=><label key={p.phase} className="block">{p.preview.label} activity<select className={field} value={phaseIds[p.phase!]??''} onChange={e=>setPhaseIds({...phaseIds,[p.phase!]:e.target.value})}><option value="">Choose…</option>{activities.filter(a=>a.activity_type==='task'&&a.start&&a.finish).map(a=><option key={a.id} value={a.id}>{a.code} · {a.task_name}</option>)}</select></label>)}</>:<label className="flex gap-2"><input type="checkbox" checked={showCuts} onChange={e=>setShowCuts(e.target.checked)}/>Preview removed soil</label>}
        <ConstructionPreviewView scene={scene} label="Ground from objects"/>
        {!phased&&<><p>{ground.pieces.length-1} excavation volumes{ground.skipped.length?' · No additional soil at '+ground.skipped.join(', '):''}</p>
        <label className="flex gap-2"><input type="checkbox" checked={keepCuts} onChange={e=>setKeepCuts(e.target.checked)}/>Keep removed soil separately for 4D phasing</label></>}
        {base&&<label className="flex gap-2"><input type="checkbox" checked={hideBase} onChange={e=>setHideBase(e.target.checked)}/>Hide original ground base</label>}
        <button className={button} onClick={()=>void create(false)}>Create ground</button>
        <button className={button} onClick={()=>phased?onPlan([]):void create(true)}>{phased?'Add foundation activities…':'Create and plan activities…'}</button>
      </>}
    </fieldset>
    {progress&&<div className="mt-2 flex items-center gap-2"><span role="status">{progress}</span><button className={button} onClick={()=>previewJob.current?.abort()}>Cancel preview</button></div>}
    {error&&<p role="alert" className="text-red-500">{error}</p>}{message&&<p role="status">{message}</p>}
  </details>
}

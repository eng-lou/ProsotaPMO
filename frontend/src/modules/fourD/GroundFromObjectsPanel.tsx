import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Vector3 } from 'three'
import { ConstructionPreviewView } from './ConstructionPreviewView'
import { constructionPlacements, type HostSource } from './constructionLayout'
import { groundCutSource, makeGround, type GroundCut } from './groundFromObjects'
import { disposeArraySnapshot } from './arraySourceSnapshot'
import { siteError, type SiteItem, type useSiteScene } from './siteScene'

const field='block w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:border-prosota-line'
const button='rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
type Ground=ReturnType<typeof makeGround>
function release(ground:Ground|null){ground?.pieces.forEach(p=>disposeArraySnapshot(p.preview.scene))}

export function GroundFromObjectsPanel({projectId,axis,state,selection,hideSources,onSelect,onPlan}:{
  projectId:string;axis:'y'|'z';state:ReturnType<typeof useSiteScene>;selection():HostSource[]
  hideSources(ids:string[]):()=>void;onSelect(ids:string[]):void;onPlan(ids:string[]):void
}){
  const [base,setBase]=useState<HostSource|null>(null),[cuts,setCuts]=useState<GroundCut[]>([])
  const [margin,setMargin]=useState('3'),[top,setTop]=useState(''),[bottom,setBottom]=useState('')
  const [ground,setGround]=useState<Ground|null>(null),prepared=useRef<Ground|null>(null)
  const [showCuts,setShowCuts]=useState(false),[keepCuts,setKeepCuts]=useState(true),[hideBase,setHideBase]=useState(true)
  const [busy,setBusy]=useState(false),pending=useRef(false),alive=useRef(true)
  const [error,setError]=useState(''),[message,setMessage]=useState('')
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;release(prepared.current)}},[])
  function clear(){release(prepared.current);prepared.current=null;setGround(null);setError('');setMessage('')}
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
    pending.current=true;setBusy(true);clear()
    try{
      await new Promise(r=>setTimeout(r,20))
      if(!alive.current)return
      const result=makeGround(cuts,base,axis,{margin:Number(margin),top:top.trim()?Number(top):undefined,bottom:bottom.trim()?Number(bottom):undefined})
      prepared.current=result;setGround(result);setShowCuts(false)
    }catch(e){if(alive.current)setError(siteError(e))}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  const scene=useMemo(()=>{
    const scene=new Group()
    if(!ground)return scene
    const origin=ground.pieces[0].preview.anchor
    for(const {preview} of showCuts?ground.pieces.slice(1):ground.pieces.slice(0,1)){
      const clone=preview.scene.clone(true)
      clone.position.copy(preview.anchor).sub(origin).applyAxisAngle(new Vector3(1,0,0),axis==='z'?-Math.PI/2:0)
      scene.add(clone)
    }
    return scene
  },[ground,showCuts,axis])
  async function create(plan:boolean){
    if(!ground||pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{
      const items:SiteItem[]=[]
      for(const piece of keepCuts?ground.pieces:ground.pieces.slice(0,1)){
        const [item]=await constructionPlacements(piece.preview,projectId,axis,false)
        if(!alive.current)return
        if(base&&hideBase&&!piece.sourceId)item.operation_inputs=[base.backupRef??base.id]
        items.push(item)
      }
      let restore:(()=>void)|undefined
      const effects=base&&hideBase?{redo:()=>{restore=hideSources([base.id])},undo:()=>restore?.()}:undefined
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
    <fieldset disabled={busy||state.busy||!state.ready} className="mt-2 space-y-2">
      <strong>Ground base</strong><p>{base?base.name:'Automatic site around exclusions'}</p>
      <button className={button} onClick={()=>capture(true)}>Use selected solid as base</button>
      {base?<button className={button} onClick={()=>{clear();setBase(null)}}>Use automatic site</button>:<>
        {input('Site margin (m)',margin,setMargin)}
        <div className="grid grid-cols-2 gap-2">{input('Ground level (m)',top,setTop,'Highest selected top')}{input('Base elevation (m)',bottom,setBottom,'Below deepest cut')}</div>
      </>}
      <strong className="block">Exclusions</strong>
      <p>Select piles, pile caps, slabs or beams. Each cut extends from the ground surface to the underside of its object. Earlier cuts take shared soil first.</p>
      <button className={button} onClick={()=>capture(false)}>Add selected exclusions</button>
      <ol className="max-h-36 overflow-auto">{cuts.map((c,i)=><li className="flex items-center gap-2" key={c.id}>
        <span className="flex-1">{i+1}. {c.name}</span>
        {i>0&&<button aria-label={'Move '+c.name+' earlier'} onClick={()=>{clear();const next=[...cuts];[next[i-1],next[i]]=[next[i],next[i-1]];setCuts(next)}}>↑</button>}
        <button aria-label={'Remove '+c.name} onClick={()=>{clear();setCuts(cuts.filter(x=>x!==c))}}>×</button></li>)}</ol>
      <button className={button} disabled={!cuts.length} onClick={()=>void preview()}>{busy?'Working…':'Preview ground cuts'}</button>
      {ground&&<><label className="flex gap-2"><input type="checkbox" checked={showCuts} onChange={e=>setShowCuts(e.target.checked)}/>Preview removed soil</label>
        <ConstructionPreviewView scene={scene} label="Ground from objects"/>
        <p>{ground.pieces.length-1} excavation volumes{ground.skipped.length?' · No additional soil at '+ground.skipped.join(', '):''}</p>
        <label className="flex gap-2"><input type="checkbox" checked={keepCuts} onChange={e=>setKeepCuts(e.target.checked)}/>Keep removed soil separately for 4D phasing</label>
        {base&&<label className="flex gap-2"><input type="checkbox" checked={hideBase} onChange={e=>setHideBase(e.target.checked)}/>Hide original ground base</label>}
        <button className={button} onClick={()=>void create(false)}>Create ground</button>
        <button className={button} onClick={()=>void create(true)}>Create and plan activities…</button>
      </>}
    </fieldset>{error&&<p role="alert" className="text-red-500">{error}</p>}{message&&<p role="status">{message}</p>}
  </details>
}

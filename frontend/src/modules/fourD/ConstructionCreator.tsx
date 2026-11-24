import { useEffect, useRef, useState } from 'react'
import { ConstructionPreviewView } from './ConstructionPreviewView'
import { constructionModes, type ConstructionMode, type ConstructionOptions } from './constructionGeometry'
import { constructionPlacements, prepareConstruction, releaseConstruction, type ConstructionPreview, type HostSource } from './constructionLayout'
import { siteError, type useSiteScene } from './siteScene'

export type CreatorKind='Formwork'|'Reinforcement'
const modes:Record<CreatorKind,ConstructionMode[]>={Formwork:['deck','slabEdge','beam','groundBeam','shutter','wallForm','screen'],Reinforcement:['mat','column','wall']}
const field='block w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:border-prosota-line'
const button='rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
export function ConstructionCreator({kind,projectId,upAxis,selectedSources,state,onSelect,onPlan,onClose}:{
  kind:CreatorKind; projectId:string; upAxis:'y'|'z'; selectedSources():HostSource[]
  state:ReturnType<typeof useSiteScene>; onSelect(ids:string[]):void; onPlan(ids:string[],mode:ConstructionMode):void; onClose():void
}){
  const [mode,setMode]=useState<ConstructionMode>(modes[kind][0])
  const [spacing,setSpacing]=useState('200'),[diameter,setDiameter]=useState('16'),[cover,setCover]=useState('35')
  const [clearance,setClearance]=useState(''),[propSpacing,setPropSpacing]=useState('1.9')
  const [panelWidth,setPanelWidth]=useState('1.2')
  const [braceSide,setBraceSide]=useState<'near'|'far'|'both'>('near')
  const [screenHeight,setScreenHeight]=useState('7.2'),[bayWidth,setBayWidth]=useState('2.4'),[skip,setSkip]=useState('')
  const [doubleMat,setDoubleMat]=useState(true),[separate,setSeparate]=useState(true)
  const [preview,setPreview]=useState<ConstructionPreview|null>(null),prepared=useRef<ConstructionPreview|null>(null)
  const [busy,setBusy]=useState(false),pending=useRef(false),alive=useRef(true)
  const [error,setError]=useState('')
  function clear(){if(prepared.current)releaseConstruction(prepared.current.scene);prepared.current=null;setPreview(null);setError('')}
  useEffect(()=>{
    alive.current=true
    return ()=>{alive.current=false;if(prepared.current)releaseConstruction(prepared.current.scene)}
  },[])
  const supported=mode==='deck'||mode==='beam'
  const host=mode==='beam'||mode==='groundBeam'?'beams':mode==='shutter'||mode==='column'?'columns':(mode==='wall'||mode==='wallForm')?'walls':'slabs'
  const number=(label:string,value:string,change:(v:string)=>void,placeholder?:string)=><label>{label}<input className={field} type="number" step="any" min="0" placeholder={placeholder} value={value} onChange={e=>{clear();change(e.target.value)}}/></label>
  function value(text:string,min:number,max:number,label:string){
    const n=Number(text)
    if(!text.trim()||!Number.isFinite(n)||n<min||n>max)throw Error(label+' must be between '+min+' and '+max+'.')
    return n
  }
  async function prepare(){
    if(pending.current)return
    pending.current=true;setBusy(true);clear()
    try{
      const rebar=kind==='Reinforcement'
      const options:ConstructionOptions={mode,
        spacing:rebar?value(spacing,40,2000,'Bar spacing (mm)')/1000:supported?value(propSpacing,.3,5,'Prop spacing (m)'):1,
        panelWidth:mode==='wallForm'?value(panelWidth,.4,3,'Max wall panel width (m)'):undefined,braceSide,
        diameter:rebar?value(diameter,4,60,'Bar diameter (mm)')/1000:.016,
        cover:rebar?value(cover,5,250,'Cover (mm)')/1000:.035,
        autoClearance:!clearance.trim(),
        clearance:supported&&clearance.trim()?value(clearance,.75,10,'Soffit height (m)'):3.424,
        screenHeight:mode==='screen'?value(screenHeight,2.5,18,'Screen height (m)'):7.2,
        bayWidth:mode==='screen'?value(bayWidth,.4,6,'Bay width (m)'):2.4,doubleMat}
      const skipEdges=mode==='screen'&&skip.trim()?skip.split(',').map(s=>Number(s.trim())):[]
      if(skipEdges.some(n=>!Number.isInteger(n)||n<1))throw Error('Enter exterior edge numbers separated by commas.')
      const sources=selectedSources()
      const result=await prepareConstruction(sources,upAxis,options,skipEdges)
      if(alive.current){prepared.current=result;setPreview(result)}else releaseConstruction(result.scene)
    }catch(e){if(alive.current)setError(siteError(e))}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  async function create(plan=false){
    if(!preview||pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{
      const items=await constructionPlacements(preview,projectId,upAxis,separate)
      if(!alive.current)return
      const saved=await state.save(current=>[...current,...items],'Create '+preview.label)
      if(!saved)throw Error('The scene is busy. Try creating this preview again.')
      if(alive.current){
        const ids=items.map(i=>i.id)
        onSelect(ids)
        onClose()
        if(plan)onPlan(ids,mode)
      }
    }catch(e){if(alive.current)setError(siteError(e))}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  return <section aria-label={kind+' creator'} className="rounded border p-2 space-y-2 dark:border-prosota-line">
    <div className="flex items-center justify-between"><strong>{kind} creator</strong><button className={button} disabled={busy} onClick={onClose}>Close</button></div>
    <fieldset disabled={busy||state.busy} className="space-y-2 min-w-0">
      <label>Generate<select className={field} value={mode} onChange={e=>{clear();setMode(e.target.value as ConstructionMode)}}>{modes[kind].map(m=><option key={m} value={m}>{constructionModes[m]}</option>)}</select></label>
      <p>Select {host} in the viewport. Ctrl/Cmd-click to add more.</p>
      {supported&&<div className="grid grid-cols-2 gap-2">{number('Soffit height above support (m)',clearance,setClearance,'Auto (IFC) / 3.424')}{number('Max prop spacing (m)',propSpacing,setPropSpacing)}</div>}
      {mode==='wallForm'&&<div className="grid grid-cols-2 gap-2">
        {number('Max wall panel width (m)',panelWidth,setPanelWidth)}
        <label>Brace placement<select className={field} value={braceSide} onChange={e=>{clear();setBraceSide(e.target.value as typeof braceSide)}}>
          <option value="near">Face A</option><option value="far">Face B</option><option value="both">Both faces</option>
        </select></label>
      </div>}
      {mode==='screen'&&<><div className="grid grid-cols-2 gap-2">{number('Max bay width (m)',bayWidth,setBayWidth)}{number('Screen height (m)',screenHeight,setScreenHeight)}</div>
        <label>Exterior edges to skip<input placeholder="e.g. 2, 4" className={field} value={skip} onChange={e=>{clear();setSkip(e.target.value)}}/></label></>}
      {kind==='Reinforcement'&&<><div className="grid grid-cols-2 gap-2">{number('Spacing (mm)',spacing,setSpacing)}{number('Bar diameter (mm)',diameter,setDiameter)}{number('Cover (mm)',cover,setCover)}</div>
        {mode==='mat'&&<label className="flex gap-2"><input type="checkbox" checked={doubleMat} onChange={e=>{clear();setDoubleMat(e.target.checked)}}/>Top and bottom mats</label>}</>}
      <button className={button} disabled={!state.ready} onClick={()=>void prepare()}>{busy?'Working…':'Preview from selection'}</button>
      {preview&&<><ConstructionPreviewView scene={preview.scene} label={constructionModes[mode]}/><p>{preview.hosts} selected {preview.hosts===1?'host':'hosts'} · {preview.parts} construction parts</p>
      {preview.bearingSummary&&<p>{preview.bearingSummary}</p>}
      {preview.parts>1&&<label className="flex gap-2"><input type="checkbox" checked={separate} onChange={e=>setSeparate(e.target.checked)}/>Save parts separately for scheduling</label>}
      <button className={button+' bg-blue-600 text-white'} onClick={()=>void create()}>Create at selected {preview.hosts===1?'element':'elements'}</button>
      <button className={button} onClick={()=>void create(true)}>Create and plan activities…</button></>}
    </fieldset>
    {error&&<p role="alert" className="text-red-500">{error}</p>}
  </section>
}

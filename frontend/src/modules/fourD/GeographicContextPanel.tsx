import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { api } from '@/lib/api'
import { recipe, siteError, type SiteItem, type useSiteScene } from './siteScene'
import type { SiteContext } from './siteContext'
import type { GeographicContext } from './geographicContext'
import { GeographicEditor } from './GeographicEditor'
import type { ReconstructionArea } from './reconstructionPlan'
const input='w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:border-prosota-line'
const button='rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
export function GeographicContextPanel({ctx,state,upAxis,onHideTiles,onShowTiles,onPlan,planArea}:{ctx:SiteContext;state:ReturnType<typeof useSiteScene>;upAxis:'y'|'z';onHideTiles():void;onShowTiles?():void;onPlan?(action:'plan'|'capture'|'orbit'):void;planArea?:ReconstructionArea|null}) {
  const [width,setWidth]=useState(800),[depth,setDepth]=useState(650),[east,setEast]=useState(0),[north,setNorth]=useState(0)
  const [provider,setProvider]=useState<'main'|'community'>('main')
  const [edit,setEdit]=useState<SiteItem|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const request=useRef(0),live=useRef(true)
  useEffect(()=>{if(!planArea)return;if(planArea.error){setError(planArea.error);return}setWidth(planArea.width);setDepth(planArea.depth);setEast(planArea.east);setNorth(planArea.north);setError('')},[planArea?.serial])
  useEffect(()=>{live.current=true;setEdit(null);setError('');setBusy(false);return()=>{live.current=false;request.current++;state.setDraft(null)}},[ctx.project_id])
  function make(data:GeographicContext):SiteItem {
    const x=(data.lon-ctx.lon!)*111320*Math.cos(ctx.lat!*Math.PI/180),y=(data.lat-ctx.lat!)*111320
    const position=new T.Vector3(x,upAxis==='z'?y:0,upAxis==='y'?-y:0).multiplyScalar(ctx.scale).applyAxisAngle(new T.Vector3(0,upAxis==='y'?1:0,upAxis==='z'?1:0),ctx.offset_yaw_deg*Math.PI/180).add(new T.Vector3(ctx.offset_x,ctx.offset_y,ctx.offset_z))
    return {id:crypto.randomUUID(),name:(ctx.label||'Open map')+' · reconstruction',kind:'geographic',geographic:data,generator_version:1,up_axis:upAxis,units:'m',position:{x:position.x,y:position.y,z:position.z},rotation:{x:0,y:upAxis==='y'?ctx.offset_yaw_deg*Math.PI/180:0,z:upAxis==='z'?ctx.offset_yaw_deg*Math.PI/180:0},scale:{x:ctx.scale,y:ctx.scale,z:ctx.scale},yaw:0,width:1,depth:1,height:1,color:'#d6d5cd',locked:false,activity_id:null,path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0}
  }
  async function load(file?:File){
    const serial=++request.current;setBusy(true);setError('')
    try{
      if(ctx.lat===null||ctx.lon===null)throw Error('Set the site coordinates first')
      let item:SiteItem
      if(file){if(file.size>8*1024*1024)throw Error('Choose a reconstruction file under 8 MB');item=make(JSON.parse(await file.text()))}
      else {const {data}=await api.post<GeographicContext>('/api/v1/site-context/open-map',{project_id:ctx.project_id,lat:ctx.lat+north/111320,lon:ctx.lon+east/(111320*Math.cos(ctx.lat*Math.PI/180)),width,depth,provider},{timeout:70000});item=make(data)}
      if(serial!==request.current||!live.current)return
      const {data}=await api.post<SiteItem>(`/api/v1/site-scenes/${ctx.project_id}/preview`,recipe(item))
      if(serial===request.current&&live.current){setEdit(data);state.setDraft(data);state.setSelected(data.id)}
    }catch(e){if(serial===request.current&&live.current)setError(siteError(e))}finally{if(serial===request.current&&live.current)setBusy(false)}
  }
  function change(data:GeographicContext){if(!edit)return;const next={...edit,geographic:data};setEdit(next);state.setDraft(next)}
  async function save(){if(!edit)return;const serial=++request.current;setError('');try{await state.save([...state.scene.items.filter(i=>i.id!==edit.id),edit],'Save geographic reconstruction');if(serial!==request.current||!live.current)return;state.setSelected(edit.id);setEdit(null);onHideTiles()}catch(e){if(serial===request.current&&live.current)setError(siteError(e))}}
  function download(){if(!edit?.geographic)return;const url=URL.createObjectURL(new Blob([JSON.stringify(edit.geographic)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='site.prosota-context.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return <section className="border-t pt-3 space-y-2 dark:border-prosota-line text-xs">
    <strong>Editable 3D reconstruction</strong><p>Build from independent OpenStreetMap footprints, roads and planting. Preview, refine, then save to 3D Site tools.</p>
    {!edit&&onPlan&&<div className="space-y-1"><p>Frame the area in top-down orthographic plan. Pan and zoom, then use its footprint. The frame locates independent map data; it does not extract live tiles.</p><div className="flex flex-wrap gap-1"><button className={button} onClick={()=>onPlan('plan')}>Set plan view</button><button className={button} onClick={()=>onPlan('capture')}>Use plan frame</button><button className={button} onClick={()=>onPlan('orbit')}>Return to orbit</button></div></div>}
    {!edit&&<><div className="grid grid-cols-2 gap-2"><label>Width (m)<input className={input} type="number" min="100" max="1500" value={width} onChange={e=>setWidth(e.target.valueAsNumber)}/></label><label>Depth (m)<input className={input} type="number" min="100" max="1500" value={depth} onChange={e=>setDepth(e.target.valueAsNumber)}/></label><label>Centre east (m)<input className={input} type="number" value={east} onChange={e=>setEast(e.target.valueAsNumber)}/></label><label>Centre north (m)<input className={input} type="number" value={north} onChange={e=>setNorth(e.target.valueAsNumber)}/></label></div>
    <label>Map service<select className={input} value={provider} onChange={e=>setProvider(e.target.value as 'main'|'community')}><option value="main">OpenStreetMap · Overpass main</option><option value="community">OpenStreetMap · Private.coffee mirror</option></select></label>
    <button className={button} disabled={busy||state.busy||!state.ready} onClick={()=>void load()}>{busy?'Loading map…':'Build 3D preview'}</button>
    <label className="block">Open saved reconstruction<input className={input} type="file" accept=".json" disabled={busy||!state.ready} onChange={e=>{const f=e.target.files?.[0];if(f)void load(f);e.target.value=''}}/></label>
    {state.scene.items.filter(i=>i.kind==='geographic').map(i=><button key={i.id} className={button} disabled={i.locked||state.busy} onClick={()=>{setEdit(i);state.setDraft(i)}}>Edit {i.name}</button>)}</>}
    {edit?.geographic&&<><p>Use Frame Selected in the viewport to inspect the study.</p><GeographicEditor data={edit.geographic} onChange={change}/><div className="flex flex-wrap gap-1"><button className={button+' bg-blue-600 text-white'} disabled={state.busy} onClick={()=>void save()}>Save reconstruction</button><button className={button} onClick={download}>Download recipe</button><button className={button} disabled={state.busy} onClick={()=>{setEdit(null);state.setDraft(null)}}>Cancel</button></div><p>Save retains editable source features offline. Ground elevation uses the site offset; adjust it to align with a survey.</p></>}
    <button className={button} disabled={!ctx.enabled&&!onShowTiles} onClick={ctx.enabled?onHideTiles:onShowTiles}>{ctx.enabled?(ctx.view_isolation?'Hide isolated tiles':'Hide live tiles'):(ctx.view_isolation?'Show isolated tiles':'Show live tiles')}</button>
    {ctx.view_isolation&&<p>Saved camera frame retained when tiles are hidden.</p>}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
  </section>
}

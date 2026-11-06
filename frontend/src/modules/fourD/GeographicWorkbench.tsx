import { useEffect, useRef, useState } from 'react'
import type { Object3D } from 'three'
import { api } from '@/lib/api'
import { GeographicEditor } from './GeographicEditor'
import { type SiteItem, type useSiteScene, siteError } from './siteScene'
import type { SiteAsset } from './siteAssets'
import { editableMapFeatures, updateMapFeatures } from './geographicSelection'
import { disposeSnapshot, downloadGlb, findGeographicRoot, geographicSnapshot } from './geographicExport'
import { mergeReconstruction } from './geographicRegeneration'
import type { GeographicContext } from './geographicContext'
import { ReplacementPanel } from './ReplacementPanel'
const button='rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
export function GeographicWorkbench({item,state,source,projectId,assets}:{item:SiteItem;state:ReturnType<typeof useSiteScene>;source?:Object3D;projectId:string;assets:SiteAsset[]}){
  const current=state.draft?.id===item.id?state.draft:item,data=current.geographic!,selection=state.detailSelection?.itemId===item.id?state.detailSelection:null
  const feature=editableMapFeatures(data).find(f=>f.id===selection?.featureId)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[missing,setMissing]=useState<string[]>([]),[search,setSearch]=useState('')
  const [retainedGeometry,setRetainedGeometry]=useState<string[]>([])
  const [preserve,setPreserve]=useState({materials:true,geometry:true,replacements:true}),[exclude,setExclude]=useState(new Set<string>()),[provider,setProvider]=useState('main')
  const alive=useRef(true),request=useRef(0)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++}},[projectId,item.id])
  const change=(geographic:GeographicContext)=>state.setDraft({...current,geographic})
  async function exporting(all:boolean){if(!source)return;setBusy(true);setError('');let snapshot:ReturnType<typeof geographicSnapshot>|undefined
    try{if(state.draft)throw Error('Save edits before export so the Blender file matches the saved reconstruction.');const root=findGeographicRoot(source);if(!root)throw Error('Wait for the reconstruction to finish loading');snapshot=geographicSnapshot(root,data,all?undefined:new Set([feature!.id]),!all);await downloadGlb(snapshot.root,all?item.name:feature!.name)}catch(e){setError(siteError(e))}finally{if(snapshot)disposeSnapshot(snapshot.root);setBusy(false)}}
  async function regenerate(){const serial=++request.current;setBusy(true);setError('')
    try{const {data:fresh}=await api.post<GeographicContext>('/api/v1/site-context/open-map',{project_id:projectId,lat:data.lat,lon:data.lon,width:data.width,depth:data.depth,provider},{timeout:70000});if(!alive.current||serial!==request.current)return
      const result=mergeReconstruction(data,fresh,{...preserve,featureIds:new Set(editableMapFeatures(data).filter(f=>!exclude.has(f.id)).map(f=>f.id))});change(result.data);setMissing(result.missing);setRetainedGeometry(result.retainedGeometry)
    }catch(e){if(alive.current)setError(siteError(e))}finally{if(alive.current)setBusy(false)}}
  return <section className="space-y-2 border rounded p-2 dark:border-prosota-line"><strong>Reconstruction objects & surfaces</strong>
    <fieldset disabled={busy||state.busy||item.locked} className="space-y-2"><GeographicEditor data={data} onChange={change} selection={selection} onSelect={(featureId,surface)=>state.setDetailSelection({itemId:item.id,featureId,surface})}/>
      {state.draft?.id===item.id&&<div className="flex gap-1"><button className={button} onClick={async()=>{try{await state.save(state.scene.items.map(i=>i.id===item.id?current:i),'Edit reconstruction');setMissing([])}catch{/* state shows save error */}}}>Save changes</button><button className={button} onClick={()=>{state.setDraft(null);setMissing([])}}>Discard edits</button></div>}
      <details className="border-t pt-2"><summary>Regenerate from map · preserve edits</summary><p>Keep the selected edit types and features. Review the regenerated preview before saving.</p>
        {(['materials','geometry','replacements'] as const).map(key=><label className="block" key={key}><input type="checkbox" checked={preserve[key]} onChange={e=>setPreserve({...preserve,[key]:e.target.checked})}/> Preserve {key}</label>)}
        <details><summary>Choose features to preserve ({editableMapFeatures(data).length-exclude.size})</summary><input placeholder="Filter preserved features…" value={search} onChange={e=>setSearch(e.target.value)}/><button className={button} onClick={()=>setExclude(new Set())}>All</button><button className={button} onClick={()=>setExclude(new Set(editableMapFeatures(data).map(f=>f.id)))}>None</button><div className="max-h-48 overflow-y-auto">{editableMapFeatures(data).filter(f=>(f.id+' '+f.name).toLowerCase().includes(search.toLowerCase())).map(f=><label className="block" key={f.id}><input type="checkbox" checked={!exclude.has(f.id)} onChange={e=>setExclude(old=>{const next=new Set(old);e.target.checked?next.delete(f.id):next.add(f.id);return next})}/>{f.name} · {f.id}</label>)}</div></details>
        <select aria-label="Regeneration map service" value={provider} onChange={e=>setProvider(e.target.value)}><option value="main">Overpass main</option><option value="community">Private.coffee mirror</option></select><button className={button} onClick={()=>void regenerate()}>Regenerate preview</button>
        {missing.length>0&&<p role="status">{missing.length} preserved feature(s) missing from the new map were retained. Inspect them before saving: {missing.slice(0,8).join(', ')}</p>}
        {retainedGeometry.length>0&&<p role="status">{retainedGeometry.length} feature(s) kept their previous geometry because the new walls could not be matched to the preserved face materials. Inspect before saving: {retainedGeometry.slice(0,8).join(', ')}</p>}
      </details>
      <details className="border-t pt-2"><summary>Export / refine in Blender</summary><p>GLB uses metres, named types, objects and surfaces. After refining in Blender, import the model normally through the Asset library. Use Replace object / instances if you want it to replace an existing feature. Procedural shader effects are approximated by standard materials. This exports a static scene.</p>
        <button className={button} disabled={!feature||!!state.draft||!source} onClick={()=>void exporting(false)}>Export selected feature GLB</button><button className={button} disabled={!!state.draft||!source} onClick={()=>void exporting(true)}>Export reconstruction GLB</button>
        {feature?.replacement&&<button className={button} onClick={()=>change(updateMapFeatures(data,[{...feature,replacement:null}]))}>Restore generated geometry</button>}
      </details>
    </fieldset>
    {feature&&<ReplacementPanel state={state} assets={assets} selection={{itemId:item.id,featureId:feature.id}}/>}
    {busy&&<p>Working…</p>}{error&&<p role="alert" className="text-red-500">{error}</p>}
  </section>
}

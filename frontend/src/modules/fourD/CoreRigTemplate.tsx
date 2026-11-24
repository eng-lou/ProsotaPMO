import { useEffect, useRef, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import { importSiteAsset, loadSiteAsset, type SiteAsset, type useSiteAssetInventory } from './siteAssets'
import { siteError, type SiteItem } from './siteScene'
import { readCoreLift, fitCoreRig } from './corePlacement'
import { corePhases } from './coreCycle'
import type { HostSource } from './constructionLayout'

export const coreModelFile='Prosota_Core_Formwork_with_Boom.glb'
export const coreModelUrl='/models/'+coreModelFile
type Inventory=ReturnType<typeof useSiteAssetInventory>
async function templateAsset(projectId:string,inventory:Inventory,file:string){
  const response=await fetch(import.meta.env.BASE_URL+'models/'+file)
  if(!response.ok)throw Error('Could not load the included core rig.')
  const blob=await response.blob()
  const existing=inventory.assets.find(a=>a.name===file && a.size_bytes===blob.size)
  if(existing)return existing
  const asset=await importSiteAsset(projectId,new File([blob],file,{type:'model/gltf-binary'}),'Equipment',()=>{})
  inventory.setAssets(old=>[...old.filter(a=>a.id!==asset.id),asset])
  return asset
}
interface Props{
  projectId:string;inventory:Inventory;onPlace(asset:SiteAsset,fit?:Partial<SiteItem>):void
  selection?:{sources():HostSource[];activities:Activity[];axis:'y'|'z'}
}
export function CoreRigTemplate({projectId,inventory,onPlace,selection}:Props){
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const [boom,setBoom]=useState(true),[activityId,setActivityId]=useState(''),[firstTop,setFirstTop]=useState('')
  const pending=useRef(false),alive=useRef(true)
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false}},[])
  async function place(){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{
      const lift=selection?readCoreLift(selection.sources(),selection.axis):null
      if(lift&&firstTop.trim()){
        const elevation=Number(firstTop)
        if(!Number.isFinite(elevation)||Math.abs(elevation)>1000000)throw Error('Enter a valid first core top elevation.')
        lift.base+=elevation-lift.top
        lift.top=elevation
      }
      const asset=await templateAsset(projectId,inventory,boom?coreModelFile:'Prosota_Core_Formwork.glb')
      if(!alive.current)return
      if(!lift||!selection){onPlace(asset);return}
      const source=await loadSiteAsset(asset.id)
      if(!alive.current)return
      const task=selection.activities.find(a=>a.id===activityId)
      const lifts=task?[{id:crypto.randomUUID(),activity_id:task.id,height:0,duration_hours:24,start:null,finish:null,...corePhases(task,selection.activities)}]:[]
      onPlace(asset,{...fitCoreRig(lift,source,asset.dimensions,selection.axis),
        name:boom?'Climbing formwork with placing boom':'Climbing formwork',
        climbing_formwork:{mode:'articulated',axis:selection.axis,reference_elevation:lift.top,reference_sources:lift.refs,lifts}})
    }catch(e){if(alive.current)setError(siteError(e))}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  return <details className="rounded border p-2"><summary>{selection?'Place climbing system from core':'Core formwork with placing boom'}</summary>
    <fieldset disabled={busy} className="space-y-2 mt-2">
      {selection?<><p>Select the walls of the first lift or the whole first-lift core. The shutters fit its footprint and start at its base.</p>
        <label className="block">System<select className="block w-full border rounded p-1 dark:bg-prosota-panel2" value={boom?'boom':'plain'} onChange={e=>setBoom(e.target.value==='boom')}>
          <option value="plain">Climbing formwork</option><option value="boom">Climbing formwork with placing boom</option>
        </select></label>
        <label className="block">First core top elevation (m)<input className="block w-full rounded border p-1 dark:bg-prosota-panel2"
          type="number" step="any" placeholder="From selected core walls" value={firstTop} onChange={e=>setFirstTop(e.target.value)}/></label>
        <label className="block">First lift activity<select className="block w-full border rounded p-1 dark:bg-prosota-panel2" value={activityId} onChange={e=>setActivityId(e.target.value)}>
          <option value="">Assign later</option>{selection.activities.filter(a=>a.start && a.activity_type==='task').map(a=><option key={a.id} value={a.id}>{a.code} · {a.task_name}</option>)}
        </select></label></>:<>
        <img src="/models/Core_Formwork_Preview.webp" alt="Core formwork with the placing boom deployed" loading="lazy" className="w-full rounded"/>
        <p>12 × 8 m clear opening. Place the assembly at its first working level.</p></>}
      <button className="rounded border px-2 py-1" onClick={()=>void place()}>{busy?'Preparing rig…':selection?'Preview on selected core':'Place core rig'}</button>
      {!selection&&<a className="ml-3 underline" href={coreModelUrl} download>Download GLB</a>}
    </fieldset>{error&&<p role="alert">{error}</p>}
  </details>
}

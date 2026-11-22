import { useEffect, useRef, useState } from 'react'
import { importSiteAsset, type SiteAsset, type useSiteAssetInventory } from './siteAssets'
import { siteError } from './siteScene'

export const coreModelFile='Prosota_Core_Formwork_with_Boom.glb'
export const coreModelUrl='/models/'+coreModelFile

export function CoreRigTemplate({projectId,inventory,onPlace}:{
  projectId:string;inventory:ReturnType<typeof useSiteAssetInventory>;onPlace(asset:SiteAsset):void
}) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  const pending=useRef(false), alive=useRef(true)
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false}},[])
  async function place(){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    try {
      const response=await fetch(coreModelUrl)
      if(!response.ok)throw Error('Could not load the included core rig.')
      const blob=await response.blob()
      if(!alive.current)return
      let asset=inventory.assets.find(a=>a.name===coreModelFile && a.size_bytes===blob.size)
      if(!asset){
        asset=await importSiteAsset(projectId,new File([blob],coreModelFile,{type:'model/gltf-binary'}),'Equipment',()=>{})
        if(!alive.current)return
        const added=asset;inventory.setAssets(old=>[...old,added])
      }
      onPlace(asset)
    }catch(e){if(alive.current)setError(siteError(e))}
    finally{pending.current=false;if(alive.current)setBusy(false)}
  }
  return <details className="rounded border p-2"><summary>Core formwork with placing boom</summary>
    <img src="/models/Core_Formwork_Preview.webp" alt="Core formwork with the placing boom deployed" loading="lazy" className="mt-2 w-full rounded"/>
    <p className="my-2">12 × 8 m clear opening. Place the assembly at its first working level.</p>
    <button className="rounded border px-2 py-1" disabled={busy} onClick={()=>void place()}>{busy?'Preparing rig…':'Place core rig'}</button>
    <a className="ml-3 underline" href={coreModelUrl} download>Download GLB</a>
    {error&&<p role="alert">{error}</p>}
  </details>
}

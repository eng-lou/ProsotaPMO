import { useEffect, useRef, useState } from 'react'
import { api, downloadLargeBlob } from '@/lib/api'
import { importSiteAsset } from './siteAssets'
import { addAssetMotion } from './importAssetMotion'
import type { SiteItem } from './siteScene'

export function ImportMotionControl({item,projectId,disabled,onApply}:{item:SiteItem;projectId:string;disabled:boolean;onApply(patch:Partial<SiteItem>):Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Awaited<ReturnType<typeof addAssetMotion>>|null>(null)
  const generation=useRef(0)
  const applyRef=useRef(onApply);applyRef.current=onApply
  useEffect(()=>()=>{generation.current++},[item.asset_id])
  async function read(file:File) {
    const version=++generation.current;setBusy(true);setError('');setResult(null)
    try {
      const {data}=await api.get<{download_url:string}>(`/api/v1/site-assets/${item.asset_id}/download`,{params:{direct:true}})
      const bytes=await (await downloadLargeBlob(data.download_url,true)).arrayBuffer()
      const next=await addAssetMotion(bytes,file)
      if(version===generation.current)setResult(next)
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Could not read motion.')}
    finally{if(version===generation.current)setBusy(false)}
  }
  async function apply() {
    if(!result)return
    const version=++generation.current;setBusy(true);setError('')
    try {
      const asset=await importSiteAsset(projectId,result.file,'People',()=>{},`${item.name} · motion`)
      window.dispatchEvent(new Event('prosota-site-assets-changed'))
      if(version!==generation.current)return
      await applyRef.current({asset_id:asset.id,animation_clip:result.firstClip,animation_playing:true})
      setResult(null)
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Could not save motion.')}
    finally{if(version===generation.current)setBusy(false)}
  }
  return <div className="space-y-2">
    <label className="block">Import motion FBX<input aria-label="Import motion FBX" type="file" accept=".fbx" disabled={disabled||busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void read(f)}}/></label>
    <p className="text-xs">Use motion exported for the same skeleton and scale. Your character, materials and placement are retained. Different rigs need retargeting first.</p>
    <p className="text-xs">If an older character import fails the skeleton check, reimport its original FBX to retain the full skeleton metadata.</p>
    {busy&&<p>Preparing motion…</p>}
    {result&&<div><p>{result.names.length} compatible clip(s): {result.names.join(', ')}</p><button disabled={disabled||busy} onClick={()=>void apply()}>Save and apply motion</button><button disabled={busy} onClick={()=>setResult(null)}>Cancel</button></div>}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
  </div>
}

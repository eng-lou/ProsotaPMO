import { useEffect, useRef, useState } from 'react'
import { importSiteAsset, downloadSiteAssetBytes } from './siteAssets'
import { addAssetMotions } from './importAssetMotion'
import type { SiteItem } from './siteScene'

export function ImportMotionControl({item,projectId,disabled,onApply}:{item:SiteItem;projectId:string;disabled:boolean;onApply(patch:Partial<SiteItem>):Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[result,setResult]=useState<Awaited<ReturnType<typeof addAssetMotions>>|null>(null)
  const generation=useRef(0)
  const applyRef=useRef(onApply);applyRef.current=onApply
  useEffect(()=>()=>{generation.current++},[item.asset_id])
  async function read(files:File[]) {
    const version=++generation.current;setBusy(true);setError('');setResult(null)
    try {
      const bytes=await downloadSiteAssetBytes(item.asset_id!)
      const next=await addAssetMotions(bytes,files,(done,total)=>{if(version===generation.current)setProgress(`${done} / ${total}`)})
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
      await applyRef.current({asset_id:asset.id,animation_clip:item.motion_actions?.length?(item.animation_clip??0):result.firstClip,animation_playing:true})
      setResult(null)
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Could not save motion.')}
    finally{if(version===generation.current)setBusy(false)}
  }
  return <div className="space-y-2">
    <label className="block">Import motion FBX (one or several)<input aria-label="Import motion FBX" type="file" accept=".fbx" multiple disabled={disabled||busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void read(files)}}/></label>
    <p className="text-xs">Character Creator / ActorCore body motions adapt to compatible CC workers automatically. Your character, materials and placement are retained. Unrelated skeletons need a matching rig.</p>
    <p className="text-xs">If an older character import fails the skeleton check, reimport its original FBX to retain the full skeleton metadata.</p>
    {busy&&<p>Preparing motion… {progress}</p>}
    {result&&<div className="space-y-2"><p>{result.names.length} compatible clip(s): {result.names.join(', ')}</p>{result.notices.map(n=><p key={n}>{n}</p>)}<div className="flex flex-wrap gap-2"><button className="border rounded px-2 py-1" disabled={disabled||busy} onClick={()=>void apply()}>Save and apply motion</button><button className="border rounded px-2 py-1" disabled={busy} onClick={()=>setResult(null)}>Cancel</button></div></div>}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
  </div>
}

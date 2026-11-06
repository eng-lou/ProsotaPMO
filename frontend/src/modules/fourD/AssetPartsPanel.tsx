import { useEffect, useState } from 'react'
import { inspectAssetParts, splitSiteAsset, type PartCandidate } from './assetParts'
import { loadSiteAsset } from './siteAssets'
import { siteError, type SiteItem, type useSiteScene } from './siteScene'

export function AssetPartsPanel({item,state,blocked}:{item:SiteItem;state:ReturnType<typeof useSiteScene>;blocked?:string}){
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false)
  const [mode,setMode]=useState<'groups'|'meshes'>('groups'),[parts,setParts]=useState<PartCandidate[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    let active=true;setParts([]);setError('')
    if(!open||!item.asset_id){setLoading(false);return}
    setLoading(true)
    void loadSiteAsset(item.asset_id).then(root=>{if(active)setParts(inspectAssetParts(root,mode))}).catch(e=>{if(active)setError(siteError(e))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[item.asset_id,mode,open])
  async function extract(){
    setBusy(true);setError('')
    try{const next=splitSiteAsset(item,await loadSiteAsset(item.asset_id!),mode)
      await state.save(state.scene.items.flatMap(i=>i.id===item.id?next:[i]),`Extract ${next.length} parts from ${item.name}`);state.setSelected(next[0].id)
    }catch(e){setError(siteError(e))}finally{setBusy(false)}
  }
  return <details className="border rounded p-2 space-y-2" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary className="cursor-pointer">Inspect construction parts</summary>
    {open&&<>
    <strong className="block break-words">{item.name}</strong>
    <p>Assembly → individual objects → linked activities. Parts keep their current layout, names and authored materials. Each can have its own profile, transform and Simulator state.</p>
    <label>Split at<select className="w-full border rounded p-1 bg-transparent" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="groups">Source files / top-level groups</option><option value="meshes">Individual meshes</option></select></label>
    {loading?<p role="status">Inspecting parts…</p>:<ol className="max-h-40 overflow-auto list-decimal pl-5">{parts.map(p=><li key={p.path.join('.')}>{p.name} · {p.meshes} mesh{p.meshes===1?'':'es'}</li>)}</ol>}
    <p>Extracting replaces this placement with {parts.length} independent objects. The library asset stays available. Undo restores the original placement.</p>
    {blocked&&<p className="text-amber-600">{blocked}</p>}{error&&<p role="alert" className="text-red-600">{error}</p>}
    <button className="border rounded p-2 disabled:opacity-40" disabled={!!blocked||busy||loading||state.busy||item.locked||parts.length<2} onClick={()=>void extract()}>{busy?'Extracting…':`Extract ${parts.length} independent parts`}</button>
    </>}
  </details>
}

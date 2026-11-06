import { useState } from 'react'
import type { SiteAsset } from './siteAssets'
import type { useSiteScene } from './siteScene'
import { replaceSiteObjects, type ReplacementSelection } from './siteReplacement'
const button='rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
export function ReplacementPanel({state,assets,selection}:{state:ReturnType<typeof useSiteScene>;assets:SiteAsset[];selection:ReplacementSelection}){
  const [assetId,setAssetId]=useState(''),[all,setAll]=useState(false),[fit,setFit]=useState(true),[message,setMessage]=useState('')
  const asset=assets.find(a=>a.id===assetId)
  let proposal:ReturnType<typeof replaceSiteObjects>|undefined,error=''
  try{if(asset)proposal=replaceSiteObjects(state.scene.items,selection,asset,all,fit)}catch(e){error=(e as Error).message}
  return <details className="border rounded p-2 space-y-2 dark:border-prosota-line"><summary>Replace object / instances</summary>
    <p>Choose an imported asset. Position and orientation are retained. Motion, animation and previous equipment rigs are not transferred.</p>
    <label>Replacement asset<select aria-label="Replacement asset" className="w-full rounded border p-1.5 dark:bg-prosota-panel2" value={assetId} onChange={e=>{setAssetId(e.target.value);setMessage('')}}><option value="">Choose from library…</option>{assets.map(a=><option key={a.id} value={a.id}>{a.category} · {a.name}</option>)}</select></label>
    <label className="block"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> Replace all matching instances in this project</label>
    <p>Matching means the same imported asset, or the same generated type. Reconstruction trees match the built-in context tree until replaced.</p>
    <label className="block"><input type="checkbox" checked={fit} onChange={e=>setFit(e.target.checked)}/> Fit existing size (trees / generated instances keep height)</label>
    {proposal&&<p>{proposal.count} replacement(s) · {proposal.locked} locked instance(s) skipped</p>}
    {error&&<p role="alert">{error}</p>}
    <button className={button} disabled={!proposal?.count||state.busy||!!state.draft} onClick={async()=>{if(!proposal)return;try{await state.save(proposal.items,'Replace '+proposal.count+' objects');setMessage('Replaced. Undo restores the original objects, motion and rig state.')}catch{/* scene error */}}}>Replace {proposal?.count||''}</button>
    {state.draft&&<p>Save or discard current edits before replacing.</p>}{message&&<p role="status">{message}</p>}
  </details>
}

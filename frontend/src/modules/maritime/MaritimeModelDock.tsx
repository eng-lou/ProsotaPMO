import { useEffect, useState, type ReactNode } from 'react'
import { AttemptControls } from './AttemptControls'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAiFourDBridge } from '@/lib/aiFourDBridge'
import { errorMessage, maritimeRoot as root, useMaritime, type ElementRef } from './workspaceData'

export function MaritimeModelDock({children}: {children:ReactNode}) {
  const {plan,edit,busy,setError,attempt,selectedAssetId:id,selectAsset:setId,setPortRun}=useMaritime(), bridge=useAiFourDBridge(), navigate=useNavigate()
  const [message,setMessage]=useState('')
  const location=useLocation()
  useEffect(()=>{
    if(location.pathname!==`${root}/models`)return
    const linkedId=new URLSearchParams(location.search).get('asset')
    if(linkedId&&plan?.assets.some(a=>a.id===linkedId))setId(linkedId)
  },[location.pathname,location.search,plan,setId])
  const asset=plan?.assets.find(a=>a.id===id)??plan?.assets[0]
  const select=async(isolate=false)=>{
    setMessage('')
    try{const fn=bridge?.current.select_maritime_asset;if(!fn||!asset)throw new Error('Wait for the model viewer to load.');const r=await fn({elements:asset.elements,isolate}) as {error?:string;selected?:number};if(r.error)throw new Error(r.error);setMessage(`${r.selected} elements selected. Use Frame Selected to frame them.`)}catch(e){setError(errorMessage(e))}
  }
  const link=async()=>{
    try{const fn=bridge?.current.get_selected_elements;if(!fn||!asset)throw new Error('Select geometry in the viewer first.');const r=await fn({}) as {elements?:ElementRef[]};if(!r.elements?.length)throw new Error('Select geometry in the viewer first.');edit(p=>({...p,assets:p.assets.map(a=>a.id===asset.id?{...a,placement:null,elements:[...new Map([...a.elements,...r.elements!].map(e=>[`${e.source_kind}:${e.element_ref}`,e])).values()]}:a)}));setPortRun(null);setMessage('Geometry linked to the port view. Save changes to keep this mapping.')}catch(e){setError(errorMessage(e))}
  }
  return <div className="mw-model-stage"><div className="mw-model-view">{children}</div><aside className="mw-model-dock"><p className="mw-kicker">Shared asset register</p>{attempt&&<AttemptControls onComplete={r=>navigate(`${root}/debrief?run=${r.id}`)}/>}<Link className="mw-link" to={`${root}/operations`}>← Port environment</Link><h2>Models & Assets</h2><select aria-label="Inspect Maritime asset" value={asset?.id??''} onChange={e=>setId(e.target.value)}><option value="">Select asset…</option>{plan?.assets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>{asset?<><h3>{asset.name}</h3><p className="mw-muted">{asset.kind} · {asset.elements.length} linked elements</p><div className="mw-run-list mt-3"><button disabled={busy||!asset.elements.length} onClick={()=>select()}>Select in model</button><button disabled={busy||!asset.elements.length} onClick={()=>select(true)}>Isolate asset</button><button disabled={busy||!!attempt} onClick={link}>Link selected geometry</button></div><p className="mw-muted mt-3">{asset.notes}</p>{message&&<p className="mw-notice" role="status">{message}</p>}</>:<p className="mw-muted">Create an asset, import a model and select geometry to connect them.</p>}<div className="mw-run-list mt-4"><Link className="mw-link" to={`${root}/equipment`}>Edit asset properties</Link><Link className="mw-link" to={`${root}/schedule`}>Schedule & assignments</Link><Link className="mw-link" to={`${root}/scenarios`}>Operational scenarios</Link><Link className="mw-link" to={`${root}/exercises`}>Safety exercises</Link></div></aside></div>
}

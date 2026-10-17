import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { AssetEditor, CallEditor, ScenarioEditor, WorkOrderEditor, SafetyWorkspace } from './WorkspaceEditors'
import { RunResults } from './RunResults'
import { errorMessage, maritimeRoot as root, newAsset, starterPlan, useMaritime, type AssetKind, type SavedRun } from './workspaceData'

import { Field, NumberInput, Empty } from './WorkspaceFields'

export function MaritimeProject() {
  const {pathname,search} = useLocation(), navigate = useNavigate(), {selectedProject} = useProject()
  const {plan,dirty,version,busy,error,setError,edit,endpoint,runs,run,selectedAssetId:assetId,selectAsset:setAssetId} = useMaritime()
  const section = pathname.split('/').pop() || 'project'
  const [selectedRun,setSelectedRun] = useState<SavedRun | null>(null)
  const [runLoading,setRunLoading] = useState(false)
  useEffect(() => {
    const id = new URLSearchParams(search).get('run')
    if (!id || !['results','debrief','reports'].includes(section)) return
    let active = true
    setRunLoading(true)
    api.get<SavedRun>(`${endpoint}/runs/${id}`).then(r=>{if(active)setSelectedRun(r.data)})
      .catch(e=>{if(active)setError(errorMessage(e))}).finally(()=>{if(active)setRunLoading(false)})
    return () => {active=false}
  }, [search,section,endpoint])
  useEffect(() => {if(!plan?.assets.some(a=>a.id === assetId)) setAssetId(plan?.assets[0]?.id ?? '')},[plan?.assets,assetId])
  useEffect(() => {if ((section === 'debrief' && selectedRun?.kind !== 'safety') || (section === 'results' && selectedRun?.kind !== 'operations')) setSelectedRun(null)}, [section, selectedRun?.kind])
  if(!plan) return null
  const openRun = async (id:string) => {
    setRunLoading(true); setError(null)
    try {setSelectedRun((await api.get<SavedRun>(`${endpoint}/runs/${id}`)).data)}catch(e){setSelectedRun(null);setError(errorMessage(e))}finally{setRunLoading(false)}
  }
  const execute = async (id?:string) => {const result = await run(id); if(result){setSelectedRun(result);navigate(`${root}/results`)}}
  const assetSection = ['equipment','berths','yard'].includes(section)
  const kinds: AssetKind[] = section === 'berths' ? ['berth'] : section === 'yard' ? ['yard','gate','truck'] : ['crane','truck','vessel','infrastructure','berth','yard','gate']
  const visibleAssets = plan.assets.filter(a=>kinds.includes(a.kind))
  const selectedAsset = visibleAssets.find(a=>a.id === assetId) ?? visibleAssets[0]
  return <div className="mw-content">
    {section === 'project' && <><p className="mw-kicker">Project workspace</p><h1>{selectedProject?.name}</h1><p className="mw-muted">Models, operations, safety exercises and delivery planning share this project.</p>
      <div className="mw-metrics">{[['Assets',plan.assets.length],['Vessel calls',plan.calls.length],['Scenarios',plan.scenarios.length],['Saved runs',runs.length]].map(([label,count])=><div className="mw-metric" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
      <div className="mw-grid"><section className="mw-card"><h2>Working plan settings</h2><fieldset disabled={busy} className="mw-form"><Field label="Currency"><select value={plan.currency} onChange={e=>edit(p=>({...p,currency:e.target.value}))}>{['GBP','USD','EUR','AED','SGD','AUD'].map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Data source"><select value={plan.source} onChange={e=>edit(p=>({...p,source:e.target.value as typeof p.source}))}><option value="user_entered">User entered</option><option value="synthetic">Synthetic example</option></select></Field><Field label="Simulation start (UTC)"><input type="datetime-local" value={plan.start_at.slice(0,16)} onChange={e=>e.target.value && edit(p=>({...p,start_at:e.target.value+':00Z'}))}/></Field><Field label="Calculation horizon (hours)"><NumberInput value={plan.horizon_hours} min={1} max={336} step="1" onChange={n=>edit(p=>({...p,horizon_hours:n}))}/></Field></fieldset><p className="mw-muted mt-3">The operational flow model uses elapsed hours. Construction scheduling retains its own working calendars.</p></section>
      <section className="mw-card"><h2>Build your terminal</h2><p>Import models in Models & Assets, register equipment and locations, then assign them to vessel calls or delivery activities.</p><div className="mw-toolbar"><Link className="mw-link" to={`${root}/models`}>Import models</Link><Link className="mw-link" to={`${root}/equipment`}>Create assets</Link><Link className="mw-link" to={`${root}/schedule`}>Open schedule</Link></div>{plan.assets.length===0 && <><button disabled={busy} onClick={()=>edit(()=>starterPlan())}>Load editable terminal starter</button><p className="mw-muted mt-2">Adds synthetic asset records, one call, one outage scenario and a lifting exercise. Import your geometry separately.</p></>}</section>
      <section className="mw-card mw-wide"><h2>Available in this workspace</h2><p>Existing model import, rigging, paths, 4D sequencing, schedules, resources, costs, risks, issues and dashboards are available through the shared Prosota modules. Operational plans, scenario runs and exercise attempts are stored with this project.</p><div className="mw-notice">Operational flow is a deterministic capacity model. Exercises currently record guided actions against linked assets; automatic spatial hazard detection and equipment-stop simulation are not yet implemented.</div></section></div></>}

    {section === 'operations' && <><p className="mw-kicker">Port operations</p><h1>Terminal working plan</h1><p className="mw-muted">{plan.source === 'synthetic' ? 'Synthetic inputs' : 'User-entered inputs'} · Start {new Date(plan.start_at).toLocaleString('en-GB',{timeZone:'UTC'})} UTC · {plan.horizon_hours} hour horizon</p><div className="mw-toolbar"><button className="primary" disabled={busy || dirty || !version} onClick={()=>execute()}>Run working plan</button><Link className="mw-link" to={`${root}/models`}>Open model environment</Link><Link className="mw-link" to={`${root}/scenarios`}>Compare an alternative</Link></div>{dirty && <div className="mw-notice">Save changes to calculate this plan.</div>}<div className="mw-grid">{[['calls','Vessel calls',`${plan.calls.length} calls with editable workload, arrival and assignments`],['berths','Berths','Exclusive occupancy and availability'],['equipment','Equipment','Crane productivity, truck capacity and planned maintenance'],['yard','Yard & gates','Finite storage and outbound gate processing']].map(([path,label,description])=><Link className="mw-card" key={path} to={`${root}/${path}`}><h2>{label}</h2><p>{description}</p></Link>)}</div><section className="mw-card mt-4"><h2>Capacity chain</h2><p>Vessel → available berth and cranes → terminal trucks → yard storage → outbound gates</p><p className="mw-muted mt-2">Workload is measured in cargo moves. Truck rates include travel. Routes, inbound gate queues, tides and physical collisions are not yet simulated.</p></section></>}

    {assetSection && <><h1>{section === 'yard' ? 'Yard & gates' : section === 'berths' ? 'Berths' : 'Equipment & assets'}</h1><div className="mw-toolbar"><button disabled={busy} onClick={()=>{const a=newAsset(kinds[0]);edit(p=>({...p,assets:[...p.assets,a]}));setAssetId(a.id)}}>Add {section === 'berths' ? 'berth' : 'asset'}</button><Link className="mw-link" to={`${root}/models`}>Open model & link geometry</Link></div><div className="mw-grid"><section className="mw-card"><div className="mw-table-wrap"><table className="mw-table"><thead><tr><th>Asset</th><th>Type</th><th>Linked geometry</th></tr></thead><tbody>{visibleAssets.map(a=><tr className={a.id===selectedAsset?.id?'selected':''} key={a.id}><td><button onClick={()=>setAssetId(a.id)}>{a.name}</button></td><td>{a.kind}</td><td>{a.elements.length || '—'}</td></tr>)}</tbody></table></div>{!visibleAssets.length && <Empty>Create an asset or load the editable starter from Project.</Empty>}</section>{selectedAsset && <AssetEditor key={selectedAsset.id} asset={selectedAsset}/>}</div></>}
    {section === 'calls' && <><h1>Vessel calls</h1><CallEditor/></>}
    {section === 'scenarios' && <><h1>Scenarios</h1><p className="mw-muted">Alternatives use the saved working plan. Every run retains its inputs and results.</p><ScenarioEditor onRun={execute}/><section className="mw-card mt-4"><h2>Planned maintenance</h2><WorkOrderEditor/></section></>}
    {['exercises','setup','training'].includes(section) && <SafetyWorkspace section={section} onComplete={r=>{setSelectedRun(r);navigate(`${root}/debrief`)}}/>}
    {['results','debrief','reports'].includes(section) && <><h1>{section==='reports'?'Reports':section==='debrief'?'Exercise debrief':'Run results'}</h1><p className="mw-muted">Select a saved run. Figures and exports use its input snapshot.</p>{section==='reports' && <div className="mw-toolbar"><Link className="mw-link" to={`${root}/dashboard`}>Delivery dashboards & reports</Link></div>}<div className="mw-grid"><section className="mw-card"><h2>Saved runs</h2><div className="mw-run-list">{runs.filter(r=>section==='reports'||r.kind===(section==='debrief'?'safety':'operations')).map(r=><button className={r.id===selectedRun?.id?'selected':''} key={r.id} disabled={runLoading} onClick={()=>openRun(r.id)}><span>{r.name}<small className="block mw-muted">{r.kind} · v{r.version}</small></span><span>{new Date(r.created_at).toLocaleString('en-GB')}</span></button>)}</div>{!runs.some(r=>section==='reports'||r.kind===(section==='debrief'?'safety':'operations')) && <Empty>No saved runs yet. Save a plan and run a scenario or exercise.</Empty>}</section><section className="mw-card"><h2>Traceable outputs</h2><p>Operations reports contain the working-plan comparison, equipment utilisation, cargo flow and calculation assumptions. Exercise reports contain the configured criteria and recorded actions.</p><p className="mw-muted mt-3">Delivery reports remain in the existing Reporting & Controls module.</p></section>{runLoading ? <Empty>Loading saved results…</Empty> : selectedRun && <div className="mw-wide"><RunResults run={selectedRun} stale={selectedRun.version!==version || dirty}/></div>}</div></>}
    {error && <span className="sr-only" role="status">An error is shown above.</span>}
  </div>
}

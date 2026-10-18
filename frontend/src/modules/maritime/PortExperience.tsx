import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { OperationalPortScene, type CameraView } from './OperationalPortScene'
import { assetTrack, flowAt, portLayout, readTrack, runEvents, statusLabel } from './portPlayback'
import { errorMessage, maritimeRoot as root, starterPlan, useMaritime, type AssetKind, type OperationRun } from './workspaceData'
import { money } from './WorkspaceFields'
import './portExperience.css'

const kinds:AssetKind[]=['vessel','berth','crane','truck','yard','gate','infrastructure']
const kindLabel:Record<AssetKind,string>={vessel:'Vessels',berth:'Berths',crane:'Cranes',truck:'Truck fleets',yard:'Yard blocks',gate:'Gates',infrastructure:'Infrastructure'}
const fmt=(n:number)=>n.toLocaleString('en-GB',{maximumFractionDigits:1})
const hours=(n:number|null)=>n===null?'Not reached':`${n.toFixed(2)} h`

/** The project scene is a view of editable asset records and immutable run inputs. */
export function PortExperience({training=false}:{training?:boolean}){
  const {selectedProject}=useProject(),navigate=useNavigate()
  const {plan,version,dirty,busy,edit,run,runs,endpoint,setError,selectedAssetId,selectAsset,
    portRun,setPortRun,portHour,setPortHour,attempt,attemptSaving,startAttempt,recordAction,finishAttempt,discardAttempt}=useMaritime()
  const [scenario,setScenario]=useState(portRun?.inputs.scenario_id??''),[camera,setCamera]=useState<CameraView>('overview')
  const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[focus,setFocus]=useState(0),[compare,setCompare]=useState(false)
  const [labels,setLabels]=useState(true),[hiddenKinds,setHiddenKinds]=useState<string[]>([]),[search,setSearch]=useState('')
  const [inspector,setInspector]=useState(true),[directory,setDirectory]=useState(true),[immersive,setImmersive]=useState(false),[arrange,setArrange]=useState(false)
  const [loadingRun,setLoadingRun]=useState(false),[outage,setOutage]=useState(false),[outageStart,setOutageStart]=useState(8),[outageDuration,setOutageDuration]=useState(6)
  const [exerciseId,setExerciseId]=useState(''),[seconds,setSeconds]=useState(0),[tour,setTour]=useState<number|null>(null)
  const request=useRef(0),time=useRef(portHour),stage=useRef<HTMLDivElement>(null)
  const current=training?null:portRun,scenePlan=current?.inputs.plan??plan!
  const result=current?.results.scenario??null,end=result?.elapsed_hours??plan!.horizon_hours
  const hour=training?0:Math.min(portHour,end),stale=!!current&&(current.version!==version||dirty)
  const asset=scenePlan.assets.find(a=>a.id===selectedAssetId),layout=useMemo(()=>portLayout(scenePlan),[scenePlan])
  const state=asset?assetTrack(asset,scenePlan,result,hour):null,flow=flowAt(result,scenePlan,hour)
  const events=useMemo(()=>current?runEvents(current):[],[current])
  const exercise=attempt?.exercise??plan!.exercises.find(e=>e.id===exerciseId)??plan!.exercises[0]
  const selectedCalls=asset?scenePlan.calls.filter(c=>c.vessel_id===asset.id||c.berth_id===asset.id||c.crane_ids.includes(asset.id)):[]
  const activeCall=state?.call_id?result?.replay?.tracks[`call:${state.call_id}`]:null
  const causal=activeCall?readTrack(activeCall,hour):state
  const pick=(id:string)=>{selectAsset(id);setInspector(true);setOutage(false)}
  const seek=(t:number)=>{setPlaying(false);setPortHour(Math.max(0,Math.min(end,t)))}
  const focusAsset=(id:string)=>{pick(id);setHiddenKinds([]);setCamera('follow');setFocus(v=>v+1)}
  const loadRun=async(id:string)=>{
    const token=++request.current;setLoadingRun(true);setPlaying(false)
    try{const r=await api.get<OperationRun>(`${endpoint}/runs/${id}`);if(request.current===token&&r.data.kind==='operations'){setPortRun(r.data);setPortHour(0);setScenario(r.data.inputs.scenario_id??'');setArrange(false)}}catch(e){if(request.current===token)setError(errorMessage(e))}finally{if(request.current===token)setLoadingRun(false)}
  }
  useEffect(()=>()=>{request.current++},[])
  useEffect(()=>{time.current=portHour},[portHour])
  useEffect(()=>{
    if(!playing)return
    let last=performance.now(),id=0
    const tick=(now:number)=>{if(now-last>=50){const next=Math.min(end,time.current+Math.min(now-last,100)/1000*speed*.35);last=now;time.current=next;setPortHour(next);if(next>=end){setPlaying(false);return}}id=requestAnimationFrame(tick)}
    id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id)
  },[playing,end,speed,setPortHour])
  useEffect(()=>{if(!attempt)return;const update=()=>setSeconds(Math.max(0,(Date.now()-attempt.startedAt)/1000));update();const id=window.setInterval(update,100);return()=>clearInterval(id)},[attempt?.startedAt])
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setImmersive(false);setArranging(false)}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[])
  const setArranging=(value:boolean)=>{setArrange(value);setPlaying(false);if(value){setPortRun(null);setCompare(false);setCamera('overview')}}
  const execute=async(id=scenario)=>{
    setPlaying(false);setTour(null);const r=await run(id||undefined,true)
    if(r?.kind==='operations'){setPortRun(r);setPortHour(0);setScenario(r.inputs.scenario_id??'');setArrange(false);return r}
    return null
  }
  const tourStep=(step:number,r:OperationRun)=>{
    setTour(step);setPlaying(false);setInspector(false);setDirectory(false)
    const c=r.inputs.plan.calls[0],d=r.inputs.plan.scenarios.find(s=>s.id===r.inputs.scenario_id)?.downtime[0]
    if(step===0&&c){selectAsset(c.vessel_id);setCamera('follow');setPortHour(c.arrival_hour);setCompare(false)}
    if(step===1){selectAsset(d?.asset_id??c?.crane_ids[0]??'');setCamera('follow');setPortHour(Math.min(r.results.scenario.elapsed_hours,(d?.start_hour??c?.arrival_hour??0)+.2));setCompare(false)}
    if(step===2){setCamera('overview');setCompare(true);setPortHour(Math.min(r.results.scenario.elapsed_hours,r.results.baseline.vessel_completion_hour??r.results.baseline.elapsed_hours))}
    setFocus(n=>n+1)
  }
  const tourRun=async()=>{const r=await execute(scenario||plan!.scenarios[0]?.id||'');if(r)tourStep(0,r)}
  const createOutage=()=>{
    if(!asset)return
    const id=crypto.randomUUID(),name=`${asset.name} outage`.slice(0,120)
    edit(p=>({...p,scenarios:[...p.scenarios,{id,name,downtime:[{asset_id:asset.id,start_hour:outageStart,duration_hours:outageDuration}]}]}))
    setScenario(id);setPortRun(null);setCompare(false);setOutage(false)
  }
  const start=()=>{if(exercise){startAttempt(exercise);focusAsset(exercise.asset_id)}}
  const visibleAssets=scenePlan.assets.filter(a=>!hiddenKinds.includes(a.kind)&&a.name.toLowerCase().includes(search.toLowerCase()))
  const canRun=plan!.calls.length>0&&['yard','truck','gate'].every(kind=>plan!.assets.some(a=>a.kind===kind))
  const stamp=new Date(new Date(scenePlan.start_at).getTime()+hour*3600000).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})

  return <div ref={stage} className={`port-experience ${immersive?'is-immersive':''}`} aria-label={training?'Safety exercise environment':'Port environment'}>
    <h1 className={immersive?'port-focus-title':'sr-only'}>{selectedProject?.name} · {training?'Safety exercise':'Port view'}</h1>
    <div className="port-commandbar">
      {training?<><select aria-label="Scene exercise" disabled={!!attempt} value={exercise?.id??''} onChange={e=>setExerciseId(e.target.value)}>{plan!.exercises.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select><Link to={`${root}/setup`}>Edit exercise</Link>{!attempt&&<button className="port-primary" disabled={!exercise||busy||dirty||!version} onClick={start}>Start exercise</button>}{dirty&&<span>Save your changes before training.</span>}</>:
        <><select aria-label="Port scenario" value={scenario} disabled={busy} onChange={e=>setScenario(e.target.value)}><option value="">Working plan</option>{plan!.scenarios.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select>
          <button className="port-primary" disabled={busy||!canRun||!!attempt} onClick={()=>void execute()}>{busy?'Calculating…':dirty||!version?'Save & simulate':'Run simulation'}</button>
          <button disabled={busy||!canRun||!!attempt} onClick={()=>void tourRun()}>Follow the story</button>
          <select aria-label="Open port replay" value={current?.id??''} disabled={loadingRun||busy} onChange={e=>e.target.value?void loadRun(e.target.value):(setPortRun(null),setPlaying(false),setCompare(false))}><option value="">Working layout</option>{runs.filter(r=>r.kind==='operations').map(r=><option value={r.id} key={r.id}>{r.name} · v{r.version}</option>)}</select>
          {current&&<button aria-pressed={compare} onClick={()=>setCompare(v=>!v)}>Compare baseline</button>}
        </>}
      <span className="port-command-status">{loadingRun?'Opening replay…':stale?'Saved replay · working plan changed':current?`Saved run · v${current.version}`:scenePlan.source==='synthetic'?'Synthetic terminal':'Working layout'}</span>
      <div className="port-command-actions"><Link to={`${root}/models`}>Import / open models</Link><button onClick={()=>{setImmersive(v=>!v);setTimeout(()=>window.dispatchEvent(new Event('resize')),0)}}>{immersive?'Exit focus':'Focus view'}</button></div>
    </div>
    <div className="port-stage">
      <div className={`port-canvases ${compare&&!training?'compare':''}`}>
        {compare&&!training&&current&&<div className="port-canvas"><span className="port-view-tag">Working plan</span><OperationalPortScene plan={scenePlan} result={current.results.baseline} hour={hour} selected={selectedAssetId} select={pick} camera={camera} focus={focus} labels={false} hiddenKinds={hiddenKinds}/></div>}
        <div className="port-canvas"><span className="port-view-tag">{training?'Exercise':compare?'Alternative':current?.name??'Terminal layout'}</span><OperationalPortScene plan={scenePlan} result={result} hour={hour} selected={selectedAssetId} select={pick} camera={camera} focus={focus} labels={labels} hiddenKinds={hiddenKinds} arrange={arrange}
          place={(x,z)=>{if(asset&&!busy)edit(p=>({...p,assets:p.assets.map(a=>a.id===asset.id?{...a,placement:{x,z,heading:layout[a.id].heading}}:a)}))}}
          exercise={attempt?{exercise:attempt.exercise,actions:attempt.actions,seconds,record:recordAction,disabled:attemptSaving}:undefined}/></div>
      </div>
      <div className="port-view-tools"><button aria-pressed={directory} onClick={()=>setDirectory(v=>!v)}>Assets</button><select aria-label="Port camera" value={camera} onChange={e=>{setCamera(e.target.value as CameraView);setFocus(v=>v+1)}}><option value="overview">Overview</option><option value="quay">Quayside</option><option value="yard">Yard</option><option value="follow">Follow selected</option><option value="walk">Walk through</option></select><button aria-pressed={labels} onClick={()=>setLabels(v=>!v)}>Labels</button>{!training&&<button aria-pressed={arrange} disabled={busy} onClick={()=>setArranging(!arrange)}>Arrange</button>}<button aria-pressed={inspector} onClick={()=>setInspector(v=>!v)}>Details</button></div>
      {directory&&<aside className="port-directory"><input type="search" aria-label="Find port asset" placeholder="Find a vessel, crane, yard…" value={search} onChange={e=>setSearch(e.target.value)}/><div className="port-filters">{kinds.filter(k=>scenePlan.assets.some(a=>a.kind===k)).map(k=><label key={k}><input type="checkbox" checked={!hiddenKinds.includes(k)} onChange={()=>setHiddenKinds(v=>v.includes(k)?v.filter(x=>x!==k):[...v,k])}/>{kindLabel[k]}<span>{scenePlan.assets.filter(a=>a.kind===k).length}</span></label>)}</div><div className="port-asset-list">{visibleAssets.map(a=>{const s=assetTrack(a,scenePlan,result,hour);return <button key={a.id} className={selectedAssetId===a.id?'selected':''} onClick={()=>pick(a.id)} onDoubleClick={()=>focusAsset(a.id)}><i className={`port-dot ${s.state}`}/><span>{a.name}<small>{a.kind}</small></span></button>})}{!visibleAssets.length&&<p>No matching assets</p>}</div><Link to={`${root}/equipment`}>Manage asset register ↗</Link></aside>}
      {inspector&&<aside className="port-inspector">
        {attempt?<><span className="port-eyebrow">EXERCISE · {Math.floor(seconds)}s</span><h2>{attempt.exercise.name}</h2><p>{attempt.exercise.hazard}</p><p className="port-helper">Use the markers in the scene. Your actions are recorded below.</p><div className="port-action-list">{attempt.exercise.required_actions.map(a=>{const done=attempt.actions.find(x=>x.action===a);return <button key={a} disabled={!!done||attemptSaving} onClick={()=>recordAction(a)}><span>{done?'✓':'○'} {a}</span><small>{done?`${done.seconds}s`:attempt.exercise.scene_effects?.[a]?'Scene control':'Record action'}</small></button>})}</div><button className="port-primary" disabled={attemptSaving} onClick={async()=>{const r=await finishAttempt();if(r)navigate(`${root}/debrief?run=${r.id}`)}}>Finish & review</button><button disabled={attemptSaving} onClick={()=>{if(window.confirm('Discard this unsaved attempt?'))discardAttempt()}}>Discard attempt</button></>:
        asset?<><div className="port-inspector-title"><span className="port-eyebrow">{asset.kind}</span><button aria-label="Close asset details" onClick={()=>setInspector(false)}>×</button></div><h2>{asset.name}</h2><span className={`port-status ${state?.state}`}>{statusLabel[state?.state??'ready']}</span>
          <button onClick={()=>focusAsset(asset.id)}>Focus on asset</button>
          {result&&state&&<><div className="port-inspector-values"><div><small>Moves handled</small><strong>{fmt(state.value)}</strong></div><div><small>Rate now</small><strong>{fmt(state.rate)}<small> moves/h</small></strong></div></div><p className="port-reason">{causal?.state==='complete'?'Work completed':causal?.reason||'Available for assigned work'}</p></>}
          <div className="port-related">{selectedCalls.map(c=><button key={c.id} onClick={()=>focusAsset(c.vessel_id)}><small>Linked vessel call</small><span>{c.name}</span><small>{fmt(c.cargo_moves)} moves · arrival {c.arrival_hour} h</small></button>)}</div>
          {arrange&&<div className="port-inline-form"><p>Click the ground to place this asset.</p><label>Heading <input aria-label="Asset layout heading" type="number" min={-360} max={360} value={layout[asset.id].heading} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=-360&&n<=360)edit(p=>({...p,assets:p.assets.map(a=>a.id===asset.id?{...a,placement:{...layout[a.id],heading:n}}:a)}))}}/></label><button onClick={()=>edit(p=>({...p,assets:p.assets.map(a=>a.id===asset.id?{...a,placement:null}:a)}))}>Reset placement</button></div>}
          {!training&&['crane','truck','gate','berth'].includes(asset.kind)&&<button disabled={busy||!!attempt||stale||!plan!.assets.some(a=>a.id===asset.id)} onClick={()=>setOutage(v=>!v)}>Test an outage</button>}
          {outage&&<div className="port-inline-form"><label>Starts at hour<input aria-label="Outage starts at hour" type="number" min={0} max={336} value={outageStart} onChange={e=>setOutageStart(+e.target.value)}/></label><label>Duration (hours)<input aria-label="Outage duration" type="number" min={.01} max={336} step={.5} value={outageDuration} onChange={e=>setOutageDuration(+e.target.value)}/></label><button className="port-primary" disabled={outageStart<0||outageStart>336||outageDuration<=0||outageDuration>336||plan!.scenarios.length>=100} onClick={createOutage}>Create alternative</button></div>}
          <Link to={`${root}/models?asset=${asset.id}`}>{asset.elements.length?'Open linked model':'Link imported geometry'} ↗</Link>
          <Link to={`${root}/equipment`}>Edit properties ↗</Link>{asset.activity_id&&<Link to={`${root}/schedule`}>Open delivery schedule ↗</Link>}
        </>:<><span className="port-eyebrow">EXPLORE YOUR TERMINAL</span><h2>Select something in the port</h2><p>See its work, follow its cargo and test a change.</p><div className="port-empty-actions"><button onClick={()=>{const a=scenePlan.assets.find(a=>a.kind==='vessel')??scenePlan.assets[0];if(a)focusAsset(a.id)}}>Find a vessel</button><Link to={`${root}/models`}>Import your models ↗</Link></div></>}
      </aside>}
      {scenePlan.assets.length===0&&<div className="port-welcome"><span className="port-eyebrow">YOUR PORT STARTS HERE</span><h2>Enter the terminal.</h2><p>Explore an editable example, or build a layout with your own assets and models.</p><button className="port-primary" disabled={busy} onClick={()=>{edit(()=>starterPlan());setInspector(false)}}>Create editable terminal</button><Link to={`${root}/models`}>Import my models</Link></div>}
      {tour!==null&&current&&<div className="port-story"><button className="port-story-close" aria-label="Close walkthrough" onClick={()=>{setTour(null);setPlaying(false)}}>×</button><span className="port-eyebrow">FOLLOW THE CARGO · {tour+1} / 3</span><h2>{['A vessel arrives','An operation changes','Compare the consequence'][tour]}</h2><p>{tour===0?`${scenePlan.calls[0]?.name} brings ${fmt(scenePlan.calls[0]?.cargo_moves??0)} moves. Play to follow the handling.`:tour===1?`${scenePlan.assets.find(a=>a.id===selectedAssetId)?.name??'Equipment'}: ${causal?.reason||state?.reason||'watch the calculated handling state change'}.`: `Vessel finish: ${hours(current.results.baseline.vessel_completion_hour)} in the working plan, ${hours(current.results.scenario.vessel_completion_hour)} in this run.`}</p><div><button onClick={()=>{setPortHour(hour>=end?0:hour);setPlaying(p=>!p)}}>{playing?'Pause':'Watch it happen'}</button><button className="port-primary" onClick={()=>tour===2?(setTour(null),setInspector(true)):tourStep(tour+1,current)}>{tour===2?'Explore yourself':'Next'}</button></div></div>}
      <div className="port-scene-hint">{arrange?'Select an asset, then click the ground to reposition it':camera==='walk'?'Click the scene · WASD / arrows to move · drag to look · Shift to move faster':'Drag to orbit · scroll to zoom · click an asset'}<span>{training?'Interactive exercise layout':'Operational layout · travel paths illustrated'}</span></div>
      {!training&&<div className="port-playback">
        <div className="port-live-metrics"><div><small>Unloaded</small><strong data-testid="port-handled">{fmt(flow.handled)} <em>/ {fmt(scenePlan.calls.reduce((n,c)=>n+c.cargo_moves,0))}</em></strong></div><div><small>In yard · pooled</small><strong>{fmt(flow.yard)}</strong></div><div><small>Gate cleared</small><strong>{fmt(flow.cleared)}</strong></div>{current&&<><div><small>Finish impact</small><strong>{hours(current.results.completion_delay_hours)}</strong></div><div><small>Cost impact</small><strong>{money(current.results.cost_change,scenePlan.currency)}</strong></div></>}</div>
        <div className="port-transport"><button aria-label={playing?'Pause port playback':'Play port playback'} disabled={!result} onClick={()=>{if(hour>=end)setPortHour(0);setPlaying(p=>!p)}}>{playing?'Ⅱ':'▶'}</button><button aria-label="Reset port playback" disabled={!result} onClick={()=>seek(0)}>↺</button><strong>{hour.toFixed(2)} h</strong><span>{stamp} UTC</span><select aria-label="Port playback speed" value={speed} onChange={e=>setSpeed(+e.target.value)}>{[.25,1,4,16].map(s=><option key={s} value={s}>{s}×</option>)}</select><span className="port-spacer"/>{current&&<Link to={`${root}/results?run=${current.id}`}>Full results ↗</Link>}</div>
        <div className="port-scrubber"><input aria-label="Port playback time" type="range" min={0} max={end} step={.005} value={hour} disabled={!result} onChange={e=>seek(+e.target.value)}/><div className="port-events">{events.slice(0,80).map((e,i)=><button key={i} style={{left:`${e.hour/end*100}%`}} title={`${e.label} · ${e.hour.toFixed(2)} h`} aria-label={`${e.label} at ${e.hour.toFixed(2)} hours`} onClick={()=>{seek(e.hour);focusAsset(e.asset)}}/>)}</div></div>
        {current&&!result?.replay?.available&&<p className="port-helper">This saved run has totals only. Run the current plan to generate equipment playback.</p>}
      </div>}
    </div>
  </div>
}

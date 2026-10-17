import { useEffect, useMemo, useState } from 'react'
import { ProsotaLogo } from '../../components/ProsotaLogo'
import { TerminalScene } from './TerminalScene'
import { ASSETS, comparison, capacity, DEFAULT_SCENARIO, DELIVERY_PHASES, handled, normaliseScenario, safetyScore, type MaritimeMode, type Scenario } from './simulation'
import { useDelivery, timestamp, dateLabel } from './delivery'
import { DeliveryControls, DeliveryKpis, DeliveryAnalysis } from './DeliveryControls'
import { MaritimePoe } from './MaritimePoe'
import './maritime.css'
const KEY='prosota_maritime_demo_v1'
function initial():Scenario {try{return normaliseScenario(JSON.parse(sessionStorage.getItem(KEY)??'null')??DEFAULT_SCENARIO)}catch{return {...DEFAULT_SCENARIO}}}
const hours=(n:number)=>`${n.toFixed(1)} h`
export function MaritimeWorkspace(){
 const [baselineSequence,setBaselineSequence]=useState(false)
 const delivery=useDelivery()
 const deliveryOrigin=delivery.result?timestamp(delivery.result.inputs.start_date):0
 const deliveryEnd=delivery.result?(timestamp(delivery.result.scenario.finish)-deliveryOrigin)/86400000:36
 const deliveryPhases=delivery.result?DELIVERY_PHASES.map(p=>{const a=(baselineSequence?delivery.result!.baseline:delivery.result!.scenario).activities.find(a=>a.id===p.id)!;return {...p,start:(timestamp(a.start)-deliveryOrigin)/86400000,finish:(timestamp(a.finish)-deliveryOrigin)/86400000}}):[]

 const [scenario,setScenario]=useState(initial),[mode,setMode]=useState<MaritimeMode>('operate'),[hour,setHour]=useState(0),[day,setDay]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[selected,setSelected]=useState('crane-01'),[camera,setCamera]=useState('overview'),[baselineView,setBaselineView]=useState(false)
 const [identified,setIdentified]=useState(false),[response,setResponse]=useState(''),[feedback,setFeedback]=useState<number|null>(null)
 useEffect(()=>{document.title='Prosota Maritime | Terminal workspace'},[])
 useEffect(()=>{try{sessionStorage.setItem(KEY,JSON.stringify(scenario))}catch{/* Demo remains usable without storage. */}},[scenario])
 const results=useMemo(()=>comparison(scenario),[scenario]),end=Math.ceil(results.scenario+2)
 useEffect(()=>{if(!playing)return;const id=setInterval(()=>{if(mode==='deliver')setDay(v=>Math.min(deliveryEnd,v+.08*speed));else setHour(v=>Math.min(end,v+.08*speed))},100);return()=>clearInterval(id)},[playing,speed,mode,end,deliveryEnd])
 useEffect(()=>{if(mode==='deliver'?day>=deliveryEnd:hour>=end)setPlaying(false)},[day,hour,end,mode,deliveryEnd])
 const active=baselineView?{...scenario,breakdown:false}:scenario,asset=ASSETS.find(a=>a.id===selected),cargo=handled(active,hour)
 const operating=hour>=active.arrival&&cargo<active.cargo
 const assetStatus=selected==='crane-01'&&capacity(active,hour)<active.rate*2?'Unavailable':selected.startsWith('crane-')?(operating?'Handling cargo':'Available / idle'):selected==='vessel-01'?(hour<active.arrival?'Approaching berth':cargo>=active.cargo?'Cargo handling complete':'Berthed'):selected==='truck-01'?(operating?'On haul route':'Idle'):selected==='expansion-01'?(day>=deliveryEnd?'Preview complete':'Proposed works'):selected==='hazard-01'?(mode==='train'&&feedback!==100?'Worker in restricted zone':'Exercise inactive'):'Available'

 function change(p:Partial<Scenario>){setScenario(s=>normaliseScenario({...s,...p}));setPlaying(false);setHour(0)}
 function select(id:string){setSelected(id);if(mode==='train'&&id==='hazard-01'&&feedback===null)setIdentified(true)}
 function changeDelivery(v:Parameters<typeof delivery.setInputs>[0]){delivery.setInputs(v);setPlaying(false);setDay(0)}
 function reset(){setPlaying(false);setHour(0);setDay(0)}
 function report(){const payload={product:'Prosota Maritime',version:1,synthetic:true,scenario,results,delivery:delivery.result,training:{identified,response,score:feedback},assumptions:['Two independent cranes, constant handling rates, continuous operation.','No tides, yard congestion, travel bottlenecks or weather.','Training is demonstrative, not certified.','Delivery uses Prosota CPM and synthetic resource rates; no actual progress or expenditure.']};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='prosota-maritime-scenario.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <div className="maritime mt-workspace">
 <header className="mt-topbar"><a className="mt-brand" href="/maritime"><ProsotaLogo size={30}/><span>PROSOTA <b>MARITIME</b></span></a><span className="mt-tag">Prototype · Synthetic terminal</span><nav><a href="/maritime">Maritime home</a><a href="/dashboard" target="_blank" rel="noopener noreferrer">Construction workspace ↗</a></nav></header>
 <main className="mt-work-main">
 <div className="mt-heading"><div><span className="mt-eyebrow">TERMINAL 01 / SCENARIO LAB</span><h1>One terminal. Three perspectives.</h1><p>Explore operations, practise a safety decision and preview infrastructure delivery.</p></div><button onClick={report}>Download scenario report</button></div>
 <div className="mt-modebar" role="tablist" aria-label="Maritime modes">{(['operate','train','deliver'] as const).map((m,i)=><button role="tab" aria-selected={mode===m} key={m} onClick={()=>{setMode(m);setPlaying(false);setSelected(m==='deliver'?'expansion-01':'crane-01')}}><small>0{i+1}</small> {m==='operate'?'Operate':m==='train'?'Train':'Deliver'}</button>)}<span>{mode==='operate'?'Port digital twin':mode==='train'?'Safety simulation':'Infrastructure delivery'}</span></div>
 {mode==='deliver'?(delivery.result?<DeliveryKpis result={delivery.result}/>:<p role="status">{delivery.error||'Loading delivery calculations…'}</p>):<div className="mt-kpis">
 <article><span>Baseline completion</span><strong>{hours(results.baseline)}</strong><small>Two cranes available</small></article>
 <article><span>Scenario completion</span><strong>{hours(results.scenario)}</strong><small>From simulation start</small></article>
 <article><span>Completion impact</span><strong className={results.delay?'mt-amber':''}>+{hours(results.delay)}</strong><small>{results.lostMoves.toFixed(0)} moves remaining at baseline finish</small></article>
 <article><span>Handled at playback</span><strong>{Math.floor(cargo).toLocaleString()} / {scenario.cargo.toLocaleString()}</strong><small>{baselineView?'Baseline':'Scenario'} · {hour.toFixed(1)} h</small></article>
 </div>}
 <div className="mt-work-grid">
 <section className="mt-card mt-view"><div className="mt-card-head"><h2>Terminal digital twin</h2><select aria-label="Camera view" value={camera} onChange={e=>setCamera(e.target.value)}><option value="overview">Overview camera</option><option value="berth">Berth camera</option><option value="yard">Yard camera</option></select></div>
 <div className="mt-scene"><TerminalScene scenario={active} hour={hour} mode={mode} day={day} selected={selected} onSelect={select} hazard={mode==='train'&&feedback!==100} camera={camera} phases={deliveryPhases}/><span className="mt-scene-note">Orbit · Pan · Zoom · Select an asset</span></div>
 <div className="mt-playback"><button disabled={mode==='deliver'&&!delivery.result} onClick={()=>{if(!playing){if(mode==='deliver'&&day>=deliveryEnd)setDay(0);if(mode!=='deliver'&&hour>=end)setHour(0)}setPlaying(v=>!v)}}>{playing?'Pause':'Play'}</button><button onClick={reset}>Reset clock</button><input aria-label="Simulation time" type="range" min={0} max={mode==='deliver'?deliveryEnd:end} step={.05} value={mode==='deliver'?day:hour} onChange={e=>{setPlaying(false);mode==='deliver'?setDay(Number(e.target.value)):setHour(Number(e.target.value))}}/><output>{mode==='deliver'?delivery.result?dateLabel(new Date(deliveryOrigin+day*86400000).toISOString().slice(0,10)):'—':hours(hour)}</output><select aria-label="Simulation speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[1,2,4,8].map(v=><option key={v} value={v}>{v}×</option>)}</select></div>
 {mode==='deliver'&&delivery.result&&<p className="mt-footnote">{baselineSequence?'Baseline':'Scenario'} playback: {(baselineSequence?delivery.result.baseline:delivery.result.scenario).activities.filter(a=>a.id!=='ready'&&timestamp(a.finish)<=deliveryOrigin+day*86400000).length} of 5 work activities complete at this date. This is planned sequence progress, not recorded actual progress.</p>}
 <div className="mt-asset-detail"><span className="mt-eyebrow">{asset?.type??'ASSET INSPECTOR'}</span><h3>{asset?.name??'Select an asset'}</h3><p>{asset?.description??'Use the scene or asset list to explore this shared terminal.'}</p>{asset&&<><code>{asset.id}</code><span className="mt-asset-status">{assetStatus}</span></>}</div>
 </section>
 <aside className="mt-card mt-controls">
 {mode==='operate'?<><span className="mt-eyebrow">OPERATIONS SCENARIO</span><h2>What if a crane stops?</h2><p>Change the inputs and compare against the same cargo handled by two available cranes.</p>
 <label>Cargo moves<input type="number" min={1} max={100000} value={scenario.cargo} onChange={e=>change({cargo:Number(e.target.value)})}/></label>
 <label>Moves / crane / hour<input type="number" min={1} max={120} value={scenario.rate} onChange={e=>change({rate:Number(e.target.value)})}/></label>
 <label>Vessel arrival (hour)<input type="number" min={0} max={48} step={.5} value={scenario.arrival} onChange={e=>change({arrival:Number(e.target.value)})}/></label>
 <label className="mt-checkbox"><input type="checkbox" checked={scenario.breakdown} onChange={e=>change({breakdown:e.target.checked})}/>Crane 01 breakdown</label>
 <div className="mt-input-pair"><label>Start hour<input type="number" min={0} max={120} value={scenario.outageStart} disabled={!scenario.breakdown} onChange={e=>change({outageStart:Number(e.target.value)})}/></label><label>Duration (hours)<input type="number" min={0} max={48} value={scenario.outageHours} disabled={!scenario.breakdown} onChange={e=>change({outageHours:Number(e.target.value)})}/></label></div>
 <div className="mt-segment"><button aria-pressed={!baselineView} onClick={()=>setBaselineView(false)}>Scenario view</button><button aria-pressed={baselineView} onClick={()=>setBaselineView(true)}>Baseline view</button></div>
 <p className="mt-explanation">{scenario.breakdown?`Crane 01 is unavailable from hour ${scenario.outageStart} to ${scenario.outageStart+scenario.outageHours}. Handling capacity drops from ${scenario.rate*2} to ${scenario.rate} moves/hour during that interval.`:'Both cranes remain available.'} Completion shifts by {results.delay.toFixed(1)} hours.</p>
 <button onClick={()=>{setScenario({...DEFAULT_SCENARIO});setBaselineView(false);reset()}}>Restore default scenario</button></>:
 mode==='train'?<><span className="mt-eyebrow">SAFETY EXERCISE / 01</span><h2>A worker enters the lifting zone.</h2><p>Select the hazard in the scene or asset list, then choose your response. Your first submitted decision is scored.</p><p className={identified?'mt-success':'mt-amber'}>{identified?'✓ Hazard identified':'Identify the hazard first'}</p><fieldset disabled={feedback!==null}><legend>Your response</legend>{[['stop','Stop the lift, secure the area and notify the supervisor.'],['alarm','Sound a warning and continue handling cargo.'],['continue','Continue: the worker will move away.']].map(([value,label])=><label className="mt-response" key={value}><input type="radio" name="safety-response" value={value} checked={response===value} onChange={()=>setResponse(value)}/>{label}</label>)}</fieldset><button disabled={!response||feedback!==null} onClick={()=>{setPlaying(false);setFeedback(safetyScore(identified,response))}}>Submit response</button>{feedback!==null&&<div className="mt-explanation" role="status"><strong>Training score: {feedback}/100</strong><p>{feedback===100?'Correct: identify the hazard and stop the operation before securing the zone.':'The expected response is to identify the restricted zone and stop the lift. A warning alone does not remove the exposure.'}</p></div>}<button onClick={()=>{setIdentified(false);setResponse('');setFeedback(null)}}>Restart exercise</button><p className="mt-footnote">Demonstration only. Not a certified safety course or operating procedure.</p></>:
 <DeliveryControls inputs={delivery.inputs} change={changeDelivery} result={delivery.result} loading={delivery.loading} error={delivery.error} retry={delivery.retry} baseline={baselineSequence} setBaseline={setBaselineSequence}/>}

 </aside>
 </div>
 {mode==='deliver'&&delivery.result&&<DeliveryAnalysis result={delivery.result} day={day} select={(id,date)=>{setSelected(id);setDay((timestamp(date)-deliveryOrigin)/86400000);setPlaying(false)}}/>}
 <MaritimePoe delivery={delivery.inputs} operations={scenario} apply={v=>{changeDelivery(v);setMode('deliver');setBaselineSequence(false)}} ready={!!delivery.result&&!delivery.loading}/>
 <div className="mt-lower-grid"><section className="mt-card"><div className="mt-card-head"><h2>Shared asset registry</h2><span>{ASSETS.length} assets</span></div><div className="mt-assets">{ASSETS.map(a=><button key={a.id} aria-pressed={selected===a.id} onClick={()=>select(a.id)}><strong>{a.name}</strong><span>{a.type}</span><code>{a.id}</code></button>)}</div></section>
 <section className="mt-card"><h2>Operations: baseline vs scenario</h2><table><thead><tr><th>Measure</th><th>Baseline</th><th>Scenario</th></tr></thead><tbody><tr><td>Completion</td><td>{hours(results.baseline)}</td><td>{hours(results.scenario)}</td></tr><tr><td>Handled at {hour.toFixed(1)} h</td><td>{Math.floor(handled({...scenario,breakdown:false},hour))}</td><td>{Math.floor(handled(scenario,hour))}</td></tr><tr><td>Available capacity now</td><td>{scenario.rate*2} moves/h</td><td>{capacity(scenario,hour)} moves/h</td></tr></tbody></table><details><summary>Simulation assumptions</summary><p>Constant independent crane rates; continuous handling after vessel arrival. No tides, weather, yard capacity or berth queues. Vehicle and cargo animations are illustrative. All figures use synthetic data. Parameters are retained only in this browser tab.</p></details><p className="mt-footnote">Available capacity is not actual throughput before arrival or after cargo completion. Live port data is not connected.</p></section></div>
 </main></div>
}

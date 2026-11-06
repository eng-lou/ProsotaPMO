import type { Scenario } from './types'
import { methodAt } from './workerMethod'

const seconds=(n:number)=>n<60?n.toFixed(1)+'s':Math.floor(n/60)+'m '+Math.round(n%60)+'s'
export function MethodPlaybackControls({scenario,progress,play,speed,onSpeed,onSeek,onPlay,onBack,onExit}:{scenario:Scenario;progress:number;play:boolean;speed:number;onSpeed:(n:number)=>void;onSeek:(p:number)=>void;onPlay:()=>void;onBack:()=>void;onExit:()=>void}){
 const result=scenario.result!,start=Date.parse(result.start),span=Math.max(1,Date.parse(result.finish)-start),time=start+span*progress
 return <div className="method-playback"><div className="row"><strong className="grow">{scenario.name}</strong><button onClick={onBack}>Edit / results</button><button onClick={onExit}>Exit preview</button></div>
 <div className="method-states">{scenario.config.steps.filter(s=>s.worker_method).map(s=>{const state=methodAt(result.events,s.id,time),wait=!state?.active&&result.waiting.find(w=>w.step_id===s.id&&w.reason!=='Previous phase'&&Date.parse(w.start)<=time&&Date.parse(w.end)>time)
 return <div key={s.id}><strong>{s.name}</strong><div className="method-stage-strip">{(['approach','work','continue'] as const).map((stage,i)=>{const event=result.events.find(e=>e.step_id===s.id&&e.worker_action?.stage===stage);return <button key={stage} className={state?.active&&state.stage===stage?'active':''} disabled={!event||scenario.status!=='current'} onClick={()=>event&&onSeek((Date.parse(event.start)-start)/span)}><span>{['↗','⚒','→'][i]}</span>{['Walk in','Use tool','Continue'][i]}</button>})}</div><small role="status">{wait?'Waiting · '+wait.reason:state?.finished?'Finished':state?.active?'Playing · '+state.event.phase:'Waiting to start'}</small></div>})}</div>
 <div className="row"><button className="primary" disabled={scenario.status!=='current'} onClick={onPlay}>{play?'Pause':'Play'}</button><span>{seconds(span*progress/1000)} / {seconds(span/1000)}</span><select aria-label="Preview speed" value={speed} onChange={e=>onSpeed(Number(e.target.value))}>{[1,2,5,10,60,3600].map(n=><option key={n} value={n}>{n}×</option>)}</select></div>
 <input aria-label="3D method playhead" type="range" min={0} max={1} step={.0001} value={progress} disabled={scenario.status!=='current'} onChange={e=>onSeek(Number(e.target.value))}/>
 <small>Preview only · your original scene animation is restored on exit.</small></div>
}

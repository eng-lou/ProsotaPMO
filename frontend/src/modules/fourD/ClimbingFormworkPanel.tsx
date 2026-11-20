import {useState} from 'react'
import {Box3} from 'three'
import type {Activity} from '@/modules/scheduling/types'
import type {SiteItem} from './siteScene'
import type {ShapeSource} from './ShapeOperationsPanel'
import {climbWindows,type ClimbingFormwork,type ClimbLift} from './climbingFormwork'
import {TimelinePointInput,type TimelineFormat} from './TimelinePointInput'
const cls='w-full rounded border p-1 dark:bg-prosota-panel2'
export function ClimbingFormworkPanel({item,activities,axis,format,onSeek,onApply,selectedSources,disabled}:{item:SiteItem;activities:Activity[];axis:'y'|'z';format:TimelineFormat;onSeek:(d:Date)=>void;onApply:(p:Partial<SiteItem>)=>Promise<void>;selectedSources:()=>ShapeSource[];disabled:boolean}){
 const [selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState(''),[rise,setRise]=useState(3),[hours,setHours]=useState(24),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const config=item.climbing_formwork,blocked=!!item.work_sequence||!!item.path_motion||!!item.attachment||!!item.load_handling?.events.length
 let warning='';try{if(config)climbWindows(config,activities)}catch(e){warning=(e as Error).message}
 async function save(value:ClimbingFormwork|null){setBusy(true);setError('');try{if(value)climbWindows(value,activities);await onApply({climbing_formwork:value})}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const change=(id:string,patch:Partial<ClimbLift>)=>{if(config)void save({...config,lifts:config.lifts.map(l=>l.id===id?{...l,...patch}:l)})}
 function selectedTop(){const sources=selectedSources().filter(s=>s.id!=='site:'+item.id);try{if(!sources.length)throw Error('Select the core geometry in the viewport first.');const bounds=new Box3();for(const source of sources){source.object.updateWorldMatrix(true,true);bounds.union(new Box3().setFromObject(source.object))}if(bounds.isEmpty())throw Error('Selected geometry has no bounds.');return bounds.max[config?.axis||axis]}finally{sources.forEach(s=>s.dispose?.())}}
 function readHeight(id?:string){try{if(!config)return;const top=selectedTop();if(id)change(id,{height:top-config.reference_elevation});else void save({...config,reference_elevation:top})}catch(e){setError((e as Error).message)}}
 return <fieldset disabled={disabled||busy||blocked} className="border rounded p-2 space-y-2 text-xs"><legend>Climbing formwork</legend>
 <p>Place the whole assembly at its first working level. It holds between climbs and moves as one object.</p>
 {blocked&&<p>Remove this object's route or attachment before enabling climbing.</p>}
 {!config?<button onClick={()=>void save({axis,reference_elevation:0,lifts:[]})}>Enable simple climb</button>:<>
 <label>Vertical axis<select className={cls} value={config.axis} onChange={e=>void save({...config,axis:e.target.value as 'y'|'z'})}><option value="z">Z</option><option value="y">Y</option></select></label>
 <label>First core top elevation (m)<input className={cls} type="number" step=".01" key={config.reference_elevation} defaultValue={config.reference_elevation} onBlur={e=>{if(Number.isFinite(e.target.valueAsNumber))void save({...config,reference_elevation:e.target.valueAsNumber})}}/></label>
 <button onClick={()=>readHeight()}>Read first core top from selection</button>
 <p>Use the same reference (core top) for every lift. Geometry heights are captured when you click; later model changes require reading them again.</p>
 <details><summary>Add lifts from activities</summary><input className={cls} placeholder="Search core activities" value={query} onChange={e=>setQuery(e.target.value)}/>
 <div className="max-h-40 overflow-auto">{activities.filter(a=>a.start&&`${a.code} ${a.task_name}`.toLowerCase().includes(query.toLowerCase())).map(a=><label className="block" key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={e=>setSelected(e.target.checked?[...selected,a.id]:selected.filter(id=>id!==a.id))}/>{a.code} - {a.task_name}</label>)}</div>
 <label>Typical lift height (m)<input className={cls} type="number" step=".1" value={rise} onChange={e=>setRise(e.target.valueAsNumber)}/></label>
 <label>Climb duration (schedule hours)<input className={cls} type="number" min=".01" step=".25" value={hours} onChange={e=>setHours(e.target.valueAsNumber)}/></label>
 <button disabled={!selected.length||!Number.isFinite(rise)||!Number.isFinite(hours)||hours<=0} onClick={()=>{try{const chosen=activities.filter(a=>selected.includes(a.id)&&!config.lifts.some(l=>l.activity_id===a.id)).sort((a,b)=>Date.parse(a.start!)-Date.parse(b.start!));const last=config.lifts.length?climbWindows(config,activities)[config.lifts.length-1].height:0;void save({...config,lifts:[...config.lifts,...chosen.map((a,i)=>({id:crypto.randomUUID(),activity_id:a.id,height:last+(i+(config.lifts.length?1:0))*rise,duration_hours:hours,start:null,finish:null}))]})}catch(e){setError((e as Error).message)}}}>Add selected in date order</button>
 <p>The first lift stays at offset 0. Later lifts climb before their activity starts. Activity date changes update these times unless overridden below.</p></details>
 {config.lifts.map((l,i)=><section className="border rounded p-2 space-y-1" key={l.id}><strong>{activities.find(a=>a.id===l.activity_id)?.task_name||'Missing activity'}</strong>
 <label>Height above first position (m)<input className={cls} aria-label={`Lift ${i+1} height`} type="number" step=".01" key={l.height} defaultValue={l.height} onBlur={e=>{if(Number.isFinite(e.target.valueAsNumber))change(l.id,{height:e.target.valueAsNumber})}}/></label><button onClick={()=>readHeight(l.id)}>Read selected core top</button>
 <label>Climb duration (hours)<input className={cls} type="number" min=".01" step=".25" key={l.duration_hours} defaultValue={l.duration_hours} onBlur={e=>{if(e.target.valueAsNumber>0)change(l.id,{duration_hours:e.target.valueAsNumber})}}/></label>
 <label className="block">Start override <TimelinePointInput value={l.start?new Date(l.start):null} onChange={d=>change(l.id,{start:d?.toISOString()||null})} format={format} placeholder="From duration" dayEdge="start"/></label>
 <label className="block">Finish override <TimelinePointInput value={l.finish?new Date(l.finish):null} onChange={d=>change(l.id,{finish:d?.toISOString()||null})} format={format} placeholder="Activity start" dayEdge="start"/></label>
 <button onClick={()=>{try{onSeek(new Date(climbWindows(config,activities).find(r=>r.id===l.id)!.finishMs))}catch(e){setError((e as Error).message)}}}>Preview working position</button> <button onClick={()=>void save({...config,lifts:config.lifts.filter(r=>r.id!==l.id)})}>Remove lift</button>
 </section>)}
 <button onClick={()=>void save(null)}>Remove climb setup</button>
 </>}
 {(error||warning)&&<p role="alert" className="text-red-500">{error||warning}</p>}
 </fieldset>
}

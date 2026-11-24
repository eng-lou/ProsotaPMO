import { SlabScaffoldSettings } from './SlabScaffoldSettings'
import type {HostSource} from './constructionLayout'
import { defaultScaffold, sitePosterTitles } from './siteScene'
import { restPose } from './gatePose'
import type { Enclosure, FenceOpening, FenceStyle, SiteItem, TowerCover } from './siteScene'

const field = 'w-full min-w-0 rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line'
const button = 'rounded border px-2 py-1 dark:border-prosota-line disabled:opacity-40'
export const fencePresets = {
  street: { label:'Streetworks mesh and barriers',color:'#8e9aa2',height:2,module_length:3.5 },
  scaffold: { label:'Perimeter scaffolding',color:'#759189',height:2,module_length:2.5 },
  edge: { label: 'Slab edge protection', color: '#ec651b', height: 1.22, module_length: 2.4 },
  mesh: { label: 'Mesh perimeter fence', color: '#9aa9ad', height: 2, module_length: 3.5 },
  hoarding: { label: 'Solid site hoarding', color: '#304d66', height: 2.4, module_length: 2.4 },
  plain: { label: 'Plain panel', color: '#64748b', height: 2, module_length: 2 },
}
const entranceNames = { gap: 'Clear gap', vehicle: 'Double vehicle gate', pedestrian: 'Pedestrian gate', turnstile: 'Worker turnstile' }
const openingDefaults = { gap: 1, vehicle: 5, pedestrian: 1.1, turnstile: 1.5 }

function Measure({label, value, onChange}: {label:string; value:number; onChange:(value:number)=>void}) {
  return <label>{label}<input className={field} type="number" step="any" value={Number.isFinite(value) ? value : ''} onChange={event=>onChange(event.target.valueAsNumber)} /></label>
}

export function FenceSettings({item, change,selection,layout}: {item:SiteItem; change:(patch:Partial<SiteItem>)=>void;selection?:()=>HostSource[];layout?:SiteItem['layout']}) {
  const legacy: FenceOpening[] = item.gate_width ? [{kind:'gap',start:item.gate_start,width:item.gate_width,angle:0,board:'',lights:false}] : []
  const config: Enclosure = item.enclosure ?? {style:'plain',openings:legacy,levels:[0],perimeter_lights:false}
  function update(patch: Partial<Enclosure>, dimensions: Partial<SiteItem> = {}) {
    change({...dimensions, enclosure:{...config,...patch}, gate_width:0, gate_start:0})
  }
  const sc=config.scaffold??defaultScaffold
  const scaffold=(patch:Partial<typeof sc>)=>update({scaffold:{...sc,...patch}})
  const referenced=config.style==='scaffold'&&!!sc.slabs?.length
  function opening(index:number, patch:Partial<FenceOpening>) {
    update({openings:config.openings.map((current,i)=>i===index ? {...current,...patch} : current)})
  }
  return <fieldset className="space-y-2 min-w-0">
    <label>Fence style<select className={field} value={config.style} onChange={event=>{
      const style = event.target.value as FenceStyle
      const {height,module_length,color} = fencePresets[style]
      update({style,...(style==='scaffold'?{levels:[0],scaffold:sc}:style==='street'?{barrier_base:'low',reflective:true}:{})},{height,module_length,color})
    }}>{Object.entries(fencePresets).map(([key,preset])=><option key={key} value={key}>{preset.label}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-2">
      <Measure label={config.style==='scaffold'?'Bay length (m)':'Panel length (m)'} value={item.module_length} onChange={module_length=>change({module_length})}/>
      <Measure label={config.style==='scaffold'?'Lift height (m)':'Height (m)'} value={item.height} onChange={height=>change({height})}/>
    </div>
    <label>Panel fitting<select className={field} value={item.panel_fit ?? 'fit'} onChange={e=>change({panel_fit:e.target.value as SiteItem['panel_fit']})}><option value="fit">Fit equal panels to each span</option><option value="trim">Trim the final panel</option><option value="strict">Whole panels only</option></select></label>
    {config.style==='hoarding' && <label className="flex gap-2"><input type="checkbox" checked={config.perimeter_lights} onChange={e=>update({perimeter_lights:e.target.checked})}/>Perimeter warning lights</label>}
    {config.style==='scaffold'&&<div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">{!referenced&&<Measure label="Lifts" value={sc.lifts} onChange={lifts=>scaffold({lifts})}/>}<Measure label="Platform width (m)" value={sc.width} onChange={width=>scaffold({width})}/></div>
      {selection&&<SlabScaffoldSettings run={sc} axis={item.up_axis} selection={selection} change={scaffold} bays={layout?.reference_bays??[]} unmatched={layout?.unmatched_edits??0}/>}
      {!referenced&&<label>Platform side along path<select className={field} value={sc.side} onChange={e=>scaffold({side:e.target.value as typeof sc.side})}><option value="left">Left</option><option value="right">Right</option></select></label>}
      <label className="block"><input type="checkbox" checked={sc.netted} onChange={e=>scaffold({netted:e.target.checked})}/> Debris netting</label>
      {!referenced&&<>{sc.stairs.map((station,i)=><div key={i} className="flex items-end gap-1"><Measure label={'Stair '+(i+1)+' station (m)'} value={station} onChange={n=>scaffold({stairs:sc.stairs.map((s,j)=>i===j?n:s)})}/><button className={button} onClick={()=>scaffold({stairs:sc.stairs.filter((_,j)=>i!==j)})}>Remove</button></div>)}
      <button className={button} onClick={()=>scaffold({stairs:[...sc.stairs,sc.stairs.length?sc.stairs[sc.stairs.length-1]+item.module_length:item.module_length/2]})}>Add stair bay</button></>}
    </div>}
    {(config.style==='street'||config.style==='mesh')&&<div className="space-y-2">
      <label>Fence base<select className={field} value={config.barrier_base??'feet'} onChange={e=>update({barrier_base:e.target.value as Enclosure['barrier_base']})}><option value="feet">Individual feet</option><option value="low">Low red / white road barrier</option><option value="ballast">Red / white ballast blocks</option></select></label>
      <label className="block"><input type="checkbox" checked={!!config.reflective} onChange={e=>update({reflective:e.target.checked})}/> Reflective strip</label>
      <label className="block"><input type="checkbox" checked={!!config.blanket} onChange={e=>update({blanket:e.target.checked})}/> Blue acoustic blankets</label>
      {config.blanket&&<label>Covered bays (blank for all)<input className={field} key={item.id} defaultValue={config.blanket_bays?.join(', ')} placeholder="1, 2, 5" onBlur={e=>{const s=e.target.value.trim(),ids=s.split(',').map(x=>Number(x.trim()));if(!s||ids.every(x=>Number.isInteger(x)&&x>0))update({blanket_bays:s?ids:null});else e.target.value=config.blanket_bays?.join(', ')??''}}/></label>}
    </div>}
    {config.style!=='scaffold'&&<details><summary>Level offsets ({config.levels.length})</summary>
      {config.levels.map((level,index)=><div key={index} className="flex items-end gap-2 my-1">
        <Measure label={`Level ${index+1} above path (m)`} value={level} onChange={value=>update({levels:config.levels.map((n,i)=>i===index?value:n)})}/>
        <button className={button} disabled={config.levels.length===1} onClick={()=>update({levels:config.levels.filter((_,i)=>i!==index)})}>Remove</button>
      </div>)}
      <button className={button} disabled={config.levels.length>=64} onClick={()=>update({levels:[...config.levels,Math.max(...config.levels)+3]})}>Add level</button>
    </details>}
    {!referenced&&<><strong className="block">Openings ({config.openings.length})</strong>
    {config.openings.map((entry,index)=><fieldset key={index} className="min-w-0 space-y-1 rounded border p-2 dark:border-prosota-line">
      <legend>Opening {index+1}</legend>
      <label>Entrance type<select className={field} value={entry.kind} onChange={e=>{
        const kind=e.target.value as FenceOpening['kind']
        opening(index,{kind,width:openingDefaults[kind],pose:null,pose_keys:[]})
      }}>{Object.entries(entranceNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2">
        <Measure label="Start along path (m)" value={entry.start} onChange={start=>opening(index,{start})}/>
        <Measure label="Opening width (m)" value={entry.width} onChange={width=>opening(index,{width})}/>
      </div>
      {entry.kind==='pedestrian'&&<fieldset><legend>Door posters</legend>{sitePosterTitles.map(title=><label key={title} className="block"><input type="checkbox" checked={entry.posters?.includes(title)??false} onChange={e=>opening(index,{posters:e.target.checked?[...(entry.posters??[]),title]:(entry.posters??[]).filter(p=>p!==title)})}/> {title}</label>)}</fieldset>}
      {(entry.kind==='vehicle'||entry.kind==='pedestrian') && <Measure label={entry.pose != null || entry.pose_keys?.length ? "Full swing (degrees, 0 uses 90)" : "Gate swing (degrees)"} value={entry.angle} onChange={angle=>opening(index,{angle})}/>}
      {entry.kind!=='gap' && <>
        <label className="block">{entry.kind==='turnstile'?'Rotation':'Opening'} (0–1) · {restPose(entry).toFixed(2)}
          <input className="w-full" type="range" min="0" max="1" step="0.01" value={restPose(entry)} onChange={e=>opening(index,{pose:Number(e.target.value)})}/>
        </label>
        <label>Entrance board / branding<input className={field} maxLength={48} placeholder="Site or contractor name" value={entry.board} onChange={e=>opening(index,{board:e.target.value})}/></label>
        <label className="flex gap-2"><input type="checkbox" checked={entry.lights} onChange={e=>opening(index,{lights:e.target.checked})}/>Gatepost warning lights</label>
      </>}
      <button className={button} onClick={()=>update({openings:config.openings.filter((_,i)=>i!==index)})}>Remove opening</button>
    </fieldset>)}
    <button className={button} disabled={config.openings.length>=32} onClick={()=>update({openings:[...config.openings,{kind:'gap',start:config.openings.reduce((n,o)=>Math.max(n,o.start+o.width),0),width:1,angle:0,board:'',lights:false}]})}>Add opening</button></>}
  </fieldset>
}

export function TowerCoverSettings({item,change}:{item:SiteItem; change:(patch:Partial<SiteItem>)=>void}) {
  const cover = item.tower_cover
  function update(patch:Partial<TowerCover>) { if(cover) change({tower_cover:{...cover,...patch}}) }
  return <details className="space-y-2"><summary>Access tower cover</summary>
    <label>Wrap<select className={field} value={cover?.style ?? 'bare'} onChange={e=>{
      const style = e.target.value
      change({tower_cover:style==='bare'?null:{width:3.16,depth:2.86,height:19.2,offset:{x:0,y:0,z:0},...cover,style:style as TowerCover['style']}})
    }}><option value="bare">Bare</option><option value="netted">Blue-green debris net</option><option value="sheeted">Reinforced sheeting</option></select></label>
    {cover && <><p>Fits the original six-bay tower. Offsets use the imported model’s local axes, with Y up.</p>
      <div className="grid grid-cols-3 gap-1">{(['width','height','depth'] as const).map(key=><Measure key={key} label={key+' (m)'} value={cover[key]} onChange={n=>update({[key]:n})}/>)}</div>
      <div className="grid grid-cols-3 gap-1">{(['x','y','z'] as const).map(key=><Measure key={key} label={key.toUpperCase()+' offset (m)'} value={cover.offset[key]} onChange={n=>update({offset:{...cover.offset,[key]:n}})}/>)}</div>
    </>}
  </details>
}

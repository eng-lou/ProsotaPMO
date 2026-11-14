import { useRef, useState } from 'react'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import type { RoadWear } from './roadWear'
import type { WearGuide } from './surfaceWearGuides'

interface Props {
  wear: RoadWear
  mixed: boolean
  guides?: Map<string,WearGuide>
  update: (change:Partial<RoadWear>)=>void
  recentColours: string[]
}

export function SurfaceWearControls({wear,mixed,guides,update,recentColours}:Props) {
  const swatch=useRef<HTMLButtonElement>(null)
  const [editingColour,setEditingColour]=useState(false)
  const available=[...(guides?.values()??[])]
  const slider=(name:'wander'|'depthCm'|'potholes'|'roughness',label:string,max:number,step:number,unit:string)=>
    <label className="flex items-center gap-2 py-1">
      {label}<input type="range" aria-label={label} className="flex-1 min-w-0" min={0} max={max} step={step} value={wear[name]}
        onChange={e=>update({[name]:Number(e.target.value)})}/>
      <span>{unit==='%'?Math.round(wear[name]*100):wear[name]}{unit}</span>
    </label>
  return <details className="text-[11px]"><summary className="cursor-pointer py-1">Surface wear</summary>
    <label className="flex items-center gap-2 py-1">Overlay
      <select aria-label="Surface wear overlay" className="flex-1 rounded border dark:bg-prosota-panel2" value={mixed?'mixed':wear.mode}
        onChange={e=>update({mode:e.target.value as RoadWear['mode']})}>
        {mixed && <option value="mixed" disabled>Mixed</option>}
        <option value="off">Off</option><option value="tracks">Wheel tracks</option><option value="rough">Uneven ground</option>
      </select>
    </label>
    {!mixed && wear.mode!=='off' && <>
      {wear.mode==='tracks' && <>
        <label className="flex items-center gap-2 py-1">Track pairs
          <select aria-label="Track pairs" value={wear.pairs} className="rounded border dark:bg-prosota-panel2"
            onChange={e=>update({pairs:Number(e.target.value)})}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select>
        </label>
        {slider('wander','Track wander',1,.05,'%')}
        <details><summary className="cursor-pointer py-1">{wear.guides.length?'Guide paths · '+wear.guides.length:'Guide paths · automatic'}</summary>
          <p>Automatic follows the surface and its branches. Draw a centreline in Paths and select it here to guide a vehicle.</p>
          {available.filter(g=>g.isPath).map(g=><label key={g.id} className="flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={wear.guides.includes(g.id)} onChange={e=>update({guides:e.target.checked?[...wear.guides,g.id]:wear.guides.filter(id=>id!==g.id)})}/>{g.name}
          </label>)}
          {wear.guides.filter(id=>!guides?.has(id)).map(id=><button key={id} className="underline" onClick={()=>update({guides:wear.guides.filter(v=>v!==id)})}>Remove missing path</button>)}
        </details>
      </>}
      {wear.mode==='rough' && slider('roughness','Ground unevenness',1,.05,'%')}
      {slider('depthCm',wear.mode==='tracks'?'Groove depth':'Relief depth',12,.5,' cm')}
      {slider('potholes','Pothole density',1,.05,'%')}
      <div className="flex items-center gap-2 py-1">{wear.mode==='tracks'?'Groove colour':'Patch colour'}
        <button ref={swatch} aria-label="Change wear colour" style={{backgroundColor:wear.colour}} className="w-5 h-5 rounded border" onClick={()=>setEditingColour(v=>!v)}/>
        {editingColour && <ColorPickerPopover anchor={swatch.current} value={wear.colour} onChange={colour=>update({colour})} onClose={()=>setEditingColour(false)} recentColors={recentColours}/>}
      </div>
      <label className="flex items-center gap-2 py-1">Apply within
        <select aria-label="Wear area" value={wear.area} className="flex-1 min-w-0 rounded border dark:bg-prosota-panel2" onChange={e=>update({area:e.target.value})}>
          <option value="">Whole surface</option>
          {wear.area&&!guides?.get(wear.area)?.closed && <option value={wear.area}>Missing boundary</option>}
          {available.filter(g=>g.closed).map(g=><option key={g.id} value={g.id}>{g.isPath?'Closed path':'Zone'} · {g.name}</option>)}
        </select>
      </label>
      {!available.some(g=>g.closed) && <p>Draw a closed path or a zone to limit this effect to part of the surface.</p>}
    </>}
  </details>
}

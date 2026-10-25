import { ToolVisualGuide } from './ToolVisualGuide'
import type { Path } from './paths'
import type { SiteItem, PathMotion } from './siteScene'
import { buildPathCurve } from './pathCurve'

function NumberField({label,value,min=0.01,max=100,onChange}:{label:string;value:number;min?:number;max?:number;onChange(value:number):void}) {
  return <label className="block">{label}<input aria-label={label} key={value} type="number" step="0.1" min={min} max={max} defaultValue={value}
    className="w-full rounded border p-1 dark:bg-prosota-panel2" onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}
    onBlur={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&n>=min&&n<=max&&n!==value)onChange(n);else e.currentTarget.value=String(value)}}/></label>
}
export function SitePathBindings({path,items,busy,onChange}:{path:Path;items:SiteItem[];busy:boolean;onChange(id:string,motion:PathMotion|null):void}) {
  return <>{items.filter(item=>item.path_motion?.path_id===path.id).map(item=>{
    const motion=item.path_motion!
    const change=(patch:Partial<PathMotion>)=>onChange(item.id,{...motion,...patch})
    const duration=(buildPathCurve(path.points,path.closed,path.curve_mode)?.getLength()||0)/motion.speed
    return <fieldset key={item.id} disabled={busy||item.locked} className="border rounded p-2 space-y-2 text-xs">
      <legend>Following: {item.name}</legend>
      <ToolVisualGuide topic="path" mode={motion.orient?"orient":"fixed"} heading={motion.heading}/>
      <NumberField label="Travel speed (m/s)" value={motion.speed} onChange={speed=>change({speed})}/>
      <p>{duration.toFixed(1)} seconds per journey · Play or scrub the animation timeline.</p>
      <label className="flex gap-2"><input type="checkbox" checked={motion.loop} onChange={e=>change({loop:e.target.checked})}/>Loop journey</label>
      <label className="flex gap-2"><input type="checkbox" checked={motion.orient} onChange={e=>change({orient:e.target.checked})}/>Follow turns</label>
      <NumberField label="Heading offset (degrees)" min={-36000} max={36000} value={motion.heading} onChange={heading=>change({heading})}/>
      <p>Rotation and scale remain editable in the object’s transform panel. Align its front with the start of the path.</p>
      {item.asset_id && <><NumberField label="Clip travel speed at 1× (m/s)" value={motion.animation_reference_speed} onChange={animation_reference_speed=>change({animation_reference_speed})}/><p>Match this to the clip’s walking or driving pace. Wheel and limb animation follows distance travelled and stops at the end.</p></>}
      <button className="border rounded px-2 py-1" onClick={()=>onChange(item.id,null)}>Unbind {item.name}</button>
    </fieldset>
  })}</>
}

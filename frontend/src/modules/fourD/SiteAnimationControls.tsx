import { useEffect, useState } from 'react'
import { loadSiteAsset } from './siteAssets'
import type { SiteItem } from './siteScene'
import { ImportMotionControl } from './ImportMotionControl'
export function SiteAnimationControls({item,onChange,disabled,projectId,onApplyMotion}:{item:SiteItem;onChange(patch:Partial<SiteItem>):void;disabled:boolean;projectId:string;onApplyMotion(patch:Partial<SiteItem>):Promise<void>}) {
 const [clips,setClips]=useState<string[]>([])
 useEffect(()=>{let active=true;setClips([]);if(item.asset_id)void loadSiteAsset(item.asset_id).then(object=>{if(active)setClips(object.animations.map((c,i)=>c.name||`Clip ${i+1}`))}).catch(()=>{});return()=>{active=false}},[item.asset_id])
 return <fieldset disabled={disabled} className="border rounded p-2 space-y-2"><legend>Asset animation</legend>
 <ImportMotionControl key={item.id+item.asset_id} item={item} projectId={projectId} disabled={disabled} onApply={onApplyMotion}/>
 {clips.length>0&&<>
 <label className="flex gap-2"><input type="checkbox" checked={item.animation_playing??true} onChange={e=>onChange({animation_playing:e.target.checked})}/>Play animation</label>
 <label className="block">Clip<select className="w-full border rounded dark:bg-prosota-panel2" value={item.animation_clip??0} onChange={e=>onChange({animation_clip:Number(e.target.value)})}>{clips.map((name,i)=><option key={i} value={i}>{name}</option>)}</select></label>
 <label className="block">Speed<input aria-label="Asset animation speed" className="w-full border rounded dark:bg-prosota-panel2" type="number" min={0} max={10} step={.1} key={item.id+':'+(item.animation_speed??1)} defaultValue={item.animation_speed??1} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={e=>{const value=e.target.valueAsNumber;if(Number.isFinite(value)){const speed=Math.min(10,Math.max(0,value));if(speed!==(item.animation_speed??1))onChange({animation_speed:speed});else e.target.value=String(speed)}else e.target.value=String(item.animation_speed??1)}}/></label>
 </>}
 </fieldset>
}

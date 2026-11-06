import * as THREE from 'three'
import { equipmentNodes, type EquipmentRig, type Vec3 } from './equipmentRig'
import { bucketFrame, type SoilDefinition } from './soilSimulation'
import { TimelinePointInput, type TimelineFormat } from './TimelinePointInput'

const input='w-full min-w-0 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel2 p-1'
const button='rounded border border-gray-300 dark:border-prosota-line px-2 py-1 disabled:opacity-40'
const vec=(v:THREE.Vector3)=>v.toArray() as Vec3
export function fitSoilBucket(node:THREE.Object3D, up:'y'|'z') {
  node.updateWorldMatrix(true,true)
  const inverse=node.matrixWorld.clone().invert(), upLocal=new THREE.Vector3(0,up==='y'?1:0,up==='z'?1:0).transformDirection(inverse)
  const rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),upLocal))
  const q=new THREE.Quaternion().setFromEuler(rotation), frameInverse=q.clone().invert(), box=new THREE.Box3(), point=new THREE.Vector3()
  node.traverse(child=>{if(child instanceof THREE.Mesh){const attr=child.geometry.getAttribute('position');if(!attr)return;for(let i=0;i<attr.count;i++){point.fromBufferAttribute(attr,i).applyMatrix4(child.matrixWorld).applyMatrix4(inverse).applyQuaternion(frameInverse);box.expandByPoint(point)}}})
  if(box.isEmpty())box.setFromCenterAndSize(new THREE.Vector3(),new THREE.Vector3(1,1,1))
  const center=box.getCenter(new THREE.Vector3()).applyQuaternion(q)
  const size=box.getSize(new THREE.Vector3()).multiply(new THREE.Vector3(.65,.5,.65)).max(new THREE.Vector3(.001,.001,.001))
  const world=new THREE.Vector3(...vec(center)).applyMatrix4(node.matrixWorld), scale=node.getWorldScale(new THREE.Vector3())
  const capacity=Math.max(.001,Math.min(100,size.x*size.y*size.z*Math.abs(scale.x*scale.y*scale.z)*.65))
  return {center:vec(center),size:vec(size),rotation:[rotation.x,rotation.y,rotation.z] as Vec3,world,capacity}
}
export function EquipmentSoilSetup({rig,object,upAxis,format,time,onChange,onSeek,onActivate}:{rig:EquipmentRig;object?:THREE.Object3D;upAxis:'y'|'z';format?:TimelineFormat|null;time:number;onChange:(rig:EquipmentRig)=>void;onSeek:(d:Date)=>void;onActivate:()=>void}) {
  const s=rig.definition.soil, nodes=object?equipmentNodes(object):new Map<string,THREE.Object3D>()
  const change=(patch:Partial<SoilDefinition>)=>{if(s)onChange({...rig,definition:{...rig.definition,soil:{...s,...patch}}})}
  const times=rig.definition.controls.flatMap(c=>c.keys.map(k=>Date.parse(k.date)))
  const speed=format?.speedDaysPerSecond||1
  const duration=(a:number,b:number)=>Math.max(1,Math.min(300,(b-a)/(86400000*speed)))
  const vector=(label:string,key:'center'|'size'|'rotation'|'source',degrees=false)=>s&&<label className="block">{label}<div className="flex gap-1">{s[key].map((v,i)=><input key={i} aria-label={`${label} ${'XYZ'[i]}`} className={input} type="number" step={degrees?5:.1} value={Number((degrees?THREE.MathUtils.radToDeg(v):v).toFixed(4))} onChange={e=>{const next=[...s[key]] as Vec3;next[i]=degrees?THREE.MathUtils.degToRad(Number(e.target.value)):Number(e.target.value);change({[key]:next})}}/>)}</div></label>
  const number=(label:string,key:'capacity'|'radius'|'height'|'dump_angle'|'pour_seconds',min:number,max:number,step:number)=>s&&<label className="block">{label}<input aria-label={label} className={input} type="number" min={min} max={max} step={step} value={s[key]} onChange={e=>change({[key]:Number(e.target.value)})}/></label>
  const place=()=>{
    const node=s&&nodes.get(s.bucket_node);if(!s||!node)return
    node.updateWorldMatrix(true,false);const p=new THREE.Vector3().applyMatrix4(node.matrixWorld.clone().multiply(bucketFrame(s)))
    p[s.up_axis]-=s.height*.55;change({source:vec(p)})
  }
  return <details onToggle={e=>{if(e.currentTarget.open)onActivate()}} className="border rounded border-gray-300 dark:border-prosota-line p-2 space-y-2">
    <summary className="font-semibold">Soil · scoop, carry & pour{s?' · configured':''}</summary>
    <p>Animate the bucket through a pile. Soil enters the calibrated volume, travels with the bucket, then falls and forms a new pile when the opening tilts down.</p>
    <svg viewBox="0 0 290 65" className="w-full" role="img" aria-label="Dig pile, carry loaded bucket, tip and deposit soil"><path d="M8 54 Q30 5 60 54 Z M228 54 Q248 25 282 54Z" fill="#896245"/><path d="M35 32L48 48L68 35 M115 24L128 41L148 29 M205 12L218 29L231 14" fill="#896245" stroke="#fbbf24" strokeWidth="4"/><path d="M72 31h25m-5-5 5 5-5 5M155 31h25m-5-5 5 5-5 5" fill="none" stroke="#7dd3fc"/><path d="M219 32l7 12m-2-9 9 12" stroke="#896245" strokeWidth="4"/></svg>
    {!s&&<button className={button} disabled={!object||!rig.definition.joints.length} onClick={()=>{
      const key=rig.definition.joints.find(j=>/bucket|scoop|tipper.body/i.test(j.name+' '+j.node))?.node||rig.definition.joints[0]?.node,node=nodes.get(key)
      if(!node)return
      const f=fitSoilBucket(node,upAxis),start=times.length?Math.min(...times):time,end=times.length>1?Math.max(...times):start+12*86400000*speed
      const preloaded=/tipper.body/i.test(node.name),template=node.userData.prosota_bulk_load
      if(preloaded&&template&&['center','size','rotation','outlet'].every(k=>Array.isArray(template[k])&&template[k].length===3&&template[k].every(Number.isFinite))&&Number.isFinite(template.capacity)&&template.capacity>0&&template.capacity<=100){f.center=template.center;f.size=template.size;f.rotation=template.rotation;f.capacity=template.capacity}
      const height=Math.min(3,Math.max(.5,Math.cbrt(f.capacity)*1.5));f.world[upAxis]=preloaded?0:f.world[upAxis]-height*.55
      onChange({...rig,definition:{...rig.definition,soil:{enabled:true,show_guide:true,bucket_node:key,center:f.center,size:f.size,rotation:f.rotation,capacity:Number(f.capacity.toFixed(3)),dump_angle:preloaded?28:105,pour_seconds:preloaded?5:1.5,source:vec(f.world),radius:Math.max(.5,Math.cbrt(f.capacity)*2),height,up_axis:upAxis,start:new Date(start).toISOString(),end:new Date(Math.max(end,start+86400000*speed)).toISOString(),duration_seconds:duration(start,end),steps:240,color:'#806046',mode:preloaded?'preloaded':'excavate',initial_fill:1,material:'soil',outlet:preloaded?[0,-.45,-.5]:null}}})
    }}>Add soil cycle</button>}
    {s&&<>
      <label className="flex gap-2"><input type="checkbox" checked={s.enabled} onChange={e=>change({enabled:e.target.checked})}/>Enable soil simulation</label>
      <label className="block">Load source<select aria-label="Load source" className={input} value={s.mode??'excavate'} onChange={e=>change({mode:e.target.value as 'excavate'|'preloaded',dump_angle:e.target.value==='preloaded'?28:105,initial_fill:s.initial_fill??1,outlet:e.target.value==='preloaded'?[0,-.45,-.5]:null})}><option value="excavate">Scoop from a pile</option><option value="preloaded">Start with a loaded body</option></select></label>
      <label className="block">Bulk material<select aria-label="Bulk material" className={input} value={s.material??'soil'} onChange={e=>{const material=e.target.value as NonNullable<SoilDefinition['material']>;change({material,color:{soil:'#806046',sand:'#c4a570',gravel:'#8b8981',rocks:'#817c70'}[material]})}}><option value="soil">Soil / fine aggregate</option><option value="sand">Sand</option><option value="gravel">Gravel</option><option value="rocks">Stones / rocks</option></select></label>
      {s.mode==='preloaded'&&<><label className="block">Starting load (%)<input aria-label="Starting load (%)" className={input} type="number" min="0" max="100" step="5" value={Math.round((s.initial_fill??1)*100)} onChange={e=>change({initial_fill:Math.max(0,Math.min(1,Number(e.target.value)/100))})}/></label><p>The body starts loaded at From. Key its tipping control and open the tailgate before pouring. Set the ground elevation below; no source pile is created.</p><label className="block">Discharge edge<select aria-label="Discharge edge" className={input} value={s.outlet?.[2]===.5?'front':'rear'} onChange={e=>change({outlet:[0,-.45,e.target.value==='front'?.5:-.5]})}><option value="rear">Rear of body</option><option value="front">Opposite end</option></select></label></>}
      {object?.userData.soilStatus&&<p>Bucket: {object.userData.soilStatus.fill.toFixed(2)} / {s.capacity.toFixed(2)} m³ · Deposited: {object.userData.soilStatus.deposited.toFixed(2)} m³</p>}
      <label className="block">Bucket part<select aria-label="Soil bucket part" className={input} value={s.bucket_node} onChange={e=>change({bucket_node:e.target.value,opening_direction:null})}>{[...nodes].filter(([k])=>k).map(([k,n])=><option key={k} value={k}>{n.name||k}</option>)}</select></label>
      <button className={button} onClick={()=>{const n=nodes.get(s.bucket_node);if(n){const f=fitSoilBucket(n,s.up_axis);change({center:f.center,size:f.size,rotation:f.rotation,capacity:Number(f.capacity.toFixed(3))})}}}>Fit volume to bucket at current pose</button>
      <label className="flex gap-2"><input type="checkbox" checked={s.show_guide} onChange={e=>change({show_guide:e.target.checked})}/>Show bucket volume guide</label>
      <p className="text-gray-500 dark:text-prosota-muted">Yellow box = scoop/fill volume. Blue arrow = opening. Fit while the bucket is upright, then adjust the box inside its cavity. In Carry, use Set mouth-up reference if the blue arrow points the wrong way. Guides are omitted from video capture.</p>
      <details><summary>Bucket / body calibration</summary>{vector('Volume centre (part coordinates)','center')}{vector('Volume size (part coordinates)','size')}{vector('Volume rotation (degrees)','rotation',true)}<p>{s.opening_direction?'Opening is calibrated separately from the volume. Set it from the Carry pose above.':'Opening follows the volume’s local Y axis until you set the mouth-up reference in Carry.'}</p>{number('Capacity (m³)','capacity',.001,100,.05)}{number('Pour when tilted past (degrees)','dump_angle',s.mode==='preloaded'?10:45,170,5)}{number('Empty full bucket in (seconds)','pour_seconds',.2,30,.1)}</details>
      <strong className="block">{s.mode==='preloaded'?'Receiving ground':'Source pile'}</strong>
      {s.mode!=='preloaded'&&<button className={button} onClick={place}>Place pile at current bucket</button>}
      {vector(s.mode==='preloaded'?'Ground base (project metres)':'Pile base (project metres)','source')}
      {s.mode!=='preloaded'&&<div className="grid grid-cols-2 gap-2">{number('Radius (m)','radius',.2,50,.1)}{number('Height (m)','height',.05,20,.1)}</div>}
      <label>Soil colour<input aria-label="Soil colour" type="color" value={s.color} onChange={e=>change({color:e.target.value})}/></label>
      <strong className="block">Cycle window</strong>
      <p>From starts the load cycle. To is when collection and pouring stop. Include travel and the complete pour; this window does not create movement.</p>
      {(['start','end'] as const).map(key=><div key={key} className="flex flex-wrap items-center gap-1"><span>{key==='start'?'From':'To'}</span>{format?<TimelinePointInput value={new Date(s[key])} format={format} placeholder={key} dayEdge={key==='start'?'start':'end'} onChange={d=>{if(d){const start=key==='start'?d.getTime():Date.parse(s.start),end=key==='end'?d.getTime():Date.parse(s.end);change({[key]:d.toISOString(),duration_seconds:duration(start,end)})}}}/>:<input aria-label={`Soil ${key}`} className={input} value={s[key]} onChange={e=>change({[key]:e.target.value})}/>}<button className={button} onClick={()=>{const start=key==='start'?time:Date.parse(s.start),end=key==='end'?time:Date.parse(s.end);change({[key]:new Date(time).toISOString(),duration_seconds:duration(start,end)})}}>Use playhead</button></div>)}
      <button className={button} onClick={()=>onSeek(new Date(s.start))}>Rewind soil cycle</button>
      <label className="block">Simulation detail<select className={input} value={s.steps} onChange={e=>change({steps:Number(e.target.value)})}><option value={120}>Quick · 120 steps</option><option value={240}>Balanced · 240 steps</option><option value={600}>Fine · 600 steps</option></select></label>
      <p className="text-gray-500 dark:text-prosota-muted">The full cycle spans {s.duration_seconds.toFixed(1)} simulation seconds. A full load needs {s.pour_seconds.toFixed(1)} seconds past the pour angle to empty: keep To later than the tipping key. Material already falling continues to land after To. Use timed route keys in Paths for travel and pauses, and equipment keys for lift and tip. Save rig & keys to retain these settings. Deposits land at the configured ground elevation. This is a visual bulk-material model; transfers between machines, tailgate collisions and soil mechanics are not simulated.</p>
      <button className={button} onClick={()=>onChange({...rig,definition:{...rig.definition,soil:null}})}>Remove soil cycle</button>
    </>}
  </details>
}

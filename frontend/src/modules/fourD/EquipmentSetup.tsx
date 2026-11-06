import { ToolVisualGuide } from './ToolVisualGuide'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { equipmentNodes, jointNodes, jointOffset, setJointTravel, validateEquipment, type EquipmentRig, type Vec3 } from './equipmentRig'
import type { EquipmentVisualState } from './EquipmentVisualEditor'
const button='rounded border border-gray-300 dark:border-prosota-line px-2 py-1 disabled:opacity-40'
const input='w-full rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel2 p-1'

export function EquipmentSetup({rig,object,onChange,onState,disabled=false,focusJoint}: {disabled?:boolean;focusJoint?:{id:string;request:number};rig:EquipmentRig;object?:THREE.Object3D;onChange:(r:EquipmentRig)=>void;onState:(s:EquipmentVisualState|null)=>void}) {
 const [selected,setSelected]=useState<string[]>([]), [hidden,setHidden]=useState<string[]>([]), [isolated,setIsolated]=useState<string[]|null>(null)
 const [mode,setMode]=useState<EquipmentVisualState['mode']>('select'), [group,setGroup]=useState(()=>focusJoint?.id||rig.definition.joints.find(j=>jointNodes(j).includes(rig.definition.soil?.bucket_node||''))?.id||rig.definition.joints[0]?.id||''), [name,setName]=useState('Loader arms')
 const [amount,setAmount]=useState(0), [message,setMessage]=useState('')
 const nodes=useMemo(()=>object?equipmentNodes(object):new Map<string,THREE.Object3D>(),[object])
 const joint=rig.definition.joints.find(j=>j.id===group)
 const control=rig.definition.controls.find(c=>c.id===joint?.control)
 const ends=joint&&control?[jointOffset(joint,control,0),jointOffset(joint,control,1)]:[0,0]
 const setEnd=(index:0|1)=>{
  try {const limits=[...ends];limits[index]=amount;const next={...rig,definition:setJointTravel(rig.definition,joint!.id,limits[0],limits[1])};validateEquipment(next.definition,nodes);onChange(next);setMessage(`Position ${index} applied. Switch to Animate to try it; Save rig & keys keeps it after reopening.`)}
  catch(e){setMessage((e as Error).message)}
 }
 const latest=useRef({rig,onChange,joint});latest.current={rig,onChange,joint}
 const change=(fn:(r:EquipmentRig)=>void)=>{
  const r=structuredClone(latest.current.rig); fn(r)
  try {validateEquipment(r.definition,nodes); latest.current.onChange(r);setMessage('')}
  catch(e){setMessage((e as Error).message)}
 }
 const updateJoint=(patch:object)=>change(r=>Object.assign(r.definition.joints.find(j=>j.id===group)!,patch))
 useEffect(()=>{
  if(!object || disabled) {onState(null);return}
  onState({model:rig.model_ref,selected,hidden,isolated,mode,joint:joint?.id,pivot:joint?.pivot,axis:joint?.axis,kind:joint?.kind,amount,rotation:joint?.pivot_rotation,label:joint?.name,
   beginPivot:()=>{setMode('pivot');setAmount(0)},
   rotatePivot:rotation=>{setMode('pivot');setAmount(0);const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));updateJoint({pivot_rotation:rotation,axis:new THREE.Vector3(0,0,1).applyQuaternion(q).toArray()});},
   pick:(path,add,point)=>{
    if(mode==='pivot' && joint){updateJoint({pivot:point});return}
    if(mode==='parent' && joint){
     const parent=latest.current.rig.definition.joints.find(j=>jointNodes(j).some(n=>path===n || path.startsWith(n+'/')))
     if(!parent){setMessage('That part has no moving group. Choose Equipment root for fixed chassis parts.');return}
     updateJoint({parent:parent.id});setMode('select');return
    }
    setSelected(p=>add?(p.includes(path)?p.filter(n=>n!==path):[...p,path]):[path])
   },movePivot:point=>{setMode('pivot');setAmount(0);updateJoint({pivot:point})},pose:setAmount})
 },[disabled,object,rig.model_ref,rig.definition,selected,hidden,isolated,mode,amount,group,onState])
 useEffect(()=>()=>onState(null),[onState])
 const selectGroup=(id:string)=>{
  const j=rig.definition.joints.find(j=>j.id===id);setGroup(id);setSelected(j?jointNodes(j):[]);setMode('select');setAmount(0);setMessage('')
 }
 useEffect(()=>{if(focusJoint)selectGroup(focusJoint.id)},[focusJoint])
 const create=()=>{
  if(!object || !selected.length || !name.trim())return
  const paths=selected.filter(n=>!selected.some(a=>n!==a&&n.startsWith(a+'/')))
  const id=crypto.randomUUID(),control=crypto.randomUUID()
  object.updateWorldMatrix(true,true)
  const bounds=new THREE.Box3();paths.forEach(n=>{const node=nodes.get(n);if(node)bounds.union(new THREE.Box3().setFromObject(node))})
  const pivot=object.worldToLocal(bounds.getCenter(new THREE.Vector3())).toArray() as Vec3
  const next=structuredClone(rig)
  next.definition.controls.push({id:control,name:name.trim(),value:0,rest:0,keys:[]})
  next.definition.joints.push({id,name:name.trim(),node:paths[0],members:paths.slice(1),parent:null,control,kind:'hinge',pivot,axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]})
  try {validateEquipment(next.definition,nodes);onChange(next);setGroup(id);setMode('pivot');setAmount(0);setMessage('Place the pivot at the hinge. Click a surface or drag the pivot arrows.');}
  catch(e){setMessage((e as Error).message)}
 }
 const hierarchy=(parent:string|null,depth=0):React.ReactNode=>depth>rig.definition.joints.length?null:rig.definition.joints.filter(j=>j.parent===parent).map(j=><div key={j.id}>
  <button className={`${button} w-full text-left ${j.id===group?'bg-blue-100 dark:bg-blue-950':''}`} style={{paddingLeft:8+depth*12}} onClick={()=>selectGroup(j.id)}>{j.name} · {jointNodes(j).length} parts</button>
  {hierarchy(j.id,depth+1)}
 </div>)
 return <section className="space-y-2" aria-label="Visual equipment setup">
  <label>Moving part<select aria-label="Setup moving part" className={input} value={group} onChange={e=>selectGroup(e.target.value)}><option value="">Choose moving part…</option>{rig.definition.joints.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
  {joint && <div className="border rounded p-2 space-y-2">
   <strong className="block">Movement range</strong>
   <p>Move this part with the slider, then Set 0 or Set 1. Each button applies that end immediately to the rig draft. These are slider limits, not timeline keyframes.</p>
   <p>Existing keys keep their 0–1 values and use the new range. Linked parts keep their own ranges; preview the mechanism after adjusting.</p>
   <button className={button} onClick={()=>setMode('pose')}>Pose with gizmo</button>
   <input aria-label="Setup pose" className="w-full" type="range" min={joint.kind==='hinge'?-180:-10} max={joint.kind==='hinge'?180:10} step={joint.kind==='hinge'?1:.01} value={amount} onChange={e=>{setMode('pose');setAmount(Number(e.target.value))}} />
   <label>Offset from imported pose ({joint.kind==='hinge'?'degrees':'model units'})<input className={input} type="number" step="any" value={amount} onChange={e=>{setMode('pose');setAmount(Number(e.target.value))}}/></label>
   <div className="flex gap-1"><button className={button} onClick={()=>setEnd(0)}>Set 0 position</button><button className={button} onClick={()=>setEnd(1)}>Set 1 position</button></div>
   <p>Applied limits: 0 = {Number(ends[0].toFixed(2))} · 1 = {Number(ends[1].toFixed(2))} {joint.kind==='hinge'?'degrees':'model units'}</p>
   <div className="flex gap-1">{([0,1] as const).map(i=><button key={i} className={button} onClick={()=>{setAmount(ends[i]);setMode('pose')}}>Preview {i} position</button>)}</div>
   {message && <p role="status" className="text-amber-700 dark:text-amber-300">{message}</p>}
   <button className={button} onClick={()=>{setAmount(0);setMode('select')}}>Return to imported pose</button>
   <details><summary>Part connections & pivot</summary>
   <input aria-label="Group name" className={input} value={joint.name} onChange={e=>updateJoint({name:e.target.value})}/>
   <button className={button} disabled={!selected.length} onClick={()=>updateJoint({node:selected[0],members:selected.slice(1)})}>Use selected parts for this group</button>
   <button className={button} onClick={()=>{
    const ids=new Set([joint.id]);let changed=true;while(changed){changed=false;rig.definition.joints.forEach(j=>{if(j.parent&&ids.has(j.parent)&&!ids.has(j.id)){ids.add(j.id);changed=true}})}
    setSelected(rig.definition.joints.filter(j=>ids.has(j.id)).flatMap(jointNodes))
   }}>Highlight group and children</button>
   <label>Parent group<select aria-label="Parent group" className={input} value={joint.parent??''} onChange={e=>updateJoint({parent:e.target.value||null})}><option value="">Equipment root</option>{rig.definition.joints.filter(j=>j.id!==joint.id).map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
   <button className={button} onClick={()=>setMode('parent')}>Pick parent in viewport</button>
   <ToolVisualGuide topic="rig" mode={joint.kind}/>
   <label>Motion<select className={input} value={joint.kind} onChange={e=>{setAmount(0);updateJoint({kind:e.target.value})}}><option value="hinge">Hinge rotation</option><option value="slide">Linear slide</option></select></label>
   <strong className="block">3. Place the pivot and choose an axis</strong>
   <button className={button} onClick={()=>{setMode('pivot');setAmount(0)}}>Place pivot in viewport</button>
   <p>Click the hinge surface or drag its arrows. Setup holds all other groups at their imported pose.</p>
   <div className="flex gap-1">{(['X','Y','Z'] as const).map((axis,i)=><button key={axis} className={button} onClick={()=>{setAmount(0);updateJoint({pivot_rotation:undefined,axis:[i===0?1:0,i===1?1:0,i===2?1:0]})}}>{axis} axis</button>)}</div>
   <p>Axis: {joint.axis.join(', ')} · Pivot: {joint.pivot.map(v=>v.toFixed(3)).join(', ')}</p>
   </details>
   <button className={button} disabled={rig.definition.joints.some(j=>j.parent===joint.id)} onClick={()=>{change(r=>{r.definition.joints=r.definition.joints.filter(j=>j.id!==joint.id);r.definition.motion_details=r.definition.motion_details?.filter(d=>d.joint!==joint.id)});selectGroup('')}}>Remove group</button>
  </div>}
  <details open={!rig.definition.joints.length}><summary>Create or regroup parts</summary>
  <strong>1. Select parts in the viewport</strong>
  <p>Click one part; Ctrl/Cmd-click adds parts. Orbit by dragging. Group pieces that move together.</p>
  <div className="flex flex-wrap gap-1">
   <button className={button} onClick={()=>setMode('select')}>Select parts</button>
   <button className={button} disabled={!selected.length} onClick={()=>setIsolated(selected)}>Isolate selection</button>
   <button className={button} disabled={!selected.length} onClick={()=>{setHidden(p=>[...p,...selected]);setSelected([])}}>Hide selection</button>
   <button className={button} onClick={()=>{setHidden([]);setIsolated(null)}}>Show all parts</button>
   <button className={button} onClick={()=>setSelected([])}>Clear selection</button>
  </div>
  <p>{selected.length} selected · Mode: {mode}</p>
  <details><summary>Selected part names</summary>{selected.map(n=><div className="break-all" key={n}>{nodes.get(n)?.name || n}</div>)}</details>
  <input aria-label="Moving group name" className={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Name this moving group" />
  <button className={button} disabled={!selected.length || !name.trim()} onClick={create}>Create moving group</button>
  <strong className="block">2. Equipment hierarchy</strong>
  <p>Equipment root</p>{hierarchy(null)}
  {!rig.definition.joints.length && <p>No moving groups yet.</p>}
  </details>
  {message && !joint && <p role="status" className="text-amber-700 dark:text-amber-300">{message}</p>}
 </section>
}

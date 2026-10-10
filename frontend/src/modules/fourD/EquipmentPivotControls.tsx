import * as THREE from 'three'
import { TransformPanel, type GizmoMode, type GizmoSpace } from './TransformPanel'
import { equipmentNodes } from './equipmentRig'
import type { EquipmentVisualState } from './EquipmentVisualEditor'

/** Adapter for the existing transform panel: all edits target the joint, never the model. */
export function EquipmentPivotControls({state,root,mode,space,onMode,onSpace,upAxis}: {
 upAxis: 'y'|'z'
 state:EquipmentVisualState;root:THREE.Object3D;mode:GizmoMode;space:GizmoSpace;onMode:(m:GizmoMode)=>void;onSpace:(s:GizmoSpace)=>void
}) {
 const q=state.rotation ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...state.rotation)) : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...(state.axis??[0,0,1])).normalize())
 const point=new THREE.Vector3(...state.pivot!)
 const center=(base:boolean)=>{
  const nodes=equipmentNodes(root),box=new THREE.Box3()
  state.selected.forEach(k=>{const n=nodes.get(k);if(n)box.union(new THREE.Box3().setFromObject(n))})
  if(box.isEmpty())return
  const p=box.getCenter(new THREE.Vector3());if(base)p[upAxis]=box.min[upAxis]
  state.movePivot(root.worldToLocal(p).toArray() as [number,number,number])
 }
 return <div className="border-t border-gray-200 dark:border-prosota-line">
  <p className="px-3 py-2 text-xs font-semibold">Equipment pivot: {state.label}</p>
  <p className="px-3 text-xs text-gray-500">Move/Rotate edits the hinge only. Pivot fields use equipment-root coordinates; local Z is the joint axis.</p>
  <TransformPanel pivotOnly object={root} mode={mode==='scale'?'translate':mode} onModeChange={m=>{if(m==='scale')return;onMode(m);state.beginPivot()}}
   space={space} onSpaceChange={onSpace} editPivot snapToSurface={false} onEditPivotChange={()=>{}} onSnapToSurfaceChange={()=>{}}
   upAxis="y" lengthUnitToMetres={null} unitDisplay="auto" keyframes={null} pathProgress={null} onFieldChange={()=>{}}
   pivot={{point,picking:state.mode==='pivot',onTogglePicking:state.beginPivot,onChange:p=>state.movePivot(p.toArray() as [number,number,number]),onReset:()=>state.movePivot([0,0,0]),onSetToCenter:()=>center(false),onSetToBase:()=>center(true)}}
   pivotRotation={{euler:new THREE.Euler().setFromQuaternion(q,'XYZ'),onChange:e=>state.rotatePivot([e.x,e.y,e.z]),onReset:()=>state.rotatePivot([0,0,0])}} />
 </div>
}

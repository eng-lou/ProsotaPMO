import { useEffect,useMemo,useState } from 'react'
import { Canvas,useFrame } from '@react-three/fiber'
import { OrbitControls,TransformControls,Bounds } from '@react-three/drei'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { SiteItem } from '../fourD/siteScene'
import { WorkerActionPlayer,attachmentNode } from '../fourD/workerActions'
import { clipPathAnchor } from '../fourD/clipPathAnchor'
import type { WorkerMethod } from './workerMethod'
import type { Pose } from './types'

function FitScene({worker,tool,workerItem,toolItem,method,mode,time,onChange}:{worker:THREE.Object3D;tool:THREE.Object3D;workerItem:SiteItem;toolItem:SiteItem;method:WorkerMethod;mode:'translate'|'rotate';time:number;onChange:(pose:Pose)=>void}){
 const scene=useMemo(()=>{
  const w=clone(worker),t=clone(tool),actor=new THREE.Group(),dimensions=new THREE.Group(),anchorOffset=new THREE.Group(),anchor=new THREE.Group(),offset=new THREE.Group(),toolDimensions=new THREE.Group()
  const up=(item:SiteItem)=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),item.up_axis==='z'?Math.PI/2:0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(item.yaw)))
  actor.scale.set(workerItem.scale?.x??1,workerItem.scale?.y??1,workerItem.scale?.z??1)
  dimensions.quaternion.copy(up(workerItem));dimensions.scale.set(workerItem.width,workerItem.height,workerItem.depth)
  actor.add(dimensions);dimensions.add(anchorOffset);anchorOffset.add(w)
  const idle=w.animations.find(c=>c.name===method.idle_clip);if(idle)anchorOffset.position.copy(clipPathAnchor(w,idle))
  toolDimensions.quaternion.copy(up(toolItem));toolDimensions.scale.set(toolItem.width,toolItem.height,toolItem.depth)
  offset.scale.set(toolItem.scale?.x??1,toolItem.scale?.y??1,toolItem.scale?.z??1);toolDimensions.add(t);offset.add(toolDimensions);anchor.add(offset)
  const player=new WorkerActionPlayer(w),hips=attachmentNode(w,'CC_Base_Hip')??attachmentNode(w,'CC_Base_Pelvis'),origins=new Map<string,THREE.Vector3>()
  if(hips)for(const clip of w.animations){player.evaluate([],0,1,w.animations.indexOf(clip),0);origins.set(clip.name,hips.position.clone())}
  return {w,actor,anchor,offset,player,hips,origins}
 },[worker,tool,workerItem,toolItem,method.idle_clip])
 useEffect(()=>()=>scene.player.dispose(),[scene])
 useEffect(()=>{scene.offset.position.fromArray(method.grip.position);scene.offset.rotation.set(...method.grip.rotation.map(THREE.MathUtils.degToRad) as [number,number,number])},[method.grip,scene])
 useFrame(()=>{
  scene.player.evaluate([],0,1,scene.w.animations.findIndex(c=>c.name===method.work_clip),time)
  const origin=scene.origins.get(method.work_clip);if(scene.hips&&origin){scene.hips.position.x=origin.x;scene.hips.position.z=origin.z}
  scene.actor.updateWorldMatrix(true,true)
  const hand=attachmentNode(scene.w,method.hand);if(hand){hand.updateWorldMatrix(true,false);hand.matrixWorld.decompose(scene.anchor.position,scene.anchor.quaternion,new THREE.Vector3());scene.anchor.updateMatrixWorld(true)}
 })
 return <><Bounds fit clip margin={1.3}><primitive object={scene.actor}/></Bounds><primitive object={scene.anchor}/><TransformControls object={scene.offset} mode={mode} space="local" onMouseUp={()=>onChange({position:scene.offset.position.toArray(),rotation:[scene.offset.rotation.x,scene.offset.rotation.y,scene.offset.rotation.z].map(THREE.MathUtils.radToDeg) as [number,number,number]})}/><OrbitControls makeDefault/><ambientLight intensity={1.7}/><directionalLight position={[5,8,9]} intensity={2}/></>
}
export function MethodGripPreview(props:{worker:THREE.Object3D;tool:THREE.Object3D;workerItem:SiteItem;toolItem:SiteItem;method:WorkerMethod;onChange:(pose:Pose)=>void}){
 const [mode,setMode]=useState<'translate'|'rotate'>('translate'),[time,setTime]=useState(0)
 const duration=props.worker.animations.find(c=>c.name===props.method.work_clip)?.duration??1
 return <div className="method-fit"><div className="row"><button type="button" className={mode==='translate'?'primary':''} onClick={()=>setMode('translate')}>Move tool</button><button type="button" className={mode==='rotate'?'primary':''} onClick={()=>setMode('rotate')}>Rotate tool</button><span className="muted">Drag the coloured handles. Drag elsewhere to orbit.</span></div><div style={{height:340,background:'#dce5ed',borderRadius:8,marginTop:8}}><Canvas camera={{position:props.workerItem.up_axis==='z'?[3,-4,2.5]:[3,2.5,4],up:props.workerItem.up_axis==='z'?[0,0,1]:[0,1,0],fov:38}}><FitScene {...props} mode={mode} time={time}/></Canvas></div><label>Check the grip through the work motion<input aria-label="Grip preview time" type="range" min={0} max={duration} step={.01} value={time} onChange={e=>setTime(Number(e.target.value))}/></label><small>This fitting view changes the method's grip only. Choose a work motion with the correct hand posture.</small></div>
}

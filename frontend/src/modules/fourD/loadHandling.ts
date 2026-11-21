import * as T from 'three'
import type { SiteItem } from './siteScene'
import { attachmentNode } from './workerActions'

export interface SlingLeg { point:number; parent_id:string; node:string; length:number; offset?:[number,number,number]; capacity_kn?:number }
export interface LiftRig { legs:SlingLeg[]; mass_kg:number; floor?:number|null }
export interface LoadEvent {
  id:string; date:string; parent_id:string|null; node:string; rigging?:LiftRig|null
  // Metre-based anchor-relative pose for attachment; world pose for release.
  matrix:number[]; slings:boolean; sling_offset?:[number,number,number]; sling_ring_angle?:number
}
export interface LoadHandling { balance_mode?:'gravity'|'fixed'; center_of_gravity?:[number,number,number]|null; events:LoadEvent[]; lifting_points:[number,number,number][]; lifting_nodes?:string[] }
export const loadRoots=new Map<string,T.Object3D>()
export const loadDates=new Map<string,number>()
export function anchorFrame(anchor:T.Object3D){
  anchor.updateWorldMatrix(true,false)
  const p=new T.Vector3(),q=new T.Quaternion();anchor.matrixWorld.decompose(p,q,new T.Vector3())
  return new T.Matrix4().compose(p,q,new T.Vector3(1,1,1))
}
export function loadEventAt(events:LoadEvent[],date:number){
  const ordered=[...events].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).filter(e=>Date.parse(e.date)<=date)
  return ordered[ordered.length-1]
}
export function loadEventWorld(event:LoadEvent,anchor?:T.Object3D|null){
  if(event.parent_id&&!anchor)return null
  const pose=new T.Matrix4().fromArray(event.matrix)
  return event.parent_id?anchorFrame(anchor!).multiply(pose):pose
}
export function captureLoadEvent(item:SiteItem,parentId:string|null,node:string,date:Date,slings:boolean):LoadEvent{
  const object=loadRoots.get(item.id)
  if(!object||loadDates.get(item.id)!==date.getTime())throw Error('Pause at the required timeline position and wait for the viewport to update.')
  if(object.userData.simulatorOwnsPose)throw Error('Stop Simulator playback before recording load attachments.')
  object.updateWorldMatrix(true,false)
  let pose=object.matrixWorld.clone()
  if(parentId){
    if(parentId===item.id)throw Error('An object cannot follow itself.')
    const parent=loadRoots.get(parentId),anchor=parent&&attachmentNode(parent,node)
    if(!anchor)throw Error('The selected parent or named connection is not available in the viewport.')
    pose=anchorFrame(anchor).invert().multiply(pose)
  }
  const p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();pose.decompose(p,q,scale)
  const rebuilt=new T.Matrix4().compose(p,q,scale)
  if(pose.elements.some((v,i)=>Math.abs(v-rebuilt.elements[i])>1e-6*Math.max(1,Math.abs(v))))throw Error('Apply non-uniform parent scaling before recording this load transfer.')
  return {id:crypto.randomUUID(),date:date.toISOString(),parent_id:parentId,node,matrix:pose.toArray(),slings:!!parentId&&slings}
}
export function validateLoadEvents(events:LoadEvent[]){
  const times=events.map(e=>Date.parse(e.date))
  if(times.some(t=>!Number.isFinite(t))||new Set(times).size!==times.length)throw Error('Each attachment event needs a different valid timeline time.')
  for(const e of events)if(e.matrix.length!==16||e.matrix.some(n=>!Number.isFinite(n))||[3,7,11].some(i=>Math.abs(e.matrix[i])>1e-8)||Math.abs(e.matrix[15]-1)>1e-8||Math.abs(new T.Matrix4().fromArray(e.matrix).determinant())<1e-10)throw Error('Invalid load transform.')
}

/** Named points follow articulated children; legacy/manual points remain root-local. */
export function liftingPointWorld(root:T.Object3D,point:[number,number,number],node?:string){
  if(node){const anchor=attachmentNode(root,node);return anchor?anchor.getWorldPosition(new T.Vector3()):null}
  return root.localToWorld(new T.Vector3(...point))
}

/** Imported mesh origins can be at ground level despite the hook geometry being aloft.
 * Use the selected part's visible bounds for the sling only; retain the original
 * attachment frame so saved load transfers do not jump when this fix is loaded.
 * Empty connection markers and bones retain their explicit origins.
 */
export function slingAnchorWorld(anchor:T.Object3D){
  anchor.updateWorldMatrix(true,true)
  if(!(anchor as T.Bone).isBone){
    const bounds=new T.Box3()
    anchor.traverse(n=>{
      const mesh=n as T.Mesh
      if(!mesh.isMesh)return
      for(let p:T.Object3D|null=n;p;p=p.parent)if(!p.visible)return
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox()
      if(mesh.geometry.boundingBox)bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
    })
    if(!bounds.isEmpty())return bounds.getCenter(new T.Vector3())
  }
  return anchor.getWorldPosition(new T.Vector3())
}

// Editor-only marker selection; never persisted in project data.
export const slingEditors=new Set<string>()
export function slingConnection(anchor:T.Object3D,event:LoadEvent){
  const frame=anchorFrame(anchor),rotation=new T.Quaternion().setFromRotationMatrix(frame)
  const seat=slingAnchorWorld(anchor).add(new T.Vector3(...(event.sling_offset||[0,0,0])).applyQuaternion(rotation))
  rotation.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),(event.sling_ring_angle||0)*Math.PI/180))
  const up=new T.Vector3(0,1,0).applyQuaternion(rotation)
  return {seat,center:seat.clone().addScaledVector(up,-.12),bottom:seat.clone().addScaledVector(up,-.24),rotation}
}

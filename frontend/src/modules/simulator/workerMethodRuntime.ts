import * as THREE from 'three'
import { WorkerActionPlayer, attachmentNode, attachmentWorld } from '../fourD/workerActions'
import { clipPathAnchor } from '../fourD/clipPathAnchor'
import type { SiteItem } from '../fourD/siteScene'
import type { SimEvent } from './types'
import { methodAt, methodRoutePoint, type WorkerMethod } from './workerMethod'

export function animationRoot(object:THREE.Object3D){
 const found:THREE.Object3D[]=[];object.traverse(n=>{if(n.userData.siteAssetRigRoot&&n.animations.length)found.push(n)})
 return found.length===1?found[0]:null
}
function snapshot(n:THREE.Object3D){return {n,p:n.position.clone(),q:n.quaternion.clone(),s:n.scale.clone(),v:n.visible}}
type Saved=ReturnType<typeof snapshot>
function restore(s:Saved){s.n.position.copy(s.p);s.n.quaternion.copy(s.q);s.n.scale.copy(s.s);s.n.visible=s.v;s.n.updateMatrixWorld(true)}
/** Owns only the preview pose. The project recipe and authored route keys never change. */
export class WorkerMethodRuntime {
 private saved:Saved[]=[]
 private player:WorkerActionPlayer
 private root:THREE.Object3D
 private anchor:THREE.Object3D
 private idleAnchor:THREE.Vector3
 private baseRootPositions=new Map<string,THREE.Vector3>()
 private hips:THREE.Object3D|null
 private ownsTool=false
 constructor(public method:WorkerMethod,private worker:THREE.Object3D,private tool:THREE.Object3D,private item:SiteItem){
  const root=animationRoot(worker);if(!root)throw Error('Worker geometry or motions are not loaded yet.')
  for(const name of [method.idle_clip,method.walk_clip,method.work_clip])if(root.animations.filter(c=>c.name===name).length!==1)throw Error('Missing or ambiguous motion: '+name)
  const hand=attachmentNode(root,method.hand);if(!hand)throw Error('Worker hand is unavailable: '+method.hand)
  if(!method.route)throw Error('Run the method again to capture its route.')
  this.root=root;this.anchor=hand
  // Preserve all original local poses, including native mixer and attachment frames.
  worker.traverse(n=>this.saved.push(snapshot(n)));tool.traverse(n=>this.saved.push(snapshot(n)))
  for(const n of [worker.parent,tool.parent])if(n)this.saved.push(snapshot(n))
  this.player=new WorkerActionPlayer(root)
  this.idleAnchor=clipPathAnchor(root,root.animations.find(c=>c.name===method.idle_clip)!)
  this.hips=attachmentNode(root,'CC_Base_Hip')??attachmentNode(root,'CC_Base_Pelvis')??null
  if(this.hips)for(const name of [method.idle_clip,method.walk_clip,method.work_clip]){this.player.evaluate([],0,1,root.animations.findIndex(c=>c.name===name),0);this.baseRootPositions.set(name,this.hips.position.clone())}
  this.saved.forEach(restore)
 }
 matches(worker:THREE.Object3D,tool:THREE.Object3D){return this.worker===worker&&this.tool===tool&&animationRoot(worker)===this.root}
 releaseTool(){if(this.ownsTool){this.saved.filter(s=>s.n===this.tool||s.n===this.tool.parent).forEach(restore);delete this.tool.userData.simulatorOwnsPose;this.ownsTool=false}}
 own(tool=true){this.worker.userData.simulatorOwnsPose=true;if(tool){this.tool.userData.simulatorOwnsPose=true;this.ownsTool=true}}
 evaluate(events:SimEvent[],step:string,time:number){
  const state=methodAt(events,step,time);if(!state)return
  const m=this.method;this.worker.userData.simulatorOwnsPose=true
  // Keep a worker through its entire method (including calendar pauses),
  // but remove it before arrival and after its final departure. Seeking back
  // into a method must restore visibility, not depend on playback direction.
  this.worker.visible=state.started&&!state.finished
  // Site objects have a dedicated path/attachment parent in project coordinates.
  for(const n of [this.worker.parent,...(this.ownsTool?[this.tool.parent]:[])])if(n){n.position.set(0,0,0);n.quaternion.identity();n.scale.setScalar(1);n.visible=true;n.updateMatrixWorld(true)}
  this.worker.position.copy(methodRoutePoint(m,state.routeProgress))
  const direction=methodRoutePoint(m,Math.min(1,state.routeProgress+.002)).sub(methodRoutePoint(m,Math.max(0,state.routeProgress-.002)))
  const up=new THREE.Vector3(0,this.item.up_axis==='y'?1:0,this.item.up_axis==='z'?1:0)
  const angle=this.item.up_axis==='z'?Math.atan2(direction.x,-direction.y):Math.atan2(direction.x,direction.z)
  this.worker.quaternion.setFromAxisAngle(up,angle+THREE.MathUtils.degToRad(m.heading-this.item.yaw))
  this.worker.scale.set(this.item.scale?.x??1,this.item.scale?.y??1,this.item.scale?.z??1)
  const walking=state.active&&state.stage!=='work',working=state.started&&!state.finished&&state.stage==='work'
  const clip=walking?m.walk_clip:working?m.work_clip:m.idle_clip
  const clock=walking?state.routeProgress*m.route!.length_m/m.stride_mps:working?state.clipSeconds:0
  this.player.evaluate([],0,1,this.root.animations.findIndex(c=>c.name===clip),clock)
  // Route movement owns horizontal root travel; keep vertical gait motion.
  const base=this.baseRootPositions.get(clip)
  if(this.hips&&base){this.hips.position.x=base.x;this.hips.position.z=base.z}
  if(this.root.parent)this.root.parent.position.copy(this.idleAnchor)
  this.worker.updateWorldMatrix(true,true)
  if(!this.ownsTool)return
  const first=events.filter(e=>e.step_id===step&&e.worker_action).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0]
  this.tool.visible=m.tool_during==='whole_method'?!!first&&time>=Date.parse(first.start)&&!state.finished:working
  if(this.tool.visible){
   const [x,y,z]=m.grip.position,[rx,ry,rz]=m.grip.rotation
   const world=attachmentWorld(this.anchor,{parent_id:m.worker_id,node:m.hand,start:'',end:'',only_during:true,position:{x,y,z},rotation:{x:rx,y:ry,z:rz}})
   const original=this.saved.find(s=>s.n===this.tool)!
   world.scale(original.s)
   this.tool.parent?.updateWorldMatrix(true,false)
   const local=this.tool.parent?this.tool.parent.matrixWorld.clone().invert().multiply(world):world
   local.decompose(this.tool.position,this.tool.quaternion,this.tool.scale);this.tool.updateMatrixWorld(true)
  }
 }
 dispose(){this.player.dispose();this.releaseTool();this.saved.filter(s=>s.n===this.worker.parent||s.n===this.worker||this.worker.getObjectById(s.n.id)).forEach(restore);delete this.worker.userData.simulatorOwnsPose}
}

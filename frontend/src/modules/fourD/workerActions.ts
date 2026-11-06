import * as THREE from 'three'
import type { PathMotion } from './siteScene'
import { sampleSitePath, sitePathRange, sitePathProgress } from './sitePathMotion'

/** Dates share the project's timeline; clip time is measured in playback seconds. */
export interface WorkerAction {
  id: string; name: string; start: string; end: string; clip: number
  speed: number; loop: boolean; blend: number
}
export interface SiteAttachment {
  parent_id: string; node: string; start: string; end: string
  position: {x:number;y:number;z:number}; rotation: {x:number;y:number;z:number}
  only_during: boolean
}
export const actionDate = (value: string) => Date.parse(value)
export function validateActions(actions: WorkerAction[], clipCount?: number) {
  const ordered=[...actions].sort((a,b)=>actionDate(a.start)-actionDate(b.start))
  if(new Set(actions.map(a=>a.id)).size!==actions.length)throw Error('Each action needs a unique ID.')
  for(let i=0;i<ordered.length;i++){
    const a=ordered[i],start=actionDate(a.start),end=actionDate(a.end)
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('Each action must finish after it starts.')
    if(i && start<actionDate(ordered[i-1].end))throw Error('Actions for one actor cannot overlap. Move the start after the preceding action.')
    if(!Number.isInteger(a.clip)||a.clip<0||(clipCount!==undefined&&a.clip>=clipCount))throw Error('An action refers to a missing clip. Choose its motion again.')
    if(!Number.isFinite(a.speed)||a.speed<=0||a.speed>10||!Number.isFinite(a.blend)||a.blend<0||a.blend>5)throw Error('Choose a valid action speed and blend length.')
  }
  return ordered
}
export function sampleWorkerAction(actions:WorkerAction[],date:number,daysPerSecond:number){
  const action=actions.find(a=>date>=actionDate(a.start)&&date<actionDate(a.end))
  if(!action)return null
  const scale=86400000*Math.max(daysPerSecond,1e-9),time=(date-actionDate(action.start))/scale,duration=(actionDate(action.end)-actionDate(action.start))/scale
  const fade=Math.min(action.blend,duration/2)
  const weight=fade?Math.max(0,Math.min(1,time/fade,(duration-time)/fade)):1
  return {action,time:time*action.speed,weight}
}
/** Stateless seeking: entering, reversing or jumping gives the same evaluated pose. */
export class WorkerActionPlayer {
  private mixer:THREE.AnimationMixer
  private actions:THREE.AnimationAction[]
  constructor(private root:THREE.Object3D){
    this.mixer=new THREE.AnimationMixer(root)
    this.actions=root.animations.map(c=>this.mixer.clipAction(c))
  }
  evaluate(sequence:WorkerAction[],date:number,daysPerSecond:number,baseClip:number,baseTime:number){
    const sample=sampleWorkerAction(sequence,date,daysPerSecond)
    this.actions.forEach(a=>{a.enabled=false;a.setEffectiveWeight(0)})
    const set=(index:number,time:number,weight:number,loop:boolean)=>{
      const a=this.actions[index];if(!a||weight<=0)return
      a.enabled=true;a.paused=true;a.play();a.setEffectiveWeight(weight)
      const duration=a.getClip().duration
      a.time=loop&&duration>0?((time%duration)+duration)%duration:Math.max(0,Math.min(duration,time))
    }
    // If the action uses the base clip, do not overwrite its requested phase.
    if(sample&&sample.action.clip===baseClip)set(baseClip,sample.time,1,sample.action.loop)
    else{
      set(baseClip,baseTime,1-(sample?.weight||0),true)
      if(sample)set(sample.action.clip,sample.time,sample.weight,sample.action.loop)
    }
    this.mixer.update(0);this.root.updateWorldMatrix(true,true)
  }
  dispose(){this.mixer.stopAllAction();this.mixer.uncacheRoot(this.root)}
}
export function attachmentNode(root:THREE.Object3D,name:string){
  if(!name)return root
  const found:THREE.Object3D[]=[];root.traverse(n=>{if(n.name===name)found.push(n)})
  return found.length===1?found[0]:null
}
/** Offset uses metres along the anchor axes, independent of imported bone scale. */
export function attachmentWorld(anchor:THREE.Object3D,attachment:SiteAttachment){
  anchor.updateWorldMatrix(true,false)
  const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3()
  anchor.matrixWorld.decompose(p,q,s)
  p.add(new THREE.Vector3(attachment.position.x,attachment.position.y,attachment.position.z).applyQuaternion(q))
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(['x','y','z'] as const).map(k=>THREE.MathUtils.degToRad(attachment.rotation[k])) as [number,number,number])))
  return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1))
}

export function routeStopForAction(motion:PathMotion,curve:THREE.Curve<THREE.Vector3>,action:WorkerAction,daysPerSecond:number):PathMotion{
  const time=actionDate(action.start),end=actionDate(action.end),duration=end-time,scale=86400000*daysPerSecond
  const range=sitePathRange(motion,curve.getLength(),daysPerSecond)
  if(time<range.start.getTime()||time>range.end.getTime())throw Error('Choose an action start within the journey to add a stop.')
  if(!Number.isFinite(duration)||duration<=0)throw Error('The action must finish after it starts.')
  const keys=motion.progress_keys?.length?motion.progress_keys:[{date:motion.start,progress:0,interpolation:'linear' as const},{date:range.end.toISOString(),progress:100,interpolation:'linear' as const}]
  const between=keys.filter(k=>actionDate(k.date)>=time&&actionDate(k.date)<=end)
  const atStart=sitePathProgress({...motion,progress_keys:keys},time),atEnd=sitePathProgress({...motion,progress_keys:keys},end)
  if(end<=range.end.getTime()&&atStart===atEnd&&between.every(k=>k.progress===atStart))return motion
  const progress=sampleSitePath(curve,motion,(time-actionDate(motion.start))/scale,'y',daysPerSecond).progress
  const next=[...keys.filter(k=>actionDate(k.date)<time),{date:action.start,progress,interpolation:'linear' as const},{date:action.end,progress,interpolation:'linear' as const},...keys.filter(k=>actionDate(k.date)>time).map(k=>({...k,date:new Date(actionDate(k.date)+duration).toISOString()}))]
  if(next.length>200)throw Error('The route already has too many timing keys. Remove unused keys before adding another stop.')
  return {...motion,loop:false,progress_keys:next}
}

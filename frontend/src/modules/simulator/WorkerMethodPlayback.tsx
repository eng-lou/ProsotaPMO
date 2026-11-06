import { useEffect,useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Object3D } from 'three'
import type { Scenario } from './types'
import type { SiteItem } from '../fourD/siteScene'
import { WorkerMethodRuntime,animationRoot } from './workerMethodRuntime'

export function WorkerMethodPlayback({scenario,objects,items,dateRef,onError}:{scenario:Scenario;objects:{id:string;object:Object3D}[];items:SiteItem[];dateRef:React.MutableRefObject<Date|null>;onError:(message:string)=>void}){
 const runtimes=useRef(new Map<string,WorkerMethodRuntime>()),reported=useRef('')
 const reset=()=>{for(const r of runtimes.current.values())r.dispose();runtimes.current.clear()}
 useEffect(()=>()=>{reset();reported.current='';onError('')},[scenario,objects,items])
 useFrame(()=>{
  const events=scenario.result?.events??[],time=dateRef.current?.getTime();if(time==null)return
  // One active method per physical actor; the solver reserves actors through all stages.
  const steps=scenario.config.steps.filter(s=>s.worker_method&&events.some(e=>e.step_id===s.id&&e.worker_action))
  const start=(id:string)=>Math.min(...events.filter(e=>e.step_id===id&&e.worker_action).map(e=>Date.parse(e.start)))
  const selected=new Map<string,typeof steps[number]>()
  for(const s of [...steps].sort((a,b)=>start(a.id)-start(b.id))){const m=s.worker_method!;if(!selected.has(m.worker_id)||start(s.id)<=time)selected.set(m.worker_id,s)}
  // Remove completed owners before allocating a tool to the next worker.
  const chosen=[...selected.values()].sort((a,b)=>{
   const x=start(a.id),y=start(b.id);return (x<=time?0:1)-(y<=time?0:1)||(x<=time?y-x:x-y)
  }),tools=new Set<string>(),owners=new Set<string>()
  for(const s of chosen){const id=s.worker_method!.tool_id;if(!tools.has(id)){tools.add(id);owners.add(s.id)}}
  const active=chosen
  for(const [id,r] of runtimes.current)if(!active.some(s=>s.id===id)){r.dispose();runtimes.current.delete(id)}
  for(const [id,r] of runtimes.current)if(!owners.has(id))r.releaseTool()
  // A newly loaded/rebound method must snapshot the authored tool pose, never
  // the pose left by another method using the same prop in the previous frame.
  if(active.some(s=>{const m=s.worker_method!,w=objects.find(o=>o.id==='site:'+m.worker_id)?.object,t=objects.find(o=>o.id==='site:'+m.tool_id)?.object;return w&&t&&!runtimes.current.get(s.id)?.matches(w,t)}))for(const r of runtimes.current.values())r.releaseTool()
  const errors:string[]=[]
  for(const s of active){const m=s.worker_method!,worker=objects.find(o=>o.id==='site:'+m.worker_id)?.object,tool=objects.find(o=>o.id==='site:'+m.tool_id)?.object,item=items.find(i=>i.id===m.worker_id)
   if(!worker||!tool||!item||!animationRoot(worker)){errors.push('Load the assigned worker and tool to play '+s.name+'.');continue}
   try{let r=runtimes.current.get(s.id);if(r&&!r.matches(worker,tool)){r.dispose();runtimes.current.delete(s.id);r=undefined}if(!r){r=new WorkerMethodRuntime(m,worker,tool,item);runtimes.current.set(s.id,r)}r.own(owners.has(s.id))}catch(e){errors.push((e as Error).message)}
  }
  const message=errors.join(' ');if(message!==reported.current){reported.current=message;onError(message)}
 },-3)
 useFrame(()=>{const time=dateRef.current?.getTime();if(time!=null)for(const [id,r]of runtimes.current)r.evaluate(scenario.result?.events??[],id,time)},0)
 return null
}

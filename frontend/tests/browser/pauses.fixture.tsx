import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CameraPresetsPanel} from '../../src/modules/fourD/CameraPresetsPanel'
import {DEFAULT_MOTION, sampleSequence, sequencePosition, type MotionShot} from '../../src/modules/fourD/cameraMotion'
const wait=()=>new Promise(r=>setTimeout(r,100))
export async function run() {
 const pose={base_position_x:10,base_position_y:0,base_position_z:4,base_target_x:0,base_target_y:0,base_target_z:0,base_focal_length:35,base_clip_start:.1,base_clip_end:10000}
 const initial:MotionShot={id:'a',name:'Orbit',settings:{...DEFAULT_MOTION},target:[0,0,0],radius:2,upAxis:'z',start:pose,end:null,startOffset:[0,0,0],endOffset:[0,0,0],stage:'progress',dateStart:'2026-01-01',dateEnd:'2026-04-01',blend:0}
 let saved:any, latest=initial
 const current={active:true,playing:false,reverse:false,seconds:4,shots:[initial],detailIds:new Set<string>(),presentation:sequencePosition([initial],4)}
 const controller:any={active:true,playing:false,seconds:4,state:{current},pause(){},restore(){},play(){},seek(t:number){current.seconds=t},activate(shots:MotionShot[]){current.shots=shots},readPose:()=>pose}
 function App(){const [shot,setShot]=useState(initial);return <CameraPresetsPanel controller={controller} shot={shot} onChange={s=>{latest=s;setShot(s)}} targets={[{id:'all',name:'All'}]} detailTargets={[{id:'annotation:a',name:'Test callout'}]} resolveTarget={async()=>({target:[0,0,0],radius:2})} upAxis="z" aspect={1} date={new Date()} views={[]} cameras={[]} onSave={async(_,motion)=>{saved=motion}} onPick={()=>{}} picking={false} onClose={()=>{}} exporting={false}/>}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);root.render(<App/>);await wait()
 const click=(text:string)=>{const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);if(!button)throw Error('Missing '+text);button.click()}
 click('Insert pause here');await wait()
 if(latest.pauses?.[0]?.at!==4)throw Error('Pause inserted at wrong frame')
 const checkbox=Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.includes('Test callout'))?.querySelector('input');checkbox?.click();await wait()
 click('Save Shot');await wait()
 if(saved?.shots[0]?.pauses[0]?.details[0]!=='annotation:a')throw Error('Pause details not saved')
 const a=sampleSequence(saved.shots,4),b=sampleSequence(saved.shots,6)
 if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Camera or date moved during hold')
 click('Remove pause');await wait()
 if(latest.pauses?.length)throw Error('Remove pause failed')
 root.unmount();host.remove();return {passed:true,checks:['insert at current frame','select callout','save shot with pause','hold camera and date','remove pause']}
}

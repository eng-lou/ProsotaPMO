import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useCameraMotion } from '../../frontend/src/modules/fourD/useCameraMotion'
import { CameraPresetsPanel } from '../../frontend/src/modules/fourD/CameraPresetsPanel'
import { CameraMotionDriver, CameraMotionHelpers } from '../../frontend/src/modules/fourD/CameraMotionHelpers'
import { sampleSequence, type MotionShot } from '../../frontend/src/modules/fourD/cameraMotion'
function Register({ cameraRef }: any) { const camera = useThree(s=>s.camera); cameraRef.current = camera; return null }
function Fixture() {
 const camera=useRef<any>(null), controls=useRef<any>(null),date=useRef<Date|null>(null)
 const c=useCameraMotion(camera,controls,date),[shot,setShot]=useState<MotionShot|null>(null),[saved,setSaved]=useState<any[]>([])
 Object.assign(window,{check:{c,camera,controls,date,shot,saved}})
 return <div style={{position:'relative',width:1100,height:820}}><Canvas camera={{position:[10,8,6],near:.1,far:1000}}><Register cameraRef={camera}/><ambientLight intensity={2}/><directionalLight position={[4,8,3]}/><mesh><boxGeometry args={[3,5,3]}/><meshStandardMaterial color="#38bdf8"/></mesh><gridHelper args={[30,30]}/><OrbitControls ref={controls} makeDefault enabled={!c.active}/><CameraMotionDriver controller={c}/>{shot&&!c.active&&<CameraMotionHelpers shot={shot} onChange={setShot}/>}</Canvas><CameraPresetsPanel controller={c} shot={shot} onChange={setShot} targets={[{id:'all',name:'Whole model'}]} resolveTarget={async()=>({target:[0,0,0],radius:3})} upAxis="y" aspect={1.34} date={new Date('2026-01-01T00:00:00Z')} views={[]} cameras={saved} onSave={async(name,motion)=>setSaved(v=>[...v,{id:crypto.randomUUID(),name,motion}])} onPick={()=>{}} picking={false} onClose={()=>{}} exporting={false}/></div>
}
createRoot(document.getElementById('app')!).render(<Fixture/>);
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));const check=(x:any,m:string)=>{if(!x)throw Error(m)}
const button=(text:string)=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text);check(b,'Missing '+text);b!.click()}
;(window as any).run=async()=>{
 await delay(700);const w=window as any, original=w.check.c.readPose()
 const orbit=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('Orbit / Revolve'));orbit!.click();await delay(100)
 check(w.check.shot,'shot created');button('Preview shot');await delay(250);button('Pause');await delay(50)
 check(w.check.c.active&&!w.check.c.playing,'preview pause');check(w.check.c.seconds>0,'preview advanced')
 w.check.c.seek(5);await delay(80);const expected=sampleSequence(w.check.c.state.current.shots,5)!.pose
 const actual=w.check.c.readPose();check(Math.abs(actual.base_position_x-expected.base_position_x)<1e-5,'preview matches deterministic export sample')
 check(w.check.date.current.toISOString()==='2026-01-01T00:00:00.000Z','fixed construction date')
 button('Restore');await delay(80);check(!w.check.c.active&&w.check.date.current===null,'restore overrides');check(Math.abs(w.check.c.readPose().base_position_x-original.base_position_x)<1e-5,'restore original pose')
 button('Add to sequence');await delay(80);button('Add to sequence');await delay(80);button('Preview sequence');await delay(80);button('Pause');await delay(80);check(w.check.c.state.current.shots.length===2,'sequence preview');button('Save sequence');await delay(80);check(w.check.saved[0].motion.shots.length===2,'sequence saved')
 button('Restore');await delay(80);return 'PASS: preset creation, preview, pause, deterministic scrub/export pose, fixed date, original view restore, two-shot sequence and save'
}

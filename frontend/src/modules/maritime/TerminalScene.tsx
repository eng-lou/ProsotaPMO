import { Component, useEffect, useRef } from 'react'
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { DEFAULT_ANIMATION_CONFIG } from '../fourD/animationDefaults'
import { computeAppliedAnimationStateAt } from '../fourD/timelinePlayback'
import { capacity, handled, DELIVERY_PHASES, type MaritimeMode, type Scenario } from './simulation'

type Vec = [number,number,number]
type Props = { scenario:Scenario; hour:number; mode:MaritimeMode; day:number; selected:string; onSelect:(id:string)=>void; hazard:boolean; camera:string }
function Box({position,size,color,onClick,opacity=1}:{position:Vec;size:Vec;color:string;onClick?:(e:ThreeEvent<MouseEvent>)=>void;opacity?:number}) {
 return <mesh position={position} onClick={onClick} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={.75} transparent={opacity<1} opacity={opacity}/></mesh>
}
function Cameras({preset}:{preset:string}) {
 const {camera}=useThree();const controls=useRef<OrbitControlsType>(null)
 useEffect(()=>{const p:Vec=preset==='berth'?[15,38,-85]:preset==='yard'?[70,65,65]:[90,78,105];camera.position.set(...p);controls.current?.target.set(0,0,0);controls.current?.update()},[preset,camera])
 return <OrbitControls ref={controls} makeDefault minDistance={20} maxDistance={240} maxPolarAngle={Math.PI/2.05}/>
}
function Crane({x,id,color,move,pick}:{x:number;id:string;color:string;move:number;pick:(id:string)=>(e:ThreeEvent<MouseEvent>)=>void}) {
 return <group position={[x,0,-6]} onClick={pick(id)}>
 {[[-4,0], [4,0],[-4,8],[4,8]].map(([dx,dz],i)=><Box key={i} position={[dx,13,dz]} size={[1.3,26,1.3]} color={color}/>)}
 <Box position={[0,26,-5]} size={[11,2,37]} color={color}/><Box position={[0,21,4]} size={[10,1,1]} color={color}/>
 <Box position={[0,23,-15+move*16]} size={[4,2,3]} color="#d5e3ed"/>
 <Box position={[0,17,-15+move*16]} size={[.2,10,.2]} color="#dce8ee"/>
 <Box position={[0,11,-15+move*16]} size={[5,2.6,2.4]} color="#f1b34e"/>
 </group>
}
function Scene(p:Props) {
 const pick=(id:string)=>(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();p.onSelect(id)}
 const color=(id:string,normal:string)=>p.selected===id?'#64dcf2':normal
 const active=p.hour>=p.scenario.arrival&&handled(p.scenario,p.hour)<p.scenario.cargo
 const out=p.scenario.breakdown&&capacity(p.scenario,p.hour)<p.scenario.rate*2
 const wave=active?(Math.sin(p.hour*4)+1)/2:.5
 const vesselX=-12-Math.max(0,1-p.hour/Math.max(.1,p.scenario.arrival))*100
 const truckX=active?-37+((p.hour*8)%65):-37
 return <>
 <color attach="background" args={['#0c2335']}/><fog attach="fog" args={['#0c2335',190,360]}/>
 <ambientLight intensity={1.1}/><directionalLight position={[35,65,20]} intensity={2.1}/>
 <Cameras preset={p.camera}/>
 <Box position={[0,-2,-48]} size={[260,2,100]} color="#164d69"/>
 <Box position={[0,-1,24]} size={[130,2,66]} color="#718792"/>
 <Box position={[-15,.3,-7]} size={[77,1.3,12]} color={color('berth-01','#afbec4')} onClick={pick('berth-01')}/>
 <Box position={[0,.08,13]} size={[125,.1,8]} color="#344d5d"/>
 {Array.from({length:14},(_,i)=><Box key={i} position={[-60+i*9,.16,13]} size={[4,.05,.22]} color="#c5d7d9"/>)}
 <group onClick={pick('yard-01')}>
 {Array.from({length:36},(_,i)=>{const row=Math.floor(i/9),col=i%9;return <Box key={i} position={[-48+col*10,2.1+(row%2)*4.1,27+Math.floor(row/2)*10]} size={[8,4,3.5]} color={color('yard-01',['#cb7648','#377f91','#d2aa5d','#4a7796'][i%4])}/>})}
 </group>
 <group position={[vesselX,0,-27]} onClick={pick('vessel-01')}>
 <Box position={[0,1,0]} size={[61,6,14]} color={color('vessel-01','#263e53')}/><Box position={[0,4.2,0]} size={[59,.5,13]} color="#c3cbd1"/>
 <Box position={[-22,9,0]} size={[10,10,12]} color="#edf2ee"/><Box position={[-22,14,0]} size={[11,2,13]} color="#7895a7"/>
 {Array.from({length:15},(_,i)=><Box key={i} position={[-10+Math.floor(i/3)*7,6.2,(i%3-1)*4]} size={[6,3.5,3.4]} color={['#ce8255','#5d9f9b','#d2b65b'][i%3]}/>)}
 </group>
 <Crane x={-26} id="crane-01" color={color('crane-01',out?'#ea8352':'#e3b556')} move={out ? .5 : wave} pick={pick}/>
 <Crane x={4} id="crane-02" color={color('crane-02','#e3b556')} move={1-wave} pick={pick}/>
 <group position={[truckX,1.4,13]} onClick={pick('truck-01')}><Box position={[0,0,0]} size={[7,2,3]} color={color('truck-01','#d0e3e8')}/><Box position={[-5,.7,0]} size={[3,3,3]} color="#e59b55"/>{[-5,-2,2].map(x=><group key={x}>{[-1.8,1.8].map(z=><mesh key={z} position={[x,-.6,z]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.8,.8,.6,12]}/><meshStandardMaterial color="#202d37"/></mesh>)}</group>)}</group>
 <group onClick={pick('expansion-01')}>
 {DELIVERY_PHASES.map((phase,i)=>{const start=phase.start*86400000,finish=phase.finish*86400000;const state=computeAppliedAnimationStateAt({startMs:start,finishMs:finish,profile:DEFAULT_ANIMATION_CONFIG},new Date(p.day*86400000),'y');const opacity=p.mode==='deliver'?Math.max(.08,state?.opacity??1):.16;const positions:Vec[]=[[43,-.3,-17],[43,1,-17],[43,9,-17],[43,18,-17]];const sizes:Vec[]=[[24,2,26],[24,1,26],[2,16,2],[22,2,3]];return <Box key={phase.id} position={positions[i]} size={sizes[i]} color={p.selected==='expansion-01'?'#64dcf2':state?.color??'#a1b4bd'} opacity={opacity}/>})}
 </group>
 {p.hazard&&<group onClick={pick('hazard-01')}>
 <mesh position={[-26,.85,2]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[7,9,48]}/><meshBasicMaterial color="#ff715b" side={2} transparent opacity={.8}/></mesh>
 <Box position={[-25,2,2]} size={[1,3,1]} color="#ff715b"/><mesh position={[-25,4,2]}><sphereGeometry args={[.7,12,12]}/><meshStandardMaterial color="#f2c57c"/></mesh>
 </group>}
 </>
}
class SceneBoundary extends Component<{children:React.ReactNode},{failed:boolean}> {
 state={failed:false};static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<div className="mt-scene-fallback">3D is unavailable on this device. Use the asset list and scenario controls below.</div>:this.props.children}
}
export function TerminalScene(props:Props){return <SceneBoundary><Canvas camera={{position:[90,78,105],fov:42,near:.1,far:600}} dpr={[1,1.5]} frameloop="demand" onPointerMissed={()=>props.onSelect('')} fallback={<p>WebGL is required for the 3D scene.</p>}><Scene {...props}/></Canvas></SceneBoundary>}

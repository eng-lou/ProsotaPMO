import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line, OrbitControls, Sky } from '@react-three/drei'
import { Color, DoubleSide, InstancedMesh, Matrix4, Quaternion, Shape, Vector3, ShaderMaterial } from 'three'
import type { OrbitControls as Controls } from 'three-stdlib'
import type { Exercise, FlowResult, SceneEffect, WorkspaceDefinition } from './workspaceData'
import { assetTrack, flowAt, portLayout, statusLabel, vesselPosition, type Position } from './portPlayback'

export type CameraView = 'overview'|'quay'|'yard'|'follow'|'walk'
export interface SceneExercise {exercise:Exercise;actions:{action:string;seconds:number}[];seconds:number;record:(action:string)=>void;disabled:boolean}
interface Props {plan:WorkspaceDefinition;result:FlowResult|null;hour:number;selected:string;select:(id:string)=>void;camera:CameraView;focus:number;labels:boolean;arrange?:boolean;place?:(x:number,z:number)=>void;exercise?:SceneExercise;onReady?:()=>void;hiddenKinds?:string[]}
const colours=['#c66a45','#2c6e7f','#d9aa50','#3d7882','#c7c7ab','#416386']
function Box({p,s,c,opacity=1}:{p:Position;s:Position;c:string;opacity?:number}){return <mesh position={p} castShadow receiveShadow><boxGeometry args={s}/><meshStandardMaterial color={c} roughness={.65} metalness={.12} transparent={opacity<1} opacity={opacity}/></mesh>}
function Beam({a,b,r=.22,c='#c5cfd2'}:{a:Position;b:Position;r?:number;c?:string}){
  const [mid,q,length]=useMemo(()=>{const av=new Vector3(...a),bv=new Vector3(...b),d=bv.clone().sub(av);return [av.add(bv).multiplyScalar(.5),new Quaternion().setFromUnitVectors(new Vector3(0,1,0),d.clone().normalize()),d.length()] as const},[...a,...b])
  return <mesh position={mid} quaternion={q} castShadow><cylinderGeometry args={[r,r,length,6]}/><meshStandardMaterial color={c} metalness={.5} roughness={.55}/></mesh>
}
function Containers({count,columns=6,rows=3,origin=[0,0,0]}:{count:number;columns?:number;rows?:number;origin?:Position}){
  const mesh=useRef<InstancedMesh>(null),max=columns*rows*3
  useEffect(()=>{if(!mesh.current)return;const m=new Matrix4();for(let i=0;i<max;i++){
    const col=i%columns,row=Math.floor(i/columns)%rows,level=Math.floor(i/(columns*rows))
    m.makeTranslation(origin[0]+(col-(columns-1)/2)*6.4,origin[1]+1.35+level*2.7,origin[2]+(row-(rows-1)/2)*2.9)
    mesh.current.setMatrixAt(i,m);mesh.current.setColorAt(i,new Color(colours[(col+row*3+level)%colours.length]))
  }mesh.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true},[max,columns,rows,...origin])
  return <instancedMesh ref={mesh} args={[undefined,undefined,max]} count={Math.max(0,Math.min(max,Math.ceil(count)))} castShadow receiveShadow><boxGeometry args={[6,2.55,2.55]}/><meshStandardMaterial roughness={.63} metalness={.15}/></instancedMesh>
}
function Water(){
  const material=useMemo(()=>new ShaderMaterial({uniforms:{time:{value:0}},vertexShader:`varying vec3 world;uniform float time;void main(){vec3 p=position;p.z+=sin(p.x*.13+time*.6)*.13+cos(p.y*.16+time*.4)*.1;world=p;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader:`varying vec3 world;uniform float time;void main(){float w=.5*sin(world.x*.11+world.y*.17+time*.3)+.3*sin(world.x*.21-world.y*.07+time*.4)+.2*sin(world.y*.039+world.x*.051-time*.2);vec3 c=mix(vec3(.08,.25,.31),vec3(.13,.32,.37),w*.5+.5);gl_FragColor=vec4(c,1.);}`,side:DoubleSide}),[])
  useFrame(({clock})=>{material.uniforms.time.value=clock.elapsedTime})
  useEffect(()=>()=>material.dispose(),[material])
  return <mesh position={[0,-.7,-430]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[2400,1000,80,50]}/><primitive object={material} attach="material"/></mesh>
}
function Ship({fraction}:{fraction:number}){
  const shape=useMemo(()=>{const s=new Shape();s.moveTo(-45,-6);s.lineTo(33,-6);s.quadraticCurveTo(49,-4,51,0);s.quadraticCurveTo(49,4,33,6);s.lineTo(-45,6);s.closePath();return s},[])
  return <><mesh rotation={[-Math.PI/2,0,0]} position={[0,0,0]} castShadow><extrudeGeometry args={[shape,{depth:4.2,bevelEnabled:true,bevelSize:.8,bevelThickness:.5,bevelSegments:2,steps:1}]}/><meshStandardMaterial color="#203a4b" roughness={.5} metalness={.25}/></mesh>
    <Box p={[-4,4.3,0]} s={[80,.4,11]} c="#a4acac"/><Containers count={fraction*54} columns={6} rows={3} origin={[5,4.5,0]}/>
    <Box p={[-35,7,0]} s={[12,7,10]} c="#d4dcda"/><Box p={[-35,11,0]} s={[14,2,12]} c="#e5ece8"/>
    <Box p={[-27.9,11,0]} s={[.15,1.1,9]} c="#334f63"/><Box p={[-35,11,-6.1]} s={[11,1,.1]} c="#334f63"/>
    <Box p={[-38,14,1]} s={[3,5,3]} c="#a14936"/><Beam a={[-31,12,0]} b={[-31,19,0]} r={.16}/>
    {[-4.8,4.8].map(z=><Beam key={z} a={[-23,5.1,z]} b={[39,5.1,z]} r={.075} c="#e4e6d6"/>)}
  </>
}
function Crane({progress,stopped}:{progress:number;stopped:boolean}){
  const phase=(progress%1+1)%1,trolley=-24+Math.sin(phase*Math.PI)*28,height=12+Math.abs(Math.cos(phase*2*Math.PI))*9,c=stopped?'#bc6442':'#efbe57'
  return <>{[-7,7].flatMap(x=>[-3,10].map(z=><group key={`${x}:${z}`}><Box p={[x,13,z]} s={[1.3,26,1.3]} c={c}/><Box p={[x,1,z]} s={[2,1.5,6]} c="#314957"/>
      <Beam a={[x,5,z]} b={[-x,24,z]} r={.22} c={c}/></group>))}
    <Box p={[0,27,5]} s={[17,1.6,3]} c={c}/><Box p={[0,24,8]} s={[16,1.3,2]} c={c}/>
    {[-3,3].map(x=><group key={x}><Box p={[x,28,-10]} s={[.7,1.5,54]} c={c}/><Beam a={[x,31,-36]} b={[x,31,17]} r={.22} c={c}/>{Array.from({length:9},(_,i)=><group key={i}><Beam a={[x,28,-36+i*6]} b={[x,31,-33+i*6]} r={.12} c={c}/><Beam a={[x,31,-33+i*6]} b={[x,28,-30+i*6]} r={.12} c={c}/></group>)}</group>)}
    {[-7,7].map(x=><group key={x}><Beam a={[x,28,4]} b={[x,41,9]} r={.48} c={c}/><Beam a={[x,41,9]} b={[x,28,-36]} r={.11}/><Beam a={[x,41,9]} b={[x,28,17]} r={.11}/></group>)}
    {[-6,6].map(x=><Beam key={x} a={[x,29,-36]} b={[x,29,17]} r={.18} c="#526272"/>)}
    <Box p={[0,27,trolley]} s={[5,1.3,4]} c="#d9e0da"/>
    {[-2,2].map(x=><Beam key={x} a={[x,27,trolley]} b={[x,height,trolley]} r={.055} c="#243640"/>)}
    <Box p={[0,height,trolley]} s={[6.3,.4,2.9]} c="#df9d3c"/><Box p={[0,height-1.5,trolley]} s={[6,2.5,2.6]} c="#368b8e"/>
    <Box p={[7.8,25,trolley]} s={[2,2.5,3]} c="#364f63"/>
    <mesh position={[8,29,10]}><sphereGeometry args={[.6,10,10]}/><meshStandardMaterial color={stopped?'#f88c54':'#81dbad'} emissive={stopped?'#e55b22':'#32ae8a'} emissiveIntensity={1.2}/></mesh>
  </>
}
function Truck(){return <><Box p={[0,1,0]} s={[11,.65,3]} c="#2c3f49"/><Box p={[5,2.2,0]} s={[3.2,3.3,3]} c="#eff0dd"/><Box p={[6.65,2.8,0]} s={[.1,1.1,2.5]} c="#25546a"/><Box p={[-1,2.6,0]} s={[8,2.7,2.8]} c="#348383"/>{[-4,-2,4].flatMap(x=>[-1.6,1.6].map(z=><mesh key={`${x}:${z}`} position={[x,.7,z]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.75,.75,.5,12]}/><meshStandardMaterial color="#202831"/></mesh>))}</>}

function CameraRig({view,selected,focus,target,extent}:{view:CameraView;selected:string;focus:number;target:Position;extent:number}){
  const {camera,gl,size}=useThree(),controls=useRef<Controls>(null),keys=useRef(new Set<string>()),previous=useRef(new Vector3())
  const fit=Math.max(1,1.45/(size.width/size.height))
  const followSelection=view==='follow'?selected:''
  useEffect(()=>{
    const t=new Vector3(...target)
    if(view==='overview'){camera.position.set(extent*.62*fit,extent*.58*fit,extent*.75*fit);controls.current?.target.set(0,0,20)}
    else if(view==='quay'){camera.position.set(65,18,-72);controls.current?.target.set(0,14,-7)}
    else if(view==='yard'){camera.position.set(55,36,110);controls.current?.target.set(0,0,50)}
    else if(view==='walk'){camera.position.copy(t).add(new Vector3(18,2.3,20));controls.current?.target.copy(t).add(new Vector3(0,2.3,0))}
    else {camera.position.copy(t).add(new Vector3(42*fit,45*fit,60*fit));controls.current?.target.copy(t).add(new Vector3(0,15,0))}
    previous.current.copy(t)
    if(view==='walk'&&controls.current)camera.lookAt(controls.current.target)
    else controls.current?.update()
  },[view,followSelection,focus,camera,extent,fit])
  useEffect(()=>{
    const canvas=gl.domElement;canvas.tabIndex=0
    let drag:{x:number;y:number}|null=null
    const key=(e:KeyboardEvent)=>e.key.length===1?e.key.toLowerCase():e.key
    const down=(e:KeyboardEvent)=>{if(view!=='walk'||document.activeElement!==canvas)return;if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Shift'].includes(key(e))){keys.current.add(key(e));e.preventDefault()}}
    const up=(e:KeyboardEvent)=>keys.current.delete(key(e)),clear=()=>{keys.current.clear();drag=null}
    const pointerDown=(e:PointerEvent)=>{canvas.focus({preventScroll:true});if(view==='walk'&&e.button===0){drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)}}
    const pointerMove=(e:PointerEvent)=>{if(!drag||view!=='walk')return;camera.rotation.order='YXZ';camera.rotation.y-=(e.clientX-drag.x)*.003;camera.rotation.x=Math.max(-1.2,Math.min(1.2,camera.rotation.x-(e.clientY-drag.y)*.003));drag={x:e.clientX,y:e.clientY};controls.current?.target.copy(camera.position).add(camera.getWorldDirection(new Vector3()).multiplyScalar(10))}
    const pointerUp=()=>{drag=null}
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp)
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear)
    return()=>{canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerUp);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);keys.current.clear()}
  },[view,gl,camera])
  useFrame((_,dt)=>{
    if(!controls.current)return
    if(view==='follow'){const next=new Vector3(...target),delta=next.clone().sub(previous.current);camera.position.add(delta);controls.current.target.add(delta);previous.current.copy(next)}
    if(view==='walk'&&document.activeElement===gl.domElement){
      const k=keys.current,f=new Vector3();camera.getWorldDirection(f);f.y=0;f.normalize();const side=new Vector3().crossVectors(f,new Vector3(0,1,0)),delta=new Vector3()
      if(k.has('w')||k.has('ArrowUp'))delta.add(f);if(k.has('s')||k.has('ArrowDown'))delta.sub(f)
      if(k.has('d')||k.has('ArrowRight'))delta.add(side);if(k.has('a')||k.has('ArrowLeft'))delta.sub(side)
      delta.normalize().multiplyScalar(Math.min(dt,.05)*(k.has('Shift')?22:8));camera.position.add(delta);controls.current.target.add(delta)
    }
    if(view!=='walk')controls.current.update()
  })
  return <OrbitControls ref={controls} makeDefault enabled={view!=='walk'} enableDamping dampingFactor={.1} minDistance={8} maxDistance={Math.max(600,extent*3)} maxPolarAngle={Math.PI*.485} rotateSpeed={.7}/>
}

function Port(props:Props){
  const {plan,result,hour,selected,select,exercise}=props,layout=useMemo(()=>portLayout(plan),[plan]),flow=flowAt(result,plan,hour)
  const extent=Math.max(160,...Object.values(layout).map(p=>Math.max(Math.abs(p.x)+70,p.z+40)))
  const picked=plan.assets.find(a=>a.id===selected),p=picked?layout[picked.id]:{x:0,z:0,heading:0}
  const target:Position=picked?.kind==='vessel'?vesselPosition(picked,plan,result,hour,layout):[p.x,0,p.z]
  const effects=new Set(exercise?.actions.map(a=>exercise.exercise.scene_effects?.[a.action]))
  useEffect(()=>{props.onReady?.()},[])
  const click=(id:string)=>(e:ThreeEvent<MouseEvent>)=>{e.stopPropagation();if(e.delta<=5)select(id)}
  const totalCapacity=plan.assets.filter(a=>a.kind==='yard').reduce((n,a)=>n+a.capacity,0)
  const positions=Object.values(layout),minX=Math.min(-85,...positions.map(p=>p.x-60)),maxX=Math.max(100,...positions.map(p=>p.x+60)),depth=Math.max(145,...positions.map(p=>p.z+35))
  return <><color attach="background" args={['#c3d5e2']}/><fog attach="fog" args={['#c3d5e2',extent*2,extent*6]}/><Sky sunPosition={[100,50,40]} turbidity={5} rayleigh={.5}/>
    <hemisphereLight args={['#d4e9ff','#666754',1.6]}/><directionalLight position={[80,140,50]} intensity={2.8} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-extent} shadow-camera-right={extent} shadow-camera-top={extent} shadow-camera-bottom={-extent} shadow-camera-far={600} shadow-normalBias={.15}/>
    <CameraRig view={props.camera} selected={selected} focus={props.focus} target={target} extent={extent}/><Water/>
    <group onClick={e=>{if(props.arrange){e.stopPropagation();props.place?.(Math.round(e.point.x*10)/10,Math.round(e.point.z*10)/10)}}}>
      <Box p={[(minX+maxX)/2,-1.2,depth/2-1]} s={[maxX-minX,2,depth]} c="#65757b"/>
      <Box p={[(minX+maxX)/2,.01,22]} s={[maxX-minX,.05,15]} c="#344652"/>
      {[14,30].map(z=><Box key={z} p={[(minX+maxX)/2,.08,z]} s={[maxX-minX,.06,.15]} c="#e1e0cb"/>)}
      {Array.from({length:Math.min(120,Math.floor((maxX-minX)/10))},(_,i)=><Box key={i} p={[minX+i*10,.09,22]} s={[4,.06,.12]} c="#e2e2cd"/>)}
      <Box p={[(minX+maxX)/2,.1,1]} s={[maxX-minX,.15,.25]} c="#e5b85c"/>
      {Array.from({length:Math.min(80,Math.floor((maxX-minX)/12))},(_,i)=><group key={i} position={[minX+i*12,.2,1.8]}><Box p={[0,.35,0]} s={[1.2,.7,1]} c="#253942"/><Box p={[0,.9,0]} s={[1.6,.3,.8]} c="#b9c2bb"/></group>)}
    </group>
    {plan.assets.filter(a=>!props.hiddenKinds?.includes(a.kind)).map(a=>{
      const state=assetTrack(a,plan,result,hour),q=layout[a.id],chosen=selected===a.id,training=exercise?.exercise.asset_id===a.id
      const at:Position=a.kind==='vessel'?vesselPosition(a,plan,result,hour,layout):[q.x,0,q.z]
      const stopped=state.state==='unavailable'||(training&&effects.has('stop'))
      const stoppedAt=exercise?.actions.find(action=>exercise.exercise.scene_effects?.[action.action]==='stop')?.seconds
      const progress=training?(stoppedAt??exercise!.seconds)/8:state.value
      const height=a.kind==='crane'?43:a.kind==='vessel'?20:8
      const call=plan.calls.find(c=>c.id===state.call_id)??plan.calls.find(c=>c.vessel_id===a.id)
      const cargoFraction=call?Math.max(0,1-state.value/call.cargo_moves):1
      return <group key={a.id} position={at} rotation={[0,q.heading*Math.PI/180,0]} onClick={click(a.id)}>
        {a.kind==='vessel'&&<Ship fraction={cargoFraction}/>}
        {a.kind==='crane'&&<Crane progress={progress} stopped={stopped}/>}
        {a.kind==='berth'&&<><Box p={[0,-.15,-3]} s={[112,1,9]} c="#adb6b4"/><Box p={[0,.39,-6]} s={[110,.12,.35]} c="#eec45d"/></>}
        {a.kind==='truck'&&<group position={[Math.sin(((training?progress:state.value)/12)*Math.PI)*18,0,0]}><Truck/></group>}
        {a.kind==='yard'&&<><Box p={[0,.05,0]} s={[42,.08,31]} c="#4c646b"/>{[-20,20].map(x=><Box key={x} p={[x,.13,0]} s={[.15,.06,30]} c="#c7bc86"/>)}<Containers count={(totalCapacity?flow.yard/totalCapacity:0)*54} columns={6} rows={3}/></>}
        {a.kind==='gate'&&<><Box p={[0,6,0]} s={[20,1,2]} c="#d0d8d2"/>{[-9,0,9].map(x=><Box key={x} p={[x,3,0]} s={[.6,6,.6]} c="#c8d0ca"/>)}<Box p={[11,1.8,0]} s={[3,3.6,5]} c="#e1e2d1"/><Box p={[6,3,-.8]} s={[2,1,.2]} c={state.state==='unavailable'?'#e57854':'#67cfac'}/></>}
        {a.kind==='infrastructure'&&<><Box p={[0,5,0]} s={[30,10,16]} c="#9cabb0"/><Box p={[0,10.2,0]} s={[31,.6,17]} c="#4b636d"/>{[-9,0,9].map(x=><Box key={x} p={[x,3.8,-8.1]} s={[5,7,.2]} c="#344e5e"/>)}</>}
        {chosen&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.6,0]}><ringGeometry args={[a.kind==='vessel'?47:10,a.kind==='vessel'?48:10.6,64]}/><meshBasicMaterial color="#56efe0" transparent opacity={.9} side={DoubleSide}/></mesh>}
        {(props.labels||chosen)&&<Html position={[0,height,0]} center zIndexRange={[20,0]}><button className={`port-label ${chosen?'is-selected':''} ${stopped?'is-stopped':''}`} onClick={()=>select(a.id)}><i/>{a.name}{chosen&&<small>{statusLabel[state.state]??a.kind}</small>}</button></Html>}
      </group>
    })}
    {picked&&<group>
      {plan.calls.filter(c=>c.crane_ids.includes(picked.id)||c.vessel_id===picked.id||c.berth_id===picked.id).slice(0,4).map(c=>{
        const ids=[c.berth_id,...c.crane_ids],points=ids.filter(id=>layout[id]).map(id=>[layout[id].x,1,layout[id].z+3] as Position)
        const yard=plan.assets.find(a=>a.kind==='yard'),gate=plan.assets.find(a=>a.kind==='gate')
        if(yard)points.push([layout[yard.id].x,1,layout[yard.id].z]);if(gate)points.push([layout[gate.id].x,1,layout[gate.id].z])
        return points.length>1?<Line key={c.id} points={points} color="#87edda" lineWidth={2} dashed dashScale={.8} dashSize={2} gapSize={2}/>:null
      })}
    </group>}
    {exercise&&layout[exercise.exercise.asset_id]&&<ExerciseObjects exercise={exercise} position={layout[exercise.exercise.asset_id]} effects={effects}/>}
  </>
}
function ExerciseObjects({exercise,position,effects}:{exercise:SceneExercise;position:{x:number;z:number;heading:number};effects:Set<SceneEffect|undefined>}){
  const points:Record<SceneEffect,Position>={identify:[-4,3,4],stop:[9,3,8],secure:[-10,2,14],notify:[14,3,17]}
  return <group position={[position.x,0,position.z]} rotation={[0,position.heading*Math.PI/180,0]}>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.5,4]}><ringGeometry args={[8,8.4,64]}/><meshBasicMaterial color={effects.has('secure')?'#63e7bb':'#f2ad62'} side={DoubleSide}/></mesh>
    <Box p={[-4,1.7,4]} s={[.8,1.4,.5]} c="#ffad3f"/><mesh position={[-4,2.7,4]}><sphereGeometry args={[.35,12,12]}/><meshStandardMaterial color="#f7d176"/></mesh>
    {[-4.2,-3.8].map(x=><Box key={x} p={[x,.65,4]} s={[.23,1.2,.3]} c="#283d4c"/>)}
    <Box p={[9,1.6,8]} s={[1,3,1]} c="#c4d2d3"/><Box p={[9,2,7.45]} s={[.65,.65,.15]} c="#e65f4e"/>
    {effects.has('secure')&&[-8,0,8].map(x=><Box key={x} p={[x,1.2,13]} s={[7,1.6,.3]} c="#f4c465"/>)}
    {exercise.exercise.required_actions.map(action=>{
      const effect=exercise.exercise.scene_effects?.[action];if(!effect)return null
      const done=exercise.actions.some(a=>a.action===action)
      return <Html key={action} position={points[effect]} center zIndexRange={[25,0]}><button className={`port-hotspot ${done?'done':''}`} disabled={done||exercise.disabled} onClick={()=>exercise.record(action)}><b>{done?'✓':effect==='stop'?'■':effect==='notify'?'↗':'◎'}</b><span>{action}</span></button></Html>
    })}
  </group>
}
class Boundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true}};render(){return this.state.failed?<div className="port-unavailable">3D could not start. Your saved data is intact; use the asset list and Results tab.</div>:this.props.children}}
export function OperationalPortScene(props:Props){return <Boundary><Canvas shadows dpr={[1,1.5]} camera={{position:[110,90,130],fov:45,near:.2,far:10000}} gl={{antialias:true}} fallback={<div className="port-unavailable">3D requires WebGL. Use the asset list and Results tab on this device.</div>}><Port {...props}/></Canvas></Boundary>}

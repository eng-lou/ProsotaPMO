import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas, useThree} from '@react-three/fiber'
import {Line} from '@react-three/drei'
import * as THREE from 'three'
import {PathsPanel} from '../../frontend/src/modules/fourD/PathsPanel'
import {PathAddPointCatcher} from '../../frontend/src/modules/fourD/PathGizmo'
import {appendPathPoint,samplePathCurve,setPathSegmentMode,materializePathSegments} from '../../frontend/src/modules/fourD/pathCurve'
import type {Path} from '../../frontend/src/modules/fourD/paths'
import type {PathDrawOptions} from '../../frontend/src/modules/fourD/pathDrawing'
const w=window as any
function Probe(){const {camera,gl}=useThree();w.project=(p:number[])=>{const v=new THREE.Vector3(...p).project(camera),r=gl.domElement.getBoundingClientRect();return {x:Math.round(r.left+(v.x+1)*r.width/2),y:Math.round(r.top+(1-v.y)*r.height/2)}};return null}
function App(){
 const [path,setPath]=useState<Path>({id:'path',project_id:'test',name:'Equipment route',points:[{x:-8,y:-5,z:2},{x:-4,y:2,z:2},{x:2,y:5,z:2}],curve_mode:'curved',closed:false,visible:true,opacity:1,show_in_viewport:true,show_in_render:true,color:'#38bdf8',line_style:'solid',show_arrow:false,show_label:false,line_width:2,dash_size:.5,gap_size:.3,animate:false,animation_loop:false,created_at:'',updated_at:''})
 const [options,setOptions]=useState<PathDrawOptions>({mode:'curved',locks:[]})
 const [adding,setAdding]=useState(true)
 w.path=path;w.options=options;w.adding=adding
 w.samples=()=>samplePathCurve(path.points,path.closed,path.curve_mode).map(v=>v.toArray())
 const noop=()=>{}
 return <div style={{display:'flex',height:760}}>
  <div style={{width:800,height:760}}><Canvas orthographic camera={{position:[0,0,30],up:[0,1,0],zoom:25,near:.1,far:100}} frameloop="demand">
   <color attach="background" args={['#e5edf2']}/><ambientLight intensity={2}/>
   <mesh><planeGeometry args={[100,100]}/><meshBasicMaterial color="#dae2e9"/></mesh>
   <mesh position={[8,0,5]}><boxGeometry args={[4,4,10]}/><meshBasicMaterial color="#94a3b8"/></mesh>
   <Line points={samplePathCurve(path.points,path.closed,path.curve_mode)} color="#0284c7" lineWidth={3}/>
   <PathAddPointCatcher active={adding} upAxis="z" path={path} drawOptions={options} onAddPoint={point=>setPath(p=>({...p,points:appendPathPoint(p.points,p.closed,p.curve_mode!,point,options.mode,options.locks)}))}/>
   <Probe/>
  </Canvas></div>
  <aside style={{width:310,overflow:'auto'}}><PathsPanel paths={[path]} drawOptions={{path:options}} savingPaths={new Set()} onDrawOptions={(_,o)=>setOptions(o)} onSegmentMode={(_,end,mode)=>setPath(p=>({...p,points:setPathSegmentMode(materializePathSegments(p.points,p.closed,p.curve_mode),end,mode)}))}
    error={null} addingPointsForPathId={adding?'path':null} upAxis="z" bindTarget={null} followers={[]} animWindows={new Map()} format={null}
    onCreate={noop} onRename={noop} onToggleClosed={()=>setPath(p=>({...p,closed:!p.closed}))} onToggleVisible={noop} onDelete={noop} onToggleAddPoints={()=>setAdding(v=>!v)}
    onRemoveLastPoint={()=>setPath(p=>({...p,points:p.points.slice(0,-1)}))} onBind={noop} onUnbind={noop} onToggleOrient={noop} onSetHeadingOffset={noop} onUpdateStyle={noop} onSetElevation={noop} onKeyAnimStart={noop} onKeyAnimEnd={noop}/></aside>
 </div>
}
createRoot(document.getElementById('root')!).render(<App/> )

import React,{useState,useCallback,useMemo} from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas,useThree,useFrame} from '@react-three/fiber'
import * as T from 'three'
import {buildPathCurve} from '../../frontend/src/modules/fourD/pathCurve'
import {applySitePath} from '../../frontend/src/modules/fourD/sitePathMotion'
import {EquipmentPlayback} from '../../frontend/src/modules/fourD/EquipmentPlayback'
import {EquipmentPanel} from '../../frontend/src/modules/fourD/EquipmentPanel'
import {SideDock} from '../../frontend/src/modules/fourD/SideDock'
import {equipmentNodes} from '../../frontend/src/modules/fourD/equipmentRig'
const w=window as any,date={current:new Date('2026-01-01T00:00:00Z')},start=date.current.getTime()
const root=new T.Group(),travel=new T.Group(),lift=new T.Group(),bucket=new T.Group()
travel.name='Travel';lift.name='Lift';bucket.name='Bucket';root.add(travel);travel.add(lift);lift.add(bucket);bucket.position.z=.8;bucket.rotation.x=Math.PI/2
const moving=new T.Group(),selectable=new T.Group();moving.add(selectable);selectable.add(root)
const gold=new T.MeshStandardMaterial({color:'#f3b736',roughness:.6})
for(const [size,p] of [[[1.6,.12,1.2],[0,-.5,0]],[[.12,1,1.2],[-.75,0,0]],[[.12,1,1.2],[.75,0,0]],[[1.5,1,.12],[0,0,-.55]]]){const m=new T.Mesh(new T.BoxGeometry(...size),gold);m.position.set(...p);m.castShadow=m.receiveShadow=true;bucket.add(m)}
const refs=['Travel','Lift','Bucket'].map(n=>[...equipmentNodes(root).keys()].find(k=>k.endsWith(':'+n)))
const track=pairs=>pairs.map(([sec,value])=>({date:new Date(start+sec*1000).toISOString(),value,interpolation:'linear'}))
let saved:any={id:'rig',project_id:'p',model_ref:'site:bucket',name:'Soil cycle test',version:1,definition:{schema_version:1,followers:[],controls:[
 {id:'travel',name:'Travel',value:0,rest:0,keys:track([[0,0],[2,0],[4,1],[10,1]])},
 {id:'lift',name:'Lift',value:0,rest:0,keys:track([[0,0],[2,0],[4,1],[10,1]])},
 {id:'tip',name:'Tip',value:0,rest:0,keys:track([[0,0],[5,0],[6,1],[10,1]])}],
 joints:refs.map((node,i)=>({id:['travel','lift','tip'][i],name:['Travel','Lift','Tip'][i],node,parent:i?['travel','lift'][i-1]:null,control:['travel','lift','tip'][i],kind:i===2?'hinge':'slide',pivot:[0,0,.8],axis:i===1?[0,0,1]:[1,0,0],minimum:0,maximum:[4,1.4,180][i],response:[[0,0],[1,1]]})),
 soil:{enabled:true,show_guide:false,bucket_node:refs[2],center:[0,0,0],size:[1.4,.9,1],rotation:[0,0,0],capacity:.4,dump_angle:105,pour_seconds:1,source:[0,0,0],radius:2,height:1,up_axis:'z',start:new Date(start).toISOString(),end:new Date(start+10000).toISOString(),duration_seconds:10,steps:240,color:'#806046'}}}
const objects=[{name:'site:bucket',kind:'mesh',object:root}],paths:any=[{id:'path',points:[{x:0,y:0,z:0},{x:6,y:0,z:0}],closed:false,curve_mode:'straight'}],curve=buildPathCurve(paths[0].points,false,'straight')!
const motion={path_id:'path',start:new Date(start).toISOString(),speed:1,loop:false,orient:true,heading:0,animation_reference_speed:1}
w.saved=()=>saved
function Drive({active}){useFrame(()=>{if(active)applySitePath(moving,curve,motion,(date.current.getTime()-start)/1000,'z',new T.Vector3(),1/86400);else{moving.position.set(0,0,0);moving.quaternion.identity();moving.updateMatrixWorld(true)}},-1);return null}
function Inspect(){w.r3f=useThree();return null}
function App(){
 const [rig,setRig]=useState(saved),[draft,setDraft]=useState(null),[preview,setPreview]=useState(null),[visual,setVisual]=useState(null),[error,setError]=useState(null),[panel,setPanel]=useState(true),[pathActive,setPath]=useState(false)
 w.setPath=setPath;w.setPanel=setPanel;w.draft=()=>draft;w.visual=()=>visual;w.error=error
 w.miscalibrateOpening=()=>{saved=structuredClone(rig);saved.definition.soil.opening_direction=[0,Math.cos(145*Math.PI/180),Math.sin(145*Math.PI/180)];setRig(saved)}
 const rigs=useMemo(()=>[draft||rig],[draft,rig]),siteScene:any=useMemo(()=>({items:[{id:'bucket',position:{x:0,y:0,z:0},up_axis:'z',path_motion:pathActive?motion:null}],objects:[{id:'site:bucket',object:selectable}]}),[pathActive])
 const seek=useCallback(d=>{date.current=d;w.r3f?.invalidate()},[]),save=useCallback(async r=>{saved=structuredClone({...r,version:r.version+1});setRig(saved);return true},[]),noop=useCallback(()=>{},[])
 w.seek=sec=>seek(new Date(start+sec*1000))
 const editor=<EquipmentPanel projectId="p" objects={objects} rigs={[rig]} busy={false} error={null} runtimeError={error} dateRef={date} onSave={save} onRemove={async()=>{}} onDraft={setDraft} onPreview={setPreview} onEditing={noop} onSeek={seek} onVisual={setVisual} upAxis="z" format={{scheduleStart:new Date(start),timeDisplayMode:'seconds',speedDaysPerSecond:1/86400,fps:30}}/>
 return <div style={{display:'grid',gridTemplateColumns:'1fr 390px',height:'100vh'}}><div><Canvas shadows frameloop="demand" camera={{position:[9,-11,8],up:[0,0,1],fov:42}} onCreated={({camera})=>camera.lookAt(2,0,.5)}><Inspect/><Drive active={pathActive}/><color attach="background" args={['#d7e1e7']}/><ambientLight intensity={1.6}/><directionalLight castShadow position={[3,-6,10]} intensity={3}/><primitive object={moving}/><mesh receiveShadow position={[2,0,-.03]}><boxGeometry args={[16,12,.05]}/><meshStandardMaterial color="#c5c4b8" roughness={1}/></mesh><EquipmentPlayback rigs={rigs} objects={objects} dateRef={date} preview={preview} visual={visual} onError={setError} paths={paths} siteScene={siteScene} daysPerSecond={1/86400}/></Canvas></div><div style={{overflowY:'auto',background:'#101b2d',color:'#eee'}}>{panel&&<SideDock side="right" width={370} panels={[{id:'rig',label:'Rigging',keepMounted:true,onToggleDock:noop,onClose:noop,content:editor},{id:'paths',label:'Paths',onToggleDock:noop,onClose:noop,content:<p>Path editor</p>}]}/>}</div></div>
}
w.mount=()=>{w.reactRoot=createRoot(document.getElementById('root'));w.reactRoot.render(<App/>)};w.mount()

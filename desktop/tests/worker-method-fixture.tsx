import React,{useCallback,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas} from '@react-three/fiber'
import {OrbitControls} from '@react-three/drei'
import * as T from 'three'
import {api} from '../../frontend/src/lib/api'
import {parseAsset} from '../../frontend/src/modules/fourD/siteAssets'
import {SiteSceneLayer} from '../../frontend/src/modules/fourD/SiteSceneLayer'
import {Simulator} from '../../frontend/src/modules/simulator/Simulator'
import {SimulationPlayback} from '../../frontend/src/modules/simulator/SimulationPlayback'
import {newStep,type Scenario} from '../../frontend/src/modules/simulator/types'
import {newWorkerMethod,snapshotMethod} from '../../frontend/src/modules/simulator/workerMethod'
const w=window as any,start='2026-10-28T08:00:00',epoch=Date.parse(start),date=(s:number)=>new Date(epoch+s*1000)
const empty:any[]=[],selectedActivities=new Set(['a'])
w.setupMethods=async(inputs:{name:string;bytes:string}[],results:any)=>{
 w.error=''
 for(const result of Object.values(results) as any[])result.activities=[]
 const assets=await Promise.all(inputs.map(async(f,i)=>{const blob=new Blob([Uint8Array.from(atob(f.bytes),c=>c.charCodeAt(0))]);return {id:'asset'+i,url:URL.createObjectURL(blob),...await parseAsset(await blob.arrayBuffer())}}))
 const path:any={id:'route',name:'Site walkway',points:[{x:-6,y:0,z:0},{x:6,y:0,z:0}],closed:false,curve_mode:'straight'},paths=[path,{...path,id:'route2',name:'Second workface',points:[{x:-6,y:0,z:4},{x:6,y:0,z:4}]}]
 const items:any[]=assets.map((a,i)=>({id:'item'+i,asset_id:a.id,name:['Male worker','Female worker','Jackhammer'][i],kind:'asset',...a.dimensions,up_axis:'y',position:{x:i===0?2:i===1?4:-3,y:0,z:2},rotation:{x:0,y:0,z:0},yaw:0,color:'#ffffff',generator_version:1,units:'m',locked:false,activity_id:null,path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0,animation_clip:0,animation_playing:false,motion_actions:[]}))
 w.assets=assets
 const original:Scenario={id:'method-demo',name:'Break concrete at workface',revision:1,status:'incomplete',decisions:[],config:{activity_ids:['a'],start,horizon_days:1,steps:[{...newStep('a','Walk to workface and use jackhammer'),id:'method',worker_method:newWorkerMethod(),quantity:1}],resources:[],disruptions:[],assumptions:'Test fixture',boundary_policy:'reserve'},result:null}
 const rows:Record<string,Scenario>={[original.id]:original};w.rows=rows
 api.defaults.adapter=async config=>{const url=config.url!,data=typeof config.data==='string'?JSON.parse(config.data):config.data;let output:any;const id=url.split('/')[4]
  if(url.includes('asset')&&url.includes('download'))output={download_url:assets.find(a=>url.includes(a.id))?.url}
  else if(url.endsWith('/context'))output={activities:[{id:'a',task_name:'Break concrete',activity_type:'task',duration_hours:1,start,finish:date(3600).toISOString()}],steps:[],resources:[],calendars:[],relationships:[],paths:[]}
  else if(url.endsWith('/simulations/'))output=Object.values(rows).map(s=>({id:s.id,name:s.name,status:s.status}))
  else if(url.endsWith('/run')){const n=rows[id].config.steps[0].worker_method!.work_seconds;output={...rows[id],result:results[String(n)],status:'current',revision:rows[id].revision+1};rows[id]=output}
  else if(config.method==='put'){output={...rows[id],...data,revision:rows[id].revision+1,result:null,status:'incomplete'};rows[id]=structuredClone(output)}
  else output=rows[id]
  return {status:200,statusText:'OK',config,headers:{},data:structuredClone(output)}
 }
 w.roots=new Map();w.items=items;w.paths=paths
 function Demo(){const [preview,setPreview]=useState<Scenario|null>(null),[objects,setObjects]=useState<{id:string;object:T.Object3D}[]>([]),[open,setOpen]=useState(true)
  const dateRef=useRef<Date|null>(date(0)),register=useCallback((id:string,r:T.Object3D|null)=>{const key='site:'+id;if(r)w.roots.set(key,r);else w.roots.delete(key);setObjects([...w.roots].map(([id,object]:any)=>({id,object})))},[])
  const onError=useCallback((e:string)=>{w.error=e},[])
  w.seek=(s:number)=>{dateRef.current=date(s)};w.exit=()=>setPreview(null);w.show=()=>setOpen(true);w.preview=preview;w.onError=onError
  w.previewVariant=(kind:string)=>{const row=structuredClone(rows['method-demo']);row.status='current';row.result=results[kind];if(kind==='shared'){row.config.steps=[{...row.config.steps[0],id:'one'},{...row.config.steps[0],id:'two',worker_method:{...row.config.steps[0].worker_method!,worker_id:'item1',worker_asset_id:'asset1',idle_clip:'Idle F',walk_clip:'Walk F'}}]};setPreview(row)}
  return <><Canvas camera={{position:[8,6,10],fov:40}}><color attach="background" args={['#e6edf2']}/><hemisphereLight intensity={2}/><directionalLight position={[4,7,4]} intensity={3}/><SiteSceneLayer state={{items,paths,daysPerSecond:1/86400,preview:null,selected:null,onSelect:()=>{},onRegister:register}} dateRef={dateRef} activities={empty} links={empty} profiles={empty} rendering={false}/><SimulationPlayback scenario={preview} objects={empty} siteObjects={objects} items={items} ifcHandles={empty} dateRef={dateRef} onError={w.onError}/><gridHelper args={[20,40]}/><OrbitControls target={[0,.8,0]}/></Canvas><Simulator projectId="project" periodId="period" open={open} onClose={()=>setOpen(false)} selectedActivities={selectedActivities} objects={empty} items={items} paths={paths} onSelection={async()=>({model_ref:''})} onPreview={setPreview} onSeek={d=>{dateRef.current=d}} onAccepted={()=>{}}/></>
 }
 sessionStorage.setItem('prosota-simulator-scenario','method-demo')
 createRoot(document.getElementById('root')!).render(<Demo/>);
 w.methodStatus=()=>[...w.roots].map(([id,r]:any)=>{r.updateWorldMatrix(true,true);const b=r.getObjectByName('CC_Base_R_Hand');return {id,p:r.getWorldPosition(new T.Vector3()).toArray(),q:r.getWorldQuaternion(new T.Quaternion()).toArray(),visible:r.visible&&r.parent.visible,bone:b?.getWorldPosition(new T.Vector3()).toArray(),boneQ:b?.getWorldQuaternion(new T.Quaternion()).toArray()}})
 w.fitHandle=()=>{const {scene,camera,size,gl}=w.fitState;let control:any;scene.traverse((n:any)=>{if(n.picker?.translate)control=n});if(!control)throw Error('No fitting gizmo');const mode=control.parent.mode,picker=control.picker[mode],handle=picker.children.find((n:any)=>n.name==='X');handle.geometry.computeBoundingBox();const p=handle.geometry.boundingBox.getCenter(new T.Vector3());if(mode==='rotate')p.set(0,.7,.7);p.applyMatrix4(handle.matrixWorld).project(camera);const rect=gl.domElement.getBoundingClientRect();return {x:rect.x+(p.x+1)*size.width/2,y:rect.y+(1-p.y)*size.height/2}}
 // Independently calculate an upright calibration for this known jackhammer.
 w.uprightGrip=()=>{const scene=w.fitState.scene,hand=scene.getObjectByName('CC_Base_R_Hand'),left=scene.getObjectByName('CC_Base_L_Hand');scene.updateMatrixWorld(true);const p=hand.getWorldPosition(new T.Vector3()),q=hand.getWorldQuaternion(new T.Quaternion()),mid=p.clone().lerp(left.getWorldPosition(new T.Vector3()),.5);mid.y-=assets[2].dimensions.height*.91;const local=mid.sub(p).applyQuaternion(q.clone().invert()),rotation=new T.Euler().setFromQuaternion(q.clone().invert());return {position:local.toArray(),rotation:[rotation.x,rotation.y,rotation.z].map(T.MathUtils.radToDeg)}}
 return assets.map(a=>({keys:Object.keys(a),dimensions:a.dimensions}))
}

import React,{useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas} from '@react-three/fiber'
import {OrbitControls,TransformControls} from '@react-three/drei'
import {useThree,useFrame} from '@react-three/fiber'
import {captureAttachmentTransform} from '../../frontend/src/modules/fourD/attachmentTransform'
import * as T from 'three'
import {api} from '../../frontend/src/lib/api'
import {parseAsset} from '../../frontend/src/modules/fourD/siteAssets'
import {SiteSceneLayer} from '../../frontend/src/modules/fourD/SiteSceneLayer'
import {WorkerActionsPanel} from '../../frontend/src/modules/fourD/WorkerActionsPanel'
import {routeStopForAction} from '../../frontend/src/modules/fourD/workerActions'
import {buildPathCurve} from '../../frontend/src/modules/fourD/pathCurve'
function AttachmentGizmo({selected,mode,onChange}:{selected:string;mode:'translate'|'rotate';onChange:()=>void}){
 const {camera,size}=useThree(),[object,setObject]=useState<T.Object3D|null>(null)
 useFrame(()=>{const next=w.roots?.get(selected)||null;if(next!==object)setObject(next)})
 w.gizmoHandle=()=>{const control=w.gizmo;control.updateMatrixWorld(true);const picker=control.children.find((x:any)=>x.picker)?.picker[mode];const handle=picker?.children.find((x:any)=>x.name==='X');if(!handle)throw Error('X handle unavailable');handle.geometry.computeBoundingBox();const p=handle.geometry.boundingBox.getCenter(new T.Vector3());if(mode==='rotate')p.set(0,.7,.7);p.applyMatrix4(handle.matrixWorld).project(camera);return {x:(p.x+1)*size.width/2,y:(1-p.y)*size.height/2}}
 return object?<TransformControls ref={c=>{w.gizmo=c}} object={object} mode={mode} space="world" onObjectChange={onChange}/>:null
}
const w=window as any,epoch=Date.parse('2026-10-29T08:00:00Z'),date=(s:number)=>new Date(epoch+s*1000)
w.setupWorkers=async(inputs:{name:string;bytes:string}[])=>{
 const assets=await Promise.all(inputs.map(async(f,i)=>{const blob=new Blob([Uint8Array.from(atob(f.bytes),c=>c.charCodeAt(0))]);return {id:'asset'+i,url:URL.createObjectURL(blob),...await parseAsset(await blob.arrayBuffer())}}))
 api.defaults.adapter=async config=>({status:200,statusText:'OK',config,headers:{},data:{download_url:assets.find(a=>config.url?.includes(a.id))?.url}})
 const path:any={id:'route',name:'Work route',points:[{x:-2,y:0,z:0},{x:2,y:0,z:0}],closed:false,curve_mode:'straight'}
 const action={id:'work',name:'Use jackhammer',start:date(2).toISOString(),end:date(7).toISOString(),clip:2,speed:1,loop:true,blend:.2}
 const items:any[]=assets.map((asset,i)=>({id:'item'+i,asset_id:asset.id,name:['Male worker','Female worker','Jackhammer'][i],kind:'asset',...asset.dimensions,up_axis:'y',position:{x:i===0?-2:i===1?1:-3,y:0,z:i===1?-1.5:0},rotation:{x:0,y:0,z:0},yaw:0,color:'#ffffff',generator_version:1,units:'m',locked:false,activity_id:null,path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0,animation_clip:i===0?1:0,animation_playing:true,motion_actions:i<2?[action]:[]}))
 items[0].path_motion=routeStopForAction({path_id:'route',start:date(0).toISOString(),speed:1,loop:false,orient:false,heading:0,animation_reference_speed:1},buildPathCurve(path.points,false,'straight')!,action,1/86400)
 items[2].attachment={parent_id:'item0',node:'CC_Base_R_Hand',start:action.start,end:action.end,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},only_during:true}
 w.roots=new Map();w.saved=JSON.stringify(items)
 const register=(id:string,r:any)=>r?w.roots.set(id,r):w.roots.delete(id)
 function Demo(){const [data,setData]=useState(items),[selected,setSelected]=useState('item0'),[open,setOpen]=useState(true),[revision,setRevision]=useState(0),[display,setDisplay]=useState<'seconds'|'frames'|'date'>('seconds'),[time,setTime]=useState(4),[gizmoMode,setGizmoMode]=useState<'translate'|'rotate'>('translate')
  const dateRef=useRef<Date|null>(date(4));const seek=(d:Date)=>{dateRef.current=d;setTime((d.getTime()-epoch)/1000)}
  w.seek=(s:number)=>seek(date(s));w.toggle=()=>setOpen(v=>!v);w.select=setSelected;w.reload=()=>{setData(JSON.parse(w.saved));setRevision(v=>v+1)};w.data=data
  w.patch=async(id:string,patch:any)=>{const next=data.map(i=>i.id===id?{...i,...patch}:i);w.saved=JSON.stringify(next);setData(next)}
  return <div style={{display:'flex',height:'100vh',color:'#17324d'}}><main style={{flex:1,position:'relative'}}><Canvas camera={{position:[4,3,7],fov:40}}><color attach="background" args={['#e6edf2']}/><hemisphereLight intensity={2}/><directionalLight position={[4,7,4]} intensity={3}/><SiteSceneLayer key={revision} state={{items:data,paths:[path],daysPerSecond:1/86400,preview:null,selected:null,onSelect:setSelected,onRegister:register}} dateRef={dateRef} activities={[]} links={[]} profiles={[]} rendering={false}/><AttachmentGizmo selected={selected} mode={gizmoMode} onChange={()=>{const item=data.find(i=>i.id===selected),object=w.roots.get(selected);const patch=object&&captureAttachmentTransform(item,object);if(patch)void w.patch(selected,patch)}}/><gridHelper args={[12,24]}/><OrbitControls target={[0,.7,0]}/></Canvas><div style={{position:'absolute',top:10,left:10,background:'white',padding:12,borderRadius:8}}><b>Walk → work → continue</b><p>Playhead: {time.toFixed(1)} seconds</p><input aria-label="Playhead" type="range" min="0" max="9" step=".05" value={time} onChange={e=>seek(date(+e.target.value))}/></div></main><aside style={{width:360,overflow:'auto',padding:12,background:'white'}}><div className="flex gap-2"><button onClick={()=>setOpen(v=>!v)}>Toggle panel</button><button onClick={()=>w.reload()}>Reopen saved scene</button><select aria-label="Time display" value={display} onChange={e=>setDisplay(e.target.value as typeof display)}><option>seconds</option><option>frames</option><option>date</option></select></div><select aria-label="Object" value={selected} onChange={e=>setSelected(e.target.value)}>{data.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>{open&&<WorkerActionsPanel item={data.find(i=>i.id===selected)!} items={data} paths={[path]} disabled={false} format={{scheduleStart:date(0),timeDisplayMode:display,speedDaysPerSecond:1/86400,fps:30}} dateRef={dateRef} onSeek={seek} onEditAttachment={setGizmoMode} onApply={patch=>w.patch(selected,patch)}/>}</aside></div>
 }
 createRoot(document.getElementById('root')!).render(<Demo/>);
 w.workerStatus=()=>[...w.roots].map(([id,r]:any)=>{r.updateWorldMatrix(true,true);const b=r.getObjectByName('CC_Base_R_Hand');return {id,p:r.getWorldPosition(new T.Vector3()).toArray(),q:r.getWorldQuaternion(new T.Quaternion()).toArray(),visible:r.parent.visible,bone:b?.getWorldPosition(new T.Vector3()).toArray(),boneQ:b?.getWorldQuaternion(new T.Quaternion()).toArray()}})
 return assets.map(a=>a.dimensions)
}

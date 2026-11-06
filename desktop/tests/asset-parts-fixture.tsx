import React,{useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas} from '@react-three/fiber'
import {Bounds,OrbitControls} from '@react-three/drei'
import * as THREE from 'three'
import {api} from '../../frontend/src/lib/api'
import {convertSiteImportSet} from '../../frontend/src/modules/fourD/convertSiteImport'
import {parseAsset} from '../../frontend/src/modules/fourD/siteAssets'
import {splitSiteAsset,extractAssetPart,siteAssetPlacement} from '../../frontend/src/modules/fourD/assetParts'
import {SiteSceneLayer} from '../../frontend/src/modules/fourD/SiteSceneLayer'
import {SiteScheduleWizard} from '../../frontend/src/modules/fourD/SiteScheduleWizard'
import {buildSiteSchedule} from '../../frontend/src/modules/fourD/siteSchedule'
const w=window as any
const start=Date.parse('2026-10-28T08:00:00Z'),date=(n:number)=>new Date(start+n*3600000).toISOString()
w.setupKit=async(files:{name:string;bytes:string}[])=>{
 const input=files.map(f=>new File([Uint8Array.from(atob(f.bytes),c=>c.charCodeAt(0))],f.name))
 const glb=await convertSiteImportSet(input,{upAxis:'auto',unitScale:0,includeAnimation:true},'Construction kit')
 const parsed=await parseAsset(await glb.arrayBuffer())
 const item:any={id:crypto.randomUUID(),asset_id:crypto.randomUUID(),name:'Construction kit',kind:'asset',...parsed.dimensions,up_axis:'z',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},yaw:0,color:'#ffffff',generator_version:1,units:'m',locked:false,activity_id:null,path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0}
 const parts=JSON.parse(JSON.stringify(splitSiteAsset(item,parsed.object)))
 const before=new THREE.Box3().setFromObject(parsed.object).applyMatrix4(siteAssetPlacement(item)),after=new THREE.Box3()
 parts.forEach((p:any)=>after.union(new THREE.Box3().setFromObject(extractAssetPart(parsed.object,p.asset_part)).applyMatrix4(siteAssetPlacement(p))))
 const url=URL.createObjectURL(glb)
 const payload=buildSiteSchedule('project','period',parts,parts.map((p:any)=>({id:p.id,name:p.name,hours:1,include:true})),{name:'Kit sequence',calendarId:'',sequence:true,profile:'drop',upAxis:'z',distance:parsed.dimensions.height/2})
 api.defaults.adapter=async config=>({status:200,statusText:'OK',config,headers:{},data:config.url?.endsWith('/download')?{download_url:url}:{}})
 const activities=parts.map((p:any,i:number)=>({id:'a'+i,task_name:p.name,start:date(i),finish:date(i+1)})),profiles=[{id:'profile',name:'Drop',config:payload.site_animation_profile}],links=parts.map((p:any,i:number)=>({id:'l'+i,source_kind:'site',element_ref:p.id,activity_id:'a'+i,animation_profile_id:'profile'}))
 w.roots=new Map();const register=(id:string,root:any)=>{if(root)w.roots.set(id,root);else w.roots.delete(id)}
 function Demo(){const [selected,setSelected]=useState<string|null>(null),[show,setShow]=useState(false);const dateRef=useRef<Date|null>(new Date(date(61)));w.seek=(h:number)=>{dateRef.current=new Date(date(h))};w.select=setSelected;w.showSchedule=()=>setShow(true);w.selected=selected
  return <><Canvas camera={{position:[100,-100,100],fov:40,up:[0,0,1]}}><color attach="background" args={['#e8edf2']}/><ambientLight intensity={1.7}/><directionalLight position={[50,-20,100]} intensity={2}/><Bounds fit clip observe margin={1.15}><SiteSceneLayer state={{items:parts,preview:null,selected,onSelect:setSelected,onRegister:register}} dateRef={dateRef} activities={activities as any} links={links as any} profiles={profiles as any} rendering={false}/></Bounds><OrbitControls makeDefault/></Canvas>{show&&<SiteScheduleWizard projectId="project" schedulePeriodId="period" items={parts} profiles={[]} links={[]} upAxis="z" calendars={[]} onCancel={()=>setShow(false)} onGenerated={()=>setShow(false)}/>}</>
 }
 createRoot(document.getElementById('root')!).render(<Demo/>);
 let originalMeshes=0;parsed.object.traverse(n=>{if((n as THREE.Mesh).isMesh)originalMeshes++})
 return {originalMeshes,count:parts.length,meshes:parts.reduce((n:any,p:any)=>{let count=0;extractAssetPart(parsed.object,p.asset_part).traverse(o=>{if((o as THREE.Mesh).isMesh)count++});return n+count},0),before:[...before.min.toArray(),...before.max.toArray()],after:[...after.min.toArray(),...after.max.toArray()],names:parts.map((p:any)=>p.name),firstId:parts[0].id,dimensions:parsed.dimensions}
}
w.partStatus=()=>[...w.roots.entries()].map(([id,root]:any)=>({id,visible:root.children[0]?.children[0]?.visible,offset:root.children[0]?.children[0]?.position.toArray(),meshes:(()=>{let n=0;root.traverse((o:any)=>{if(o.isMesh)n++});return n})()}))

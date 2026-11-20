import {EquipmentPlayback} from '../../src/modules/fourD/EquipmentPlayback'
import {equipmentNodes,type EquipmentRig} from '../../src/modules/fourD/equipmentRig'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas} from '@react-three/fiber'
import * as T from 'three'
import {SiteSceneLayer,type SiteLayerState} from '../../src/modules/fourD/SiteSceneLayer'
import type {SiteItem} from '../../src/modules/fourD/siteScene'
import type {WorkSequence} from '../../src/modules/fourD/workSequence'
export async function run(){
 const host=document.createElement('div');host.style.cssText='width:800px;height:500px';document.body.appendChild(host);const root=createRoot(host)
 const base=Date.parse('2026-11-01T00:00:00Z'),h=3600000,dateRef={current:new Date(base)},registered=new Map<string,T.Group>()
 const activities=[{id:'a',start:new Date(base+2*h).toISOString(),finish:new Date(base+12*h).toISOString()}] as any
 const config:WorkSequence={kind:'piling',axis:'z',offset:{x:0,y:0,z:0},path_id:null,tool_control:'auger',tool_travel:20,tool_rest:0,tool_full:1,steps:[{id:'s',activity_id:'a',start:null,finish:null,start_chainage:0,end_chainage:10,position:{x:10,y:0,z:0},depth:10,travel_hours:2,excavation_id:'soil',pile_id:'pile'}]}
 const item=(id:string)=>({id,name:id,kind:'context',position:{x:0,y:0,z:0},up_axis:'z',yaw:0,width:2,depth:2,height:10,color:'#888888',points:[],rotation:{x:0,y:0,z:.2},scale:{x:1,y:1,z:1}} as SiteItem)
 let items=[{...item('machine'),work_sequence:config},item('soil'),item('pile')]
 let rigEntries:EquipmentRig[]=[],rigObjects:{name:string;kind:string;object:T.Object3D}[]=[],rigError:string|null=null;const onError=(e:string|null)=>{rigError=e}
 const register=(id:string,o:T.Group|null)=>{if(o)registered.set(id,o);else registered.delete(id)}
 const draw=()=>{const state:SiteLayerState={items,preview:null,selected:null,onSelect:()=>{},onRegister:register,pathDateRef:dateRef,paths:[]};root.render(<Canvas gl={{localClippingEnabled:true}} camera={{position:[25,20,20]}}><ambientLight/><SiteSceneLayer state={state} activities={activities} links={[]} profiles={[]} dateRef={dateRef} rendering={false}/><EquipmentPlayback rigs={rigEntries} objects={rigObjects} dateRef={dateRef} preview={null} onError={onError}/></Canvas>)}
 const wait=()=>new Promise(r=>setTimeout(r,180)),near=(a:number,b:number)=>{if(Math.abs(a-b)>1e-5)throw Error(`${a} != ${b}`)}
 const visible=(id:string)=>registered.get(id)!.children[0].visible
 const mats=()=>{const result:T.Material[]=[];registered.get('soil')!.traverse(n=>{if(n instanceof T.Mesh)result.push(...(Array.isArray(n.material)?n.material:[n.material]))});return result}
 try{
  draw();for(let i=0;i<80&&!registered.has('machine');i++)await wait();await wait();
  const machine=registered.get('machine')!,entry=[...equipmentNodes(machine)].find(([,n])=>n instanceof T.Mesh)!;const tool=entry[1],rest=tool.getWorldPosition(new T.Vector3()).z;
  rigObjects=[{name:'site:machine',kind:'mesh',object:machine}];rigEntries=[{id:'rig',project_id:'project',model_ref:'site:machine',name:'Test rig',version:1,definition:{schema_version:1,controls:[{id:'auger',name:'Auger',value:0,rest:0,keys:[]}],joints:[{id:'slide',name:'Slide',node:entry[0],parent:null,control:'auger',kind:'slide',pivot:[0,0,0],axis:[0,0,1],minimum:-20,maximum:0,response:[[0,1],[1,0]]}],followers:[]}}];draw();await wait();if(rigError)throw Error(rigError);
  dateRef.current=new Date(base+h);await wait();near(registered.get('machine')!.getWorldPosition(new T.Vector3()).x,5)
  dateRef.current=new Date(base+5.25*h);await wait();near(registered.get('machine')!.getWorldPosition(new T.Vector3()).x,10);near(registered.get('machine')!.userData.workSequenceControl.value,.25);near(registered.get('machine')!.rotation.z,.2);near(tool.getWorldPosition(new T.Vector3()).z,rest-5)
  if(!mats().every(m=>m.clippingPlanes?.length===1&&m.clipShadows))throw Error('Excavation must clip geometry and shadows')
  if(visible('pile'))throw Error('Pile appeared before withdrawal')
  dateRef.current=new Date(base+11*h);await wait();if(visible('soil')||!visible('pile'))throw Error('Work completion visibility is wrong')
  dateRef.current=new Date(base+h);await wait();if(!visible('soil')||visible('pile')||mats().some(m=>m.clippingPlanes?.length))throw Error('Reverse seek did not restore volumes')
  dateRef.current=new Date(base+5.25*h);await wait();items=items.map(i=>({...i,work_sequence:null})) as typeof items;draw();await wait();near(registered.get('machine')!.getWorldPosition(new T.Vector3()).x,0);near(tool.getWorldPosition(new T.Vector3()).z,rest);if(!visible('pile')||mats().some(m=>m.clippingPlanes?.length))throw Error('Removing setup did not restore state')
  return {passed:true,checks:['actual scene movement','actual equipment slide control','excavation clipping and shadow flags','pile completion','reverse scrub','setup removal']}
 }finally{root.unmount();host.remove()}
}

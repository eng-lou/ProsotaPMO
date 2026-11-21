import React from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas} from '@react-three/fiber'
import * as T from 'three'
import {LoadHandlingLayer} from '../../src/modules/fourD/LoadHandlingLayer'
import {LoadHandlingPanel} from '../../src/modules/fourD/LoadHandlingPanel'
import {captureLoadEvent,loadDates} from '../../src/modules/fourD/loadHandling'
import type {SiteItem} from '../../src/modules/fourD/siteScene'

export async function run(){
 const host=document.createElement('div');host.style.cssText='width:900px;height:600px';document.body.appendChild(host)
 const ui=document.createElement('div');document.body.appendChild(ui)
 const root=createRoot(host),panel=createRoot(ui),deck=new T.Group(),carrier=new T.Group(),motion=new T.Group(),world=new T.Group()
 const tray=new T.Group(),eye=new T.Group();eye.name='LiftEye_1';tray.add(eye);deck.add(tray);
 world.add(motion,carrier);motion.add(deck);deck.position.set(3,0,0);carrier.position.set(0,4,0)
 deck.add(new T.Mesh(new T.BoxGeometry(3,.15,4),new T.MeshStandardMaterial({color:'blue'})))
 const dates={current:new Date('2026-11-20T12:00:00Z')},roots={current:new Map([['deck',deck],['crane',carrier]])}
 let items=[{id:'deck',name:'Deck',up_axis:'y',position:{x:3,y:0,z:0},load_handling:{events:[],lifting_nodes:['LiftEye_1','','',''],lifting_points:[[-1,0,-1],[1,0,-1],[-1,0,1],[1,0,1]]}},{id:'crane',name:'Crane',position:{x:0,y:4,z:0}}] as SiteItem[]
 const draw=()=>{root.render(<Canvas camera={{position:[12,12,12]}}><ambientLight intensity={2}/><primitive object={world}/><LoadHandlingLayer items={items} roots={roots} dateRef={dates}/></Canvas>);panel.render(<LoadHandlingPanel item={items[0]} items={items} date={()=>dates.current} onSeek={d=>{dates.current=d}} onApply={async patch=>{items=[{...items[0],...patch},...items.slice(1)];draw()}}/>)}
 const wait=async()=>{await new Promise(r=>setTimeout(r,160))},near=(x:number,y:number)=>{if(Math.abs(x-y)>1e-5)throw Error(`${x} != ${y}`)}
 try{
  draw();for(let i=0;i<80&&!loadDates.has('deck');i++)await wait()
  const e=captureLoadEvent(items[0],'crane','',dates.current,true);items[0].load_handling!.events.push(e);draw();await wait();near(deck.getWorldPosition(new T.Vector3()).x,3)
  carrier.position.x=5;await wait();near(deck.getWorldPosition(new T.Vector3()).x,8)
  carrier.add(new T.Mesh(new T.BoxGeometry(.2,.2,.2).translate(0,3,0),new T.MeshStandardMaterial()))
  const visibleSlings=()=>{let count=0;world.parent?.traverse(n=>{const mesh=n as T.Mesh;if(mesh.isMesh&&mesh.geometry.type==='CylinderGeometry'&&mesh.visible&&(mesh.material as T.MeshStandardMaterial).color?.getHexString()==='d6a63c')count++});return count}
  if(visibleSlings()!==4)throw Error('Four sling legs must follow the hook')
  const slingBottom=()=>{let found:T.Mesh|undefined;world.parent?.traverse(n=>{const mesh=n as T.Mesh;if(!found&&mesh.isMesh&&mesh.geometry.type==='CylinderGeometry'&&mesh.visible&&(mesh.material as T.MeshStandardMaterial).color?.getHexString()==='d6a63c')found=mesh});return found!.localToWorld(new T.Vector3(0,-.5,0))}
  await wait();let sling:T.Mesh|undefined;world.parent?.traverse(n=>{const m=n as T.Mesh;if(!sling&&m.isMesh&&m.geometry.type==='CylinderGeometry'&&(m.material as T.MeshStandardMaterial).color?.getHexString()==='d6a63c')sling=m});near(sling!.localToWorld(new T.Vector3(0,.5,0)).y,6.76)
  const details=[...ui.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Adjust hook connection')!;details.open=true;await wait()
  const offset=ui.querySelector('[aria-label="Hook offset Y"]') as HTMLInputElement;offset.focus();offset.value='-1';offset.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));await wait()
  near(items[0].load_handling!.events[0].sling_offset![1],-1);near(deck.getWorldPosition(new T.Vector3()).x,8)
  near(sling!.localToWorld(new T.Vector3(0,.5,0)).y,5.76)
  const ring=()=>{let found:T.Mesh|undefined;world.parent?.traverse(n=>{const m=n as T.Mesh;if(m.isMesh&&m.geometry.type==='TorusGeometry')found=m});return found!};if(!ring().visible)throw Error('Master ring missing')
  tray.position.z=2;await wait();near(slingBottom().z,2)
  tray.position.z=-1;await wait();near(slingBottom().z,-1)
  tray.position.z=0;await wait()
  // Remove the two far-side eyes: the real layer must let the deck hang sideways.
  items[0].load_handling={...items[0].load_handling!,lifting_points:[[-1,0,-1],[1,0,-1]],lifting_nodes:['',''],center_of_gravity:[0,0,0]};draw();await wait();
  near(deck.getWorldPosition(new T.Vector3()).y,-1);near(deck.getWorldPosition(new T.Vector3()).z,-1);if(visibleSlings()!==2)throw Error('Expected two remaining sling legs');
  const hanging=deck.quaternion.clone();if(hanging.angleTo(new T.Quaternion())<1)throw Error('Two-point deck stayed level');
  dates.current=new Date(dates.current.getTime()+1000);await wait()
  // Exercise the real authoring button and save callback.
  const release=[...ui.querySelectorAll('button')].find(b=>b.textContent==='Release here')!;release.click();await wait()
  if(items[0].load_handling!.events.length!==2)throw Error('Release button did not save')
  carrier.position.x=20;await wait();near(deck.getWorldPosition(new T.Vector3()).x,8);near(deck.quaternion.angleTo(hanging),0)
  if(visibleSlings()!==0||ring().visible)throw Error('Released slings and ring must disappear')
  dates.current=new Date(e.date);await wait();near(deck.getWorldPosition(new T.Vector3()).x,23)
  dates.current=new Date(Date.parse(e.date)-1000);await wait();near(deck.getWorldPosition(new T.Vector3()).x,3)
  items[0].load_handling!.events=[];draw();await wait();near(deck.position.x,3)
  // Real two-crane solver, release and deterministic scrubbing.
  const second=new T.Group();second.position.set(4,5,0);world.add(second);roots.current.set('crane2',second);carrier.clear();carrier.position.set(2,4,0)
  items.push({id:'crane2',name:'Second crane',position:{x:4,y:5,z:0}} as SiteItem)
  items[0].load_handling={events:[],lifting_points:[[-1,0,0],[1,0,0]],center_of_gravity:[0,0,0]};draw();await wait()
  const lift=captureLoadEvent(items[0],'crane','',dates.current,true);lift.rigging={mass_kg:1000,legs:[{point:0,parent_id:'crane',node:'',length:4},{point:1,parent_id:'crane2',node:'',length:4}]}
  items[0].load_handling.events=[lift];draw();await wait();const pose=deck.matrixWorld.clone();if(deck.quaternion.angleTo(new T.Quaternion())<.2)throw Error('Independent hooks did not tilt load')
  const rigEditor=[...ui.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Rigging solver / multiple hooks')!;rigEditor.open=true;await wait()
  const saveRig=[...rigEditor.querySelectorAll('button')].find(b=>b.textContent==='Save rigging')!;saveRig.click();await wait();if(items[0].load_handling?.events[0].rigging?.legs[1].parent_id!=='crane2')throw Error('Rig editor lost second crane')
  second.position.y=6;await wait();if(deck.matrixWorld.equals(pose))throw Error('Second hook motion ignored')
  second.position.y=5;await wait();pose.elements.forEach((v,i)=>near(v,deck.matrixWorld.elements[i]))
  dates.current=new Date(dates.current.getTime()+1000);await wait();const setDown=captureLoadEvent(items[0],null,'',dates.current,false);items[0].load_handling.events.push(setDown);draw();await wait();second.position.y=8;carrier.position.y=9;await wait();pose.elements.forEach((v,i)=>near(v,deck.matrixWorld.elements[i]))
  return {passed:true,checks:['two-crane solver and release','two-point hanging pose','release preserves tilt','live carrier following','release button persists pose','reverse seek','before first event','remove events']}
 }finally{root.unmount();panel.unmount();host.remove();ui.remove()}
}

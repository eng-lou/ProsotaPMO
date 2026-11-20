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
 let items=[{id:'deck',name:'Deck',position:{x:3,y:0,z:0},load_handling:{events:[],lifting_nodes:['LiftEye_1','','',''],lifting_points:[[-1,0,-1],[1,0,-1],[-1,0,1],[1,0,1]]}},{id:'crane',name:'Crane',position:{x:0,y:4,z:0}}] as SiteItem[]
 const draw=()=>{root.render(<Canvas camera={{position:[12,12,12]}}><ambientLight intensity={2}/><primitive object={world}/><LoadHandlingLayer items={items} roots={roots} dateRef={dates}/></Canvas>);panel.render(<LoadHandlingPanel item={items[0]} items={items} date={()=>dates.current} onSeek={d=>{dates.current=d}} onApply={async patch=>{items=[{...items[0],...patch},items[1]];draw()}}/>)}
 const wait=async()=>{await new Promise(r=>setTimeout(r,160))},near=(x:number,y:number)=>{if(Math.abs(x-y)>1e-5)throw Error(`${x} != ${y}`)}
 try{
  draw();for(let i=0;i<80&&!loadDates.has('deck');i++)await wait()
  const e=captureLoadEvent(items[0],'crane','',dates.current,true);items[0].load_handling!.events.push(e);draw();await wait();near(deck.getWorldPosition(new T.Vector3()).x,3)
  carrier.position.x=5;await wait();near(deck.getWorldPosition(new T.Vector3()).x,8)
  const visibleSlings=()=>{let count=0;world.parent?.traverse(n=>{const mesh=n as T.Mesh;if(mesh.isMesh&&mesh.visible&&(mesh.material as T.MeshStandardMaterial).color?.getHexString()==='d6a63c')count++});return count}
  if(visibleSlings()!==4)throw Error('Four sling legs must follow the hook')
  const slingBottom=()=>{let found:T.Mesh|undefined;world.parent?.traverse(n=>{const mesh=n as T.Mesh;if(!found&&mesh.isMesh&&mesh.visible&&(mesh.material as T.MeshStandardMaterial).color?.getHexString()==='d6a63c')found=mesh});return found!.localToWorld(new T.Vector3(0,-.5,0))}
  tray.position.z=2;await wait();near(slingBottom().z,2)
  tray.position.z=-1;await wait();near(slingBottom().z,-1)
  tray.position.z=0;await wait()
  dates.current=new Date(dates.current.getTime()+1000);await wait()
  // Exercise the real authoring button and save callback.
  const release=[...ui.querySelectorAll('button')].find(b=>b.textContent==='Release here')!;release.click();await wait()
  if(items[0].load_handling!.events.length!==2)throw Error('Release button did not save')
  carrier.position.x=20;await wait();near(deck.getWorldPosition(new T.Vector3()).x,8)
  if(visibleSlings()!==0)throw Error('Released slings must disappear')
  dates.current=new Date(e.date);await wait();near(deck.getWorldPosition(new T.Vector3()).x,23)
  dates.current=new Date(Date.parse(e.date)-1000);await wait();near(deck.getWorldPosition(new T.Vector3()).x,3)
  items[0].load_handling!.events=[];draw();await wait();near(deck.position.x,3)
  return {passed:true,checks:['live carrier following','release button persists pose','reverse seek','before first event','remove events']}
 }finally{root.unmount();panel.unmount();host.remove();ui.remove()}
}

import '../../src/index.css'
import {checkPileSelection} from './pileSelection.fixture'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {WorkSequencePanel} from '../../src/modules/fourD/WorkSequencePanel'
import {ClimbingFormworkPanel} from '../../src/modules/fourD/ClimbingFormworkPanel'
import type {SiteItem} from '../../src/modules/fourD/siteScene'
export async function run(){
 const host=document.createElement('div');host.style.cssText='width:320px';document.body.appendChild(host);const root=createRoot(host),base=Date.parse('2026-11-01T00:00:00Z'),iso=(n:number)=>new Date(base+n*86400000).toISOString(),wait=()=>new Promise(r=>setTimeout(r,100));
 const activities=Array.from({length:150},(_,i)=>({id:String(i),code:`A${i}`,task_name:`Core ${i}`,start:iso(i*2),finish:iso(i*2+1)})) as any;
 const item={id:'machine',name:'Machine',up_axis:'z',position:{x:0,y:0,z:0},work_sequence:{kind:'tbm',axis:'z',offset:{x:0,y:0,z:0},path_id:'p',tool_control:null,tool_travel:20,tool_rest:0,tool_full:1,steps:[{id:'step',activity_id:'0',start:null,finish:null,start_chainage:0,end_chainage:10,position:{x:0,y:0,z:0},depth:10,travel_hours:0,excavation_id:null,pile_id:null}]}} as SiteItem
 const format={scheduleStart:new Date(base),timeDisplayMode:'date' as const,speedDaysPerSecond:1,fps:30},paths=[{id:'p',name:'Alignment',points:[{x:0,y:0,z:0},{x:20,y:0,z:0}],closed:false,curve_mode:'straight'}] as any;
 const draw=(climb=false)=>root.render(climb?<ClimbingFormworkPanel item={{...item,work_sequence:null,climbing_formwork:{axis:'z',reference_elevation:0,lifts:[{id:'lift',activity_id:'0',height:0,duration_hours:24,start:null,finish:null}]}}} activities={activities} axis="z" format={format} onSeek={()=>{}} onApply={async()=>{}} selectedSources={()=>[]} disabled={false}/>:<WorkSequencePanel item={item} items={[item]} activities={activities} paths={paths} projectId="" format={format} onSeek={()=>{}} onApply={async()=>{}} readPileBounds={()=>{throw Error("No pile selected")}} disabled={false}/>);
 function check(condition:unknown,message:string){if(!condition)throw Error(message)}
 try{
  draw();await wait();check(!host.textContent?.includes('Start chainage (m)'),'Closed step mounted its editor');
  const row=[...host.querySelectorAll('summary')].find(s=>s.textContent?.includes('1. Core 0'))!;row.click();await wait();check(host.textContent?.includes('Start chainage (m)'),'Step did not expand');
  const input=host.querySelector('input[type=number]')!;const light=getComputedStyle(input);check(light.fontFamily.includes('IBM Plex Sans'),'Prosota body font missing');check(light.backgroundColor==='rgb(248, 250, 252)','Light field background wrong');
  document.documentElement.classList.add('dark');await wait();const dark=getComputedStyle(input);check(dark.backgroundColor==='rgb(16, 31, 54)'&&dark.color==='rgb(230, 237, 247)','Dark input contrast wrong');check(getComputedStyle(host.querySelector('.construction-controls')!).colorScheme==='dark','Native date/select theme missing');
  const add=[...host.querySelectorAll('summary')].find(s=>s.textContent==='Add activities')!;add.click();await wait();check(host.querySelectorAll('input[type=checkbox]').length===100,'Activity results not bounded');check(host.textContent?.includes('Showing 100 of 149'),'Missing search count');
  const remove=[...host.querySelectorAll('button')].find(b=>b.textContent==='Remove sequence')!;remove.click();await wait();check(host.textContent?.includes('Discard changes'),'Missing discard action');[...host.querySelectorAll('button')].find(b=>b.textContent==='Discard changes')!.click();await wait();check(host.textContent?.includes('Core 0'),'Discard did not restore setup');
  draw(true);await wait();check(!host.querySelector('[aria-label="Lift 1 height"]'),'Closed climb editor mounted');[...host.querySelectorAll('summary')].find(s=>s.textContent?.includes('Core 0'))!.click();await wait();const height=host.querySelector('[aria-label="Lift 1 height"]')!;check(getComputedStyle(height).backgroundColor==='rgb(16, 31, 54)','Climb dark field wrong');
  check(host.scrollWidth<=host.clientWidth+1,'Panel overflows narrow sidebar');
  await checkPileSelection()
  return {passed:true,checks:['light and dark field colours','Prosota font','native control theme','lazy step editors','bounded activity search','discard changes','320px sidebar','mixed IFC and site marker selection preserves piling draft and saves to the rig']}
 }finally{root.unmount();host.remove();document.documentElement.classList.remove('dark')}
}

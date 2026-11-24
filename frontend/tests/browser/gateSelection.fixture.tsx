import React from 'react'
import {createRoot} from 'react-dom/client'
import {api} from '../../src/lib/api'
import {SiteToolsPanel} from '../../src/modules/fourD/SiteToolsPanel'
import {changeSiteSelection} from '../../src/modules/fourD/siteObjectSelection'
import type {SiteItem,useSiteScene} from '../../src/modules/fourD/siteScene'

export async function checkGateSelection(fence: SiteItem) {
  const host=document.createElement('div')
  document.body.appendChild(host)
  const root=createRoot(host), adapter=api.defaults.adapter
  api.defaults.adapter=async config=>({config,data:[],status:200,statusText:'OK',headers:{}})
  const first={...fence,name:'Main fence'}, second={...fence,id:'fence-2',name:'Second fence'}
  const surface={...first,id:'ground',kind:'shape',name:'Ground',enclosure:null} as SiteItem
  let items=[first,second,surface], ids=new Set<string>(), draft:SiteItem|null=null
  const noop=()=>{}
  const settle=()=>new Promise(resolve=>setTimeout(resolve,50))
  const summaries=(name:string)=>[...host.querySelectorAll('summary')].filter(s=>s.textContent===name)
  const setDraft:React.Dispatch<React.SetStateAction<SiteItem|null>>=value=>{draft=typeof value==='function'?value(draft):value}
  function draw(){
    const state={scene:{items},ready:true,draft,setDraft,setSelected:noop,setPlacing:noop,setError:noop,
      save:async(apply:(v:SiteItem[])=>SiteItem[])=>{items=apply(items);draw();return true}} as unknown as ReturnType<typeof useSiteScene>
    root.render(<SiteToolsPanel projectId="gate-test" state={state} selectedObjectIds={ids}
      onPickItems={(next,mode)=>{ids=changeSiteSelection(ids,next,mode);draw()}}
      paths={[]} zones={[]} activities={[]} sceneSources={[]} links={[]} profiles={[]} linkError={null} upAxis="y"
      sceneLightsEnabled enableSceneLights={noop} openPaths={noop} focusSite={noop} onGenerateSchedule={noop}
      readPileBounds={()=>{throw Error('Unused')}} onLink={noop} onUnlink={noop} onAssignProfile={noop}
      selectedShapeSources={()=>[]} hideShapeSources={()=>noop}/>)
  }
  async function pick(...selected:SiteItem[]){
    ids=new Set(selected.map(item=>'site:'+item.id))
    draw();await settle()
  }
  function count(expected:number,step:string){
    const actual=summaries('Gate pose').length
    if(actual!==expected)throw Error(step+': expected '+expected+' Gate pose panel(s), found '+actual)
  }
  try{
    await pick(first);count(1,'Selected fence')
    summaries('Gate pose')[0].click()
    for(let i=0;i<3;i++){
      await pick(second);count(1,'Switched fence')
      await pick(surface);count(0,'Selected ground')
      await pick(first);count(1,'Reselected fence')
    }
    await pick(first,second);count(0,'Multi-selection')
    await pick(first);summaries('Gate pose')[0].click()
    const slider=host.querySelector<HTMLInputElement>('input[type=range]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'.65')
    slider.dispatchEvent(new Event('input',{bubbles:true}));await settle()
    if((draft as SiteItem|null)?.id!==first.id)throw Error('Missing gate preview')
    const remove=[...host.querySelectorAll('button')].find(b=>b.textContent==='Remove Main fence')
    if(!remove)throw Error('Missing remove button')
    remove.click();await settle()
    count(0,'Removed fence with a live preview')
    if(draft!==null||items.some(i=>i.id===first.id))throw Error('Removed fence or preview survived')
    await pick(second);count(1,'Remaining fence')
    const entrance=second.enclosure!.openings[1]
    const built=second.layout!.openings!.filter(g=>g.start===entrance.start)
    items=[{...second,layout:{...second.layout,openings:built}},surface]
    draw();await settle()
    const options=()=>summaries('Gate pose')[0]?.closest('details')?.querySelectorAll('select option')
    if(options()?.length!==1||options()?.[0].value!=='1')throw Error('Entrance list includes a gate missing from the layout')
    items=[{...second,layout:{...second.layout,openings:[]}},surface]
    draw();await settle();count(0,'Removed last built gate')
    items=[{...second,kind:'shape'},surface]
    draw();await settle();count(0,'Replaced fence with leftover settings')
    items=[first,second,surface];await pick(first);count(1,'Restored fence')
    const clear=[...host.querySelectorAll('button')].find(b=>b.textContent==='Clear selection')!
    clear.click();await settle();count(0,'Cleared selection')
  }finally{root.unmount();host.remove();api.defaults.adapter=adapter}
}
